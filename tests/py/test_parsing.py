"""Parsing that decides what the owner is told to change.

Both of these produced confident, wrong findings: a description ending at
the first apostrophe read as "too short", and an AI crawler that robots.txt
explicitly allows read as blocked because the match ran past its group.
"""
import unittest

import _paths  # noqa: F401

import analyze_metadata
import site_probe


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


if __name__ == "__main__":
    unittest.main()
