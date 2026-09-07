import io
import json
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import date
from pathlib import Path
from unittest import mock

import _paths  # noqa: F401
import seo_config
import daily_diff

SITES = [
    {"host": "example.com", "gscProperty": "sc-domain:example.com", "gscHost": "example.com"},
    {"host": "docs.example.com", "gscProperty": "sc-domain:example.com", "gscHost": "docs.example.com"},
]


def probe(site, **over):
    base = {"site": site, "robots": {"exists": True}, "sitemap": {"exists": True},
            "llms.txt": {"exists": True}, "soft_404": {"real_404": True}, "homepage": {"status": 200}}
    base.update(over)
    return base


def ga4_rows(pairs):
    return {"rows": [{"dimensionValues": [{"value": s}, {"value": m}], "metricValues": [{"value": str(n)}]}
                     for s, m, n in pairs]}


class DailyDiffTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="n-seo-diff-"))
        self.data = self.tmp / "data"
        (self.data / "probes").mkdir(parents=True)
        (self.data / "gsc" / "example.com").mkdir(parents=True)
        self._saved = (daily_diff.ROOT, daily_diff.DATA, seo_config._cache)
        daily_diff.ROOT = self.tmp
        daily_diff.DATA = self.data
        seo_config._cache = {
            "sites": [dict(s, label=s["host"], ga4Property=None, brand=None) for s in SITES],
            "watchPages": ["https://example.com/pricing/", "https://docs.example.com/", "https://elsewhere.org/x"],
            "conversions": None,
            "modules": {},
        }
        (self.data / "gsc" / "example.com" / "pages_90d.json").write_text(json.dumps({"rows": [
            {"keys": ["https://example.com/pricing"], "clicks": 12, "impressions": 400, "ctr": 0.03, "position": 4.2},
        ]}))
        (self.data / "probes" / "probe-20260901-070000.json").write_text(json.dumps(
            {"probed_at": "x", "sites": [probe("https://example.com"), probe("https://docs.example.com")]}))
        (self.data / "probes" / "probe-20260902-070000.json").write_text(json.dumps(
            {"probed_at": "y", "sites": [probe("https://example.com"),
                                        probe("https://docs.example.com", **{"llms.txt": {"exists": False}})]}))

    def tearDown(self):
        daily_diff.ROOT, daily_diff.DATA, seo_config._cache = self._saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_diff(self):
        out = io.StringIO()
        with redirect_stdout(out):
            code = daily_diff.main()
        return code, out.getvalue(), (self.tmp / "docs" / "daily-log.md").read_text()

    def test_entry_contents(self):
        code, out, log = self.run_diff()
        self.assertEqual(code, 0)
        today = date.today().isoformat()
        self.assertIn(f"## {today}", log)
        self.assertIn("ALERT:** https://docs.example.com: llms.txt REGRESSED", log)
        self.assertIn("probe: 1/2 sites fully healthy", log)
        self.assertIn("example.com/pricing/: 12 clicks / 400 imps / CTR 3.00% / pos 4.2 (90d)", log,
                      "trailing-slash mismatch tolerated")
        self.assertIn("docs.example.com/: no impressions yet (90d)", log)
        self.assertNotIn("elsewhere.org", log, "watch pages for unknown hosts are ignored")
        self.assertIn("ALERT:", out)

    def test_same_day_rerun_replaces_entry(self):
        self.run_diff()
        # an older day before today's must survive
        log = self.tmp / "docs" / "daily-log.md"
        text = log.read_text()
        today = date.today().isoformat()
        text = text.replace(f"\n## {today}\n", f"\n## 2000-01-01\n\n- old line\n\n## {today}\n", 1)
        log.write_text(text)
        (self.data / "gsc" / "example.com" / "pages_90d.json").write_text(json.dumps({"rows": [
            {"keys": ["https://example.com/pricing/"], "clicks": 99, "impressions": 500, "ctr": 0.198, "position": 3.0},
        ]}))
        _, _, log2 = self.run_diff()
        self.assertEqual(log2.count(f"## {today}"), 1, "one heading per day")
        self.assertIn("- old line", log2)
        self.assertIn("99 clicks", log2)
        self.assertNotIn("12 clicks", log2, "the earlier same-day entry is gone")
        self.assertTrue(log2.index("2000-01-01") < log2.index(today), "order preserved")

    def test_conversions_and_cross_referrals(self):
        seo_config._cache["conversions"] = {"site": "example.com", "events": ["sign_up"]}
        (self.data / "ga4" / "example.com").mkdir(parents=True)
        (self.data / "ga4" / "example.com" / "funnel.json").write_text(json.dumps({"rows": [
            {"dimensionValues": [{"value": "20260901"}, {"value": "sign_up"}], "metricValues": [{"value": "3"}]},
            {"dimensionValues": [{"value": "20260902"}, {"value": "sign_up"}], "metricValues": [{"value": "4"}]},
        ]}))
        (self.data / "ga4" / "example.com" / "sources.json").write_text(json.dumps(ga4_rows([
            ("google", "organic", 100), ("docs.example.com", "referral", 7), ("example.com", "internal", 1),
        ])))
        _, _, log = self.run_diff()
        self.assertIn("CONVERSIONS: sign_up=7 (90d)", log)
        self.assertIn("cross-referrals into example.com (90d sessions): docs.example.com=7", log)
        self.assertNotIn("example.com=1", log.split("cross-referrals")[1], "self-referrals are not cross-referrals")


if __name__ == "__main__":
    unittest.main()
