"""Profiles: engine defaults <- profile <- instance, in that order.

Both loaders resolve profiles, and they must agree. A dashboard saying the
freeze is 28 days while the daily log says 56 is worse than either number
being wrong, because nobody would know which to believe.
"""
import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import _paths  # noqa: F401
import seo_config

REPO = Path(__file__).resolve().parent.parent.parent
PROFILES = REPO / "profiles"


def load(cfg: dict):
    """Load a config through the Python loader, in a throwaway instance."""
    with TemporaryDirectory() as tmp:
        d = Path(tmp)
        (d / "n-seo.config.json").write_text(json.dumps(cfg), encoding="utf-8")
        out = subprocess.run(
            [sys.executable, "-c",
             "import sys,json;sys.path.insert(0,r'%s');import seo_config;"
             "c=seo_config.load();"
             "print(json.dumps({'p':c['profile'],'r':c['rules'],'o':c['operatingRules'],"
             "'m':{k:v.get('enabled') for k,v in c['modules'].items()}}))" % (REPO / "ingest"),
             ],
            capture_output=True, text=True, timeout=60,
            env={**__import__("os").environ, "N_SEO_INSTANCE": str(d)},
        )
        if out.returncode != 0:
            raise AssertionError(out.stderr)
        return json.loads(out.stdout)


class BuiltinProfileTests(unittest.TestCase):
    def test_every_shipped_profile_is_valid_json_with_a_name(self):
        found = sorted(p.parent.name for p in PROFILES.glob("*/n-seo.profile.json"))
        self.assertTrue(found, "no profiles ship with the engine")
        for spec in found:
            meta = json.loads((PROFILES / spec / "n-seo.profile.json").read_text(encoding="utf-8"))
            self.assertTrue(meta.get("name"), f"{spec} has no name")
            self.assertTrue(meta.get("description"), f"{spec} has no description")

    def test_shipped_profiles_only_set_keys_the_engine_knows(self):
        """A typo in a profile would otherwise be silently ignored forever."""
        for p in PROFILES.glob("*/n-seo.profile.json"):
            meta = json.loads(p.read_text(encoding="utf-8"))
            for group, value in (meta.get("rules") or {}).items():
                self.assertIn(group, seo_config.DEFAULT_RULES, f"{p.parent.name}: unknown rule group {group}")
                for key in value:
                    self.assertIn(key, seo_config.DEFAULT_RULES[group],
                                  f"{p.parent.name}: unknown key {group}.{key}")
            for key in (meta.get("operatingRules") or {}):
                self.assertIn(key, seo_config.DEFAULT_OPERATING_RULES,
                              f"{p.parent.name}: unknown operating rule {key}")

    def test_the_default_profile_restates_the_engine_defaults_exactly(self):
        meta = json.loads((PROFILES / "default" / "n-seo.profile.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["rules"], seo_config.DEFAULT_RULES)
        self.assertEqual(meta["operatingRules"], seo_config.DEFAULT_OPERATING_RULES)


class LayeringTests(unittest.TestCase):
    def test_no_profile_gives_the_engine_defaults(self):
        c = load({"name": "t", "sites": []})
        self.assertIsNone(c["p"])
        self.assertEqual(c["r"], seo_config.DEFAULT_RULES)
        self.assertEqual(c["o"], seo_config.DEFAULT_OPERATING_RULES)

    def test_a_profile_changes_what_it_sets_and_inherits_the_rest(self):
        c = load({"name": "t", "sites": [], "profile": "patient"})
        self.assertEqual(c["o"]["titleFreezeDays"], 56, "patient sets this")
        self.assertEqual(c["o"]["decisionWindowDays"], 90, "patient does not, so it is inherited")
        self.assertEqual(c["r"]["strikingDistance"]["minImpressions"], 40)
        self.assertEqual(c["r"]["strikingDistance"]["minPosition"], 5, "inherited from the engine")

    def test_the_instance_always_wins(self):
        c = load({"name": "t", "sites": [], "profile": "patient",
                  "operatingRules": {"titleFreezeDays": 14},
                  "rules": {"strikingDistance": {"minImpressions": 1}}})
        self.assertEqual(c["o"]["titleFreezeDays"], 14)
        self.assertEqual(c["r"]["strikingDistance"]["minImpressions"], 1)
        self.assertEqual(c["r"]["strikingDistance"]["maxRows"], 6, "still the profile's")

    def test_a_profile_can_supply_module_defaults(self):
        with TemporaryDirectory() as tmp:
            d = Path(tmp) / "p"
            d.mkdir()
            (d / "n-seo.profile.json").write_text(json.dumps({
                "name": "mods", "modules": {"indexNow": {"enabled": True}},
            }), encoding="utf-8")
            c = load({"name": "t", "sites": [], "profile": str(d)})
            self.assertTrue(c["m"]["indexNow"], "the profile should turn it on")
            c2 = load({"name": "t", "sites": [], "profile": str(d),
                       "modules": {"indexNow": {"enabled": False}}})
            self.assertFalse(c2["m"]["indexNow"], "the instance should turn it back off")


class ResolutionTests(unittest.TestCase):
    def test_a_builtin_resolves_by_bare_name(self):
        self.assertIsNotNone(seo_config.profile_dir("patient"))

    def test_an_unknown_profile_resolves_to_nothing(self):
        self.assertIsNone(seo_config.profile_dir("n-seo-profile-does-not-exist"))

    def test_no_spec_resolves_to_nothing(self):
        self.assertIsNone(seo_config.profile_dir(None))
        self.assertIsNone(seo_config.profile_dir(""))


if __name__ == "__main__":
    unittest.main()
