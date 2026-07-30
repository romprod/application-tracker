from __future__ import annotations

import asyncio
import os
import socket
from dataclasses import dataclass

from policy import (
    SUPPORTED_EGRESS_HOST_SUFFIXES,
    configured_egress_suffixes,
    host_matches,
    is_public_address,
    json_event,
)

MAXIMUM_HEADER_BYTES = 8192
MAXIMUM_TUNNEL_SECONDS = 30


@dataclass(frozen=True)
class ProxyConfig:
    allowed_suffixes: tuple[str, ...]
    host: str
    port: int

    @classmethod
    def from_environment(cls) -> "ProxyConfig":
        suffixes = configured_egress_suffixes(
            os.getenv(
                "CAMOUFOX_EGRESS_ALLOWED_HOST_SUFFIXES",
                ",".join(SUPPORTED_EGRESS_HOST_SUFFIXES),
            )
        )
        return cls(
            allowed_suffixes=suffixes,
            host=os.getenv("CAMOUFOX_EGRESS_HOST", "0.0.0.0"),
            port=bounded_integer("CAMOUFOX_EGRESS_PORT", 8081, 1, 65535),
        )


def bounded_integer(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as error:
        raise ValueError(f"Invalid {name}") from error
    if value < minimum or value > maximum:
        raise ValueError(f"Invalid {name}")
    return value


def parse_connect_target(request_line: str) -> tuple[str, int] | None:
    parts = request_line.split()
    if len(parts) != 3 or parts[0] != "CONNECT" or parts[2] != "HTTP/1.1":
        return None
    target = parts[1]
    if target.count(":") != 1:
        return None
    hostname, port_text = target.rsplit(":", 1)
    if (
        not hostname
        or len(hostname) > 253
        or not port_text.isdigit()
        or int(port_text) != 443
    ):
        return None
    return hostname.rstrip(".").lower(), 443


async def resolve_public_addresses(hostname: str) -> list[tuple[int, str]]:
    loop = asyncio.get_running_loop()
    resolved = await loop.getaddrinfo(
        hostname,
        443,
        type=socket.SOCK_STREAM,
        proto=socket.IPPROTO_TCP,
    )
    addresses: list[tuple[int, str]] = []
    for family, _type, _protocol, _canonical, sockaddr in resolved:
        if family not in (socket.AF_INET, socket.AF_INET6):
            continue
        address = str(sockaddr[0])
        if not is_public_address(address):
            raise ValueError("non_public_address")
        candidate = (family, address)
        if candidate not in addresses:
            addresses.append(candidate)
    if not addresses:
        raise ValueError("non_public_address")
    return addresses


async def open_validated_connection(
    addresses: list[tuple[int, str]],
    port: int,
    timeout_seconds: float,
) -> tuple[int, asyncio.StreamReader, asyncio.StreamWriter]:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_seconds
    last_error: BaseException | None = None
    for index, (family, address) in enumerate(addresses):
        remaining = deadline - loop.time()
        if remaining <= 0:
            break
        attempt_timeout = remaining / (len(addresses) - index)
        try:
            remote_reader, remote_writer = await asyncio.wait_for(
                asyncio.open_connection(address, port, family=family),
                timeout=attempt_timeout,
            )
            return family, remote_reader, remote_writer
        except (OSError, asyncio.TimeoutError) as error:
            last_error = error
    raise ConnectionError("No validated address was reachable") from last_error


async def relay(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
) -> None:
    try:
        while data := await reader.read(64 * 1024):
            writer.write(data)
            await writer.drain()
    finally:
        writer.close()


async def write_response(
    writer: asyncio.StreamWriter,
    status: str,
) -> None:
    writer.write(
        f"HTTP/1.1 {status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n".encode(
            "ascii"
        )
    )
    await writer.drain()


async def handle_connection(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    config: ProxyConfig,
) -> None:
    outcome = "denied"
    family_name = "none"
    try:
        header = await asyncio.wait_for(
            reader.readuntil(b"\r\n\r\n"),
            timeout=5,
        )
        if len(header) > MAXIMUM_HEADER_BYTES:
            await write_response(writer, "431 Request Header Fields Too Large")
            return
        lines = header.decode("ascii", "strict").split("\r\n")
        if lines[0] == "GET /health HTTP/1.1":
            await write_response(writer, "200 OK")
            outcome = "health"
            return
        target = parse_connect_target(lines[0])
        if not target:
            await write_response(writer, "405 Method Not Allowed")
            return
        hostname, port = target
        if not host_matches(hostname, config.allowed_suffixes):
            await write_response(writer, "403 Forbidden")
            return
        addresses = await asyncio.wait_for(resolve_public_addresses(hostname), 5)
        family, remote_reader, remote_writer = await open_validated_connection(
            addresses,
            port,
            5,
        )
        family_name = "ipv4" if family == socket.AF_INET else "ipv6"
        await write_response(writer, "200 Connection Established")
        outcome = "connected"
        await asyncio.wait_for(
            asyncio.gather(
                relay(reader, remote_writer),
                relay(remote_reader, writer),
            ),
            timeout=MAXIMUM_TUNNEL_SECONDS,
        )
    except (
        asyncio.IncompleteReadError,
        asyncio.LimitOverrunError,
        asyncio.TimeoutError,
        ConnectionError,
        UnicodeError,
        ValueError,
    ):
        if not writer.is_closing():
            await write_response(writer, "502 Bad Gateway")
    finally:
        if not writer.is_closing():
            writer.close()
        try:
            await writer.wait_closed()
        except ConnectionError:
            pass
        print(
            json_event(
                "camoufox_egress_request",
                addressFamily=family_name,
                outcome=outcome,
            ),
            flush=True,
        )


async def main() -> None:
    config = ProxyConfig.from_environment()
    server = await asyncio.start_server(
        lambda reader, writer: handle_connection(reader, writer, config),
        config.host,
        config.port,
        limit=MAXIMUM_HEADER_BYTES,
    )
    print(
        json_event(
            "camoufox_egress_started",
            allowedSuffixCount=len(config.allowed_suffixes),
            port=config.port,
        ),
        flush=True,
    )
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
