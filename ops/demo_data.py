#!/usr/bin/env python3
"""Synthetic dataset so you can see the dashboard before wiring up Google.

  python3 ops/demo_data.py          # write demo data for the configured sites
  python3 ops/demo_data.py --clean  # delete data/ and exit

Writes every file the pipeline produces (see docs/ARCHITECTURE.md) for the
sites in the current config — with no config of your own that is the
example's example.com + docs.example.com. Deterministic (seeded), and shaped
so every dashboard feature has something to show: striking-distance queries,
CTR gaps, a low-engagement landing page, a probe finding, indexing problems,
rising/falling queries, AI referrals, proposals. It is fake; the "why" on
every proposal says so.
"""

import json
import math
import random
import shutil
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ingest"))
import seo_config  # noqa: E402

DATA = seo_config.DATA
rng = random.Random(20260907)

TODAY = date.today()
END = TODAY - timedelta(days=3)        # GSC finalizes ~3 days behind
FULL_DAYS = 488
RECENT_DAYS = 93

# Query templates per site "role"; {t} is the site's topic word.
TOPICS = ["widgets", "dashboards", "canvas rendering", "supply chain games", "static sites",
          "webhooks", "api design", "markdown", "rate limiting", "feature flags"]
QUERY_SHAPES = [
    ("{t}", 1.0), ("what is {t}", 0.6), ("{t} tutorial", 0.7), ("{t} examples", 0.5),
    ("best {t} tools", 0.4), ("{t} vs {u}", 0.3), ("how to use {t}", 0.5),
    ("{t} explained", 0.35), ("free {t}", 0.3), ("{t} guide", 0.45), ("{t} for beginners", 0.4),
    ("open source {t}", 0.3), ("{t} cheat sheet", 0.25), ("{t} pricing", 0.2),
]
PAGE_SHAPES = ["/", "/docs/", "/docs/getting-started/", "/blog/{s}/", "/guides/{s}/", "/pricing/",
               "/examples/", "/about/", "/blog/{s}-explained/", "/compare/{s}-vs-alternatives/"]

# (source, medium, share of sessions, is an AI assistant). Shared by the 90-day
# sources aggregate and the daily source series so the two agree. The AI rows
# are the ones that grow across the window in the series.
SOURCE_MIX = [
    ("google", "organic", 0.58, False),
    ("(direct)", "(none)", 0.20, False),
    ("bing", "organic", 0.05, False),
    ("chatgpt.com", "referral", 0.045, True),
    ("perplexity.ai", "referral", 0.015, True),
    ("github.com", "referral", 0.03, False),
    ("duckduckgo", "organic", 0.02, False),
    ("t.co", "referral", 0.015, False),
    ("news.ycombinator.com", "referral", 0.02, False),
    ("claude.ai", "referral", 0.01, True),
]


def slugify(s):
    return s.lower().replace(" ", "-")


def weekly(d, base, growth=0.0, day0=None):
    """Weekday-shaped daily value with mild noise and optional linear growth."""
    dow = d.weekday()
    shape = [1.0, 1.05, 1.05, 1.0, 0.9, 0.55, 0.5][dow]
    g = 1.0 + growth * ((d - day0).days / 365) if day0 else 1.0
    return max(0, base * shape * g * rng.uniform(0.8, 1.2))


def expected_ctr(pos):
    table = {1: .28, 2: .15, 3: .10, 4: .07, 5: .05, 6: .04, 7: .035, 8: .03, 9: .026, 10: .022}
    if pos <= 10:
        return table[max(1, round(pos))]
    return max(0.004, 0.02 * math.exp(-(pos - 10) / 8))


def site_queries(site, idx):
    """A few dozen queries for one host, with some deliberately in striking
    distance (pos 5-15) and some with CTR gaps (pos 1-6, half the expected CTR)."""
    host = site["gscHost"]
    brand = site.get("brand") or host.split(".")[0]
    topics = TOPICS[idx * 3: idx * 3 + 3] or TOPICS[:3]
    pages = [f"https://{host}" + p.format(s=slugify(topics[i % len(topics)])) for i, p in enumerate(PAGE_SHAPES)]
    rows = []
    n = 0
    for t in topics:
        for shape, weight in QUERY_SHAPES:
            q = shape.format(t=t, u=topics[(topics.index(t) + 1) % len(topics)])
            n += 1
            role = n % 5
            if role == 0:          # striking distance
                pos = rng.uniform(5.5, 14)
                imps = int(rng.uniform(40, 400) * weight * 3)
                ctr = expected_ctr(pos) * rng.uniform(0.8, 1.2)
            elif role == 1:        # CTR gap: ranks well, rarely clicked
                pos = rng.uniform(1.2, 5.8)
                imps = int(rng.uniform(80, 600) * weight * 3)
                ctr = expected_ctr(pos) * rng.uniform(0.2, 0.45)
            else:
                pos = rng.uniform(1.5, 40)
                imps = int(rng.uniform(10, 900) * weight * 3)
                ctr = expected_ctr(pos) * rng.uniform(0.7, 1.4)
            page = pages[n % len(pages)]
            rows.append((q, page, imps, ctr, pos))
    # branded head term
    rows.append((brand, f"https://{host}/", int(rng.uniform(1500, 4000)), 0.42, 1.1))
    rows.append((f"{brand} docs", f"https://{host}/docs/", int(rng.uniform(200, 600)), 0.31, 1.4))
    return rows


def gsc_row(keys, imps, ctr, pos):
    clicks = round(imps * ctr)
    return {"keys": keys, "clicks": clicks, "impressions": imps,
            "ctr": (clicks / imps) if imps else 0, "position": round(pos, 2)}


def write_gsc(prop, slug, sites_in_prop, index_of):
    d = DATA / "gsc" / slug
    d.mkdir(parents=True, exist_ok=True)
    full_rows = []
    for s in sites_in_prop:
        full_rows += site_queries(s, index_of[s["host"]])

    def dataset(rows, scale, suffix, start):
        qp = [gsc_row([q, p], max(1, int(imps * scale)), ctr, pos * rng.uniform(0.95, 1.05))
              for q, p, imps, ctr, pos in rows]
        by_q, by_p = {}, {}
        for r in qp:
            for key, bucket in ((r["keys"][0], by_q), (r["keys"][1], by_p)):
                cur = bucket.setdefault(key, {"clicks": 0, "impressions": 0, "posw": 0})
                cur["clicks"] += r["clicks"]
                cur["impressions"] += r["impressions"]
                cur["posw"] += r["position"] * r["impressions"]

        def agg(bucket):
            out = []
            for k, v in bucket.items():
                out.append({"keys": [k], "clicks": v["clicks"], "impressions": v["impressions"],
                            "ctr": v["clicks"] / v["impressions"] if v["impressions"] else 0,
                            "position": round(v["posw"] / v["impressions"], 2) if v["impressions"] else 0})
            return out

        meta = {"site": prop, "startDate": start.isoformat(), "endDate": END.isoformat()}
        for name, dims, rows_ in (("query_page", ["query", "page"], qp),
                                  ("queries", ["query"], agg(by_q)),
                                  ("pages", ["page"], agg(by_p))):
            (d / f"{name}{suffix}.json").write_text(json.dumps(
                {**meta, "dimensions": dims, "rowCount": len(rows_), "rows": rows_}), encoding="utf-8")

    dataset(full_rows, 1.0, "", END - timedelta(days=FULL_DAYS))
    dataset(full_rows, 0.22, "_90d", END - timedelta(days=RECENT_DAYS))

    # dates.json — daily totals with seasonality and growth
    total_imps = sum(r[2] for r in full_rows)
    day0 = END - timedelta(days=FULL_DAYS)
    dates = []
    for i in range(FULL_DAYS):
        day = day0 + timedelta(days=i)
        imps = weekly(day, total_imps / FULL_DAYS * 0.8, growth=0.6, day0=day0)
        clicks = imps * rng.uniform(0.045, 0.07)
        dates.append({"keys": [day.isoformat()], "clicks": round(clicks), "impressions": round(imps),
                      "ctr": clicks / imps if imps else 0, "position": round(rng.uniform(9, 14), 1)})
    (d / "dates.json").write_text(json.dumps(
        {"site": prop, "dimensions": ["date"], "startDate": day0.isoformat(), "endDate": END.isoformat(),
         "rowCount": len(dates), "rows": dates}), encoding="utf-8")
    return full_rows


def ga4_report(dims, mets, rows):
    return {
        "dimensionHeaders": [{"name": n} for n in dims],
        "metricHeaders": [{"name": n, "type": "TYPE_INTEGER"} for n in mets],
        "rows": [{"dimensionValues": [{"value": str(v)} for v in dv],
                  "metricValues": [{"value": str(v)} for v in mv]} for dv, mv in rows],
        "rowCount": len(rows),
        "metadata": {"currencyCode": "USD", "timeZone": "UTC"},
        "kind": "analyticsData#runReport",
    }


def write_ga4(site, idx, conv, gsc_rows):
    host = site["host"]
    d = DATA / "ga4" / host
    d.mkdir(parents=True, exist_ok=True)
    base = [60, 25, 12][idx % 3] * (1 + idx * 0.3)
    yesterday = TODAY - timedelta(days=1)
    day0 = yesterday - timedelta(days=89)
    daily = []
    for i in range(90):
        day = day0 + timedelta(days=i)
        s = round(weekly(day, base, growth=0.5 if idx == 0 else -0.2, day0=day0))
        daily.append(([day.strftime("%Y%m%d")], [s, round(s * 0.85)]))
    total = sum(m[0] for _, m in daily)
    meta = {"site": host, "property": f"properties/{site.get('ga4Property') or '000000000'}",
            "pulled": TODAY.isoformat()}
    (d / "daily.json").write_text(json.dumps({**meta, **ga4_report(["date"], ["sessions", "totalUsers"], daily)}), encoding="utf-8")

    mix = [(src, med, w) for src, med, w, _ai in SOURCE_MIX]
    others = [h for h in seo_config.hosts() if h != host]
    if others:
        mix.append((others[0], "referral", 0.015))
    sources = [([src, med], [round(total * w), round(total * w * 0.8)]) for src, med, w in mix]
    (d / "sources.json").write_text(json.dumps({**meta, **ga4_report(["sessionSource", "sessionMedium"], ["sessions", "totalUsers"], sources)}), encoding="utf-8")

    pages = sorted({r[1] for r in gsc_rows if r[1].split("/")[2] == site["gscHost"]})
    paths = [p.split(site["gscHost"], 1)[1].rstrip("/") or "/" for p in pages] or ["/", "/docs", "/pricing"]
    landing = []
    for i, p in enumerate(paths[:12]):
        sessions = round(total * (0.35 if i == 0 else 0.6 / max(1, len(paths))) * rng.uniform(0.6, 1.4))
        eng = rng.uniform(0.45, 0.72)
        if i == 2:  # one page that does not deliver what the click promised
            sessions = max(sessions, 45)
            eng = 0.18
        landing.append(([p], [sessions, round(eng, 4)]))
    landing.sort(key=lambda r: -r[1][0])
    (d / "landing.json").write_text(json.dumps({**meta, **ga4_report(["landingPage"], ["sessions", "engagementRate"], landing)}), encoding="utf-8")

    if conv and conv.get("site") == host:
        rows = []
        for i in range(0, 90, 2):
            day = (day0 + timedelta(days=i)).strftime("%Y%m%d")
            for ev in conv.get("events", [])[:2]:
                rows.append(([day, ev, rng.choice(["web", "docs", "(not set)"])], [rng.randint(0, 4)]))
        (d / "funnel.json").write_text(json.dumps({**meta, **ga4_report(["date", "eventName", conv.get("sourceDimension") or "customEvent:source_app"], ["eventCount"], rows)}), encoding="utf-8")
    return paths, total


def write_timeseries(prop, slug, sites_in_prop, gsc_rows, ga4_paths):
    d = DATA / "timeseries"
    d.mkdir(parents=True, exist_ok=True)
    day0 = END - timedelta(days=180)
    pages = {}
    for q, p, imps, ctr, pos in gsc_rows:
        cur = pages.setdefault(p, [0, 0])
        cur[0] += imps * 0.37
        cur[1] += imps * ctr * 0.37
    rows = []
    for i in range(180):
        day = day0 + timedelta(days=i)
        for p, (imps, clicks) in pages.items():
            di = weekly(day, imps / 180, growth=0.5, day0=day0)
            dc = di * (clicks / imps if imps else 0.05)
            if round(di) or round(dc):
                rows.append({"keys": [day.isoformat(), p], "clicks": round(dc), "impressions": round(di),
                             "ctr": (dc / di) if di else 0, "position": round(rng.uniform(4, 20), 1)})
    (d / f"gsc-{slug}.json").write_text(json.dumps(
        {"site": prop, "startDate": day0.isoformat(), "endDate": END.isoformat(), "rows": rows}), encoding="utf-8")
    for s in sites_in_prop:
        paths, total = ga4_paths.get(s["host"], ([], 0))
        if not s.get("ga4Property"):
            continue
        rows = []
        ga0 = TODAY - timedelta(days=180)
        for i in range(180):
            day = ga0 + timedelta(days=i)
            for j, p in enumerate(paths[:8]):
                v = weekly(day, (total / 90) * (0.35 if j == 0 else 0.08), day0=ga0)
                if round(v):
                    rows.append({"date": day.strftime("%Y%m%d"), "page": p, "sessions": round(v)})
        (d / f"ga4-{s['host']}.json").write_text(json.dumps({"site": s["host"], "rows": rows}), encoding="utf-8")

        # date x source/medium. AI assistants grow over the window and the
        # rest hold roughly flat, so the demo actually shows the thing the
        # AI chart exists to show.
        rows = []
        for i in range(180):
            day = ga0 + timedelta(days=i)
            ramp = 0.3 + 1.7 * (i / 179)
            for src, med, w, g in SOURCE_MIX:
                v = weekly(day, (total / 90) * w * (ramp if g else 1.0), day0=ga0)
                if round(v):
                    rows.append({"date": day.strftime("%Y%m%d"), "source": src,
                                 "medium": med, "sessions": round(v)})
        (d / f"ga4-sources-{s['host']}.json").write_text(
            json.dumps({"site": s["host"], "rows": rows}), encoding="utf-8")


def write_probe(sites):
    d = DATA / "probes"
    d.mkdir(parents=True, exist_ok=True)
    out = []
    for i, s in enumerate(sites):
        healthy = i == 0
        out.append({
            "site": f"https://{s['gscHost']}",
            "robots": {"status": 200, "exists": True, "sitemap_declared": True, "ai_crawlers_blocked": []},
            "sitemap": {"status": 200, "exists": True, "url_count": 42 - i * 10,
                        "newest_lastmod": (TODAY - timedelta(days=2 + i * 9)).isoformat()},
            "llms.txt": {"status": 200 if healthy else 404, "exists": healthy, "bytes": 2400 if healthy else 0},
            "llms-full.txt": {"status": 200 if healthy else 404, "exists": healthy, "bytes": 18000 if healthy else 0},
            "homepage": {"status": 200, "title": f"{s['label'].title()} — the friendly demo site",
                         "meta_description": "A demo site used to show what n-seo's dashboard looks like with data in it.",
                         "canonical": f"https://{s['gscHost']}/", "og_tags": 4 if healthy else 0,
                         "jsonld_types": ["WebSite", "Organization"] if healthy else [],
                         "h1_count": 1, "lang": "en", "visible_text_bytes": 2100 if healthy else 380},
            "soft_404": {"status": 404, "real_404": True},
        })
    now = datetime.now(timezone.utc)
    (d / f"probe-{now:%Y%m%d-%H%M%S}.json").write_text(json.dumps({"probed_at": now.isoformat(), "sites": out}, indent=2), encoding="utf-8")


def write_metadata_audit(sites, gsc_by_host):
    audit = {"generated": TODAY.isoformat(), "window": "90d", "sites": {}}
    for i, s in enumerate(sites):
        rows = gsc_by_host.get(s["host"], [])
        by_page = {}
        for q, p, imps, ctr, pos in rows:
            by_page.setdefault(p, []).append({"q": q, "imps": int(imps * 0.22), "clicks": int(imps * 0.22 * ctr),
                                              "pos": round(pos, 1), "ctr": round(ctr, 4)})
        findings = []
        for j, (page, qs) in enumerate(sorted(by_page.items(), key=lambda kv: -sum(q["imps"] for q in kv[1]))[:3]):
            qs.sort(key=lambda q: -q["imps"])
            imps = sum(q["imps"] for q in qs)
            issues = [f"title misses ranking-query language: {', '.join(q['q'] for q in qs[:2])}"]
            missed = 0
            if j == 0:
                missed = round(imps * 0.04)
                issues.append(f"CTR below position expectation (~{missed} clicks missed in 90d)")
                issues.append("meta description missing")
            elif j == 1:
                issues.append("title long (71 chars — SERP truncates ~60)")
            else:
                issues.append("meta description duplicates the title")
            title = page.rstrip("/").rsplit("/", 1)[-1].replace("-", " ").title() or s["label"].title()
            findings.append({"page": page, "title": f"{title} | {s['label'].title()}" + (" — everything you need to know about it and more" if j == 1 else ""),
                             "description": "" if j == 0 else f"{title} | {s['label'].title()}. Learn more.",
                             "imps": imps, "clicks": sum(q["clicks"] for q in qs), "issues": issues,
                             "top_queries": qs[:5], "missed_clicks_window": missed})
        audit["sites"][s["host"]] = findings
    (DATA / "metadata-audit.json").write_text(json.dumps(audit, indent=1), encoding="utf-8")


def write_index_status(sites, gsc_by_host):
    out = {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "sites": {}}
    for i, s in enumerate(sites):
        if not s.get("gscProperty"):
            continue
        pages = sorted({r[1] for r in gsc_by_host.get(s["host"], [])})
        checked = len(pages) + 12
        problems = []
        if pages:
            problems.append({"url": pages[-1].rstrip("/") + "/changelog/", "coverage": "Discovered - currently not indexed",
                             "lastCrawl": None, "verdict": "NEUTRAL", "robots": "ALLOWED",
                             "canonicalMismatch": False, "googleCanonical": None})
            problems.append({"url": pages[0].rstrip("/") + "/archive/2024/", "coverage": "Crawled - currently not indexed",
                             "lastCrawl": (TODAY - timedelta(days=20)).isoformat() + "T04:12:00Z", "verdict": "NEUTRAL",
                             "robots": "ALLOWED", "canonicalMismatch": False, "googleCanonical": None})
            if i == 0:
                problems.append({"url": pages[min(2, len(pages) - 1)].rstrip("/") + "/old-name/", "coverage": "Soft 404",
                                 "lastCrawl": (TODAY - timedelta(days=140)).isoformat() + "T09:30:00Z", "verdict": "FAIL",
                                 "robots": "ALLOWED", "canonicalMismatch": True,
                                 "googleCanonical": pages[min(2, len(pages) - 1)]})
        out["sites"][s["gscHost"]] = {
            "property": s["gscProperty"], "checked": checked, "indexed": checked - len(problems),
            "neverCrawled": sum(1 for p in problems if not p["lastCrawl"]),
            "sitemap": {"submitted": 1, "entries": [{"path": f"https://{s['gscHost']}/sitemap.xml",
                                                    "lastSubmitted": (TODAY - timedelta(days=30)).isoformat() + "T00:00:00Z",
                                                    "lastDownloaded": (TODAY - timedelta(days=1)).isoformat() + "T06:00:00Z",
                                                    "pending": False, "errors": 0, "warnings": 0}]},
            "problems": problems,
        }
    (DATA / "index-status.json").write_text(json.dumps(out, indent=2), encoding="utf-8")


def write_trends(props, sites, gsc_rows_by_prop):
    out = {"generated": TODAY.isoformat(), "sites": {}, "ai_referrals": {}}
    brands = seo_config.brand_patterns()
    import re
    for prop, slug in props.items():
        rows = gsc_rows_by_prop[prop]
        brand = re.compile(brands[prop], re.I) if prop in brands else None
        recent = {q: int(imps * 0.2) for q, p, imps, ctr, pos in rows}
        prior = {q: int(imps * 0.2 * rng.uniform(0.3, 1.6)) for q, p, imps, ctr, pos in rows}
        # make some clear risers and fallers
        for k, q in enumerate(list(recent)[:6]):
            if k % 2 == 0:
                prior[q] = max(0, int(recent[q] / 4))
            else:
                prior[q] = int(recent[q] * 2.5)
        movers = []
        for q in recent:
            ri, pi = recent[q], prior[q]
            if max(ri, pi) >= 30:
                movers.append({"query": q, "recent_imps": ri, "prior_imps": pi, "delta": ri - pi,
                               "recent_pos": round(rng.uniform(3, 18), 1), "recent_clicks": int(ri * 0.05)})
        movers.sort(key=lambda m: -abs(m["delta"]))

        def split(d):
            b = [q for q in d if brand and brand.search(q)]
            g = [q for q in d if q not in b]
            return {"branded_clicks": sum(d[q] * 0.3 for q in b), "generic_clicks": sum(d[q] * 0.05 for q in g),
                    "branded_imps": sum(d[q] for q in b), "generic_imps": sum(d[q] for q in g)}

        monthly = {}
        dates_file = DATA / "gsc" / slug / "dates.json"
        for r in json.loads(dates_file.read_text(encoding="utf-8"))["rows"]:
            m = r["keys"][0][:7]
            cur = monthly.setdefault(m, {"clicks": 0, "imps": 0})
            cur["clicks"] += r["clicks"]
            cur["imps"] += r["impressions"]
        out["sites"][prop] = {"recent_split": split(recent), "prior_split": split(prior),
                              "rising": [m for m in movers if m["delta"] > 0][:20],
                              "falling": [m for m in movers if m["delta"] < 0][:15], "monthly": monthly}
    for i, s in enumerate(sites):
        if not s.get("ga4Property"):
            continue
        ai, total = {}, {}
        for k in range(12, 0, -1):
            ym = (TODAY.replace(day=1) - timedelta(days=30 * k)).strftime("%Y%m")
            t = round(1500 * (1 + i) * (1 + (12 - k) * 0.04) * rng.uniform(0.9, 1.1))
            total[ym] = t
            ai[ym] = round(t * (0.01 + (12 - k) * 0.004))
        out["ai_referrals"][s["host"]] = {"ai": ai, "total": total}
    (DATA / f"trends-{TODAY.isoformat()}.json").write_text(json.dumps(out, indent=1), encoding="utf-8")


def write_proposals(sites, gsc_by_host):
    s0 = sites[0]
    pages = sorted({r[1] for r in gsc_by_host.get(s0["host"], [])})
    q = next((r for r in gsc_by_host.get(s0["host"], []) if 5 <= r[4] <= 15), None)
    out = {
        "generated": TODAY.isoformat(),
        "candidates": [{"host": s0["gscHost"], "query": r[0], "recent_imps": int(r[2] * 0.2), "prior_imps": int(r[2] * 0.05),
                        "delta": int(r[2] * 0.15), "recent_pos": round(r[4], 1), "recent_clicks": int(r[2] * 0.2 * r[3])}
                       for r in gsc_by_host.get(s0["host"], [])[:4]],
        "proposals": [
            {"host": s0["host"], "title": f"New guide page for “{q[0] if q else 'rising query'}”",
             "kind": "New top-level page",
             "why": f"DEMO DATA — a rising query (pos {round(q[4], 1) if q else 9}) with no page that answers it directly; impressions quadrupled over 84 days",
             "how": "Write an answer-formatted guide: the query as H1, a 40-60 word direct answer, then detail, FAQPage schema, internal links from the two closest pages.",
             "spec": [f"URL: {pages[0].rstrip('/') if pages else 'https://example.com'}/guides/{slugify(q[0]) if q else 'topic'}/",
                      "Outline: direct answer -> how it works -> examples -> FAQ", "Schema: Article + FAQPage",
                      "Success: first-page ranking for the target query within 8 weeks"],
             "impact": 40, "effort": "M", "tag": "content"},
            {"host": (sites[1] if len(sites) > 1 else s0)["host"], "title": "Add llms.txt and server-render the homepage intro",
             "kind": "Config/template change",
             "why": "DEMO DATA — the probe shows no llms.txt and 380 bytes of visible text on the homepage; AI crawlers see an empty shell",
             "how": "Publish /llms.txt (markdown summary + key links) and move the homepage H1 + intro paragraph into the server-rendered HTML.",
             "spec": ["Serve /llms.txt and /llms-full.txt", "Static H1 + 2 paragraphs in the HTML shell",
                      "Verify with probes/site_probe.py after deploy"],
             "impact": 15, "effort": "S", "tag": "hygiene"},
        ],
        "verdicts": [{"title": "Rewrite title/description: /docs/getting-started/", "verdict": "keep-watching",
                      "evidence": "DEMO DATA — 12 days since the change; CTR up from 1.9% to 2.6% but the 28-day window has not closed."}],
        "inference_ran": True,
    }
    (DATA / "opportunity-proposals.json").write_text(json.dumps(out, indent=1), encoding="utf-8")


def write_run_files():
    ts = datetime.now(timezone.utc)
    (DATA / "last-run.json").write_text(json.dumps({
        "ts": ts.strftime("%Y-%m-%dT%H:%MZ"), "failures": "",
        "steps": [{"name": n, "ok": True, "seconds": s} for n, s in
                  (("probe", 6.2), ("gsc", 41.0), ("ga4", 9.8), ("timeseries", 22.4), ("metadata-audit", 14.1),
                   ("index-status", 38.5), ("opportunity-scan", 17.0), ("daily-diff", 0.3))]}, indent=1), encoding="utf-8")
    with (DATA / "daily-ops.log").open("a", encoding="utf-8") as f:
        f.write(f"=== daily run {ts:%Y-%m-%d %H:%M} (demo data) ===\n")
        f.write("--- probe\n  2 sites probed\n--- gsc\n  2 properties pulled\n--- daily-diff\n  daily-log updated (0 alerts)\n")
        f.write("=== done (0 failures) ===\n")


def main():
    if "--clean" in sys.argv:
        if DATA.exists():
            shutil.rmtree(DATA)
            print(f"removed {DATA}")
        else:
            print("data/ does not exist")
        return 0

    cfg = seo_config.load()
    sites = cfg["sites"]
    if not sites:
        print("no sites in config — nothing to generate")
        return 1
    if seo_config.using_example():
        print("no n-seo.config.json — generating demo data for the example config's sites")
    DATA.mkdir(parents=True, exist_ok=True)
    index_of = {s["host"]: i for i, s in enumerate(sites)}
    props = seo_config.gsc_properties(include_extra=False)

    gsc_rows_by_prop, gsc_by_host = {}, {}
    for prop, slug in props.items():
        in_prop = [s for s in sites if s.get("gscProperty") == prop]
        rows = write_gsc(prop, slug, in_prop, index_of)
        gsc_rows_by_prop[prop] = rows
        for s in in_prop:
            gsc_by_host[s["host"]] = [r for r in rows if r[1].split("/")[2] == s["gscHost"]]

    # the example config leaves ga4Property empty; the demo still needs GA4 files
    ga4_paths = {}
    for s in sites:
        s.setdefault("ga4Property", None)
        demo_site = dict(s, ga4Property=s.get("ga4Property") or str(100000000 + index_of[s["host"]]))
        ga4_paths[s["host"]] = write_ga4(demo_site, index_of[s["host"]], cfg["conversions"], gsc_by_host.get(s["host"], []))
    demo_sites = [dict(s, ga4Property=s.get("ga4Property") or str(100000000 + index_of[s["host"]])) for s in sites]

    for prop, slug in props.items():
        in_prop = [s for s in demo_sites if s.get("gscProperty") == prop]
        write_timeseries(prop, slug, in_prop, gsc_rows_by_prop[prop], ga4_paths)
    write_probe(sites)
    write_metadata_audit(sites, gsc_by_host)
    write_index_status(sites, gsc_by_host)
    write_trends(props, demo_sites, gsc_rows_by_prop)
    write_proposals(sites, gsc_by_host)
    write_run_files()

    written = sorted(str(p.relative_to(DATA.parent)) for p in DATA.rglob("*") if p.is_file())
    print(f"wrote {len(written)} files under data/ for {', '.join(s['host'] for s in sites)}:")
    for w in written:
        print("  " + w)
    if DATA.parent == seo_config.ROOT:  # in-place: data lives inside the engine checkout
        print("\nnow run: npm start   (then open the dashboard)")
        print("remove with: python3 ops/demo_data.py --clean")
    else:
        print("\nnow run: n-seo start   (then open the dashboard)")
        print("remove with: n-seo demo --clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
