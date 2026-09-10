"""Does ops/demo_data.py produce every file in the ARCHITECTURE.md table, in
the contract shape? Runs into a temp dir by re-pointing the module's DATA."""
import io
import json
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import _paths  # noqa: F401
import seo_config
import demo_data

CONTRACT_KEYS = {
    "gsc/example.com/queries.json": ["site", "dimensions", "startDate", "endDate", "rowCount", "rows"],
    "gsc/example.com/pages.json": ["rows"],
    "gsc/example.com/query_page.json": ["rows"],
    "gsc/example.com/dates.json": ["rows"],
    "gsc/example.com/queries_90d.json": ["rows"],
    "gsc/example.com/pages_90d.json": ["rows"],
    "gsc/example.com/query_page_90d.json": ["rows"],
    "ga4/example.com/daily.json": ["rows"],
    "ga4/example.com/sources.json": ["rows"],
    "ga4/example.com/landing.json": ["rows"],
    "ga4/docs.example.com/daily.json": ["rows"],
    "timeseries/gsc-example.com.json": ["site", "startDate", "endDate", "rows"],
    "timeseries/ga4-example.com.json": ["site", "rows"],
    "timeseries/ga4-docs.example.com.json": ["site", "rows"],
    "timeseries/ga4-sources-example.com.json": ["site", "rows"],
    "timeseries/ga4-sources-docs.example.com.json": ["site", "rows"],
    "metadata-audit.json": ["generated", "window", "sites"],
    "index-status.json": ["generated", "sites"],
    "opportunity-proposals.json": ["generated", "candidates", "proposals", "verdicts", "inference_ran"],
    "last-run.json": ["ts", "failures", "steps"],
}


class DemoDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="n-seo-demo-"))
        cls.data = cls.tmp / "data"
        cls._saved = (demo_data.DATA, seo_config.CONFIG_PATH, seo_config._cache, sys.argv, seo_config.ROOT)
        demo_data.DATA = cls.data
        seo_config.ROOT = cls.tmp  # main() prints paths relative to ROOT
        seo_config.CONFIG_PATH = cls.tmp / "absent.json"  # force the example config
        seo_config._cache = None
        sys.argv = ["demo_data.py"]
        out = io.StringIO()
        with redirect_stdout(out):
            cls.code = demo_data.main()
        cls.stdout = out.getvalue()

    @classmethod
    def tearDownClass(cls):
        demo_data.DATA, seo_config.CONFIG_PATH, seo_config._cache, sys.argv, seo_config.ROOT = cls._saved
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def load(self, rel):
        return json.loads((self.data / rel).read_text(encoding="utf-8"))

    def test_exit_and_summary(self):
        self.assertEqual(self.code, 0)
        self.assertIn("now run: npm start", self.stdout)
        self.assertIn("example.com, docs.example.com", self.stdout)

    def test_every_contract_file_exists_with_keys(self):
        for rel, keys in CONTRACT_KEYS.items():
            p = self.data / rel
            self.assertTrue(p.exists(), rel)
            d = self.load(rel)
            for k in keys:
                self.assertIn(k, d, f"{rel} missing {k}")
        probes = list((self.data / "probes").glob("probe-*.json"))
        self.assertEqual(len(probes), 1)
        self.assertTrue(list(self.data.glob("trends-*.json")))
        self.assertTrue((self.data / "daily-ops.log").exists())

    def test_gsc_rows_shape_and_hosts(self):
        qp = self.load("gsc/example.com/query_page_90d.json")["rows"]
        self.assertTrue(qp)
        hosts = {r["keys"][1].split("/")[2] for r in qp}
        self.assertEqual(hosts, {"example.com", "docs.example.com"}, "shared domain property covers both hosts")
        for r in qp:
            self.assertEqual(set(r), {"keys", "clicks", "impressions", "ctr", "position"})
            self.assertEqual(len(r["keys"]), 2)
            self.assertLessEqual(r["clicks"], r["impressions"])
        self.assertTrue(any(5 <= r["position"] <= 15 and r["impressions"] >= 10 for r in qp), "striking distance present")
        dates = self.load("gsc/example.com/dates.json")["rows"]
        self.assertGreater(len(dates), 400, "16 months of daily rows")
        self.assertTrue(all(len(r["keys"][0]) == 10 for r in dates))

    def test_ga4_rows_are_raw_report_shape(self):
        src = self.load("ga4/example.com/sources.json")
        row = src["rows"][0]
        self.assertIn("dimensionValues", row)
        self.assertIn("metricValues", row)
        self.assertEqual(len(row["dimensionValues"]), 2)
        names = {r["dimensionValues"][0]["value"] for r in src["rows"]}
        self.assertTrue(any("chatgpt" in n or "perplexity" in n for n in names), "AI referral sources present")
        landing = self.load("ga4/example.com/landing.json")["rows"]
        self.assertTrue(any(float(r["metricValues"][0]["value"]) >= 30 and float(r["metricValues"][1]["value"]) < 0.25
                            for r in landing), "a low-engagement landing page")
        ga_ts = self.load("timeseries/ga4-example.com.json")["rows"][0]
        self.assertEqual(set(ga_ts), {"date", "page", "sessions"})
        self.assertEqual(len(ga_ts["date"]), 8, "YYYYMMDD")

        src_ts = self.load("timeseries/ga4-sources-example.com.json")["rows"]
        self.assertEqual(set(src_ts[0]), {"date", "source", "medium", "sessions"})
        self.assertEqual(len(src_ts[0]["date"]), 8, "YYYYMMDD")
        # The AI charts are only worth shipping if the demo exercises them.
        days = sorted({r["date"] for r in src_ts})
        self.assertGreater(len(days), 150, "a real window, not a handful of days")
        ai = lambda d: sum(r["sessions"] for r in src_ts
                           if r["date"] == d and "chatgpt" in r["source"])
        self.assertGreater(ai(days[-1]), ai(days[0]), "AI referrals grow across the demo window")

    def test_probe_index_audit_shapes(self):
        probe = self.load(next((self.data / "probes").glob("probe-*.json")).relative_to(self.data))
        self.assertEqual({s["site"] for s in probe["sites"]}, {"https://example.com", "https://docs.example.com"})
        for s in probe["sites"]:
            for k in ("robots", "sitemap", "llms.txt", "llms-full.txt", "homepage", "soft_404"):
                self.assertIn(k, s)
        self.assertTrue(any(not s["llms.txt"]["exists"] for s in probe["sites"]), "one site misses llms.txt")

        idx = self.load("index-status.json")["sites"]
        self.assertIn("example.com", idx)
        site = idx["example.com"]
        for k in ("property", "checked", "indexed", "neverCrawled", "sitemap", "problems"):
            self.assertIn(k, site)
        self.assertTrue(site["problems"])
        self.assertIn("coverage", site["problems"][0])

        audit = self.load("metadata-audit.json")
        self.assertEqual(audit["window"], "90d")
        findings = audit["sites"]["example.com"]
        self.assertTrue(findings)
        f = findings[0]
        for k in ("page", "title", "description", "imps", "clicks", "issues", "top_queries", "missed_clicks_window"):
            self.assertIn(k, f)
        self.assertEqual(set(f["top_queries"][0]), {"q", "imps", "clicks", "pos", "ctr"})

    def test_trends_and_proposals(self):
        trends = self.load(next(self.data.glob("trends-*.json")).name)
        site = trends["sites"]["sc-domain:example.com"]
        for k in ("recent_split", "prior_split", "rising", "falling", "monthly"):
            self.assertIn(k, site)
        self.assertEqual(set(site["recent_split"]), {"branded_clicks", "generic_clicks", "branded_imps", "generic_imps"})
        self.assertEqual(set(site["rising"][0]), {"query", "recent_imps", "prior_imps", "delta", "recent_pos", "recent_clicks"} | set(site["rising"][0]))
        self.assertIn("example.com", trends["ai_referrals"])
        props = self.load("opportunity-proposals.json")
        self.assertEqual(len(props["proposals"]), 2)
        for p in props["proposals"]:
            for k in ("host", "title", "kind", "why", "how", "spec", "impact", "effort", "tag"):
                self.assertIn(k, p)
            self.assertIn("DEMO", p["why"])
        self.assertEqual(len(props["verdicts"]), 1)
        self.assertEqual(set(props["verdicts"][0]), {"title", "verdict", "evidence"})

    def test_deterministic(self):
        a = (self.data / "gsc/example.com/queries_90d.json").read_bytes()
        tmp2 = Path(tempfile.mkdtemp(prefix="n-seo-demo2-"))
        try:
            demo_data.DATA = tmp2 / "data"
            seo_config.ROOT = tmp2
            demo_data.rng.seed(20260907)
            with redirect_stdout(io.StringIO()):
                demo_data.main()
            b = (tmp2 / "data/gsc/example.com/queries_90d.json").read_bytes()
        finally:
            demo_data.DATA = self.data
            seo_config.ROOT = self.tmp
            shutil.rmtree(tmp2, ignore_errors=True)
        self.assertEqual(a, b)

    def test_clean_flag(self):
        tmp3 = Path(tempfile.mkdtemp(prefix="n-seo-demo3-"))
        (tmp3 / "data").mkdir()
        (tmp3 / "data" / "x").write_text("x", encoding="utf-8")
        saved_argv = sys.argv
        try:
            demo_data.DATA = tmp3 / "data"
            sys.argv = ["demo_data.py", "--clean"]
            with redirect_stdout(io.StringIO()):
                self.assertEqual(demo_data.main(), 0)
            self.assertFalse((tmp3 / "data").exists())
        finally:
            demo_data.DATA = self.data
            sys.argv = saved_argv
            shutil.rmtree(tmp3, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
