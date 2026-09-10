#!/usr/bin/env python3
"""Analyze pulled Search Console data into a markdown report: totals, 28-day
trend, striking-distance queries, CTR gaps, top pages, dead pages.

Reads data/gsc/<slug>/*.json (from pull_gsc.py), writes
docs/reports/gsc-findings-<YYYY-MM>.md and prints it. Run it whenever you
want a shareable snapshot; the dashboard shows the same data live.
"""

import json
import sys
from datetime import date, timedelta

import seo_config

# Rough expected CTR by average position (industry midpoints).
EXPECTED_CTR = {1: 0.28, 2: 0.15, 3: 0.10, 4: 0.07, 5: 0.05, 6: 0.04}


def load(slug, dataset):
    p = seo_config.DATA / "gsc" / slug / f"{dataset}.json"
    return json.loads(p.read_text(encoding="utf-8"))["rows"] if p.exists() else []


def fmt_pct(x):
    return f"{100 * x:.1f}%"


def section(prop, slug, out):
    queries = load(slug, "queries")
    pages = load(slug, "pages")
    dates = load(slug, "dates")

    clicks = sum(r["clicks"] for r in dates)
    imps = sum(r["impressions"] for r in dates)
    out.append(f"\n## {prop}\n")
    out.append(f"**16-month totals:** {clicks:,.0f} clicks · {imps:,.0f} impressions"
               f" · overall CTR {fmt_pct(clicks / imps) if imps else 'n/a'}\n")

    if dates:
        by_day = {r["keys"][0]: r for r in dates}
        today = date.today()

        def window(offset_start, offset_end):
            c = i = 0
            for d in range(offset_start, offset_end):
                r = by_day.get((today - timedelta(days=d)).isoformat())
                if r:
                    c += r["clicks"]
                    i += r["impressions"]
            return c, i
        c1, i1 = window(3, 31)
        c2, i2 = window(31, 59)
        out.append(f"**Last 28d vs prior 28d:** {c1:,.0f} vs {c2:,.0f} clicks · "
                   f"{i1:,.0f} vs {i2:,.0f} impressions\n")

    hosts = {}
    for r in pages:
        host = r["keys"][0].split("/")[2]
        h = hosts.setdefault(host, {"clicks": 0, "impressions": 0})
        h["clicks"] += r["clicks"]
        h["impressions"] += r["impressions"]
    if len(hosts) > 1:
        out.append("**By host:**\n")
        for host, v in sorted(hosts.items(), key=lambda kv: -kv[1]["clicks"]):
            out.append(f"- {host}: {v['clicks']:,.0f} clicks / {v['impressions']:,.0f} impressions")
        out.append("")

    top = sorted(queries, key=lambda r: -r["clicks"])[:15]
    out.append("**Top queries by clicks:**\n")
    out.append("| Query | Clicks | Impressions | CTR | Pos |")
    out.append("|---|---|---|---|---|")
    for r in top:
        out.append(f"| {r['keys'][0]} | {r['clicks']:.0f} | {r['impressions']:.0f}"
                   f" | {fmt_pct(r['ctr'])} | {r['position']:.1f} |")

    striking = [r for r in queries if 5 <= r["position"] <= 15 and r["impressions"] >= 50]
    striking.sort(key=lambda r: -r["impressions"])
    out.append("\n**Striking distance (pos 5-15, >=50 impressions) — biggest prizes:**\n")
    if striking:
        out.append("| Query | Impressions | Clicks | Pos |")
        out.append("|---|---|---|---|")
        for r in striking[:15]:
            out.append(f"| {r['keys'][0]} | {r['impressions']:.0f} | {r['clicks']:.0f} | {r['position']:.1f} |")
    else:
        out.append("_none at threshold_")

    ctr_gap = []
    for r in queries:
        pos = round(r["position"])
        if pos in EXPECTED_CTR and r["impressions"] >= 100:
            expected = EXPECTED_CTR[pos]
            if r["ctr"] < expected * 0.5:
                ctr_gap.append((r, expected))
    ctr_gap.sort(key=lambda t: -(t[0]["impressions"] * (t[1] - t[0]["ctr"])))
    out.append("\n**CTR gaps (ranking well, clicked rarely — title/snippet problems):**\n")
    if ctr_gap:
        out.append("| Query | Impressions | CTR | Expected | Pos |")
        out.append("|---|---|---|---|---|")
        for r, exp in ctr_gap[:12]:
            out.append(f"| {r['keys'][0]} | {r['impressions']:.0f} | {fmt_pct(r['ctr'])}"
                       f" | ~{fmt_pct(exp)} | {r['position']:.1f} |")
    else:
        out.append("_none at threshold_")

    top_pages = sorted(pages, key=lambda r: -r["clicks"])[:10]
    out.append("\n**Top pages by clicks:**\n")
    for r in top_pages:
        out.append(f"- {r['keys'][0]} — {r['clicks']:.0f} clicks, {r['impressions']:.0f} imps, pos {r['position']:.1f}")

    dead = [r for r in pages if r["impressions"] >= 200 and r["clicks"] <= 2]
    dead.sort(key=lambda r: -r["impressions"])
    if dead:
        out.append("\n**High-impression, near-zero-click pages:**\n")
        for r in dead[:10]:
            out.append(f"- {r['keys'][0]} — {r['impressions']:.0f} imps, {r['clicks']:.0f} clicks, pos {r['position']:.1f}")
    return out


def main():
    out = [f"# Search Console Findings — {date.today().isoformat()}",
           "\nWindow: trailing 16 months (final data through ~3 days ago)."]
    for prop, slug in seo_config.gsc_properties(include_extra=False).items():
        section(prop, slug, out)
    text = "\n".join(out) + "\n"
    dest_dir = seo_config.INSTANCE / "docs" / "reports"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"gsc-findings-{date.today():%Y-%m}.md"
    dest.write_text(text, encoding="utf-8")
    print(text)
    print(f"\n[saved to {dest}]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
