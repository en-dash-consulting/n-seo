#!/usr/bin/env python3
"""Setup checker: is this install ready to run?

  python3 ops/doctor.py            # everything, including live Google calls
  python3 ops/doctor.py --offline  # local checks only

Each check prints OK / WARN / FAIL with a fix hint. Exit code 1 on any FAIL.
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ingest"))
import seo_config  # noqa: E402

OFFLINE = "--offline" in sys.argv
FAILS = 0


def report(level, name, detail=""):
    global FAILS
    if level == "FAIL":
        FAILS += 1
    print(f"  {level:4s} {name}" + (f" — {detail}" if detail else ""))


def check_engine():
    e = seo_config.engine_info()
    print("engine")
    report("OK", f"n-seo {e['version']}" + (f" · {e['commit']}" if e["commit"] else ""))
    report("OK", f"mode: {e['mode']}", "" if e["mode"] == "instance"
           else "config, queue and data live inside the engine checkout (see docs/INSTANCE.md to split them)")
    report("OK", f"engine: {e['root']}")
    report("OK", f"instance: {e['instance']}")


def check_config():
    print("config")
    if seo_config.using_example():
        report("WARN", "n-seo.config.json missing",
               "running on the example — copy n-seo.config.example.json to "
               "n-seo.config.json or open /settings in the dashboard")
    else:
        report("OK", f"config at {seo_config.CONFIG_PATH}")
    try:
        cfg = seo_config.load(force=True)
    except json.JSONDecodeError as exc:
        report("FAIL", "config is not valid JSON", str(exc))
        return None
    sites = cfg["sites"]
    if not sites:
        report("FAIL", "no sites configured", "add at least one entry to sites[]")
    else:
        report("OK", f"{len(sites)} site(s): {', '.join(s['host'] for s in sites)}")
    for s in sites:
        if not s.get("gscProperty") and not s.get("ga4Property"):
            report("WARN", f"{s['host']} has neither gscProperty nor ga4Property",
                   "it will be probed but have no search or traffic data")
    return cfg


def check_tools():
    print("tools")
    report("OK" if shutil.which("curl") else "FAIL", "curl",
           "" if shutil.which("curl") else "install it — all HTTP goes through curl "
           "(Windows 10+ ships it in System32)")
    # node signs the service-account JWT, so it is required even for someone
    # who never opens the dashboard.
    import google_auth
    node = google_auth.node_bin()
    report("OK" if shutil.which(node) else "FAIL", f"node ({node})",
           "" if shutil.which(node) else "install Node 20+ — it runs the dashboard "
           "and signs the service-account JWT; $NODE overrides the path")
    v = sys.version_info
    report("OK" if v >= (3, 10) else "FAIL",
           f"python {v.major}.{v.minor} ({Path(sys.executable).name})",
           "" if v >= (3, 10) else "3.10+ required")
    nm = seo_config.ROOT / "node_modules"
    report("OK" if nm.exists() else "WARN", "node_modules", "" if nm.exists() else "run: npm install")


def check_auth(cfg):
    print("google auth")
    g = cfg["google"]
    mode = g.get("auth", "service-account-key")
    report("OK", f"mode: {mode}")
    import google_auth
    if mode == "service-account-key":
        kp = google_auth.key_path()
        if not kp or not Path(kp).exists():
            report("FAIL", "service-account key file not found",
                   f"{kp or '(unset)'} — set google.serviceAccountKey or $GOOGLE_APPLICATION_CREDENTIALS; see docs/SETUP-GOOGLE.md")
            return None
        try:
            key = json.loads(Path(kp).read_text())
        except (OSError, json.JSONDecodeError) as exc:
            report("FAIL", "key file unreadable", str(exc))
            return None
        if not key.get("client_email") or not key.get("private_key"):
            report("FAIL", "key file lacks client_email/private_key", "download a fresh JSON key for the service account")
            return None
        report("OK", f"key for {key['client_email']}")
    elif mode == "metadata":
        # Only meaningful on GCE / Cloud Run / GKE; say so plainly elsewhere
        # rather than leaving a confusing token failure as the only clue.
        email = g.get("impersonate") or google_auth.metadata_service_account()
        if not email:
            report("FAIL", "no metadata server on this machine",
                   "google.auth is metadata, which needs GCE, Cloud Run or GKE — "
                   "use service-account-key elsewhere; see docs/SETUP-GOOGLE.md")
            return None
        report("OK", f"runtime service account {email}")
    else:
        if not shutil.which("gcloud"):
            report("FAIL", "gcloud not on PATH", "install the Google Cloud SDK or switch to service-account-key")
            return None
        if mode == "gcloud-impersonate" and not g.get("impersonate"):
            report("FAIL", "google.impersonate is empty", "set the service-account email to impersonate")
            return None
        report("OK", "gcloud present")
    if OFFLINE:
        return None
    try:
        tok = google_auth.access_token(google_auth.WEBMASTERS_RO)
        report("OK", "minted a Search Console token")
        return tok
    except Exception as exc:  # noqa: BLE001
        report("FAIL", "could not mint a token", str(exc)[:200])
        return None


def check_gsc(cfg, tok):
    print("search console")
    props = seo_config.gsc_properties()
    if not props:
        report("WARN", "no gscProperty configured")
        return
    if OFFLINE or not tok:
        report("WARN", "skipped (offline or no token)")
        return
    from http_util import get_json
    import google_auth
    try:
        resp = get_json("https://searchconsole.googleapis.com/webmasters/v3/sites", tok, label="sites")
    except RuntimeError as exc:
        report("FAIL", "sites list failed", str(exc)[:200])
        return
    have = {e["siteUrl"]: e.get("permissionLevel") for e in resp.get("siteEntry", []) if "siteUrl" in e}
    who = google_auth.service_account_email() or "your account"
    for p in props:
        if p in have:
            report("OK", f"{p} ({have[p]})")
        else:
            report("FAIL", f"{p} not accessible",
                   f"in Search Console add {who} as a Full user on that property (or verify the property first)")


def check_ga4(cfg, tok_unused):
    print("ga4")
    props = seo_config.ga4_properties()
    if not props:
        report("WARN", "no ga4Property configured")
        return
    if OFFLINE:
        report("WARN", "skipped (offline)")
        return
    import google_auth
    from http_util import post_json
    try:
        tok = google_auth.access_token(google_auth.ANALYTICS_RO)
    except Exception as exc:  # noqa: BLE001
        report("FAIL", "could not mint an Analytics token", str(exc)[:200])
        return
    who = google_auth.service_account_email() or "your account"
    for host, prop in props.items():
        try:
            r = post_json(f"https://analyticsdata.googleapis.com/v1beta/properties/{prop}:runReport",
                          {"dateRanges": [{"startDate": "yesterday", "endDate": "yesterday"}],
                           "metrics": [{"name": "sessions"}]}, tok, label=f"ga4 {prop}")
        except RuntimeError as exc:
            report("FAIL", f"{host} (properties/{prop})", str(exc)[:200])
            continue
        if r.get("error"):
            report("FAIL", f"{host} (properties/{prop})",
                   f"{r['error'].get('message', '')[:120]} — add {who} as Viewer on the GA4 property")
        else:
            report("OK", f"{host} (properties/{prop})")


def check_dashboard():
    print("dashboard")
    if OFFLINE:
        report("WARN", "skipped (offline)")
        return
    base = seo_config.dashboard_base()
    p = subprocess.run(["curl", "-sf", "--max-time", "5", base + "/api/actions"], capture_output=True)
    report("OK" if p.returncode == 0 else "WARN", base, "" if p.returncode == 0 else "not running — npm start")


def check_modules(cfg):
    print("modules")
    on = [k for k, v in cfg["modules"].items() if v.get("enabled")]
    report("OK", "enabled: " + (", ".join(on) or "(none beyond defaults)"))
    llm = cfg["modules"].get("llm", {})
    if llm.get("enabled"):
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import llm as llm_mod
        http = llm_mod.http_config()
        if http:
            report("OK", f"llm over http: {http['provider']} {http['model']}")
            fast = llm_mod.http_config(fast=True)
            if fast and fast["model"] != http["model"]:
                report("OK", f"llm fast model: {fast['model']}")
        elif isinstance(llm.get("http"), dict) and llm["http"]:
            report("FAIL", "llm.http is configured but unusable",
                   f"check provider/model and that {llm['http'].get('apiKeyEnv') or 'apiKeyEnv'} "
                   "is set in the environment or .env")
        for key in ("command", "fastCommand"):
            raw = str(llm.get(key) or "").strip()
            cmd = llm_mod.split_command(raw)
            if not cmd:
                if raw:
                    # Configured but unparseable — almost always an unbalanced
                    # quote. Say so, or the next line reads as "not configured".
                    report("FAIL", f"llm.{key} could not be parsed: {raw[:60]}",
                           "check for an unbalanced quote")
                # Only complain about a missing command when there is no http
                # block at all; a broken one already reported itself.
                elif key == "command" and not http and not llm.get("http"):
                    report("FAIL", "llm has neither http nor command configured")
                continue
            report("OK" if shutil.which(cmd[0]) else "FAIL", f"llm.{key}: {cmd[0]}",
                   "" if shutil.which(cmd[0]) else "not on PATH")
    hn = cfg["modules"].get("hackerNews", {})
    if hn.get("enabled"):
        user = (hn.get("user") or "").strip()
        if not user:
            report("WARN", "hackerNews.user empty", "threads you already joined won't be marked")
        elif not OFFLINE:
            from http_util import get_json
            try:
                prof = get_json(f"https://hacker-news.firebaseio.com/v0/user/{user}.json", label="hn user")
                report("OK" if prof else "FAIL", f"HN user {user}", "" if prof else "profile not found")
            except RuntimeError as exc:
                report("WARN", f"HN user {user}", str(exc)[:120])
        if not hn.get("topics"):
            report("WARN", "hackerNews.topics empty", "add [query, why] pairs")
        if not (cfg["participation"] or {}).get("expertise", "").strip():
            report("WARN", "participation.expertise empty", "briefings will be skipped")
    rd = cfg["modules"].get("reddit", {})
    if rd.get("enabled"):
        ok = bool(seo_config.env("REDDIT_CLIENT_ID") and seo_config.env("REDDIT_CLIENT_SECRET"))
        report("OK" if ok else "FAIL", "reddit credentials",
               "" if ok else "REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET missing from .env")
    if cfg["modules"].get("indexNow", {}).get("enabled"):
        kf = cfg["modules"]["indexNow"].get("keyFile") or "indexnow.key"
        p = Path(kf) if Path(kf).is_absolute() else seo_config.INSTANCE / kf
        report("OK" if p.exists() else "WARN", f"indexNow key {kf}", "" if p.exists() else "run: python3 ops/indexnow.py init")


def main():
    check_engine()
    cfg = check_config()
    check_tools()
    if cfg is None:
        return 1
    tok = check_auth(cfg)
    check_gsc(cfg, tok)
    check_ga4(cfg, tok)
    check_dashboard()
    check_modules(cfg)
    print(f"\n{'all good' if not FAILS else f'{FAILS} problem(s) to fix'}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
