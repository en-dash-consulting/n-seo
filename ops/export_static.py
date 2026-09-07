#!/usr/bin/env python3
"""Snapshot the running dashboard into site/ as static HTML (modules.staticExport).

Host site/ anywhere you like — behind your own login, on an internal box, in
a private bucket. All data collection stays on the machine that runs the
daily job; the export is a read-only mirror of what the dashboard showed.

Every exported page gets a noindex meta and the export writes a deny-all
robots.txt: this is an internal ops view, not public content. Pages also
carry a small script that shows a banner when the mirror is more than 36
hours old, so a stalled daily job is visible from the mirror itself.
"""

import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ingest"))
import seo_config  # noqa: E402

ROOT = seo_config.ROOT
SITE = ROOT / "site"
BASE = seo_config.dashboard_base()


def routes():
    hosts = seo_config.hosts()
    drafts_dir = ROOT / "content" / "drafts"
    camps_dir = ROOT / "content" / "campaigns"
    # Same filter as the dashboard's drafts()/campaigns(): README and _-prefixed files are not content.
    skip = lambda p: p.name == "README.md" or p.name.startswith("_")
    drafts = sorted(p.stem for p in drafts_dir.glob("*.md") if not skip(p)) if drafts_dir.exists() else []
    camps = sorted(p.stem for p in camps_dir.glob("*.json") if not skip(p)) if camps_dir.exists() else []
    return (["/", "/actions", "/insights", "/trends", "/trends/30", "/trends/60", "/trends/90",
             "/trends/120", "/trends/180", "/content", "/indexing", "/probes", "/logs", "/settings"]
            + [f"/site/{h}" for h in hosts]
            + [f"/drafts/{s}" for s in drafts]
            + [f"/campaigns/{s}" for s in camps])


def fetch(path):
    p = subprocess.run(["curl", "-sf", "--max-time", "30", BASE + path],
                       capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"fetch failed for {path} — is the dashboard running at {BASE}? (npm start)")
    return p.stdout


def main():
    if SITE.exists():
        shutil.rmtree(SITE)
    SITE.mkdir()

    stamp = datetime.now(timezone.utc).isoformat(timespec="minutes")
    staleness = (
        '<script>(function(){var g=new Date("' + stamp + '");'
        'var h=(Date.now()-g.getTime())/36e5;'
        'if(h>36){var b=document.createElement("div");b.className="stale-banner";'
        'b.textContent="⚠ This mirror is "+Math.round(h)+"h old — the daily run has not published since '
        + stamp + ' UTC. Check the machine that runs it.";'
        'document.body.prepend(b);}})();</script>'
    )
    rs = routes()
    for route in rs:
        html = fetch(route)
        html = html.replace("<head>", '<head><meta name="robots" content="noindex, nofollow">', 1)
        html = html.replace("</body>", staleness + "</body>", 1)
        dest = SITE / "index.html" if route == "/" else SITE / route.lstrip("/") / "index.html"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(html)

    (SITE / "styles.css").write_text(fetch("/styles.css"))
    (SITE / "favicon.svg").write_text(fetch("/favicon.svg"))
    (SITE / "robots.txt").write_text("User-agent: *\nDisallow: /\n")

    print(f"exported {len(rs)} pages to {SITE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
