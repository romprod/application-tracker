import asyncio
import json
import unittest
from dataclasses import replace
from unittest.mock import AsyncMock, patch

from worker import (
    InspectionGate,
    WorkerConfig,
    collect_job_postings,
    request_route_policy,
    select_structured_posting,
)

CANONICAL_URL = "https://uk.indeed.com/viewjob?jk=96550901704ee48a"


def config(**overrides: object) -> WorkerConfig:
    base = WorkerConfig(
        allowed_providers=("indeed",),
        allowed_suffixes=("indeed.com", "indeedcdn.com"),
        browser_executable="/opt/camoufox/camoufox-bin",
        cooldown_ms=1000,
        egress_proxy_url="http://camoufox-egress:8081",
        enabled=True,
        host="127.0.0.1",
        max_concurrency=1,
        minimum_interval_ms=0,
        navigation_timeout_ms=1000,
        port=8080,
        token="a" * 32,
    )
    return replace(base, **overrides)


class StructuredPostingTests(unittest.TestCase):
    def test_collects_one_bounded_job_posting(self) -> None:
        posting = {
            "@context": "https://schema.org",
            "@type": "JobPosting",
            "title": "Platform Engineer",
            "url": CANONICAL_URL,
        }
        self.assertEqual(collect_job_postings({"@graph": [posting]}), [posting])
        selected, reason = select_structured_posting(
            [json.dumps({"@graph": [posting]})],
            "indeed",
            CANONICAL_URL,
        )
        self.assertEqual(selected, posting)
        self.assertIsNone(reason)

    def test_distinguishes_missing_malformed_and_ambiguous_metadata(self) -> None:
        self.assertEqual(
            select_structured_posting([], "indeed", CANONICAL_URL),
            (None, "missing_structured_data"),
        )
        self.assertEqual(
            select_structured_posting(["{"], "indeed", CANONICAL_URL),
            (None, "malformed_structured_data"),
        )
        scripts = [
            json.dumps(
                [
                    {"@type": "JobPosting", "title": "One"},
                    {"@type": "JobPosting", "title": "Two"},
                ]
            )
        ]
        self.assertEqual(
            select_structured_posting(scripts, "indeed", CANONICAL_URL),
            (None, "ambiguous_metadata"),
        )

    def test_selects_only_one_exact_posting_from_multiple_records(self) -> None:
        exact = {
            "@type": "JobPosting",
            "title": "Exact",
            "url": CANONICAL_URL,
        }
        other = {
            "@type": "JobPosting",
            "title": "Other",
            "url": "https://uk.indeed.com/viewjob?jk=e56772bb8f333a4d",
        }
        selected, reason = select_structured_posting(
            [json.dumps([other, exact])],
            "indeed",
            CANONICAL_URL,
        )
        self.assertEqual(selected, exact)
        self.assertIsNone(reason)


class RequestRoutePolicyTests(unittest.TestCase):
    def test_only_main_frame_navigation_can_be_a_redirect_escape(self) -> None:
        suffixes = ("indeed.com", "indeedcdn.com")
        self.assertEqual(
            request_route_policy(
                "indeed",
                CANONICAL_URL,
                "https://captcha.example.net/frame",
                suffixes,
                is_main_frame_navigation=False,
            ),
            (True, False),
        )
        self.assertEqual(
            request_route_policy(
                "indeed",
                CANONICAL_URL,
                "https://static.indeedcdn.com/frame",
                suffixes,
                is_main_frame_navigation=False,
            ),
            (False, False),
        )
        self.assertEqual(
            request_route_policy(
                "indeed",
                CANONICAL_URL,
                "https://uk.indeed.com/viewjob?jk=e56772bb8f333a4d",
                suffixes,
                is_main_frame_navigation=True,
            ),
            (True, True),
        )
        self.assertEqual(
            request_route_policy(
                "indeed",
                CANONICAL_URL,
                CANONICAL_URL,
                suffixes,
                is_main_frame_navigation=True,
            ),
            (False, False),
        )


class GateTests(unittest.IsolatedAsyncioTestCase):
    async def test_concurrency_exhaustion_and_cooldown(self) -> None:
        gate = InspectionGate(config())
        state, denied = await gate.enter("indeed")
        self.assertIsNotNone(state)
        self.assertIsNone(denied)
        second_state, second_denied = await gate.enter("indeed")
        self.assertIsNone(second_state)
        self.assertEqual(second_denied, "resource_exhausted")
        gate.challenge(state)
        self.assertIsNotNone(await gate.pace(state))
        await gate.leave()

    async def test_pacing_delays_the_next_operation(self) -> None:
        gate = InspectionGate(config(minimum_interval_ms=20))
        state, _ = await gate.enter("indeed")
        self.assertIsNotNone(state)
        self.assertIsNone(await gate.pace(state))
        started = asyncio.get_running_loop().time()
        self.assertIsNone(await gate.pace(state))
        self.assertGreaterEqual(asyncio.get_running_loop().time() - started, 0.015)
        await gate.leave()

    async def test_operation_timeout_is_bounded_and_deterministic(self) -> None:
        slow_config = config(navigation_timeout_ms=10)

        async def slow_browser(*_arguments: object) -> dict[str, object]:
            await asyncio.sleep(1)
            return {}

        with patch("worker.inspect_with_browser", side_effect=slow_browser):
            from worker import inspect

            result = await inspect(
                slow_config,
                InspectionGate(slow_config),
                {"canonicalUrl": CANONICAL_URL, "provider": "indeed"},
            )
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["reason"], "navigation_timeout")

    async def test_disabled_and_invalid_requests_never_launch_browser(self) -> None:
        from worker import inspect

        browser = AsyncMock()
        with patch("worker.inspect_with_browser", browser):
            disabled = config(enabled=False)
            disabled_result = await inspect(
                disabled,
                InspectionGate(disabled),
                {"canonicalUrl": CANONICAL_URL, "provider": "indeed"},
            )
            invalid_result = await inspect(
                config(),
                InspectionGate(config()),
                {
                    "canonicalUrl": "https://example.com/viewjob?jk=96550901704ee48a",
                    "provider": "indeed",
                },
            )
        self.assertEqual(disabled_result["reason"], "worker_disabled")
        self.assertEqual(invalid_result["reason"], "blocked")
        browser.assert_not_awaited()
