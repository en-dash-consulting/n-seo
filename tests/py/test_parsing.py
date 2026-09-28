"""Parsing that decides what the owner is told to change.

Both of these produced confident, wrong findings: a description ending at
the first apostrophe read as "too short", and an AI crawler that robots.txt
explicitly allows read as blocked because the match ran past its group.
"""
import unittest
from unittest import mock

import _paths  # noqa: F401

import analyze_metadata
import site_probe

# RobotsGroupTests swaps site_probe.fetch out and never puts it back.
REAL_FETCH = site_probe.fetch


class MetadataParsingTests(unittest.TestCase):
    def head(self, status, body):
        analyze_metadata.fetch_text = lambda url, **kw: (status, body)
        return analyze_metadata.fetch_head("https://example.com/page")

    def test_apostrophes_and_entities_survive(self):
        status, title, desc = self.head(200, (
            "<title>Tom&#39;s guide &amp; more</title>"
            "<meta name=\"description\" content=\"Here's the fastest way to ship it\">"
        ))
        self.assertEqual(status, 200)
        self.assertEqual(title, "Tom's guide & more")
        self.assertEqual(desc, "Here's the fastest way to ship it")

    def test_status_is_reported_so_dead_pages_are_not_audited(self):
        status, title, desc = self.head(404, "<title>Not found</title>")
        self.assertEqual(status, 404)
        self.assertNotIn(404, analyze_metadata.SERVING)

    def test_a_ranged_206_still_counts_as_serving(self):
        # curl -r gets 206 from any server that honours Range; a page there is
        # perfectly healthy and must not be reported as not serving.
        self.assertIn(206, analyze_metadata.SERVING)
        self.assertIn(200, analyze_metadata.SERVING)


class RobotsGroupTests(unittest.TestCase):
    def blocked(self, robots):
        def fake(url, timeout=15):
            if url.endswith("/robots.txt"):
                return 200, robots
            return 404, ""
        site_probe.fetch = fake
        return site_probe.probe_site("https://example.com")["robots"]["ai_crawlers_blocked"]

    def test_an_allowed_crawler_is_not_reported_blocked(self):
        self.assertEqual(self.blocked(
            "User-agent: GPTBot\nAllow: /\n\nUser-agent: SomeOtherBot\nDisallow: /\n"), [])

    def test_a_genuinely_blocked_crawler_is_still_caught(self):
        self.assertIn("GPTBot", self.blocked("User-agent: GPTBot\nDisallow: /\n"))


class ProbeFetchRetryTests(unittest.TestCase):
    def fetch(self, *answers):
        calls = []
        it = iter(answers)

        def fake(url, **kw):
            calls.append(url)
            return next(it)
        with mock.patch.object(site_probe, "fetch_text", fake), \
                mock.patch.object(site_probe.time, "sleep"):
            return REAL_FETCH("https://example.com/robots.txt"), len(calls)

    def test_a_slow_first_answer_is_not_a_regression(self):
        # A cold origin behind a CDN timed out once, and robots.txt was
        # reported REGRESSED on a site that was serving it fine.
        self.assertEqual(self.fetch((None, ""), (200, "ok")), ((200, "ok"), 2))

    def test_a_5xx_gets_a_second_try(self):
        self.assertEqual(self.fetch((522, ""), (200, "ok")), ((200, "ok"), 2))

    def test_a_404_is_an_answer_and_is_not_retried(self):
        self.assertEqual(self.fetch((404, "")), ((404, ""), 1))

    def test_a_site_that_is_really_down_still_fails(self):
        self.assertEqual(self.fetch((None, ""), (None, "")), ((None, ""), 2))


if __name__ == "__main__":
    unittest.main()
