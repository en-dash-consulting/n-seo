#!/usr/bin/env python3
"""Ask the registry whether a newer engine has been published.

Nothing else in n-seo checks for updates, so before this existed the only way
to learn that a release had happened was to go and look. That is a poor deal
for a tool you schedule and then stop thinking about.

Two rules this obeys, because the promise on the tin is that your data stays
put:

1. **Only this step talks to the registry.** The dashboard never does — it
   reads the file written here, so opening a page makes no outbound request
   and works with the network unplugged.
2. **It is a module, and it can be switched off.** `modules.updateCheck`.
   The request carries no instance data: it is the same public metadata
   request `npm view n-seo version` makes from any machine.

Writes data/update-check.json. Pure stdlib; runs unattended from ops/daily.py.
"""

import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ingest"))
import seo_config  # noqa: E402

DATA = seo_config.DATA
OUT = DATA / "update-check.json"
PACKAGE = "n-seo"
RELEASES = "https://github.com/en-dash-consulting/n-seo/releases/tag/v"

SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)")


def parts(v: str):
    """(1, 2, 3) from '1.2.3', or None if it is not a plain release version."""
    m = SEMVER.match(v or "")
    return tuple(int(g) for g in m.groups()) if m else None


def npm_bin() -> str:
    return "npm.cmd" if sys.platform == "win32" else "npm"


def published_version() -> str | None:
    """What the registry serves.

    `npm view` rather than a direct fetch, so a private registry, a proxy or
    an .npmrc setting is honoured — someone running an internal mirror should
    be told about *their* latest, not npmjs.com's.
    """
    npm = shutil.which(npm_bin())
    if not npm:
        return None
    try:
        out = subprocess.run(
            [npm, "view", f"{PACKAGE}@latest", "version"],
            capture_output=True, text=True, timeout=45, encoding="utf-8",
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    if out.returncode != 0:
        return None
    v = (out.stdout or "").strip()
    return v if parts(v) else None


def main() -> int:
    m = seo_config.module("updateCheck")
    if not m.get("enabled"):
        print("updateCheck module is off — skipping (no registry request made)")
        return 0

    engine = seo_config.engine_info()
    current = engine.get("version", "0.0.0")
    latest = published_version()

    if latest is None:
        # Never a failure: an offline morning must not fail the daily run over
        # a version check, and a stale file is better than no file.
        print("could not reach the registry — leaving the last result in place")
        return 0

    cur_p, new_p = parts(current), parts(latest)
    newer = bool(cur_p and new_p and new_p > cur_p)
    ahead = bool(cur_p and new_p and cur_p > new_p)

    DATA.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "checked": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "current": current,
        "latest": latest,
        "newer": newer,
        "notes": f"{RELEASES}{latest}" if newer else "",
    }, indent=1) + "\n", encoding="utf-8")

    if newer:
        print(f"n-seo {latest} is available (running {current}) — upgrade with: n-seo upgrade")
        print(f"  release notes: {RELEASES}{latest}")
    elif ahead:
        print(f"running {current}, ahead of the published {latest} — a development build")
    else:
        print(f"n-seo {current} is the latest")
    return 0


if __name__ == "__main__":
    sys.exit(main())
