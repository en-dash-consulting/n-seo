"""modules.llm: the CLI path, the HTTP path, and which one wins.

The HTTP path exists because a container or a server has no CLI signed in,
so it is the only way the digests and the opportunity scan produce anything
off a laptop. `infer` must never raise — every caller degrades on None.
"""
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

import _paths  # noqa: F401

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "ops"))
import llm  # noqa: E402
import seo_config  # noqa: E402

ANTHROPIC = {"provider": "anthropic", "model": "claude-sonnet-5",
             "fastModel": "claude-haiku-4-5-20251001", "apiKeyEnv": "TEST_LLM_KEY"}
OPENAI = {"provider": "openai", "model": "gpt-4o", "apiKeyEnv": "TEST_LLM_KEY"}


class LlmTests(unittest.TestCase):
    def setUp(self):
        self._cfg = seo_config._cache
        self._env = seo_config.env          # restored below: this module is
        self.env = {"TEST_LLM_KEY": "sk-test-123"}   # shared across the suite
        seo_config.env = lambda k, default="": self.env.get(k, default)

    def tearDown(self):
        seo_config._cache = self._cfg
        seo_config.env = self._env

    def cfg(self, **llm_cfg):
        seo_config._cache = {"modules": {"llm": {"enabled": True, **llm_cfg}}}

    def capture(self, response):
        calls = []

        def curl(args, **kw):
            calls.append({"args": args, "kw": kw})
            if isinstance(response, Exception):
                raise response
            return response

        return curl, calls

    def test_anthropic_request_and_response(self):
        self.cfg(http=ANTHROPIC)
        curl, calls = self.capture({"content": [{"type": "text", "text": "  the reply  "}]})
        with mock.patch.object(llm, "curl_json", curl):
            self.assertEqual(llm.infer("a prompt"), "the reply")
        args = calls[0]["args"]
        self.assertEqual(args[-1], "https://api.anthropic.com/v1/messages")
        self.assertIn("x-api-key: sk-test-123", args)
        self.assertIn(f"anthropic-version: {llm.ANTHROPIC_VERSION}", args)
        body = json.loads(args[args.index("-d") + 1])
        self.assertEqual(body["model"], "claude-sonnet-5")
        self.assertEqual(body["messages"], [{"role": "user", "content": "a prompt"}])
        self.assertIn("max_tokens", body)

    def test_fast_uses_the_fast_model(self):
        self.cfg(http=ANTHROPIC)
        curl, calls = self.capture({"content": [{"type": "text", "text": "x"}]})
        with mock.patch.object(llm, "curl_json", curl):
            llm.infer("p", fast=True)
        body = json.loads(calls[0]["args"][calls[0]["args"].index("-d") + 1])
        self.assertEqual(body["model"], "claude-haiku-4-5-20251001")

    def test_openai_shape(self):
        self.cfg(http=OPENAI)
        curl, calls = self.capture({"choices": [{"message": {"content": "openai reply"}}]})
        with mock.patch.object(llm, "curl_json", curl):
            self.assertEqual(llm.infer("p"), "openai reply")
        args = calls[0]["args"]
        self.assertEqual(args[-1], "https://api.openai.com/v1/chat/completions")
        self.assertIn("Authorization: Bearer sk-test-123", args)

    def test_base_url_override_for_a_gateway(self):
        self.cfg(http={**OPENAI, "baseUrl": "https://gateway.example.com/"})
        curl, calls = self.capture({"choices": [{"message": {"content": "x"}}]})
        with mock.patch.object(llm, "curl_json", curl):
            llm.infer("p")
        self.assertEqual(calls[0]["args"][-1], "https://gateway.example.com/v1/chat/completions")

    def test_failures_return_none_rather_than_raising(self):
        self.cfg(http=ANTHROPIC)
        for response in (RuntimeError("timed out"),
                         {"error": {"type": "authentication_error"}},
                         {"content": []}):
            curl, _ = self.capture(response)
            with mock.patch.object(llm, "curl_json", curl):
                self.assertIsNone(llm.infer("p"), response)

    def test_http_wins_over_the_command_when_its_key_resolves(self):
        self.cfg(http=ANTHROPIC, command="definitely-not-a-real-binary")
        curl, calls = self.capture({"content": [{"type": "text", "text": "via http"}]})
        with mock.patch.object(llm, "curl_json", curl):
            self.assertEqual(llm.infer("p"), "via http")
        self.assertEqual(len(calls), 1)

    def test_falls_back_to_the_command_when_the_key_is_missing(self):
        self.env = {}
        self.cfg(http=ANTHROPIC, command="/bin/cat")
        self.assertIsNone(llm.http_config())
        self.assertTrue(llm.available())
        self.assertEqual(llm.infer("round trip"), "round trip")

    def test_available_truth_table(self):
        self.cfg(http=ANTHROPIC)
        self.assertTrue(llm.available(), "http configured")
        self.cfg(command="/bin/cat")
        self.assertTrue(llm.available(), "cli configured")
        self.cfg(command="definitely-not-a-real-binary")
        self.assertFalse(llm.available(), "cli not on PATH")
        self.cfg()
        self.assertFalse(llm.available(), "neither")
        self.cfg(http={"provider": "anthropic"})  # no model
        self.assertFalse(llm.available(), "incomplete http block")
        seo_config._cache = {"modules": {"llm": {"enabled": False, "http": ANTHROPIC}}}
        self.assertFalse(llm.available(), "module disabled")
        self.assertIsNone(llm.infer("p"))


class SplitCommandTests(unittest.TestCase):
    """`llm.command` is a user-configured string that has to become argv.

    POSIX splitting eats backslashes, which is invisible on a Mac and fatal
    on Windows: a configured `C:\\tools\\claude.exe` would be looked up as
    `C:toolsclaude.exe` and the LLM module would silently report itself
    unavailable. These force both branches regardless of the host.
    """

    def posix(self, cmd):
        with mock.patch.object(llm.os, "name", "posix"):
            return llm.split_command(cmd)

    def windows(self, cmd):
        with mock.patch.object(llm.os, "name", "nt"):
            return llm.split_command(cmd)

    def test_plain_command_splits_the_same_on_both(self):
        for split in (self.posix, self.windows):
            self.assertEqual(split("claude -p --model claude-sonnet-5"),
                             ["claude", "-p", "--model", "claude-sonnet-5"])
            self.assertEqual(split(""), [])
            self.assertEqual(split("   "), [])

    def test_windows_paths_survive_only_the_windows_branch(self):
        cmd = r'C:\tools\claude.exe -p'
        self.assertEqual(self.windows(cmd), [r"C:\tools\claude.exe", "-p"])
        # The bug this guards: POSIX rules drop the separators entirely.
        self.assertEqual(self.posix(cmd), ["C:toolsclaude.exe", "-p"])

    def test_windows_strips_the_quotes_shlex_leaves_on(self):
        # shlex(posix=False) keeps quotes in the token; CreateProcess would
        # then look for a file whose name literally starts with a quote.
        argv = self.windows(r'"C:\Program Files\nodejs\node.exe" script.js')
        self.assertEqual(argv, [r"C:\Program Files\nodejs\node.exe", "script.js"])
        self.assertFalse(any(a.startswith('"') for a in argv))

    def test_an_unbalanced_quote_degrades_instead_of_raising(self):
        # The command is typed into the Settings form, so a stray quote is a
        # plausible typo. shlex raises ValueError on it; if that escaped, the
        # daily run and doctor would both die on a config mistake.
        for split in (self.posix, self.windows):
            self.assertEqual(split('claude -p "unfinished'), [])
        seo_config._cache = {"modules": {"llm": {"enabled": True, "command": 'x "'}}}
        self.assertIsNone(llm.command())
        self.assertFalse(llm.available())

    def test_an_empty_quoted_argument_survives_quote_stripping(self):
        self.assertEqual(self.windows('cmd ""'), ["cmd", ""])

    def test_posix_quoting_still_works_on_posix(self):
        self.assertEqual(self.posix('sh -c "echo hi"'), ["sh", "-c", "echo hi"])

    def test_command_uses_the_platform_split(self):
        self._cfg = seo_config._cache
        try:
            seo_config._cache = {"modules": {"llm": {"enabled": True, "command": "/bin/cat -u"}}}
            self.assertEqual(llm.command(), ["/bin/cat", "-u"])
        finally:
            seo_config._cache = self._cfg


if __name__ == "__main__":
    unittest.main()
