#!/usr/bin/env python3
"""Ask Search Console whether each sitemap URL is actually in Google's index.

The rest of the pipeline measures pages that already rank. Nothing measures
the step before that: a page can sit in the sitemap for months in
"Discovered - currently not indexed" — known to Google, never fetched — and
look identical to a page nobody searches for, because both show zero
impressions. The URL Inspection API is the only place that distinction is
visible, and it decides where the manual "Request Indexing" quota (the
Search Console UI, roughly 10/day) is worth spending.

Quota: 2,000 inspections/day and 600/minute per property, so a full sweep of
a modest sitemap is affordable daily. Read-only scope. Stdlib + curl.
"""

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import quote

import google_auth
import seo_config
from http_util import fetch_text, get_json, post_json

OUT = seo_config.DATA / "index-status.json"
INSPECT = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect"
SITES_API = "https://searchconsole.googleapis.com/webmasters/v3/sites"

# The URL Inspection quota is per property (2,000/day), and several hosts can
# share one domain property, so the budget has to be per property too.
MAX_PER_PROPERTY = 1500
WORKERS = 4

# Anything other than this needs a human to look at it.
INDEXED = "Submitted and indexed"


def sitemap_urls(host: str) -> list[str]:
    """The site's own sitemap is the list of pages it claims should rank.
    Sitemap indexes are followed one level."""
    status, raw = fetch_text(f"https://{host}/sitemap.xml", timeout=60)
    if status != 200:
        return []

    def locs(xml):
        out, rest = [], xml
        while "<loc>" in rest:
            _, _, rest = rest.partition("<loc>")
            loc, _, rest = rest.partition("</loc>")
            loc = loc.strip()
            if loc.startswith("http"):
                out.append(loc)
        return out

    urls = locs(raw)
    if "<sitemapindex" in raw:
        pages = []
        for child in urls[:20]:
            st, body = fetch_text(child, timeout=60)
            if st == 200:
                pages.extend(locs(body))
        urls = pages
    return urls


def inspect(token: str, site_url: str, page_url: str) -> dict:
    resp = post_json(INSPECT, {"inspectionUrl": page_url, "siteUrl": site_url},
                     token, label=page_url[-60:])
    if "error" in resp:
        return {"url": page_url, "coverage": "API error",
                "detail": str(resp["error"].get("message", ""))[:120]}
    r = resp.get("inspectionResult", {}).get("indexStatusResult", {})
    canonical = r.get("googleCanonical")
    return {
        "url": page_url,
        "coverage": r.get("coverageState", "unknown"),
        "lastCrawl": r.get("lastCrawlTime"),
        "verdict": r.get("verdict"),
        "robots": r.get("robotsTxtState"),
        # A Google canonical pointing elsewhere is why a page can be crawled
        # and still never appear — worth surfacing, not just the coverage line.
        "canonicalMismatch": bool(canonical and canonical != page_url),
        "googleCanonical": canonical,
    }


def accessible_properties(token: str) -> set[str]:
    """Properties this account can actually inspect. An unverified or
    unshared property answers every inspection with a 403, which would fill
    the report with identical error rows and bury the real findings."""
    resp = get_json(SITES_API, token, label="sites list")
    return {e["siteUrl"] for e in resp.get("siteEntry", []) if "siteUrl" in e}


def sitemap_state(token: str, site_url: str) -> dict:
    """What Search Console has done with the submitted sitemap.

    The UI shows a bare "Couldn't fetch" for a sitemap Google has simply not
    read yet, which reads as a failure and is not one — the API distinguishes
    them: isPending with errors 0 means queued, a real problem shows up as a
    non-zero error count. Recording both keeps the difference visible."""
    resp = get_json(f"{SITES_API}/{quote(site_url, safe='')}/sitemaps", token,
                    label=f"sitemaps {site_url}")
    maps = resp.get("sitemap", []) if isinstance(resp, dict) else []
    return {
        "submitted": len(maps),
        "entries": [
            {
                "path": m.get("path"),
                "lastSubmitted": m.get("lastSubmitted"),
                "lastDownloaded": m.get("lastDownloaded"),
                "pending": bool(m.get("isPending")),
                "errors": int(m.get("errors", 0) or 0),
                "warnings": int(m.get("warnings", 0) or 0),
            }
            for m in maps
        ],
    }


def main() -> int:
    hosts = seo_config.index_hosts()
    if not hosts:
        print("no site has a gscProperty configured — nothing to inspect")
        return 0
    token = google_auth.access_token(google_auth.WEBMASTERS_RO)
    available = accessible_properties(token)
    who = google_auth.service_account_email() or "your Google account"
    out = {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "sites": {}}
    total_problems = 0
    budget: dict[str, int] = {}

    for host, site_url in hosts.items():
        if site_url not in available:
            print(f"{host}: {site_url} not accessible — verify it in Search Console "
                  f"and add {who}; skipping")
            continue
        left = budget.get(site_url, MAX_PER_PROPERTY)
        if left <= 0:
            print(f"{host}: today's inspection budget for {site_url} is spent; skipping")
            continue
        urls = sitemap_urls(host)
        if not urls:
            print(f"{host}: no sitemap URLs, skipping")
            continue
        if len(urls) > left:
            print(f"{host}: {len(urls)} sitemap URLs, inspecting {left} "
                  f"(shared quota for {site_url})")
            urls = urls[:left]
        budget[site_url] = left - len(urls)
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            rows = list(pool.map(lambda u: inspect(token, site_url, u), urls))

        problems = [r for r in rows if r["coverage"] != INDEXED]
        never_crawled = [r for r in problems if not r.get("lastCrawl")]
        out["sites"][host] = {
            "property": site_url,
            "sitemap": sitemap_state(token, site_url),
            "checked": len(rows),
            "indexed": len(rows) - len(problems),
            "neverCrawled": len(never_crawled),
            # Only the problems are stored: the point is the short list a
            # human acts on; hundreds of healthy rows would bury it.
            "problems": sorted(problems, key=lambda r: (bool(r.get("lastCrawl")), r["url"])),
        }
        total_problems += len(problems)
        print(f"{host}: {len(rows)} checked, {len(problems)} not indexed "
              f"({len(never_crawled)} never crawled)")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2))
    print(f"saved {OUT} — {total_problems} URLs needing attention")
    return 0


if __name__ == "__main__":
    sys.exit(main())
