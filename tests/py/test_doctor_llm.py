"""doctor must exercise the model command, not just find the file.

`shutil.which` only proves a file exists. An expired OAuth session, a revoked
key or a lapsed subscription all leave the binary exactly where it was — so
the old check reported OK while every call in the daily run failed. Eleven of
them in one run, silently, because the llm module degrades rather than
failing. A green tick for something that cannot work is worse than no check.
"""
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import _paths  # noqa: F401

REPO = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO / "ops"))
import doctor  # noqa: E402


def fake_cli(dirpath: Path, name: str, body: str) -> list[str]:
    """A stand-in CLI, so these tests never call a real model.

    Written in Python and invoked through this interpreter rather than as a
    shell script with a shebang: Windows has neither, and the behaviour being
    tested — how a failing command is reported — matters on every platform.
    Returns argv, which is what probe_llm takes.
    """
    p = dirpath / f"{name}.py"
    p.write_text(body, encoding="utf-8")
    return [sys.executable, str(p)]


class ProbeTests(unittest.TestCase):
    def test_a_working_command_passes_and_quotes_the_reply(self):
        with TemporaryDirectory() as tmp:
            cli = fake_cli(Path(tmp), "good", "import sys; sys.stdin.read(); print('ok')")
            ok, detail = doctor.probe_llm(cli)
            self.assertTrue(ok)
            self.assertEqual(detail, "ok")

    def test_an_error_on_stdout_with_a_nonzero_exit_is_caught(self):
        """The real failure: `claude` exits 1 and writes the reason to stdout.

        Reading stderr alone produced "llm: exit 1:" with nothing after it,
        which is what made this expensive to diagnose.
        """
        with TemporaryDirectory() as tmp:
            cli = fake_cli(Path(tmp), "expired",
                           "import sys; sys.stdin.read();"
                           " print('Failed to authenticate: OAuth session expired'); sys.exit(1)")
            ok, detail = doctor.probe_llm(cli)
            self.assertFalse(ok, "a non-zero exit must not pass")
            self.assertIn("OAuth session expired", detail,
                          "the reason is on stdout and must still be reported")

    def test_an_error_on_stderr_is_caught(self):
        with TemporaryDirectory() as tmp:
            cli = fake_cli(Path(tmp), "bad",
                           "import sys; sys.stdin.read();"
                           " print('no credit', file=sys.stderr); sys.exit(2)")
            ok, detail = doctor.probe_llm(cli)
            self.assertFalse(ok)
            self.assertIn("no credit", detail)

    def test_exit_zero_with_no_output_is_a_failure(self):
        """Some CLIs fail quietly. Silence is not a reply."""
        with TemporaryDirectory() as tmp:
            cli = fake_cli(Path(tmp), "silent", "import sys; sys.stdin.read()")
            ok, detail = doctor.probe_llm(cli)
            self.assertFalse(ok)
            self.assertIn("said nothing", detail)

    def test_a_missing_command_fails_without_raising(self):
        ok, detail = doctor.probe_llm(["/nonexistent/definitely-not-here"])
        self.assertFalse(ok)
        self.assertTrue(detail, "a reason is always given")

    def test_the_prompt_goes_in_on_stdin(self):
        """The module pipes the prompt in; a CLI that reads argv would break."""
        with TemporaryDirectory() as tmp:
            cli = fake_cli(Path(tmp), "echoer",
                           "import sys; print('got:' + sys.stdin.read().strip())")
            ok, detail = doctor.probe_llm(cli)
            self.assertTrue(ok)
            self.assertTrue(detail.startswith("got:"), detail)


class OfflineTests(unittest.TestCase):
    def test_offline_does_not_call_the_model(self):
        """doctor --offline must stay offline; a probe would hang or bill."""
        src = (REPO / "ops" / "doctor.py").read_text(encoding="utf-8")
        i = src.index("ok, detail = probe_llm(cmd)")
        before = src[:i]
        self.assertIn("if OFFLINE:", before.rsplit("for key in", 1)[-1],
                      "the offline guard must come before the probe")


class LlmLoggingTests(unittest.TestCase):
    def test_the_module_falls_back_to_stdout_for_the_reason(self):
        src = (REPO / "ops" / "llm.py").read_text(encoding="utf-8")
        self.assertIn("p.stderr.strip() or p.stdout.strip()", src,
                      "a CLI that reports failure on stdout must still be logged")


if __name__ == "__main__":
    unittest.main()
