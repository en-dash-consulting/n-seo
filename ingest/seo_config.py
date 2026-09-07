"""The one config file, as seen from Python.

seo-agent.config.json (or $SEO_AGENT_CONFIG) is shared with the dashboard
(src/config.ts). Every script imports this instead of carrying its own site
list, so a site added to the config is picked up by every pull, probe, audit
and export. Stdlib only.
"""

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CONFIG_PATH = Path(os.environ.get("SEO_AGENT_CONFIG") or ROOT / "seo-agent.config.json")
EXAMPLE_PATH = ROOT / "seo-agent.config.example.json"

MODULE_KEYS = [
    "indexStatus", "metadataAudit", "opportunityScan", "llm", "hackerNews",
    "reddit", "indexNow", "staticExport", "gitAutoCommit", "notifications",
]

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
    raw = json.loads(path.read_text())
    modules = {k: {"enabled": False} for k in MODULE_KEYS}
    for k, v in (raw.get("modules") or {}).items():
        modules[k] = {"enabled": False, **(v or {})}
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
    _cache = {
        "name": raw.get("name") or "SEO Agent",
        "port": int(os.environ.get("SEO_PORT") or raw.get("port") or 4600),
        "google": {"auth": "service-account-key", **(raw.get("google") or {})},
        "sites": sites,
        "watchPages": raw.get("watchPages") or [],
        "conversions": conv if conv.get("site") else None,
        "participation": raw.get("participation") or {},
        "modules": modules,
    }
    return _cache


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


def gsc_properties() -> dict[str, str]:
    """{GSC property -> data/gsc subdirectory}, deduplicated. A domain
    property covers its subdomains, so several hosts can share one."""
    out = {}
    for s in sites():
        if s["gscProperty"]:
            out[s["gscProperty"]] = gsc_slug(s["gscProperty"])
    return out


def gsc_dir_for(site: dict) -> Path | None:
    return DATA / "gsc" / gsc_slug(site["gscProperty"]) if site.get("gscProperty") else None


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
    """Read one key from the environment, then from ./.env (KEY=value lines)."""
    if os.environ.get(key):
        return os.environ[key]
    try:
        for line in (ROOT / ".env").read_text().splitlines():
            line = line.strip()
            if line.startswith(f"{key}="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return default
