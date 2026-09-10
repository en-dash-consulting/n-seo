import base64
import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import _paths  # noqa: F401
import google_auth
import seo_config


def b64url_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


@unittest.skipUnless(shutil.which("openssl"), "openssl not on PATH")
class JwtTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="n-seo-auth-")).resolve()
        priv = self.tmp / "key.pem"
        subprocess.run(["openssl", "genrsa", "-out", str(priv), "2048"], check=True, capture_output=True)
        self.pub = self.tmp / "pub.pem"
        subprocess.run(["openssl", "rsa", "-in", str(priv), "-pubout", "-out", str(self.pub)],
                       check=True, capture_output=True)
        self.key_file = self.tmp / "sa.json"
        self.key_file.write_text(json.dumps({
            "type": "service_account",
            "client_email": "reader@project.iam.gserviceaccount.com",
            "private_key": priv.read_text(encoding="utf-8"),
            "token_uri": "https://oauth2.googleapis.com/token",
        }), encoding="utf-8")
        google_auth._cache.clear()
        self._cfg = seo_config._cache
        seo_config._cache = {"google": {"auth": "service-account-key", "serviceAccountKey": str(self.key_file)}}

    def tearDown(self):
        seo_config._cache = self._cfg
        google_auth._cache.clear()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_key_path_and_email(self):
        self.assertEqual(google_auth.key_path(), str(self.key_file))
        self.assertEqual(google_auth.service_account_email(), "reader@project.iam.gserviceaccount.com")

    def test_jwt_is_well_formed_and_signed(self):
        captured = {}

        def fake_curl(args, **kw):
            captured["args"] = args
            return {"access_token": "tok-123", "expires_in": 3600}

        before = time.time()
        with mock.patch.object(google_auth, "curl_json", fake_curl):
            tok = google_auth.access_token(google_auth.ANALYTICS_RO)
        self.assertEqual(tok, "tok-123")
        self.assertEqual(captured["args"][-1], "https://oauth2.googleapis.com/token")
        body = captured["args"][captured["args"].index("-d") + 1]
        self.assertTrue(body.startswith("grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion="))
        assertion = body.split("assertion=", 1)[1]
        h, c, s = assertion.split(".")
        self.assertEqual(json.loads(b64url_decode(h)), {"alg": "RS256", "typ": "JWT"})
        claims = json.loads(b64url_decode(c))
        self.assertEqual(claims["iss"], "reader@project.iam.gserviceaccount.com")
        self.assertEqual(claims["scope"], google_auth.ANALYTICS_RO)
        self.assertEqual(claims["aud"], "https://oauth2.googleapis.com/token")
        # iat is deliberately backdated so a slightly fast clock cannot make
        # Google reject the assertion as issued in the future.
        self.assertTrue(before - 120 <= claims["iat"] <= time.time() - 30,
                        f"iat should be backdated ~60s, got {claims['iat'] - before}s vs now")
        self.assertEqual(claims["exp"] - claims["iat"], 3600)

        sig = self.tmp / "sig.bin"
        sig.write_bytes(b64url_decode(s))
        p = subprocess.run(["openssl", "dgst", "-sha256", "-verify", str(self.pub), "-signature", str(sig)],
                           input=f"{h}.{c}".encode(), capture_output=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(sorted(x for x in os.listdir(self.tmp) if x.endswith(".pem")), ["key.pem", "pub.pem"],
                         "signing leaves no private-key file behind")

    def test_signature_verifies_and_needs_no_openssl_binary(self):
        """The signer runs through node, so a machine without openssl (every
        stock Windows box) can still authenticate. Verified cryptographically,
        not just for plausible-looking bytes."""
        key = json.loads(self.key_file.read_text(encoding="utf-8"))
        data = b"eyJhbGciOiJSUzI1NiJ9.eyJzY29wZSI6InRlc3QifQ"
        sig = google_auth._sign_rs256(key["private_key"], data)
        self.assertEqual(len(sig), 256, "RSA-2048 signature is 256 bytes")

        sig_file = self.tmp / "direct.bin"
        sig_file.write_bytes(sig)
        p = subprocess.run(
            ["openssl", "dgst", "-sha256", "-verify", str(self.pub), "-signature", str(sig_file)],
            input=data, capture_output=True)
        self.assertEqual(p.returncode, 0, p.stderr)

    def test_signing_reports_a_missing_node(self):
        with mock.patch.object(google_auth.shutil, "which", return_value=None):
            with self.assertRaises(RuntimeError) as ctx:
                google_auth._sign_rs256("-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n", b"d")
        self.assertIn("not on PATH", str(ctx.exception))
        self.assertIn("NODE", str(ctx.exception))

    def test_signing_reports_a_malformed_key(self):
        with self.assertRaises(RuntimeError) as ctx:
            google_auth._sign_rs256("not a pem at all", b"data")
        self.assertIn("private_key", str(ctx.exception))

    def test_token_is_cached_per_scope(self):
        calls = []

        def fake_curl(args, **kw):
            calls.append(1)
            return {"access_token": f"tok-{len(calls)}"}

        with mock.patch.object(google_auth, "curl_json", fake_curl):
            a = google_auth.access_token(google_auth.WEBMASTERS_RO)
            b = google_auth.access_token(google_auth.WEBMASTERS_RO)
            c = google_auth.access_token(google_auth.ANALYTICS_RO)
        self.assertEqual((a, b), ("tok-1", "tok-1"))
        self.assertEqual(c, "tok-2")

    def test_token_exchange_error_is_loud(self):
        with mock.patch.object(google_auth, "curl_json", lambda *a, **k: {"error": "invalid_grant"}):
            with self.assertRaises(RuntimeError) as cm:
                google_auth.access_token()
        self.assertIn("invalid_grant", str(cm.exception))

    def test_missing_key_file_points_at_docs(self):
        seo_config._cache = {"google": {"auth": "service-account-key", "serviceAccountKey": str(self.tmp / "nope.json")}}
        with self.assertRaises(RuntimeError) as cm:
            google_auth.access_token()
        self.assertIn("SETUP-GOOGLE", str(cm.exception))

    def test_gcloud_modes(self):
        seo_config._cache = {"google": {"auth": "gcloud-impersonate", "impersonate": ""}}
        with self.assertRaises(RuntimeError):
            google_auth.access_token()
        seo_config._cache = {"google": {"auth": "gcloud-impersonate", "impersonate": "sa@p.iam.gserviceaccount.com"}}
        with mock.patch.object(google_auth.subprocess, "run",
                               return_value=subprocess.CompletedProcess([], 0, stdout="gtok\n", stderr="")) as run:
            self.assertEqual(google_auth.access_token(google_auth.WEBMASTERS_RO), "gtok")
        cmd = run.call_args[0][0]
        self.assertIn("--impersonate-service-account=sa@p.iam.gserviceaccount.com", cmd)
        self.assertIn(f"--scopes={google_auth.WEBMASTERS_RO}", cmd)
        self.assertEqual(google_auth.service_account_email(), "sa@p.iam.gserviceaccount.com")
        seo_config._cache = {"google": {"auth": "what"}}
        google_auth._cache.clear()
        with self.assertRaises(RuntimeError):
            google_auth.access_token()


if __name__ == "__main__":
    unittest.main()
