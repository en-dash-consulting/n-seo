import json
import subprocess
import unittest
from unittest import mock

import _paths  # noqa: F401
import http_util


def fake_run(script):
    """A subprocess.run stand-in that replays (returncode, stdout) pairs."""
    calls = []
    it = iter(script)

    def run(cmd, **kw):
        calls.append(cmd)
        code, out = next(it)
        return subprocess.CompletedProcess(cmd, code, stdout=out, stderr="boom")
    run.calls = calls
    return run


class CurlJsonTests(unittest.TestCase):
    def setUp(self):
        self.sleep = mock.patch.object(http_util.time, "sleep")
        self.sleep.start()
        mock.patch.object(http_util.sys, "stderr", new=mock.MagicMock()).start()

    def tearDown(self):
        mock.patch.stopall()

    def test_retryable_curl_exit_then_success(self):
        run = fake_run([(28, ""), (0, '{"ok": 1}')])
        with mock.patch.object(http_util.subprocess, "run", run):
            self.assertEqual(http_util.curl_json(["http://x"]), {"ok": 1})
        self.assertEqual(len(run.calls), 2)
        self.assertEqual(run.calls[0][:2], ["curl", "-s"])

    def test_http_500_then_success(self):
        run = fake_run([(0, json.dumps({"error": {"code": 503, "message": "backend"}})), (0, '{"rows": []}')])
        with mock.patch.object(http_util.subprocess, "run", run):
            self.assertEqual(http_util.curl_json(["http://x"]), {"rows": []})
        self.assertEqual(len(run.calls), 2)

    def test_429_retries(self):
        run = fake_run([(0, json.dumps({"error": {"code": 429}})), (0, "{}")])
        with mock.patch.object(http_util.subprocess, "run", run):
            http_util.curl_json(["http://x"])
        self.assertEqual(len(run.calls), 2)

    def test_4xx_is_returned_not_retried(self):
        body = {"error": {"code": 403, "message": "insufficient permission"}}
        run = fake_run([(0, json.dumps(body))])
        with mock.patch.object(http_util.subprocess, "run", run):
            self.assertEqual(http_util.curl_json(["http://x"]), body)
        self.assertEqual(len(run.calls), 1)

    def test_unparseable_retries_then_raises(self):
        run = fake_run([(0, "<html>")] * 4)
        with mock.patch.object(http_util.subprocess, "run", run):
            with self.assertRaises(RuntimeError) as cm:
                http_util.curl_json(["http://x"], label="thing")
        self.assertIn("thing failed after 4 attempts", str(cm.exception))
        self.assertEqual(len(run.calls), 4)

    def test_non_retryable_exit_raises_immediately(self):
        run = fake_run([(3, "")])
        with mock.patch.object(http_util.subprocess, "run", run):
            with self.assertRaises(RuntimeError) as cm:
                http_util.curl_json(["http://x"])
        self.assertIn("curl exit 3", str(cm.exception))
        self.assertEqual(len(run.calls), 1)

    def test_helpers_build_headers(self):
        run = fake_run([(0, "{}"), (0, "{}")])
        with mock.patch.object(http_util.subprocess, "run", run):
            http_util.get_json("http://a", token="T")
            http_util.post_json("http://b", {"k": 1}, token="T")
        get_cmd, post_cmd = run.calls
        self.assertIn("Authorization: Bearer T", get_cmd)
        self.assertEqual(get_cmd[-1], "http://a")
        self.assertIn("POST", post_cmd)
        self.assertIn('{"k": 1}', post_cmd)
        self.assertIn("Content-Type: application/json", post_cmd)

    def test_fetch_text_splits_status(self):
        run = fake_run([(0, "<title>x</title>\n404")])
        with mock.patch.object(http_util.subprocess, "run", run):
            status, body = http_util.fetch_text("http://x")
        self.assertEqual((status, body), (404, "<title>x</title>"))
        self.assertIn("-L", run.calls[0])


if __name__ == "__main__":
    unittest.main()
