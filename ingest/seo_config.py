"""The one config file, as seen from Python.

n-seo.config.json (or $N_SEO_CONFIG) is shared with the dashboard
(src/config.ts). Every script imports this instead of carrying its own site
list, so a site added to the config is picked up by every pull, probe, audit
and export. Stdlib only.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

# Print UTF-8 whatever the platform thinks the console encoding is.
#
# Windows picks the ANSI code page (cp1252 on a US install) for a piped
# stdout, so the em dashes and middle dots this tool prints come out as
# mojibake or raise UnicodeEncodeError mid-run. Every entry point imports
# this module, so fixing it once here covers all of them. File I/O is
# handled separately: every read_text/write_text/open call passes
# encoding="utf-8" explicitly, and tests/py/test_portability.py enforces it.
for _stream in (sys.stdout, sys.stderr):
    try:
        if getattr(_stream, "encoding", "").lower().replace("-", "") != "utf8":
            _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError, OSError):
        pass  # a captured or replaced stream; nothing to fix

# The engine checkout: code, engine docs, public assets.
ROOT = Path(__file__).resolve().parent.parent
# The instance: one user's config, queue, content and data. Defaults to the
# engine checkout ("in-place" mode); N_SEO_INSTANCE separates them so that
# upgrading the engine is a git pull that never touches your files.
INSTANCE = Path(os.environ["N_SEO_INSTANCE"]).resolve() if os.environ.get("N_SEO_INSTANCE") else ROOT
DATA = INSTANCE / "data"
CONFIG_PATH = Path(os.environ.get("N_SEO_CONFIG") or INSTANCE / "n-seo.config.json")
EXAMPLE_PATH = ROOT / "n-seo.config.example.json"

MODULE_KEYS = [
    "indexStatus", "metadataAudit", "opportunityScan", "llm", "hackerNews",
    "reddit", "indexNow", "staticExport", "publish", "gitAutoCommit",
    "notifications", "updateCheck",
]

# Per-module defaults, so a half-written block cannot make a step guess.
# Mirrors MODULE_DEFAULTS in src/config.ts.
MODULE_DEFAULTS = {
    # The one module that ships on. Everything else here is opt-in, but an
    # engine that never mentions its own updates leaves people running old
    # code without knowing it. One public metadata request a day, carrying
    # nothing about this instance, and `"updateCheck": {"enabled": false}`
    # stops it for good.
    "updateCheck": {"enabled": True},
    "staticExport": {"signOutUrl": "", "signOutLabel": "Sign out"},
    "publish": {"target": "gcs", "destination": "", "command": "",
                "delete": False, "dryRun": False, "env": {}},
}

_cache = None


def using_example() -> bool:
    return not CONFIG_PATH.exists()


def load(force: bool = False) -> dict:
    """The normalized config. Falls back to the example file so a fresh
    checkout can run `ops/demo_data.py` and open the dashboard before any
    Google setup."""
    global _cache
    if _cache is not None and not force:
        return _cache
    path = CONFIG_PATH if CONFIG_PATH.exists() else EXAMPLE_PATH
    raw = json.loads(path.read_text(encoding="utf-8"))
    modules = {k: {"enabled": False, **MODULE_DEFAULTS.get(k, {})} for k in MODULE_KEYS}
    for k, v in (raw.get("modules") or {}).items():
        modules[k] = {"enabled": False, **MODULE_DEFAULTS.get(k, {}), **(v or {})}
    sites = []
    for s in raw.get("sites") or []:
        if not s.get("host"):
            continue
        sites.append({
            **s,
            "label": s.get("label") or s["host"],
            "gscHost": s.get("gscHost") or s["host"],
            "gscProperty": s.get("gscProperty") or None,
            "ga4Property": str(s.get("ga4Property") or "") or None,
            "brand": s.get("brand") or None,
        })
    conv = raw.get("conversions") or {}

    def str_list(v):
        return [x for x in (v or []) if isinstance(x, str) and x.strip()] if isinstance(v, list) else []

    raw_hooks = raw.get("hooks") or {}
    hooks = {
        "beforeRun": str_list(raw_hooks.get("beforeRun")),
        "afterRun": str_list(raw_hooks.get("afterRun")),
        "afterStep": {k: str_list(v) for k, v in (raw_hooks.get("afterStep") or {}).items()},
    }
    _cache = {
        "name": raw.get("name") or "n-seo",
        "port": int(os.environ.get("SEO_PORT") or raw.get("port") or 4600),
        "google": {**(raw.get("google") or {}),
                   "auth": (raw.get("google") or {}).get("auth") or "service-account-key"},
        "sites": sites,
        "watchPages": raw.get("watchPages") or [],
        "conversions": conv if conv.get("site") else None,
        "participation": raw.get("participation") or {},
        "modules": modules,
        "gscExtraProperties": str_list(raw.get("gscExtraProperties")),
        "hooks": hooks,
    }
    return _cache


def engine_info() -> dict:
    """Mirrors src/config.ts engineInfo(): what engine is running, for which instance."""
    try:
        version = json.loads((ROOT / "package.json").read_text(encoding="utf-8")).get("version", "0.0.0")
    except (OSError, json.JSONDecodeError):
        version = "0.0.0"
    try:
        p = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"],
                           capture_output=True, text=True)
        commit = p.stdout.strip() or None if p.returncode == 0 else None
    except OSError:
        commit = None
    return {"version": version, "commit": commit, "root": str(ROOT), "instance": str(INSTANCE),
            "mode": "in-place" if INSTANCE == ROOT else "instance"}


def hooks() -> dict:
    return load()["hooks"]


def sites() -> list[dict]:
    return load()["sites"]


def hosts() -> list[str]:
    return [s["host"] for s in sites()]


def module(name: str) -> dict:
    return load()["modules"].get(name, {"enabled": False})


def enabled(name: str) -> bool:
    return bool(module(name).get("enabled"))


def port() -> int:
    return load()["port"]


def dashboard_base() -> str:
    return f"http://localhost:{port()}"


def gsc_slug(prop: str) -> str:
    """data/gsc/<slug>/ — must match src/config.ts gscSlug()."""
    s = prop
    if s.startswith("sc-domain:"):
        s = s[len("sc-domain:"):]
    for prefix in ("https://", "http://"):
        if s.startswith(prefix):
            s = s[len(prefix):]
    return s.rstrip("/").replace("/", "_")


def gsc_data_slug(prop: str) -> str:
    """The data/gsc/ directory for a property. A url-prefix property
    ("https://example.com/") would slug to the same name as the domain
    property ("sc-domain:example.com"), so it gets a "-urlprefix" suffix.
    Must match src/config.ts gscDataSlug()."""
    s = gsc_slug(prop)
    return s + "-urlprefix" if prop.lower().startswith(("http://", "https://")) else s


def gsc_properties(include_extra: bool = True) -> dict[str, str]:
    """{GSC property -> data/gsc subdirectory}, deduplicated. A domain
    property covers its subdomains, so several hosts can share one.
    gscExtraProperties (pulled for their data, never shown as sites) are
    appended unless include_extra is False."""
    out = {}
    for s in sites():
        if s["gscProperty"]:
            out[s["gscProperty"]] = gsc_data_slug(s["gscProperty"])
    if include_extra:
        for prop in load()["gscExtraProperties"]:
            out.setdefault(prop, gsc_data_slug(prop))
    return out


def gsc_dir_for(site: dict) -> Path | None:
    return DATA / "gsc" / gsc_data_slug(site["gscProperty"]) if site.get("gscProperty") else None


def ga4_properties() -> dict[str, str]:
    """{host -> numeric GA4 property id}"""
    return {s["host"]: s["ga4Property"] for s in sites() if s.get("ga4Property")}


def index_hosts() -> dict[str, str]:
    """{crawlable host -> GSC property to inspect its URLs against}"""
    return {s["gscHost"]: s["gscProperty"] for s in sites() if s.get("gscProperty")}


def brand_patterns() -> dict[str, str]:
    """{GSC property -> brand regex}; hosts sharing a property are OR-ed."""
    out: dict[str, list[str]] = {}
    for s in sites():
        if s.get("gscProperty") and s.get("brand"):
            out.setdefault(s["gscProperty"], []).append(s["brand"])
    return {p: "|".join(f"(?:{b})" for b in bs) for p, bs in out.items()}


def expand(path_str: str) -> Path:
    return Path(os.path.expanduser(os.path.expandvars(path_str))).resolve()


def env(key: str, default: str = "") -> str:
    """Read one key from the environment, then from the instance's .env (KEY=value lines)."""
    if os.environ.get(key):
        return os.environ[key]
    try:
        for line in (INSTANCE / ".env").read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith(f"{key}="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return default
