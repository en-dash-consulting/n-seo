"""data/last-run.json must be current while the run is still going.

This shipped wrong. The record was written once, after every step had
finished — but `static-export` is itself a step, so when it stamped each page
it read the *previous* run's record. Every page on a published mirror
therefore claimed the last daily run was about a day old, on a mirror that
run had rebuilt minutes earlier. It looked exactly like a run that never
happened.
"""
import ast
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import _paths  # noqa: F401

REPO = Path(__file__).resolve().parent.parent.parent
DAILY = REPO / "ops" / "daily.py"

OFF = {k: {"enabled": False} for k in
       ("indexStatus", "metadataAudit", "opportunityScan", "llm", "hackerNews",
        "reddit", "indexNow", "staticExport", "gitAutoCommit", "notifications", "publish")}


def step_loop(tree: ast.AST) -> ast.For:
    """The `for name, script in todo:` loop in main()."""
    for node in ast.walk(tree):
        if isinstance(node, ast.For) and isinstance(node.target, ast.Tuple):
            names = [e.id for e in node.target.elts if isinstance(e, ast.Name)]
            if names == ["name", "script"]:
                return node
    raise AssertionError("could not find the step loop in ops/daily.py")


class RunRecordTests(unittest.TestCase):
    def test_the_record_is_written_inside_the_step_loop(self):
        tree = ast.parse(DAILY.read_text(encoding="utf-8"))
        loop = step_loop(tree)
        calls = [n for n in ast.walk(loop)
                 if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                 and n.func.id == "write_last_run"]
        self.assertTrue(calls,
                        "write_last_run() is never called inside the step loop, so a step "
                        "that reads last-run.json (static-export does) sees the previous run")

    def test_a_later_step_sees_this_run_not_the_last_one(self):
        """End to end, through the same afterStep hook machinery a step would use.

        Two steps run. A hook after the first one captures last-run.json as it
        exists mid-run. That capture has to describe *this* run.
        """
        with TemporaryDirectory() as tmp:
            inst = Path(tmp)
            (inst / "data").mkdir()
            # A record from a previous run, which is what the old code left on
            # disk for the export to read.
            (inst / "data" / "last-run.json").write_text(json.dumps(
                {"ts": "2001-01-01T00:00Z", "failures": "", "steps": []}), encoding="utf-8")
            capture = inst / "captured.json"
            (inst / "n-seo.config.json").write_text(json.dumps({
                "name": "t", "sites": [], "modules": OFF,
                "hooks": {"afterStep": {"probe": [
                    f'{sys.executable} -c "import shutil;shutil.copy(r\'{inst}/data/last-run.json\', r\'{capture}\')"'
                ]}},
            }), encoding="utf-8")

            subprocess.run(
                [sys.executable, str(DAILY), "--only", "probe,daily-diff", "--no-network-wait"],
                cwd=str(REPO), capture_output=True, text=True, timeout=180,
                env={**os.environ, "N_SEO_INSTANCE": str(inst)},
            )

            self.assertTrue(capture.exists(), "the afterStep hook did not run")
            mid = json.loads(capture.read_text(encoding="utf-8"))
            self.assertNotEqual(mid["ts"], "2001-01-01T00:00Z",
                                "a step mid-run still saw the previous run's record")
            self.assertEqual([s["name"] for s in mid["steps"]], ["probe"],
                             "the mid-run record should describe the steps done so far")


if __name__ == "__main__":
    unittest.main()
