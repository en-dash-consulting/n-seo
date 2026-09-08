#!/usr/bin/env python3
"""Trend analysis for marketer-grade recommendations.

Pulls supplemental windowed data (GSC recent-vs-prior query windows, GA4
monthly AI-referral series) and computes:
  - branded vs non-branded share (clicks + impressions), using each site's
    `brand` regex from the config (no regex -> everything counts as generic)
  - rising / falling queries (trailing 84d vs prior 84d)
  - monthly clicks/impressions trajectory (from the existing dates.json)
  - AI-referral sessions by month
Writes data/trends-<date>.json and prints a summary.
"""

import json
import re
import sys
from datetime import date, timedelta
from urllib.parse import quote

import google_auth
import seo_config
from http_util import post_json

AI_RE = re.compile(r"chatgpt|chat\.openai|openai\.com|perplexity|claude\.ai|copilot|gemini\.google"
                   r"|edgeservices|you\.com|poe\.com|phind|kagi|mistral|deepseek", re.I)


PAGE = 25000


def gsc_queries(tok, site, start, end):
    """Every query in the window, paged — a single request caps out and the
    truncation would quietly skew the branded/generic split."""
    url = f"https://searchconsole.googleapis.com/webmasters/v3/sites/{quote(site, safe='')}/searchAnalytics/query"
    rows, start_row = {}, 0
    while True:
        r = post_json(url, {"startDate": start, "endDate": end, "dimensions": ["query"],
                            "rowLimit": PAGE, "startRow": start_row, "dataState": "final"},
                      tok, label=f"trends {site}")
        batch = r.get("rows", [])
        rows.update({row["keys"][0]: row for row in batch})
        if len(batch) < PAGE:
            return rows
        start_row += PAGE


def main():
    out = {"generated": date.today().isoformat(), "sites": {}}
    gsc_props = seo_config.gsc_properties(include_extra=False)
    brands = {p: re.compile(rx, re.I) for p, rx in seo_config.brand_patterns().items()}
    ga4_props = seo_config.ga4_properties()

    end = date.today() - timedelta(days=3)
    mid = end - timedelta(days=84)
    start = mid - timedelta(days=84)
    # The windows must not share their boundary day, or it is counted on both
    # sides of every rising/falling comparison.
    prior_end = mid - timedelta(days=1)

    if gsc_props:
        gsc_tok = google_auth.access_token(google_auth.WEBMASTERS_RO)
    for site, slug in gsc_props.items():
        recent = gsc_queries(gsc_tok, site, mid.isoformat(), end.isoformat())
        prior = gsc_queries(gsc_tok, site, start.isoformat(), prior_end.isoformat())
        brand = brands.get(site)
        is_brand = (lambda q: bool(brand.search(q))) if brand else (lambda q: False)

        def split(rows):
            return {
                "branded_clicks": sum(r["clicks"] for q, r in rows.items() if is_brand(q)),
                "generic_clicks": sum(r["clicks"] for q, r in rows.items() if not is_brand(q)),
                "branded_imps": sum(r["impressions"] for q, r in rows.items() if is_brand(q)),
                "generic_imps": sum(r["impressions"] for q, r in rows.items() if not is_brand(q)),
            }

        movers = []
        for q in set(recent) | set(prior):
            ri = recent.get(q, {}).get("impressions", 0)
            pi = prior.get(q, {}).get("impressions", 0)
            if max(ri, pi) >= 30:
                movers.append({"query": q, "recent_imps": ri, "prior_imps": pi,
                               "delta": ri - pi,
                               "recent_pos": round(recent.get(q, {}).get("position", 0), 1),
                               "recent_clicks": recent.get(q, {}).get("clicks", 0)})
        movers.sort(key=lambda m: -abs(m["delta"]))

        entry = {
            "recent_split": split(recent), "prior_split": split(prior),
            "rising": [m for m in movers if m["delta"] > 0][:20],
            "falling": [m for m in movers if m["delta"] < 0][:15],
        }
        # monthly trajectory from the existing 16-month dates.json
        p = seo_config.DATA / "gsc" / slug / "dates.json"
        if p.exists():
            monthly = {}
            for r in json.loads(p.read_text())["rows"]:
                m = r["keys"][0][:7]
                cur = monthly.setdefault(m, {"clicks": 0, "imps": 0})
                cur["clicks"] += r["clicks"]
                cur["imps"] += r["impressions"]
            entry["monthly"] = monthly
        out["sites"][site] = entry

    # GA4 AI referrals by month
    if ga4_props:
        ga_tok = google_auth.access_token(google_auth.ANALYTICS_RO)
    for host, prop in ga4_props.items():
        r = post_json(f"https://analyticsdata.googleapis.com/v1beta/properties/{prop}:runReport", {
            "dateRanges": [{"startDate": "365daysAgo", "endDate": "yesterday"}],
            "dimensions": [{"name": "yearMonth"}, {"name": "sessionSource"}],
            "metrics": [{"name": "sessions"}], "limit": PAGE}, ga_tok, label=f"ga4 monthly {host}")
        ai_by_month, total_by_month = {}, {}
        for row in r.get("rows", []):
            ym, src = row["dimensionValues"][0]["value"], row["dimensionValues"][1]["value"]
            n = float(row["metricValues"][0]["value"])
            total_by_month[ym] = total_by_month.get(ym, 0) + n
            if AI_RE.search(src):
                ai_by_month[ym] = ai_by_month.get(ym, 0) + n
        out.setdefault("ai_referrals", {})[host] = {
            "ai": dict(sorted(ai_by_month.items())),
            "total": dict(sorted(total_by_month.items()))}

    seo_config.DATA.mkdir(parents=True, exist_ok=True)
    dest = seo_config.DATA / f"trends-{date.today().isoformat()}.json"
    dest.write_text(json.dumps(out, indent=1))
    print(f"saved {dest}\n")

    for site, d in out["sites"].items():
        rs, ps = d["recent_split"], d["prior_split"]
        print(f"== {site}")
        print(f"  clicks 84d: branded {rs['branded_clicks']:.0f} vs generic {rs['generic_clicks']:.0f}"
              f" (prior: {ps['branded_clicks']:.0f}/{ps['generic_clicks']:.0f})")
        print(f"  imps 84d: branded {rs['branded_imps']:.0f} vs generic {rs['generic_imps']:.0f}")
        print("  RISING:", "; ".join(f"{m['query']} ({m['prior_imps']}->{m['recent_imps']}, pos {m['recent_pos']})" for m in d["rising"][:8]))
        print("  FALLING:", "; ".join(f"{m['query']} ({m['prior_imps']}->{m['recent_imps']})" for m in d["falling"][:5]))
    if out.get("ai_referrals"):
        print("\n== AI referrals by month (sessions)")
        for site, d in out["ai_referrals"].items():
            series = ", ".join(f"{k[-2:]}:{v:.0f}" for k, v in list(d["ai"].items())[-6:])
            print(f"  {site:28s} {series}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
