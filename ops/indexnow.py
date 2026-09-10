#!/usr/bin/env python3
"""IndexNow: tell Bing, Copilot, Yandex and friends about changed URLs (modules.indexNow).

  python3 ops/indexnow.py init                 # create the key file, print where each site must serve it
  python3 ops/indexnow.py ping URL [URL ...]   # submit changed URLs (grouped by host)

The key is public by design: every site serves it at https://<host>/<key>.txt
and that is how IndexNow verifies you own the host. Free, instant, and it
does nothing for Google (Google's fast lane is Request Indexing in the
Search Console UI).
"""

import json
import secrets
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ingest"))
import seo_config  # noqa: E402

ENDPOINT = "https://api.indexnow.org/indexnow"


def key_file() -> Path:
    m = seo_config.module("indexNow")
    p = m.get("keyFile") or "indexnow.key"
    path = Path(p)
    return path if path.is_absolute() else seo_config.INSTANCE / path


def cmd_init() -> int:
    kf = key_file()
    if kf.exists():
        key = kf.read_text(encoding="utf-8").strip()
        print(f"key file already exists: {kf}")
    else:
        key = secrets.token_hex(16)
        kf.parent.mkdir(parents=True, exist_ok=True)
        kf.write_text(key + "\n", encoding="utf-8")
        print(f"wrote {kf}")
    print(f"\nkey: {key}\n\nServe this key as plain text at, for every site:")
    for s in seo_config.sites():
        print(f"  https://{s['gscHost']}/{key}.txt   (content: {key})")
    print("\nThen: python3 ops/indexnow.py ping https://example.com/changed-page")
    return 0


def cmd_ping(urls: list[str]) -> int:
    kf = key_file()
    if not kf.exists():
        print(f"no key file at {kf} — run: python3 ops/indexnow.py init")
        return 1
    key = kf.read_text(encoding="utf-8").strip()
    by_host: dict[str, list[str]] = {}
    for u in urls:
        host = urlsplit(u).netloc
        if not host:
            print(f"skipping non-URL argument: {u}")
            continue
        by_host.setdefault(host, []).append(u)
    if not by_host:
        print("nothing to ping")
        return 1
    rc = 0
    for host, group in by_host.items():
        body = json.dumps({
            "host": host, "key": key,
            "keyLocation": f"https://{host}/{key}.txt",
            "urlList": group,
        })
        # IndexNow answers 200/202 with an EMPTY body, so the status code is
        # the whole answer — plain curl rather than the JSON helper.
        p = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
                            "--max-time", "30", "-X", "POST",
                            "-H", "Content-Type: application/json; charset=utf-8",
                            "-d", body, ENDPOINT], capture_output=True, text=True)
        code = p.stdout.strip()
        if code in ("200", "202"):
            print(f"{host}: {code} — submitted {len(group)} URL(s)")
        else:
            rc = 1
            hint = {"400": "bad request", "403": "key not found at keyLocation — is it served?",
                    "422": "URLs don't belong to this host", "429": "too many requests"}.get(code, "")
            print(f"{host}: HTTP {code or 'no response'} {hint}")
    return rc


def main() -> int:
    if not seo_config.enabled("indexNow"):
        print("indexNow module disabled — enable modules.indexNow in Settings or the config file")
        return 1
    args = sys.argv[1:]
    if not args or args[0] not in ("init", "ping"):
        print(__doc__)
        return 2
    if args[0] == "init":
        return cmd_init()
    if len(args) < 2:
        print("ping needs at least one URL")
        return 2
    return cmd_ping(args[1:])


if __name__ == "__main__":
    sys.exit(main())
