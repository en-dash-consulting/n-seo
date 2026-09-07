import json
import os
import tempfile
import unittest
from pathlib import Path

import _paths  # noqa: F401
import seo_config
from _paths import REPO

# The same cases as tests/ts/config.test.ts — the two slug functions must agree.
SLUG_CASES = [
    ("sc-domain:example.com", "example.com"),
    ("https://www.example.com/", "www.example.com"),
    ("https://example.com/blog/", "example.com_blog"),
    ("http://example.com", "example.com"),
    ("sc-domain:sub.example.com", "sub.example.com"),
    ("https://example.com///", "example.com"),
]


class ConfigTests(unittest.TestCase):
    def setUp(self):
        self._orig = (seo_config.CONFIG_PATH, seo_config.ROOT, seo_config._cache)
        self.tmp = Path(tempfile.mkdtemp(prefix="seo-agent-cfg-"))

    def tearDown(self):
        seo_config.CONFIG_PATH, seo_config.ROOT, seo_config._cache = self._orig

    def use(self, raw: dict):
        p = self.tmp / "seo-agent.config.json"
        p.write_text(json.dumps(raw))
        seo_config.CONFIG_PATH = p
        return seo_config.load(force=True)

    def test_slug_parity(self):
        for prop, want in SLUG_CASES:
            self.assertEqual(seo_config.gsc_slug(prop), want, prop)

    def test_example_fallback(self):
        seo_config.CONFIG_PATH = self.tmp / "missing.json"
        cfg = seo_config.load(force=True)
        self.assertTrue(seo_config.using_example())
        self.assertEqual(cfg["name"], "My sites")
        self.assertEqual(len(cfg["sites"]), 2)
        self.assertEqual(cfg["port"], 4600)
        self.assertIsNone(cfg["conversions"])

    def test_normalization_and_module_defaults(self):
        cfg = self.use({
            "sites": [{"host": "a.example.com", "gscProperty": "", "ga4Property": 123, "brand": ""},
                      {"label": "no host → dropped"}],
            "modules": {"llm": {"enabled": True, "command": "cat"}, "custom": {"x": 1}},
            "conversions": {"site": "", "events": ["x"]},
        })
        self.assertEqual(cfg["name"], "SEO Agent")
        self.assertEqual(cfg["google"]["auth"], "service-account-key")
        self.assertEqual(len(cfg["sites"]), 1)
        s = cfg["sites"][0]
        self.assertEqual(s["label"], "a.example.com")
        self.assertEqual(s["gscHost"], "a.example.com")
        self.assertIsNone(s["gscProperty"])
        self.assertEqual(s["ga4Property"], "123", "numeric ids become strings")
        self.assertIsNone(s["brand"])
        for k in seo_config.MODULE_KEYS:
            self.assertIn(k, cfg["modules"])
            self.assertIn("enabled", cfg["modules"][k])
        self.assertTrue(cfg["modules"]["llm"]["enabled"])
        self.assertEqual(cfg["modules"]["llm"]["command"], "cat")
        self.assertFalse(cfg["modules"]["custom"]["enabled"])
        self.assertTrue(seo_config.enabled("llm"))
        self.assertFalse(seo_config.enabled("hackerNews"))
        self.assertIsNone(cfg["conversions"], "empty site → no conversions")

    def test_port_env_override(self):
        self.use({"sites": [], "port": 4700})
        self.assertEqual(seo_config.port(), 4700)
        os.environ["SEO_PORT"] = "4999"
        try:
            self.assertEqual(seo_config.load(force=True)["port"], 4999)
            self.assertEqual(seo_config.dashboard_base(), "http://localhost:4999")
        finally:
            del os.environ["SEO_PORT"]

    def test_derived_maps(self):
        self.use({"sites": [
            {"host": "example.com", "gscProperty": "sc-domain:example.com", "brand": "example", "ga4Property": "1"},
            {"host": "docs.example.com", "gscProperty": "sc-domain:example.com", "brand": "docs|documentation"},
            {"host": "www.other.org", "gscProperty": "https://www.other.org/", "ga4Property": "2"},
            {"host": "nogsc.example.com"},
        ]})
        self.assertEqual(seo_config.gsc_properties(),
                         {"sc-domain:example.com": "example.com", "https://www.other.org/": "www.other.org"})
        self.assertEqual(seo_config.ga4_properties(), {"example.com": "1", "www.other.org": "2"})
        self.assertEqual(seo_config.index_hosts(),
                         {"example.com": "sc-domain:example.com", "docs.example.com": "sc-domain:example.com",
                          "www.other.org": "https://www.other.org/"})
        pats = seo_config.brand_patterns()
        self.assertEqual(pats["sc-domain:example.com"], "(?:example)|(?:docs|documentation)")
        self.assertNotIn("https://www.other.org/", pats, "no brand → no pattern")
        self.assertEqual(seo_config.hosts(), ["example.com", "docs.example.com", "www.other.org", "nogsc.example.com"])
        self.assertEqual(seo_config.gsc_dir_for(seo_config.sites()[3]), None)
        self.assertEqual(seo_config.gsc_dir_for(seo_config.sites()[0]).name, "example.com")

    def test_env_reads_process_then_dotenv(self):
        seo_config.ROOT = self.tmp
        (self.tmp / ".env").write_text('REDDIT_CLIENT_ID=abc\nQUOTED="q v"\n# comment\nEMPTY=\n')
        self.assertEqual(seo_config.env("REDDIT_CLIENT_ID"), "abc")
        self.assertEqual(seo_config.env("QUOTED"), "q v")
        self.assertEqual(seo_config.env("EMPTY", "dflt"), "", "present but empty wins over the default")
        self.assertEqual(seo_config.env("MISSING", "dflt"), "dflt")
        os.environ["REDDIT_CLIENT_ID"] = "from-env"
        try:
            self.assertEqual(seo_config.env("REDDIT_CLIENT_ID"), "from-env")
        finally:
            del os.environ["REDDIT_CLIENT_ID"]

    def test_expand(self):
        self.assertEqual(seo_config.expand("~/x"), Path.home() / "x")

    def test_example_file_is_valid_and_complete(self):
        raw = json.loads((REPO / "seo-agent.config.example.json").read_text())
        for k in seo_config.MODULE_KEYS:
            self.assertIn(k, raw["modules"], f"example config should document module {k}")
        self.assertIn("google", raw)
        self.assertIn("sites", raw)


if __name__ == "__main__":
    unittest.main()
