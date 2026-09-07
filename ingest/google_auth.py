"""Access tokens for the Google APIs (Search Console, GA4), three ways.

  service-account-key (default, recommended)
      A service-account JSON key on disk (config google.serviceAccountKey,
      or $GOOGLE_APPLICATION_CREDENTIALS). We build the OAuth JWT ourselves
      and sign it with the `openssl` CLI, so there is no gcloud and no pip
      dependency. Add the service account's email to your Search Console
      property (Full user) and your GA4 property (Viewer) — that is all the
      access it gets.

  gcloud-impersonate
      `gcloud auth print-access-token --impersonate-service-account=<sa>`.
      For people who already run gcloud and would rather grant themselves
      Token Creator on the SA than keep a key file.

  gcloud-user
      `gcloud auth print-access-token` with a user login. Only works if that
      login already carries the webmasters/analytics scopes, which Google's
      default gcloud client does not — kept for completeness, not
      recommended.

Scopes are requested per call, minimal: webmasters.readonly for pulls and
inspection, analytics.readonly for GA4.
"""
import base64
import json
import os
import subprocess
import tempfile
import time

import seo_config
from http_util import curl_json

WEBMASTERS_RO = "https://www.googleapis.com/auth/webmasters.readonly"
WEBMASTERS = "https://www.googleapis.com/auth/webmasters"
ANALYTICS_RO = "https://www.googleapis.com/auth/analytics.readonly"

_cache: dict[str, tuple[str, float]] = {}


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def key_path() -> str | None:
    g = seo_config.load()["google"]
    p = g.get("serviceAccountKey") or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    return str(seo_config.expand(p)) if p else None


def _sa_key_token(scope: str) -> str:
    kp = key_path()
    if not kp or not os.path.exists(kp):
        raise RuntimeError(
            "google.auth is service-account-key but no key file was found at "
            f"{kp or '(unset)'} — see docs/SETUP-GOOGLE.md")
    key = json.loads(open(kp).read())
    now = int(time.time())
    header = _b64url(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    claims = _b64url(json.dumps({
        "iss": key["client_email"], "scope": scope, "aud": key["token_uri"],
        "iat": now, "exp": now + 3600,
    }).encode())
    signing_input = f"{header}.{claims}".encode()
    # openssl needs the private key in a file; keep it 0600 and short-lived.
    fd, tmp = tempfile.mkstemp(prefix="n-seo-", suffix=".pem")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(key["private_key"])
        sig = subprocess.run(["openssl", "dgst", "-sha256", "-sign", tmp],
                             input=signing_input, capture_output=True, check=True).stdout
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    assertion = signing_input.decode() + "." + _b64url(sig)
    resp = curl_json([
        "-X", "POST", "-d", f"grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion={assertion}",
        key["token_uri"]], label="token")
    if "access_token" not in resp:
        raise RuntimeError(f"token exchange failed: {json.dumps(resp)[:300]}")
    return resp["access_token"]


def _gcloud_token(scope: str, impersonate: str | None) -> str:
    cmd = ["gcloud", "auth", "print-access-token"]
    if impersonate:
        cmd += [f"--impersonate-service-account={impersonate}", f"--scopes={scope}"]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"gcloud token failed: {p.stderr.strip()[:200]}")
    return p.stdout.strip()


def access_token(scope: str = WEBMASTERS_RO) -> str:
    """A bearer token for `scope`, cached in-process for ~50 minutes."""
    hit = _cache.get(scope)
    if hit and hit[1] > time.time():
        return hit[0]
    g = seo_config.load()["google"]
    mode = g.get("auth", "service-account-key")
    if mode == "service-account-key":
        tok = _sa_key_token(scope)
    elif mode == "gcloud-impersonate":
        if not g.get("impersonate"):
            raise RuntimeError("google.auth is gcloud-impersonate but google.impersonate is empty")
        tok = _gcloud_token(scope, g["impersonate"])
    elif mode == "gcloud-user":
        tok = _gcloud_token(scope, None)
    else:
        raise RuntimeError(f"unknown google.auth mode {mode!r}")
    _cache[scope] = (tok, time.time() + 50 * 60)
    return tok


def service_account_email() -> str | None:
    """Who to add in the Search Console / GA4 consoles."""
    g = seo_config.load()["google"]
    if g.get("auth") == "gcloud-impersonate":
        return g.get("impersonate") or None
    kp = key_path()
    if kp and os.path.exists(kp):
        try:
            return json.loads(open(kp).read()).get("client_email")
        except (OSError, json.JSONDecodeError):
            return None
    return None


if __name__ == "__main__":
    # `python3 ingest/google_auth.py` — mint one token and list GSC properties.
    tok = access_token()
    props = curl_json(["-H", f"Authorization: Bearer {tok}",
                       "https://searchconsole.googleapis.com/webmasters/v3/sites"], label="sites")
    print("token OK;", service_account_email() or "(user login)")
    for e in props.get("siteEntry", []):
        print(f"  {e.get('siteUrl'):45s} {e.get('permissionLevel')}")
