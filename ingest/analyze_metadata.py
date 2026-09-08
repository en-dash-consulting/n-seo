#!/usr/bin/env python3
"""Page-level metadata audit: does each ranking page's title/description earn
its clicks?

For every significant page (by impressions, host-filtered), fetches the LIVE
title + meta description and joins them with the page's top queries from the
90-day Search Console pull. Flags: query language missing from the title,
missing/short/title-duplicating descriptions, bad title lengths, and CTR
below position expectations (positions 1-15).

Writes data/metadata-audit.json — consumed by the dashboard's action queue.
Stdlib + curl. Runs in the daily batch when modules.metadataAudit is on.
"""

import html
import json
import re
import sys
from datetime import date

import seo_config
from http_util import fetch_text

EXPECTED_CTR = {1: .28, 2: .15, 3: .10, 4: .07, 5: .05, 6: .04,
                7: .035, 8: .03, 9: .026, 10: .022,
                11: .018, 12: .016, 13: .014, 14: .012, 15: .011}

MIN_PAGE_IMPS = 15  # 90d window
TOP_PAGES_PER_SITE = 15
STOP = set("a an the and or of to in on for with vs what is how why your our "
           "you we i it its this that de la".split())


def fetch_head(url):
    """(status, title, description) for a live page.

    The status matters: a page that still ranks but no longer serves must not
    be audited against whatever its 404 page happens to contain. The quote in
    the description pattern is back-referenced so an apostrophe inside the
    text cannot end the match early, and entities are decoded rather than
    blanked, because both mistakes invent findings that are not there.
    """
    status, h = fetch_text(url, byte_range="0-40000")
    title = re.search(r"<title[^>]*>(.*?)</title>", h, re.S | re.I)
    desc = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=(["\'])(.*?)\1', h, re.S | re.I) \
        or re.search(r'<meta[^>]+content=(["\'])(.*?)\1[^>]+name=["\']description["\']', h, re.S | re.I)
    return (status,
            html.unescape(title.group(1)).strip() if title else "",
            html.unescape(desc.group(2)).strip() if desc else "")


def tokens(text):
    return {w for w in re.findall(r"[a-z0-9']+", text.lower()) if w not in STOP and len(w) > 1}


def main():
    qp_cache = {}
    audit = {"generated": date.today().isoformat(), "window": "90d", "sites": {}}

    for site in seo_config.sites():
        gsc_dir = seo_config.gsc_dir_for(site)
        if not gsc_dir:
            continue
        recent = gsc_dir / "query_page_90d.json"
        gsc_file = recent if recent.exists() else gsc_dir / "query_page.json"
        if not gsc_file.exists():
            continue
        host = site["gscHost"]
        cache_key = str(gsc_file)
        if cache_key not in qp_cache:
            qp_cache[cache_key] = json.loads(gsc_file.read_text())["rows"]
        rows = [r for r in qp_cache[cache_key]
                if r["keys"][1].split("/")[2] == host]

        by_page = {}
        for r in rows:
            p = by_page.setdefault(r["keys"][1], {"imps": 0, "clicks": 0, "queries": []})
            p["imps"] += r["impressions"]
            p["clicks"] += r["clicks"]
            p["queries"].append({"q": r["keys"][0], "imps": r["impressions"],
                                 "clicks": r["clicks"], "pos": round(r["position"], 1),
                                 "ctr": r["ctr"]})
        pages = sorted(((u, d) for u, d in by_page.items() if d["imps"] >= MIN_PAGE_IMPS),
                       key=lambda t: -t[1]["imps"])[:TOP_PAGES_PER_SITE]

        findings = []
        for url, d in pages:
            status, title, desc = fetch_head(url)
            d["queries"].sort(key=lambda q: -q["imps"])
            top_q = d["queries"][:5]

            if status != 200:
                # It still earns impressions, so it is worth reporting — but a
                # title rewrite is the wrong move and would burn one of the
                # ~8 metadata changes a week on a page that does not serve.
                findings.append({
                    "page": url, "title": "", "description": "",
                    "imps": round(d["imps"]), "clicks": round(d["clicks"]),
                    "issues": [f"page does not serve (HTTP {status or 'no response'}) "
                               f"but still ranks — fix, redirect or retire it"],
                    "top_queries": top_q, "missed_clicks_window": 0,
                })
                continue

            t_tokens = tokens(title)
            issues, missed = [], 0.0

            uncovered = []
            for q in top_q:
                q_tokens = tokens(q["q"])
                if q_tokens and len(q_tokens & t_tokens) / len(q_tokens) < 0.5:
                    uncovered.append(q["q"])
            if uncovered and sum(q["imps"] for q in top_q) >= MIN_PAGE_IMPS:
                issues.append(f"title misses ranking-query language: {', '.join(uncovered[:3])}")

            for q in d["queries"]:
                exp = EXPECTED_CTR.get(round(q["pos"]))
                if exp and q["imps"] >= 20 and q["ctr"] < exp * 0.5:
                    missed += q["imps"] * (exp - q["ctr"])
            if missed >= 5:
                issues.append(f"CTR below position expectation (~{missed:.0f} clicks missed in 90d)")

            if not desc:
                issues.append("meta description missing")
            elif len(desc) < 60:
                issues.append(f"meta description too short ({len(desc)} chars)")
            elif title and desc.lower().startswith(title.lower()[:40]):
                issues.append("meta description duplicates the title")
            if title and len(title) > 65:
                issues.append(f"title long ({len(title)} chars — SERP truncates ~60)")
            if not title:
                issues.append("no <title> found")

            if issues:
                findings.append({
                    "page": url, "title": title[:120], "description": desc[:180],
                    "imps": round(d["imps"]), "clicks": round(d["clicks"]),
                    "issues": issues, "top_queries": top_q,
                    "missed_clicks_window": round(missed),
                })
        findings.sort(key=lambda f: -(f["missed_clicks_window"] + f["imps"] / 50))
        # keyed by the site's canonical host, which is how the dashboard looks it up
        audit["sites"][site["host"]] = findings
        print(f"{site['host']:28s} {len(pages)} pages audited, {len(findings)} with findings")

    seo_config.DATA.mkdir(parents=True, exist_ok=True)
    (seo_config.DATA / "metadata-audit.json").write_text(json.dumps(audit, indent=1))
    print("saved data/metadata-audit.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
