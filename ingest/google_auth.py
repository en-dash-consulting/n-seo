"""Access tokens for the Google APIs (Search Console, GA4), four ways.

  service-account-key (default, recommended)
      A service-account JSON key on disk (config google.serviceAccountKey,
      or $GOOGLE_APPLICATION_CREDENTIALS). We build the OAuth JWT ourselves
      and sign it with node's crypto module, so there is no gcloud, no pip
      dependency and no openssl binary. Add the service account's email to
      your Search Console property (Full user) and your GA4 property
      (Viewer) — that is all the access it gets.

  gcloud-impersonate
      `gcloud auth print-access-token --impersonate-service-account=<sa>`.
      For people who already run gcloud and would rather grant themselves
      Token Creator on the SA than keep a key file.

  gcloud-user
      `gcloud auth print-access-token` with a user login. Only works if that
      login already carries the webmasters/analytics scopes, which Google's
      default gcloud client does not — kept for completeness, not
      recommended.

  metadata (for GCE / Cloud Run / GKE — no key file at all)
      The runtime service account, taken from the metadata server. Its token
      is `cloud-platform` scoped and Search Console rejects that, so the
      account mints a correctly scoped token for itself through IAM
      Credentials. That self-impersonation needs
      `roles/iam.serviceAccountTokenCreator` on itself; the error says so if
      it is missing. Prefer this over shipping a key file into a container.

Scopes are requested per call, minimal: webmasters.readonly for pulls and
inspection, analytics.readonly for GA4.
"""
import base64
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

import seo_config
from http_util import curl_json

WEBMASTERS_RO = "https://www.googleapis.com/auth/webmasters.readonly"
WEBMASTERS = "https://www.googleapis.com/auth/webmasters"
ANALYTICS_RO = "https://www.googleapis.com/auth/analytics.readonly"

METADATA_ROOT = "http://metadata.google.internal/computeMetadata/v1"
IAM_CREDENTIALS = "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts"
# Off GCP the hostname does not resolve, so the probe fails on curl's DNS
# error rather than waiting; the short timeouts bound the case where some
# network resolves it to something that then hangs.
_MD_ARGS = ["--connect-timeout", "1", "-H", "Metadata-Flavor: Google"]

_cache: dict[str, tuple[str, float]] = {}


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


# RS256 without an openssl binary. Node is already required (the dashboard
# runs on it) and its crypto module produces byte-identical signatures, so
# signing through node drops an external dependency on every platform — and
# makes Windows work, where openssl is not installed by default.
#
# Key and payload go in over stdin, never on the command line: argv is
# readable by any other process on the machine.
_NODE_SIGN_JS = (
    "let s='';"
    "process.stdin.setEncoding('utf8')"
    ".on('data', d => s += d)"
    ".on('end', () => {"
    "  const { key, data } = JSON.parse(s);"
    "  const sig = require('node:crypto')"
    "    .sign('sha256', Buffer.from(data, 'base64'), key);"
    "  process.stdout.write(sig.toString('base64'));"
    "});"
)


def node_bin() -> str:
    """The node executable. $NODE overrides, mirroring $PYTHON for the CLI."""
    return os.environ.get("NODE") or "node"


def _sign_rs256(private_key_pem: str, data: bytes) -> bytes:
    """RSASSA-PKCS1-v1_5 over SHA-256, the `RS256` a Google JWT needs."""
    node = node_bin()
    if not shutil.which(node):
        raise RuntimeError(
            f"{node} is not on PATH, and the service-account JWT is signed with it. "
            "Install Node 20+ (it is required for the dashboard anyway), or set "
            "$NODE to its path.")
    payload = json.dumps({"key": private_key_pem,
                          "data": base64.b64encode(data).decode()})
    p = subprocess.run([node, "-e", _NODE_SIGN_JS],
                       input=payload, capture_output=True, text=True)
    if p.returncode != 0 or not p.stdout.strip():
        raise RuntimeError(
            "could not sign the service-account JWT — the key file's "
            f"private_key may be malformed: {(p.stderr or '').strip()[:200]}")
    return base64.b64decode(p.stdout.strip())


def key_path() -> str | None:
    """The service-account key to sign with.

    The configured path wins, but the example config ships a default one, so
    a key that is not there must not shadow a working
    GOOGLE_APPLICATION_CREDENTIALS — otherwise the documented env var can
    never take effect on a fresh install.
    """
    g = seo_config.load()["google"]
    configured = g.get("serviceAccountKey")
    env = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if configured:
        p = str(seo_config.expand(configured))
        if os.path.exists(p) or not env:
            return p
    return str(seo_config.expand(env)) if env else None


def _sa_key_token(scope: str) -> str:
    kp = key_path()
    if not kp or not os.path.exists(kp):
        raise RuntimeError(
            "google.auth is service-account-key but no key file was found at "
            f"{kp or '(unset)'} — see docs/SETUP-GOOGLE.md")
    key = json.loads(Path(kp).read_text())
    # Backdate slightly: Google rejects a JWT issued in its future, so a
    # machine whose clock runs a few seconds fast otherwise fails to
    # authenticate at all, with an error that names nothing useful.
    iat = int(time.time()) - 60
    header = _b64url(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    claims = _b64url(json.dumps({
        "iss": key["client_email"], "scope": scope, "aud": key["token_uri"],
        "iat": iat, "exp": iat + 3600,
    }).encode())
    signing_input = f"{header}.{claims}".encode()
    sig = _sign_rs256(key["private_key"], signing_input)
    assertion = signing_input.decode() + "." + _b64url(sig)
    resp = curl_json([
        "-X", "POST", "-d", f"grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion={assertion}",
        key["token_uri"]], label="token")
    if "access_token" not in resp:
        hint = ""
        if resp.get("error") == "invalid_grant":
            hint = (" — invalid_grant usually means this machine's clock is off, "
                    "or the key has been disabled or deleted")
        raise RuntimeError(f"token exchange failed{hint}: {json.dumps(resp)[:300]}")
    return resp["access_token"]


def _metadata_json(path: str, *, timeout: int = 2, attempts: int = 1):
    return curl_json([*_MD_ARGS, f"{METADATA_ROOT}{path}"],
                     timeout=timeout, attempts=attempts, label=f"metadata {path}")


def metadata_service_account() -> str | None:
    """The runtime service account's email, or None when not on GCP."""
    try:
        sa = _metadata_json("/instance/service-accounts/default/?recursive=true")
    except (RuntimeError, OSError):
        return None
    return sa.get("email") if isinstance(sa, dict) else None


def metadata_available() -> bool:
    """True on GCE, Cloud Run and GKE. Safe (and quick) to call anywhere."""
    return metadata_service_account() is not None


def _metadata_token(scope: str) -> str:
    """Runtime service account -> a token carrying `scope`.

    Two steps, because the metadata server only issues `cloud-platform`
    tokens and the Search Console API checks for its own scope: take the
    metadata token, then ask IAM Credentials for a scoped one for the same
    account.
    """
    g = seo_config.load()["google"]
    email = g.get("impersonate") or metadata_service_account()
    if not email:
        raise RuntimeError(
            "google.auth is metadata, but the metadata server did not answer. "
            "That mode only works on GCE, Cloud Run or GKE. Off GCP, use "
            "service-account-key; see docs/SETUP-GOOGLE.md")
    md = _metadata_json("/instance/service-accounts/default/token", timeout=5, attempts=2)
    base = md.get("access_token") if isinstance(md, dict) else None
    if not base:
        raise RuntimeError(f"metadata server returned no access_token: {json.dumps(md)[:200]}")
    resp = curl_json([
        "-X", "POST",
        "-H", f"Authorization: Bearer {base}",
        "-H", "Content-Type: application/json",
        "-d", json.dumps({"scope": [scope], "lifetime": "3600s"}),
        f"{IAM_CREDENTIALS}/{email}:generateAccessToken",
    ], label="generateAccessToken")
    if isinstance(resp, dict) and resp.get("accessToken"):
        return resp["accessToken"]
    err = resp.get("error") if isinstance(resp, dict) else None
    code = int(err.get("code", 0)) if isinstance(err, dict) else 0
    if code in (401, 403):
        raise RuntimeError(
            f"{email} is not allowed to mint tokens for itself. Grant it Token "
            f"Creator on itself:\n"
            f"  gcloud iam service-accounts add-iam-policy-binding {email} \\\n"
            f"    --member=serviceAccount:{email} \\\n"
            f"    --role=roles/iam.serviceAccountTokenCreator\n"
            f"({json.dumps(resp)[:200]})")
    raise RuntimeError(f"generateAccessToken failed: {json.dumps(resp)[:300]}")


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
    elif mode == "metadata":
        tok = _metadata_token(scope)
    else:
        raise RuntimeError(f"unknown google.auth mode {mode!r}")
    _cache[scope] = (tok, time.time() + 50 * 60)
    return tok


def service_account_email() -> str | None:
    """Who to add in the Search Console / GA4 consoles."""
    g = seo_config.load()["google"]
    if g.get("auth") == "gcloud-impersonate":
        return g.get("impersonate") or None
    if g.get("auth") == "metadata":
        return g.get("impersonate") or metadata_service_account()
    kp = key_path()
    if kp and os.path.exists(kp):
        try:
            return json.loads(Path(kp).read_text()).get("client_email")
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
