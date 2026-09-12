"""The update check: gated, offline-safe, and never a reason to fail a run.

n-seo told nobody when a new version shipped. This step fixes that, and it is
the only module that is on by default — so what it does, and what happens
when it cannot do it, both need holding still.
"""
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import _paths  # noqa: F401
import seo_config

REPO = Path(__file__).resolve().parent.parent.parent
SCRIPT = REPO / "ops" / "update_check.py"


def run(instance: Path, path_override: str | None = None):
    env = {**os.environ, "N_SEO_INSTANCE": str(instance)}
    if path_override is not None:
        env["PATH"] = path_override
    return subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True,
                          timeout=90, env=env, cwd=str(REPO))


def instance(tmp: str, enabled: bool = True) -> Path:
    d = Path(tmp)
    (d / "n-seo.config.json").write_text(json.dumps({
        "name": "t", "sites": [], "modules": {"updateCheck": {"enabled": enabled}},
    }), encoding="utf-8")
    return d


class ModuleDefaultTests(unittest.TestCase):
    def test_it_is_on_by_default(self):
        """The only module that ships enabled. If that changes, say so loudly."""
        self.assertTrue(seo_config.MODULE_DEFAULTS["updateCheck"]["enabled"])

    def test_it_can_be_switched_off(self):
        with TemporaryDirectory() as tmp:
            d = instance(tmp, enabled=False)
            r = run(d)
            self.assertEqual(r.returncode, 0)
            self.assertIn("off", r.stdout)
            self.assertIn("no registry request", r.stdout)
            self.assertFalse((d / "data" / "update-check.json").exists(),
                             "a disabled module must not write its output file")


class OfflineTests(unittest.TestCase):
    def test_no_npm_on_path_is_not_a_failure(self):
        """An offline morning must not fail the daily run over a version check."""
        with TemporaryDirectory() as tmp:
            d = instance(tmp)
            # An empty PATH: npm cannot be found, which is the same code path
            # as a registry that will not answer.
            r = run(d, path_override=str(Path(tmp) / "nothing"))
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("could not reach the registry", r.stdout)

    def test_a_failed_check_leaves_the_previous_result_alone(self):
        with TemporaryDirectory() as tmp:
            d = instance(tmp)
            (d / "data").mkdir()
            keep = {"checked": "2020-01-01T00:00Z", "current": "0.1.0",
                    "latest": "0.9.9", "newer": True, "notes": "x"}
            (d / "data" / "update-check.json").write_text(json.dumps(keep), encoding="utf-8")
            run(d, path_override=str(Path(tmp) / "nothing"))
            self.assertEqual(json.loads((d / "data" / "update-check.json").read_text(encoding="utf-8")), keep)


class VersionCompareTests(unittest.TestCase):
    def test_parts_rejects_anything_that_is_not_a_release(self):
        sys.path.insert(0, str(REPO / "ops"))
        import update_check
        self.assertEqual(update_check.parts("1.2.3"), (1, 2, 3))
        self.assertEqual(update_check.parts("10.0.1"), (10, 0, 1))
        self.assertIsNone(update_check.parts(""))
        self.assertIsNone(update_check.parts("not-a-version"))
        # A prerelease still parses its numeric head, which is what ordering needs.
        self.assertEqual(update_check.parts("1.2.3-beta.1"), (1, 2, 3))

    def test_ordering_is_numeric_not_lexical(self):
        sys.path.insert(0, str(REPO / "ops"))
        import update_check
        # "0.10.0" < "0.9.0" as strings; the whole point is that it is not.
        self.assertGreater(update_check.parts("0.10.0"), update_check.parts("0.9.0"))


if __name__ == "__main__":
    unittest.main()
