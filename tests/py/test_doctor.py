"""The doctor's engine-dependency check, across both engine layouts.

This shipped wrong: the check looked for a `node_modules` directory inside
the engine. npm hoists dependencies to the *consumer's* node_modules, so an
`npm i n-seo` engine has none of its own and a perfectly healthy install was
told to "run: npm install", which would not have helped. The check now asks
node to resolve the three runtime dependencies the way the CLI does.
"""
import json
import shutil
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import _paths  # noqa: F401

REPO = Path(__file__).resolve().parent.parent.parent

# Lifted from ops/doctor.py. Kept in step by test_probe_matches_doctor below,
# so a change to one that is not made to the other fails rather than drifts.
PROBE = (
    "const {createRequire}=require('node:module');"
    "const r=createRequire(process.argv[1]+'/');"
    "r.resolve('tsx/package.json');"
    "for (const d of ['hono','@hono/node-server']) r.resolve(d);"
)


def resolves(engine: Path) -> bool:
    r = subprocess.run(["node", "-e", PROBE, str(engine)], capture_output=True)
    return r.returncode == 0


@unittest.skipUnless(shutil.which("node"), "node is required")
class DependencyProbeTests(unittest.TestCase):
    def test_probe_matches_doctor(self):
        """The probe under test must be the one doctor actually runs."""
        src = (REPO / "ops" / "doctor.py").read_text(encoding="utf-8")
        for fragment in ("r.resolve('tsx/package.json');",
                         "for (const d of ['hono','@hono/node-server']) r.resolve(d);"):
            self.assertIn(fragment, src, "doctor's probe drifted from this test")

    def test_a_git_checkout_resolves(self):
        """The engine's own node_modules — the developer layout."""
        if not (REPO / "node_modules").is_dir():
            self.skipTest("engine dependencies are not installed")
        self.assertTrue(resolves(REPO))

    def test_hono_is_resolved_as_a_bare_specifier(self):
        """hono's `exports` map does not expose ./package.json.

        Asking for it throws on a healthy install, which is how the first
        version of this fix reported FAIL for every engine on the planet.
        """
        if not (REPO / "node_modules").is_dir():
            self.skipTest("engine dependencies are not installed")
        bad = ("const {createRequire}=require('node:module');"
               "createRequire(process.argv[1]+'/').resolve('hono/package.json');")
        r = subprocess.run(["node", "-e", bad, str(REPO)], capture_output=True)
        self.assertNotEqual(r.returncode, 0, "hono now exports ./package.json; simplify the probe")

    def test_an_engine_with_no_dependencies_fails(self):
        """The check has to still catch a genuinely broken engine."""
        with TemporaryDirectory() as tmp:
            engine = Path(tmp) / "engine"
            (engine / "ops").mkdir(parents=True)
            (engine / "package.json").write_text(json.dumps({"name": "n-seo"}), encoding="utf-8")
            self.assertFalse(resolves(engine))


if __name__ == "__main__":
    unittest.main()
