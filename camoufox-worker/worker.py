from __future__ import annotations

import asyncio
import hmac
import json
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

from policy import (
    SUPPORTED_EGRESS_HOST_SUFFIXES,
    allowed_request_url,
    canonicalize_posting_url,
    configured_egress_suffixes,
    host_matches,
    json_event,
)

MAXIMUM_REQUEST_BYTES = 4096
MAXIMUM_SCRIPT_CHARACTERS = 131_072
MAXIMUM_POSTING_BYTES = 65_536
MAXIMUM_METADATA_NODES = 1000
MAXIMUM_RESPONSE_BYTES = 131_072


def bounded_integer(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as error:
        raise ValueError(f"Invalid {name}") from error
    if value < minimum or value > maximum:
        raise ValueError(f"Invalid {name}")
    return value


@dataclass(frozen=True)
class WorkerConfig:
    allowed_providers: tuple[str, ...]
    allowed_suffixes: tuple[str, ...]
    browser_executable: str
    cooldown_ms: int
    egress_proxy_url: str
    enabled: bool
    host: str
    max_concurrency: int
    minimum_interval_ms: int
    navigation_timeout_ms: int
    port: int
    token: str

    @classmethod
    def from_environment(cls) -> "WorkerConfig":
        enabled_value = os.getenv("CAMOUFOX_WORKER_ENABLED", "false")
        if enabled_value not in ("true", "false"):
            raise ValueError("Invalid worker enabled flag")
        enabled = enabled_value == "true"
        providers = tuple(
            entry.strip().lower()
            for entry in os.getenv("CAMOUFOX_FALLBACK_PROVIDERS", "").split(",")
            if entry.strip()
        )
        if len(providers) > 8 or any(provider != "indeed" for provider in providers):
            raise ValueError("Invalid provider allowlist")
        suffixes = configured_egress_suffixes(
            os.getenv(
                "CAMOUFOX_EGRESS_ALLOWED_HOST_SUFFIXES",
                ",".join(SUPPORTED_EGRESS_HOST_SUFFIXES),
            )
        )
        token = os.getenv("CAMOUFOX_WORKER_TOKEN", "")
        if enabled and (not providers or len(token) < 32 or len(token) > 512):
            raise ValueError("Enabled worker requires providers and a strong token")
        proxy_url = os.getenv(
            "CAMOUFOX_EGRESS_PROXY_URL",
            "http://camoufox-egress:8081",
        )
        proxy = urlsplit(proxy_url)
        if (
            proxy.scheme != "http"
            or proxy.hostname != "camoufox-egress"
            or proxy.port != 8081
            or proxy.username is not None
            or proxy.password is not None
            or proxy.path not in ("", "/")
            or proxy.query
            or proxy.fragment
        ):
            raise ValueError("Invalid egress proxy URL")
        return cls(
            allowed_providers=providers,
            allowed_suffixes=suffixes,
            browser_executable=os.getenv(
                "CAMOUFOX_BROWSER_EXECUTABLE",
                "/opt/camoufox/camoufox-bin",
            ),
            cooldown_ms=bounded_integer(
                "CAMOUFOX_WORKER_COOLDOWN_MS",
                900_000,
                1_000,
                3_600_000,
            ),
            egress_proxy_url=proxy_url,
            enabled=enabled,
            host=os.getenv("CAMOUFOX_WORKER_HOST", "0.0.0.0"),
            max_concurrency=bounded_integer(
                "CAMOUFOX_WORKER_MAX_CONCURRENCY",
                1,
                1,
                4,
            ),
            minimum_interval_ms=bounded_integer(
                "CAMOUFOX_WORKER_MIN_INTERVAL_MS",
                5_000,
                0,
                60_000,
            ),
            navigation_timeout_ms=bounded_integer(
                "CAMOUFOX_WORKER_NAVIGATION_TIMEOUT_MS",
                12_000,
                1_000,
                30_000,
            ),
            port=bounded_integer("CAMOUFOX_WORKER_PORT", 8080, 1, 65535),
            token=token,
        )


@dataclass
class ProviderState:
    cooldown_until: float = 0
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    next_request_at: float = 0


class InspectionGate:
    def __init__(self, config: WorkerConfig) -> None:
        self.config = config
        self.active = 0
        self.lock = asyncio.Lock()
        self.states: dict[str, ProviderState] = {}

    async def enter(self, provider: str) -> tuple[ProviderState | None, str | None]:
        async with self.lock:
            if self.active >= self.config.max_concurrency:
                return None, "resource_exhausted"
            self.active += 1
            return self.states.setdefault(provider, ProviderState()), None

    async def leave(self) -> None:
        async with self.lock:
            self.active = max(0, self.active - 1)

    async def pace(self, state: ProviderState) -> float | None:
        now = time.monotonic()
        if state.cooldown_until > now:
            return state.cooldown_until
        wait_seconds = max(0, state.next_request_at - now)
        if wait_seconds:
            await asyncio.sleep(wait_seconds)
        state.next_request_at = (
            time.monotonic() + self.config.minimum_interval_ms / 1000
        )
        return None

    def challenge(self, state: ProviderState) -> None:
        state.cooldown_until = time.monotonic() + self.config.cooldown_ms / 1000


def is_record(value: object) -> bool:
    return isinstance(value, dict)


def is_job_posting(value: object) -> bool:
    if not isinstance(value, dict):
        return False
    raw_types = value.get("@type")
    types = raw_types if isinstance(raw_types, list) else [raw_types]
    return any(
        isinstance(entry, str)
        and entry.lower()
        .removeprefix("https://schema.org/")
        .removeprefix("http://schema.org/")
        == "jobposting"
        for entry in types
    )


def collect_job_postings(value: object) -> list[dict[str, Any]]:
    postings: list[dict[str, Any]] = []
    visited = 0

    def visit(candidate: object, depth: int) -> None:
        nonlocal visited
        if depth > 10 or visited >= MAXIMUM_METADATA_NODES:
            return
        visited += 1
        if isinstance(candidate, list):
            for entry in candidate:
                visit(entry, depth + 1)
            return
        if not isinstance(candidate, dict):
            return
        if is_job_posting(candidate):
            postings.append(candidate)
        for nested in candidate.values():
            visit(nested, depth + 1)

    visit(value, 0)
    return postings


def posting_urls(posting: dict[str, Any]) -> list[str]:
    values: list[str] = []
    if isinstance(posting.get("url"), str):
        values.append(posting["url"])
    actions = posting.get("potentialAction")
    for action in actions if isinstance(actions, list) else [actions]:
        if not isinstance(action, dict):
            continue
        targets = action.get("target")
        for target in targets if isinstance(targets, list) else [targets]:
            if isinstance(target, str):
                values.append(target)
            elif isinstance(target, dict) and isinstance(
                target.get("urlTemplate"), str
            ):
                values.append(target["urlTemplate"])
    return values


def select_structured_posting(
    scripts: list[str],
    provider: str,
    canonical_url: str,
) -> tuple[dict[str, Any] | None, str | None]:
    postings: list[dict[str, Any]] = []
    malformed = False
    for script in scripts[:20]:
        source = script.strip()
        if not source or len(source) > MAXIMUM_SCRIPT_CHARACTERS:
            malformed = malformed or bool(source)
            continue
        try:
            postings.extend(collect_job_postings(json.loads(source)))
        except (json.JSONDecodeError, RecursionError):
            malformed = True
    if not postings:
        return None, (
            "malformed_structured_data"
            if malformed
            else "missing_structured_data"
        )
    if len(postings) == 1:
        selected = postings[0]
    else:
        exact = [
            posting
            for posting in postings
            if any(
                canonicalize_posting_url(provider, value) == canonical_url
                for value in posting_urls(posting)
            )
        ]
        if len(exact) != 1:
            return None, "ambiguous_metadata"
        selected = exact[0]
    encoded = json.dumps(
        selected,
        ensure_ascii=True,
        separators=(",", ":"),
    ).encode("utf-8")
    if len(encoded) > MAXIMUM_POSTING_BYTES:
        return None, "resource_exhausted"
    return selected, None


def challenge_title(value: str) -> bool:
    normalized = " ".join(value.lower().split())
    return any(
        marker in normalized
        for marker in (
            "security check",
            "verify you are human",
            "captcha",
            "attention required",
        )
    )


async def inspect_with_browser(
    config: WorkerConfig,
    provider: str,
    canonical_url: str,
) -> dict[str, Any]:
    from camoufox import DefaultAddons
    from camoufox.async_api import AsyncCamoufox
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    blocked_requests = 0
    redirect_escape = False

    try:
        async with AsyncCamoufox(
            block_images=True,
            block_webrtc=True,
            enable_cache=False,
            executable_path=config.browser_executable,
            exclude_addons=[DefaultAddons.UBO],
            ff_version=152,
            geoip=False,
            headless=True,
            humanize=False,
            i_know_what_im_doing=True,
            proxy={"server": config.egress_proxy_url},
            firefox_user_prefs={
                "browser.cache.disk.enable": False,
                "browser.cache.memory.enable": False,
                "browser.privatebrowsing.autostart": True,
                "dom.serviceWorkers.enabled": False,
                "media.peerconnection.enabled": False,
                "network.proxy.no_proxies_on": "",
            },
        ) as browser:
            context = await browser.new_context(
                accept_downloads=False,
                service_workers="block",
            )
            page = await context.new_page()

            async def route_request(route: Any) -> None:
                nonlocal blocked_requests, redirect_escape
                request = route.request
                value = request.url
                parsed = urlsplit(value)
                if not allowed_request_url(value, config.allowed_suffixes):
                    blocked_requests += 1
                    if request.is_navigation_request():
                        redirect_escape = True
                    await route.abort("blockedbyclient")
                    return
                if request.is_navigation_request():
                    candidate = canonicalize_posting_url(provider, value)
                    if candidate != canonical_url:
                        blocked_requests += 1
                        redirect_escape = True
                        await route.abort("blockedbyclient")
                        return
                if request.resource_type in ("font", "image", "media"):
                    await route.abort("blockedbyclient")
                    return
                await route.continue_()

            await context.route("**/*", route_request)
            response = await page.goto(
                canonical_url,
                timeout=config.navigation_timeout_ms,
                wait_until="domcontentloaded",
            )
            if redirect_escape:
                return unavailable(canonical_url, "blocked", blocked_requests)
            final_url = canonicalize_posting_url(provider, page.url)
            if final_url != canonical_url:
                return unavailable(canonical_url, "blocked", blocked_requests)
            status = response.status if response else 0
            title = await page.title()
            challenge_element = await page.locator(
                "iframe[src*='captcha' i], [id*='captcha' i], "
                "[class*='captcha' i], [data-sitekey]"
            ).count()
            if status in (403, 429) or challenge_title(title) or challenge_element:
                return unavailable(
                    canonical_url,
                    "provider_challenge",
                    blocked_requests,
                )
            if status in (404, 410):
                return unavailable(canonical_url, "expired", blocked_requests)
            if status < 200 or status >= 300:
                return unavailable(canonical_url, "blocked", blocked_requests)
            scripts = await page.locator(
                "script[type='application/ld+json' i]"
            ).all_text_contents()
            posting, reason = select_structured_posting(
                scripts,
                provider,
                canonical_url,
            )
            if reason or posting is None:
                return unavailable(
                    canonical_url,
                    reason or "worker_failure",
                    blocked_requests,
                )
            return {
                "blockedRequests": min(blocked_requests, 1000),
                "canonicalUrl": canonical_url,
                "posting": posting,
                "status": "available",
                "version": 1,
            }
    except PlaywrightTimeoutError:
        return unavailable(canonical_url, "navigation_timeout", blocked_requests)
    except Exception:
        return unavailable(canonical_url, "worker_failure", blocked_requests)


def unavailable(
    canonical_url: str,
    reason: str,
    blocked_requests: int = 0,
    retry_after: str | None = None,
) -> dict[str, Any]:
    return {
        "blockedRequests": min(max(0, blocked_requests), 1000),
        "canonicalUrl": canonical_url,
        "reason": reason,
        **({"retryAfter": retry_after} if retry_after else {}),
        "status": "unavailable",
        "version": 1,
    }


def retry_after(config: WorkerConfig) -> str:
    return datetime.fromtimestamp(
        time.time() + config.cooldown_ms / 1000,
        tz=timezone.utc,
    ).isoformat(timespec="milliseconds").replace("+00:00", "Z")


async def inspect(
    config: WorkerConfig,
    gate: InspectionGate,
    payload: object,
) -> dict[str, Any]:
    if not config.enabled:
        return unavailable("", "worker_disabled")
    if (
        not isinstance(payload, dict)
        or set(payload) != {"canonicalUrl", "provider"}
        or not isinstance(payload.get("canonicalUrl"), str)
        or not isinstance(payload.get("provider"), str)
    ):
        return unavailable("", "blocked")
    provider = payload["provider"]
    canonical_url = payload["canonicalUrl"]
    if (
        provider not in config.allowed_providers
        or canonicalize_posting_url(provider, canonical_url) != canonical_url
    ):
        return unavailable("", "blocked")
    state, denied = await gate.enter(provider)
    if denied or state is None:
        return unavailable(canonical_url, denied or "resource_exhausted")
    try:
        async with state.lock:
            cooldown_until = await gate.pace(state)
            if cooldown_until is not None:
                remaining_ms = max(0, int((cooldown_until - time.monotonic()) * 1000))
                return unavailable(
                    canonical_url,
                    "provider_challenge",
                    retry_after=datetime.fromtimestamp(
                        time.time() + remaining_ms / 1000,
                        tz=timezone.utc,
                    )
                    .isoformat(timespec="milliseconds")
                    .replace("+00:00", "Z"),
                )
            try:
                result = await asyncio.wait_for(
                    inspect_with_browser(config, provider, canonical_url),
                    timeout=config.navigation_timeout_ms / 1000,
                )
            except asyncio.TimeoutError:
                result = unavailable(canonical_url, "navigation_timeout")
            if (
                result.get("status") == "unavailable"
                and result.get("reason") == "provider_challenge"
            ):
                gate.challenge(state)
                result["retryAfter"] = retry_after(config)
            return result
    finally:
        await gate.leave()


async def read_request(
    reader: asyncio.StreamReader,
) -> tuple[str, str, dict[str, str], bytes]:
    header = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 5)
    if len(header) > 8192:
        raise ValueError("header_too_large")
    lines = header.decode("ascii", "strict").split("\r\n")
    request_parts = lines[0].split()
    if len(request_parts) != 3 or request_parts[2] != "HTTP/1.1":
        raise ValueError("invalid_request")
    headers: dict[str, str] = {}
    for line in lines[1:]:
        if not line:
            continue
        name, separator, value = line.partition(":")
        if not separator:
            raise ValueError("invalid_request")
        headers[name.strip().lower()] = value.strip()
    try:
        length = int(headers.get("content-length", "0"))
    except ValueError as error:
        raise ValueError("invalid_request") from error
    if length < 0 or length > MAXIMUM_REQUEST_BYTES:
        raise ValueError("request_too_large")
    body = await asyncio.wait_for(reader.readexactly(length), 5) if length else b""
    return request_parts[0], request_parts[1], headers, body


async def send_json(
    writer: asyncio.StreamWriter,
    status: str,
    payload: dict[str, Any],
) -> None:
    encoded = json.dumps(
        payload,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    if len(encoded) > MAXIMUM_RESPONSE_BYTES:
        status = "503 Service Unavailable"
        encoded = json.dumps(
            unavailable("", "resource_exhausted"),
            separators=(",", ":"),
        ).encode("utf-8")
    writer.write(
        (
            f"HTTP/1.1 {status}\r\n"
            "Connection: close\r\n"
            "Content-Type: application/json\r\n"
            f"Content-Length: {len(encoded)}\r\n\r\n"
        ).encode("ascii")
        + encoded
    )
    await writer.drain()


async def handle_connection(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    config: WorkerConfig,
    gate: InspectionGate,
) -> None:
    outcome = "rejected"
    reason = "invalid_request"
    started = time.monotonic()
    provider = "none"
    try:
        method, path, headers, body = await read_request(reader)
        if method == "GET" and path == "/health":
            await send_json(
                writer,
                "200 OK",
                {
                    "enabled": config.enabled,
                    "service": "camoufox-worker",
                    "status": "ok",
                    "version": 1,
                },
            )
            outcome = "health"
            reason = "none"
            return
        authorization = headers.get("authorization", "")
        expected = f"Bearer {config.token}"
        if (
            method != "POST"
            or path != "/v1/inspect"
            or not config.enabled
            or not hmac.compare_digest(authorization, expected)
            or headers.get("content-type", "").split(";", 1)[0]
            != "application/json"
        ):
            await send_json(
                writer,
                "403 Forbidden",
                unavailable("", "worker_disabled" if not config.enabled else "blocked"),
            )
            reason = "worker_disabled" if not config.enabled else "blocked"
            return
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            await send_json(writer, "400 Bad Request", unavailable("", "blocked"))
            reason = "blocked"
            return
        if isinstance(payload, dict) and isinstance(payload.get("provider"), str):
            provider = payload["provider"]
        result = await inspect(config, gate, payload)
        await send_json(writer, "200 OK", result)
        outcome = str(result["status"])
        reason = str(result.get("reason", "none"))
    except (
        asyncio.IncompleteReadError,
        asyncio.LimitOverrunError,
        asyncio.TimeoutError,
        ConnectionError,
        UnicodeError,
        ValueError,
    ):
        if not writer.is_closing():
            await send_json(writer, "400 Bad Request", unavailable("", "blocked"))
    finally:
        if not writer.is_closing():
            writer.close()
        try:
            await writer.wait_closed()
        except ConnectionError:
            pass
        print(
            json_event(
                "camoufox_worker_inspection",
                durationMs=round((time.monotonic() - started) * 1000),
                outcome=outcome,
                provider=provider if provider in config.allowed_providers else "none",
                reason=reason,
            ),
            flush=True,
        )


async def main() -> None:
    config = WorkerConfig.from_environment()
    gate = InspectionGate(config)
    server = await asyncio.start_server(
        lambda reader, writer: handle_connection(reader, writer, config, gate),
        config.host,
        config.port,
        limit=8192,
    )
    print(
        json_event(
            "camoufox_worker_started",
            enabled=config.enabled,
            maxConcurrency=config.max_concurrency,
            providerCount=len(config.allowed_providers),
        ),
        flush=True,
    )
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
