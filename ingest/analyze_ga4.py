#!/usr/bin/env python3
"""GA4 analysis: 90-day traffic mix and the AI-referral (GEO) scoreboard.

Reads data/ga4/<host>/*.json, writes docs/reports/ga4-findings-<YYYY-MM>.md
and prints it.
"""

import json
import re
import sys
from datetime import date

import seo_config

GA_DIR = seo_config.DATA / "ga4"

AI_SOURCES = re.compile(
    r"chatgpt|chat\.openai|openai\.com|perplexity|claude\.ai|copilot|gemini\.google"
    r"|edgeservices|you\.com|poe\.com|phind|kagi|mistral|deepseek", re.I)
SEARCH_SOURCES = re.compile(r"google|bing|duckduckgo|yahoo|ecosia|brave|yandex|baidu", re.I)


def rows(site, name):
    p = GA_DIR / site / f"{name}.json"
    if not p.exists():
        return []
    d = json.loads(p.read_text())
    out = []
    for r in d.get("rows", []):
        dims = [v["value"] for v in r.get("dimensionValues", [])]
        mets = [float(v["value"]) for v in r.get("metricValues", [])]
        out.append((dims, mets))
    return out


def main():
    if not GA_DIR.exists():
        print("no GA4 data yet — run ingest/pull_ga4.py")
        return 0
    out = [f"# GA4 Findings — {date.today().isoformat()}",
           "\nWindow: last 90 days.\n",
           "| Site | Sessions | AI-referral | Search | Direct/other | Top AI sources |",
           "|---|---|---|---|---|---|"]
    detail = []
    for site_dir in sorted(p for p in GA_DIR.iterdir() if p.is_dir()):
        site = site_dir.name
        src = rows(site, "sources")
        total = sum(m[0] for _, m in src)
        ai = [("/".join(d), m[0]) for d, m in src if AI_SOURCES.search(d[0])]
        search = sum(m[0] for d, m in src if SEARCH_SOURCES.search(d[0]) and not AI_SOURCES.search(d[0]))
        ai_total = sum(v for _, v in ai)
        ai.sort(key=lambda t: -t[1])
        top_ai = ", ".join(f"{s} ({v:.0f})" for s, v in ai[:3]) or "—"
        out.append(f"| {site} | {total:,.0f} | {ai_total:,.0f}"
                   f" ({100*ai_total/total:.1f}%) | {search:,.0f} ({100*search/total:.1f}%)"
                   f" | {total-ai_total-search:,.0f} | {top_ai} |" if total else
                   f"| {site} | 0 | — | — | — | — |")

        landing = rows(site, "landing")[:8]
        detail.append(f"\n## {site}\n\n**Top landing pages (sessions / engagement):**\n")
        for d, m in landing:
            detail.append(f"- {d[0]} — {m[0]:.0f} sessions, {100*m[1]:.0f}% engaged")
        if ai:
            detail.append("\n**All AI sources:**\n")
            for s, v in ai:
                detail.append(f"- {s}: {v:.0f} sessions")

    text = "\n".join(out) + "\n" + "\n".join(detail) + "\n"
    dest_dir = seo_config.ROOT / "docs" / "reports"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"ga4-findings-{date.today():%Y-%m}.md"
    dest.write_text(text)
    print(text)
    print(f"[saved to {dest}]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
