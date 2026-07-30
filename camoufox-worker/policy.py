from __future__ import annotations

import ipaddress
import json
import re
from typing import Iterable
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

INDEED_POSTING_ID = re.compile(r"^[0-9a-z-]{8,128}$", re.IGNORECASE)
SUPPORTED_EGRESS_HOST_SUFFIXES = (
    "indeed.com",
    "indeedcdn.com",
    "indeedstatic.com",
)


def configured_egress_suffixes(value: str) -> tuple[str, ...]:
    suffixes = tuple(
        entry.strip().rstrip(".").lower()
        for entry in value.split(",")
        if entry.strip()
    )
    if (
        not suffixes
        or len(suffixes) > len(SUPPORTED_EGRESS_HOST_SUFFIXES)
        or len(set(suffixes)) != len(suffixes)
        or "indeed.com" not in suffixes
        or any(suffix not in SUPPORTED_EGRESS_HOST_SUFFIXES for suffix in suffixes)
    ):
        raise ValueError("Invalid egress host allowlist")
    return suffixes


def json_event(event: str, **fields: object) -> str:
    return json.dumps(
        {"event": event, **fields},
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )


def host_matches(hostname: str, allowed_suffixes: Iterable[str]) -> bool:
    actual = hostname.rstrip(".").lower()
    return any(
        actual == suffix or actual.endswith(f".{suffix}")
        for suffix in allowed_suffixes
    )


def is_public_address(address: str) -> bool:
    try:
        parsed = ipaddress.ip_address(address)
    except ValueError:
        return False
    return parsed.is_global


def canonicalize_posting_url(provider: str, value: str) -> str | None:
    if len(value) > 2048 or provider != "indeed":
        return None
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        return None
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
        or not host_matches(parsed.hostname, ("indeed.com",))
    ):
        return None
    posting_ids = parse_qs(parsed.query, keep_blank_values=True).get("jk", [])
    if len(posting_ids) != 1 or not INDEED_POSTING_ID.fullmatch(posting_ids[0]):
        return None
    return urlunsplit(
        (
            "https",
            parsed.hostname.lower(),
            "/viewjob",
            urlencode({"jk": posting_ids[0]}),
            "",
        )
    )


def allowed_request_url(
    value: str,
    allowed_suffixes: Iterable[str],
) -> bool:
    if len(value) > 4096:
        return False
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        return False
    return bool(
        parsed.scheme == "https"
        and parsed.hostname
        and parsed.username is None
        and parsed.password is None
        and port in (None, 443)
        and host_matches(parsed.hostname, allowed_suffixes)
    )
