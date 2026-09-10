"""modules.publish: what command each target builds, and what it refuses to do.

Publishing overwrites whatever is already serving the mirror — with `delete`
it removes files too — so the command has to be exactly right and the
failure modes have to be legible. Nothing here runs a real publish.
"""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import _paths  # noqa: F401

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "ops"))
import publish  # noqa: E402
import seo_config  # noqa: E402
# Imported before any test stubs the config: export_static resolves the
# dashboard URL at import time.
import export_static  # noqa: E402

# The local half of every publish command. str() of it, not a hardcoded
# "/i/site": the site directory is passed through as a native path, which is
# backslash-separated on Windows.
SITE = Path("/i/site")
LOCAL = str(SITE)


class PublishTests(unittest.TestCase):
    def setUp(self):
        self._cache = seo_config._cache
        self._instance = seo_config.INSTANCE
        self.tmp = Path(tempfile.mkdtemp(prefix="n-seo-publish-"))
        (self.tmp / "site").mkdir()
        (self.tmp / "site" / "index.html").write_text("<html></html>", encoding="utf-8")
        seo_config.INSTANCE = self.tmp

    def tearDown(self):
        seo_config._cache = self._cache
        seo_config.INSTANCE = self._instance
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def cfg(self, **publish_cfg):
        defaults = dict(seo_config.MODULE_DEFAULTS["publish"])
        seo_config._cache = {"modules": {"publish": {"enabled": True, **defaults, **publish_cfg}}}

    def run_main(self):
        """main() with a stubbed subprocess; returns (exit code, calls, output)."""
        calls = []

        class Done:
            returncode = 0

        def fake_run(cmd, **kw):
            calls.append({"cmd": cmd, "kw": kw})
            return Done()

        with mock.patch.object(publish.subprocess, "run", fake_run), \
                mock.patch.object(publish.shutil, "which", lambda b: f"/usr/bin/{b}"), \
                mock.patch("sys.stdout", new_callable=lambda: __import__("io").StringIO()) as out, \
                mock.patch("sys.stderr", new_callable=lambda: __import__("io").StringIO()) as err:
            code = publish.main()
        return code, calls, out.getvalue() + err.getvalue()

    # ---------- command construction ----------

    def test_gcs_command(self):
        self.cfg(target="gcs", destination="gs://bucket")
        cmd, shell = publish.build_command(seo_config.module("publish"), SITE)
        self.assertFalse(shell)
        self.assertEqual(cmd, ["gcloud", "storage", "rsync", LOCAL, "gs://bucket", "--recursive"])

    def test_gcs_command_with_delete(self):
        self.cfg(target="gcs", destination="gs://bucket", delete=True)
        cmd, _ = publish.build_command(seo_config.module("publish"), SITE)
        self.assertEqual(cmd[-1], "--delete-unmatched-destination-objects")

    def test_s3_command(self):
        self.cfg(target="s3", destination="s3://bucket")
        cmd, shell = publish.build_command(seo_config.module("publish"), SITE)
        self.assertFalse(shell)
        self.assertEqual(cmd, ["aws", "s3", "sync", LOCAL, "s3://bucket"])

    def test_s3_command_with_delete(self):
        self.cfg(target="s3", destination="s3://bucket", delete=True)
        cmd, _ = publish.build_command(seo_config.module("publish"), SITE)
        self.assertEqual(cmd[-1], "--delete")

    def test_rsync_command_copies_contents_not_the_directory(self):
        self.cfg(target="rsync", destination="user@host:/srv/mirror")
        cmd, shell = publish.build_command(seo_config.module("publish"), SITE)
        self.assertFalse(shell)
        # the trailing slash is the difference between /srv/mirror/*.html and
        # /srv/mirror/site/*.html — getting it wrong nests the mirror
        self.assertEqual(cmd, ["rsync", "-a", LOCAL + "/", "user@host:/srv/mirror"])

    def test_rsync_command_with_delete(self):
        self.cfg(target="rsync", destination="user@host:/srv/mirror", delete=True)
        cmd, _ = publish.build_command(seo_config.module("publish"), SITE)
        self.assertEqual(cmd[-1], "--delete")

    def test_command_target_is_a_shell_string(self):
        self.cfg(target="command", command="./my-publish.sh site/")
        cmd, shell = publish.build_command(seo_config.module("publish"), SITE)
        self.assertTrue(shell)
        self.assertEqual(cmd, "./my-publish.sh site/")

    # ---------- refusals, each with its own message ----------

    def test_unknown_target(self):
        self.cfg(target="ftp", destination="x")
        with self.assertRaises(ValueError) as e:
            publish.build_command(seo_config.module("publish"), SITE)
        self.assertIn("unknown publish target", str(e.exception))

    def test_missing_destination(self):
        self.cfg(target="gcs", destination="")
        code, calls, out = self.run_main()
        self.assertEqual(code, 1)
        self.assertEqual(calls, [])
        self.assertIn("destination is empty", out)

    def test_command_target_without_a_command(self):
        self.cfg(target="command", command="")
        code, calls, out = self.run_main()
        self.assertEqual(code, 1)
        self.assertEqual(calls, [])
        self.assertIn("modules.publish.command is empty", out)

    def test_missing_site_directory_points_at_static_export(self):
        import shutil
        shutil.rmtree(self.tmp / "site")
        self.cfg(target="gcs", destination="gs://bucket")
        code, calls, out = self.run_main()
        self.assertEqual(code, 1)
        self.assertEqual(calls, [])
        self.assertIn("modules.staticExport", out)

    def test_missing_binary(self):
        self.cfg(target="gcs", destination="gs://bucket")
        with mock.patch.object(publish.shutil, "which", lambda b: None), \
                mock.patch("sys.stderr", new_callable=lambda: __import__("io").StringIO()) as err:
            code = publish.main()
        self.assertEqual(code, 1)
        self.assertIn("not on PATH", err.getvalue())

    def test_module_off_runs_nothing(self):
        seo_config._cache = {"modules": {"publish": {"enabled": False, "target": "gcs",
                                                     "destination": "gs://bucket"}}}
        code, calls, out = self.run_main()
        self.assertEqual(code, 0)
        self.assertEqual(calls, [])
        self.assertIn("off", out)

    # ---------- dry run and environment ----------

    def test_dry_run_prints_the_command_and_runs_nothing(self):
        self.cfg(target="gcs", destination="gs://bucket", delete=True, dryRun=True)
        code, calls, out = self.run_main()
        self.assertEqual(code, 0)
        self.assertEqual(calls, [], "dryRun must not execute anything")
        self.assertIn("DRY RUN", out)
        self.assertIn("gcloud storage rsync", out)
        self.assertIn("--delete-unmatched-destination-objects", out)

    def test_env_is_merged_into_the_child_and_values_never_printed(self):
        self.cfg(target="gcs", destination="gs://bucket",
                 env={"CLOUDSDK_CONFIG": "~/.config/creds", "TOKEN": "s3cret"})
        code, calls, out = self.run_main()
        self.assertEqual(code, 0)
        env = calls[0]["kw"]["env"]
        self.assertEqual(env["CLOUDSDK_CONFIG"], os.path.expanduser("~/.config/creds"))
        self.assertEqual(env["TOKEN"], "s3cret")
        self.assertIn("PATH", env, "the child keeps the run's own environment")
        self.assertIn("CLOUDSDK_CONFIG", out, "key names are logged")
        self.assertNotIn("s3cret", out, "values are not")

    def test_a_real_publish_runs_the_command_from_the_instance(self):
        self.cfg(target="rsync", destination="user@host:/srv/mirror")
        code, calls, out = self.run_main()
        self.assertEqual(code, 0)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["kw"]["cwd"], self.tmp)
        self.assertFalse(calls[0]["kw"]["shell"])

    def test_a_failing_command_fails_the_step(self):
        self.cfg(target="gcs", destination="gs://bucket")

        class Failed:
            returncode = 2

        with mock.patch.object(publish.subprocess, "run", lambda *a, **k: Failed()), \
                mock.patch.object(publish.shutil, "which", lambda b: "/usr/bin/x"), \
                mock.patch("sys.stdout", new_callable=lambda: __import__("io").StringIO()), \
                mock.patch("sys.stderr", new_callable=lambda: __import__("io").StringIO()) as err:
            code = publish.main()
        self.assertEqual(code, 1)
        self.assertIn("FAILED", err.getvalue())


class SignOutLinkTests(unittest.TestCase):
    """modules.staticExport.signOutUrl fills the topbar slot in exported pages."""

    def setUp(self):
        self._cache = seo_config._cache

    def tearDown(self):
        seo_config._cache = self._cache

    def cfg(self, **static_cfg):
        defaults = dict(seo_config.MODULE_DEFAULTS["staticExport"])
        seo_config._cache = {"modules": {"staticExport": {"enabled": True, **defaults, **static_cfg}}}

    def export(self):
        return export_static

    def test_no_link_when_unconfigured(self):
        self.cfg()
        self.assertEqual(self.export().sign_out_link(), "")

    def test_label_defaults_to_sign_out(self):
        self.cfg(signOutUrl="/oauth2/sign_out")
        link = self.export().sign_out_link()
        self.assertIn('href="/oauth2/sign_out"', link)
        self.assertIn(">Sign out<", link)
        self.assertIn('class="signout"', link)

    def test_custom_label(self):
        self.cfg(signOutUrl="/logout", signOutLabel="Log out")
        self.assertIn(">Log out<", self.export().sign_out_link())

    def test_url_and_label_are_escaped(self):
        self.cfg(signOutUrl='/out?a=1&b="x"', signOutLabel="<b>bye</b>")
        link = self.export().sign_out_link()
        self.assertNotIn('&b="x"', link)
        self.assertIn("&amp;", link)
        self.assertNotIn("<b>", link)

    def test_the_slot_is_replaced_only_when_configured(self):
        e = self.export()
        page = '<header><nav></nav><span id="export-slot"></span></header>'
        self.cfg(signOutUrl="/logout")
        self.assertIn("signout", e.EXPORT_SLOT.sub(e.sign_out_link(), page, count=1))
        self.cfg()
        self.assertEqual(e.sign_out_link(), "")


if __name__ == "__main__":
    unittest.main()
