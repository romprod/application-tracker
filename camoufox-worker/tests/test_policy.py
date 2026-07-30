import asyncio
import socket
import unittest
from unittest.mock import AsyncMock, call, patch

from egress_proxy import (
    ProxyConfig,
    open_validated_connection,
    parse_connect_target,
    resolve_public_addresses,
)
from policy import (
    allowed_request_url,
    canonicalize_posting_url,
    configured_egress_suffixes,
    host_matches,
    is_public_address,
)


class PolicyTests(unittest.TestCase):
    def test_public_address_policy_rejects_reserved_ranges(self) -> None:
        for address in (
            "0.0.0.0",
            "10.0.0.1",
            "100.64.0.1",
            "127.0.0.1",
            "169.254.169.254",
            "172.16.0.1",
            "192.168.1.1",
            "198.51.100.1",
            "::1",
            "fc00::1",
            "fe80::1",
            "2001:db8::1",
        ):
            self.assertFalse(is_public_address(address), address)
        self.assertTrue(is_public_address("1.1.1.1"))
        self.assertTrue(is_public_address("2606:4700:4700::1111"))

    def test_exact_canonical_posting_url(self) -> None:
        canonical = "https://uk.indeed.com/viewjob?jk=96550901704ee48a"
        self.assertEqual(canonicalize_posting_url("indeed", canonical), canonical)
        self.assertEqual(
            canonicalize_posting_url(
                "indeed",
                "https://uk.indeed.com/pagead/clk?from=email&jk=96550901704ee48a",
            ),
            canonical,
        )
        for rejected in (
            "http://uk.indeed.com/viewjob?jk=96550901704ee48a",
            "https://example.com/viewjob?jk=96550901704ee48a",
            "https://uk.indeed.com:444/viewjob?jk=96550901704ee48a",
            "https://user:secret@uk.indeed.com/viewjob?jk=96550901704ee48a",
            "https://uk.indeed.com/viewjob",
        ):
            self.assertIsNone(canonicalize_posting_url("indeed", rejected))

    def test_subresource_and_connect_allowlists(self) -> None:
        suffixes = ("indeed.com", "indeedcdn.com")
        self.assertTrue(host_matches("uk.indeed.com", suffixes))
        self.assertFalse(host_matches("indeed.com.example.net", suffixes))
        self.assertTrue(
            allowed_request_url("https://static.indeedcdn.com/app.js", suffixes)
        )
        self.assertFalse(
            allowed_request_url("https://169.254.169.254/latest", suffixes)
        )
        self.assertEqual(
            parse_connect_target("CONNECT uk.indeed.com:443 HTTP/1.1"),
            ("uk.indeed.com", 443),
        )
        self.assertIsNone(
            parse_connect_target("CONNECT uk.indeed.com:8443 HTTP/1.1")
        )
        self.assertIsNone(parse_connect_target("GET https://example.com/ HTTP/1.1"))

    def test_egress_allowlist_cannot_be_broadened_by_environment(self) -> None:
        self.assertEqual(
            configured_egress_suffixes("indeed.com,indeedcdn.com"),
            ("indeed.com", "indeedcdn.com"),
        )
        for rejected in (
            "",
            "indeedcdn.com",
            "indeed.com,example.com",
            "indeed.com,indeed.com",
        ):
            with self.assertRaisesRegex(ValueError, "egress host allowlist"):
                configured_egress_suffixes(rejected)
        with patch.dict(
            "os.environ",
            {"CAMOUFOX_EGRESS_ALLOWED_HOST_SUFFIXES": "indeed.com,example.com"},
        ):
            with self.assertRaisesRegex(ValueError, "egress host allowlist"):
                ProxyConfig.from_environment()


class ResolutionTests(unittest.IsolatedAsyncioTestCase):
    async def test_dns_resolution_rejects_any_private_answer(self) -> None:
        loop = asyncio.get_running_loop()
        answers = [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("1.1.1.1", 443)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443)),
        ]
        with patch.object(loop, "getaddrinfo", return_value=answers):
            with self.assertRaisesRegex(ValueError, "non_public_address"):
                await resolve_public_addresses("uk.indeed.com")

    async def test_connect_tries_later_validated_address_after_failure(self) -> None:
        remote_reader = AsyncMock()
        remote_writer = AsyncMock()
        connect = AsyncMock(
            side_effect=[
                OSError("IPv6 route unavailable"),
                (remote_reader, remote_writer),
            ]
        )
        addresses = [
            (socket.AF_INET6, "2606:4700:4700::1111"),
            (socket.AF_INET, "1.1.1.1"),
        ]
        with patch("egress_proxy.asyncio.open_connection", connect):
            family, reader, writer = await open_validated_connection(
                addresses,
                443,
                1,
            )
        self.assertEqual(family, socket.AF_INET)
        self.assertIs(reader, remote_reader)
        self.assertIs(writer, remote_writer)
        self.assertEqual(
            connect.await_args_list,
            [
                call("2606:4700:4700::1111", 443, family=socket.AF_INET6),
                call("1.1.1.1", 443, family=socket.AF_INET),
            ],
        )
