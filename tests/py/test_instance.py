"""Engine / instance split on the Python side, and the daily-run hooks."""
import importlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import _paths  # noqa: F401
import seo_config

REPO = _paths.REPO


class InstanceResolutionTest(unittest.TestCase):
    """seo_config reads N_SEO_INSTANCE at import time, so re-import in a
    subprocess to observe each configuration cleanly."""

    def _probe(self, env):
        code = (
            "import sys, json; sys.path.insert(0, %r); import seo_config as c; "
            "print(json.dumps({'root': str(c.ROOT), 'instance': str(c.INSTANCE), 'data': str(c.DATA), "
            "'config': str(c.CONFIG_PATH), 'info': c.engine_info(), "
            "'hooks': c.load()['hooks'], 'extra': c.load()['gscExtraProperties'], "
            "'props': c.gsc_properties(), 'props_no_extra': c.gsc_properties(include_extra=False), "
            "'env': c.env('SEO_MCP_TOKEN')}))" % str(REPO / "ingest")
        )
        full = {k: v for k, v in os.environ.items() if k not in ("N_SEO_INSTANCE", "N_SEO_CONFIG")}
        full.update(env)
        p = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=full, cwd=REPO)
        self.assertEqual(p.returncode, 0, p.stderr)
        return json.loads(p.stdout)

    def test_unset_is_in_place(self):
        r = self._probe({})
        self.assertEqual(r["instance"], r["root"])
        self.assertEqual(r["data"], str(Path(r["root"]) / "data"))
        self.assertEqual(r["config"], str(Path(r["root"]) / "n-seo.config.json"))
        self.assertEqual(r["info"]["mode"], "in-place")
        self.assertEqual(set(r["info"]), {"version", "commit", "root", "instance", "mode"})
        self.assertEqual(r["info"]["version"], json.loads((REPO / "package.json").read_text(encoding="utf-8"))["version"])

    def test_set_moves_instance_paths_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            inst = Path(tmp).resolve()
            (inst / ".env").write_text("SEO_MCP_TOKEN='abc'\n", encoding="utf-8")
            (inst / "n-seo.config.json").write_text(json.dumps({
                "sites": [{"host": "example.com", "gscProperty": "sc-domain:example.com"}],
                "gscExtraProperties": ["https://example.com/", ""],
                "hooks": {"beforeRun": ["echo a"], "afterStep": {"probe": ["echo b"]}, "afterRun": []},
            }), encoding="utf-8")
            r = self._probe({"N_SEO_INSTANCE": str(inst)})
            self.assertEqual(r["instance"], str(inst))
            self.assertNotEqual(r["instance"], r["root"])
            self.assertEqual(r["data"], str(inst / "data"))
            self.assertEqual(r["config"], str(inst / "n-seo.config.json"))
            self.assertEqual(r["info"]["mode"], "instance")
            self.assertEqual(r["env"], "abc")
            self.assertEqual(r["extra"], ["https://example.com/"])
            self.assertEqual(r["hooks"], {"beforeRun": ["echo a"], "afterStep": {"probe": ["echo b"]}, "afterRun": []})
            self.assertEqual(r["props"], {"sc-domain:example.com": "example.com", "https://example.com/": "example.com-urlprefix"})
            self.assertEqual(r["props_no_extra"], {"sc-domain:example.com": "example.com"})

    def test_relative_instance_resolves_against_cwd(self):
        # Inside the repo on purpose: Windows puts TEMP on C: while the
        # checkout is on D:, and there is no relative path between drives.
        with tempfile.TemporaryDirectory(dir=REPO) as tmp:
            inst = Path(tmp).resolve()
            rel = os.path.relpath(inst, REPO)
            r = self._probe({"N_SEO_INSTANCE": rel})
            self.assertEqual(r["instance"], str(inst))

    def test_defaults_without_hooks_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "n-seo.config.json").write_text('{"sites": []}', encoding="utf-8")
            r = self._probe({"N_SEO_INSTANCE": tmp})
            self.assertEqual(r["hooks"], {"beforeRun": [], "afterStep": {}, "afterRun": []})
            self.assertEqual(r["extra"], [])


class HooksTest(unittest.TestCase):
    """ops/daily.py run_hooks: records like steps, fails without aborting."""

    def setUp(self):
        import daily
        self.daily = daily
        self.tmp = Path(tempfile.mkdtemp()).resolve()
        self._saved = (daily.INSTANCE, daily.LOG)
        daily.INSTANCE = self.tmp
        daily.LOG = self.tmp / "data" / "daily-ops.log"

    def tearDown(self):
        self.daily.INSTANCE, self.daily.LOG = self._saved
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_records_success_and_failure_and_env(self):
        results, failures = [], []
        # Hooks are handed to the system shell, so the variable syntax is
        # the shell's: %VAR% under cmd.exe, $VAR under sh. Asserting the
        # marker either way proves the documented env actually reaches a
        # hook on this platform.
        expand = ("echo step=%N_SEO_STEP% inst=%N_SEO_INSTANCE% > marker.txt" if os.name == "nt"
                  else "echo step=$N_SEO_STEP inst=$N_SEO_INSTANCE > marker.txt")
        cmds = [expand, "false", "echo ok"]
        self.daily.run_hooks("daily-diff", cmds, results, failures, step="daily-diff")
        self.assertEqual([r["name"] for r in results], ["hook:daily-diff:0", "hook:daily-diff:1", "hook:daily-diff:2"])
        self.assertEqual([r["ok"] for r in results], [True, False, True])
        self.assertEqual(failures, ["hook:daily-diff:1"])
        for r in results:
            self.assertIn("seconds", r)
        # ran in the instance dir with the documented env
        marker = (self.tmp / "marker.txt").read_text(encoding="utf-8").strip()
        self.assertEqual(marker, f"step=daily-diff inst={self.tmp}")
        log = (self.tmp / "data" / "daily-ops.log").read_text(encoding="utf-8")
        self.assertIn("hook:daily-diff:1 FAILED", log)
        self.assertIn("  ok", log)

    def test_before_and_after_names(self):
        results, failures = [], []
        self.daily.run_hooks("before", ["true"], results, failures)
        self.daily.run_hooks("after", ["true", "true"], results, failures)
        self.assertEqual([r["name"] for r in results], ["hook:before:0", "hook:after:0", "hook:after:1"])
        self.assertEqual(failures, [])


if __name__ == "__main__":
    unittest.main()
