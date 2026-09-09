"""google.auth = "metadata": the GCE / Cloud Run / GKE runtime identity.

The metadata server only issues cloud-platform tokens and Search Console
rejects those, so the mode is a two-step exchange. These pin both steps and
the message shown when the account may not sign for itself, because that
IAM binding is the one thing a first deployment always misses.
"""
import json
import unittest
from unittest import mock

import _paths  # noqa: F401
import google_auth
import seo_config

SA = "runtime@project.iam.gserviceaccount.com"
MD_SA = "/instance/service-accounts/default/?recursive=true"
MD_TOKEN = "/instance/service-accounts/default/token"


class MetadataAuthTests(unittest.TestCase):
    def setUp(self):
        google_auth._cache.clear()
        self._cfg = seo_config._cache
        seo_config._cache = {"google": {"auth": "metadata"}}

    def tearDown(self):
        seo_config._cache = self._cfg
        google_auth._cache.clear()

    def fake_curl(self, *, sa_email=SA, exchange=None, on_call=None):
        """Stand in for curl_json, answering both metadata paths and IAM."""
        calls = []

        def curl(args, **kw):
            url = args[-1]
            calls.append({"url": url, "args": args, "kw": kw})
            if on_call:
                on_call(url, args)
            if url.endswith(MD_SA):
                return {"email": sa_email, "aliases": ["default"]}
            if url.endswith(MD_TOKEN):
                return {"access_token": "metadata-cloud-platform-token", "expires_in": 3599}
            if ":generateAccessToken" in url:
                return exchange if exchange is not None else {"accessToken": "scoped-token"}
            raise AssertionError(f"unexpected url {url}")

        return curl, calls

    def test_two_step_exchange_asks_for_the_scope_we_need(self):
        curl, calls = self.fake_curl()
        with mock.patch.object(google_auth, "curl_json", curl):
            tok = google_auth.access_token(google_auth.WEBMASTERS_RO)
        self.assertEqual(tok, "scoped-token")

        iam = next(c for c in calls if ":generateAccessToken" in c["url"])
        self.assertIn(f"/{SA}:generateAccessToken", iam["url"])
        body = json.loads(iam["args"][iam["args"].index("-d") + 1])
        self.assertEqual(body["scope"], [google_auth.WEBMASTERS_RO])
        self.assertEqual(body["lifetime"], "3600s")
        # the IAM call is authorized by the metadata token, not by a key
        self.assertIn("Authorization: Bearer metadata-cloud-platform-token", iam["args"])

    def test_configured_impersonate_wins_over_the_detected_account(self):
        curl, calls = self.fake_curl()
        seo_config._cache = {"google": {"auth": "metadata", "impersonate": "other@p.iam.gserviceaccount.com"}}
        with mock.patch.object(google_auth, "curl_json", curl):
            google_auth.access_token(google_auth.ANALYTICS_RO)
        iam = next(c for c in calls if ":generateAccessToken" in c["url"])
        self.assertIn("/other@p.iam.gserviceaccount.com:generateAccessToken", iam["url"])
        self.assertNotIn(MD_SA, [c["url"] for c in calls])  # no need to ask

    def test_scoped_tokens_are_cached_per_scope(self):
        seen = []
        curl, _ = self.fake_curl(on_call=lambda url, args: seen.append(url) if ":generateAccessToken" in url else None)
        with mock.patch.object(google_auth, "curl_json", curl):
            google_auth.access_token(google_auth.WEBMASTERS_RO)
            google_auth.access_token(google_auth.WEBMASTERS_RO)
            google_auth.access_token(google_auth.ANALYTICS_RO)
        self.assertEqual(len(seen), 2, "one exchange per scope, then cached")

    def test_403_names_the_token_creator_binding(self):
        curl, _ = self.fake_curl(exchange={"error": {"code": 403, "status": "PERMISSION_DENIED",
                                                     "message": "denied"}})
        with mock.patch.object(google_auth, "curl_json", curl):
            with self.assertRaises(RuntimeError) as cm:
                google_auth.access_token()
        msg = str(cm.exception)
        self.assertIn("roles/iam.serviceAccountTokenCreator", msg)
        self.assertIn("add-iam-policy-binding", msg)
        self.assertIn(SA, msg)

    def test_off_gcp_says_so_instead_of_failing_obscurely(self):
        def curl(args, **kw):
            raise RuntimeError("curl exit 6")  # hostname does not resolve
        with mock.patch.object(google_auth, "curl_json", curl):
            self.assertFalse(google_auth.metadata_available())
            self.assertIsNone(google_auth.metadata_service_account())
            with self.assertRaises(RuntimeError) as cm:
                google_auth.access_token()
        self.assertIn("metadata server did not answer", str(cm.exception))

    def test_probe_is_bounded_and_uses_the_required_header(self):
        curl, calls = self.fake_curl()
        with mock.patch.object(google_auth, "curl_json", curl):
            self.assertTrue(google_auth.metadata_available())
        probe = calls[0]
        self.assertIn("Metadata-Flavor: Google", probe["args"])
        self.assertIn("--connect-timeout", probe["args"])
        self.assertEqual(probe["kw"].get("attempts"), 1, "no retry loop on a laptop")

    def test_service_account_email_reports_the_runtime_identity(self):
        curl, _ = self.fake_curl()
        with mock.patch.object(google_auth, "curl_json", curl):
            self.assertEqual(google_auth.service_account_email(), SA)


if __name__ == "__main__":
    unittest.main()
