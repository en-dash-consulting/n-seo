#!/usr/bin/env python3
"""Post-refresh daily diff: appends a dated entry to docs/daily-log.md.

Reports, per day: probe health (with ALERT lines for checks that regressed
since the previous snapshot), the Search Console numbers for every URL in
config `watchPages` (shipped work being measured), your conversion events
if `conversions` is configured, and cross-referrals between your own sites.
Pure stdlib; runs unattended from ops/daily.py.
"""

import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ingest"))
import seo_config  # noqa: E402

ROOT = seo_config.ROOT
INSTANCE = seo_config.INSTANCE
DATA = seo_config.DATA

PROBE_KEYS = [
    ("robots.txt", lambda s: s["robots"].get("exists")),
    ("sitemap.xml", lambda s: s["sitemap"].get("exists")),
    ("llms.txt", lambda s: s["llms.txt"].get("exists")),
    ("real-404", lambda s: s["soft_404"].get("real_404")),
    ("homepage-200", lambda s: s["homepage"].get("status") == 200),
]


def probes():
    files = sorted((DATA / "probes").glob("probe-*.json"))
    return [json.loads(f.read_text(encoding="utf-8")) for f in files[-2:]]


def watch_groups():
    """{gsc slug -> [watch URLs]} — each watched URL is matched to the site
    whose host (or gscHost) it belongs to, then to that site's property."""
    by_host = {}
    for s in seo_config.sites():
        if s.get("gscProperty"):
            slug = seo_config.gsc_data_slug(s["gscProperty"])
            by_host[s["host"]] = slug
            by_host[s["gscHost"]] = slug
    groups = {}
    for url in seo_config.load()["watchPages"]:
        host = url.split("/")[2] if "//" in url else ""
        slug = by_host.get(host)
        if slug:
            groups.setdefault(slug, []).append(url)
    return groups


def main():
    lines, alerts = [], []

    snaps = probes()
    if len(snaps) == 2:
        prev = {s["site"]: s for s in snaps[0]["sites"]}
        for cur in snaps[1]["sites"]:
            old = prev.get(cur["site"])
            if not old:
                continue
            for name, get in PROBE_KEYS:
                if get(old) and not get(cur):
                    alerts.append(f"{cur['site']}: {name} REGRESSED (was OK, now failing)")
    if snaps:
        latest = snaps[-1]
        ok = sum(1 for s in latest["sites"] if all(get(s) for _, get in PROBE_KEYS))
        lines.append(f"probe: {ok}/{len(latest['sites'])} sites fully healthy")

    for slug, urls in watch_groups().items():
        f90 = DATA / "gsc" / slug / "pages_90d.json"
        f = f90 if f90.exists() else DATA / "gsc" / slug / "pages.json"
        if not f.exists():
            continue
        win = "90d" if f90.exists() else "16mo"
        by_url = {r["keys"][0]: r for r in json.loads(f.read_text(encoding="utf-8"))["rows"]}
        for url in urls:
            r = by_url.get(url) or by_url.get(url.rstrip("/")) or by_url.get(url + "/")
            label = url.split("//", 1)[-1]
            if r:
                lines.append(
                    f"{label}: {r['clicks']:.0f} clicks / {r['impressions']:.0f} imps"
                    f" / CTR {100 * r['ctr']:.2f}% / pos {r['position']:.1f} ({win})")
            else:
                lines.append(f"{label}: no impressions yet ({win})")

    conv = seo_config.load()["conversions"]
    if conv:
        try:
            fr = json.loads((DATA / "ga4" / conv["site"] / "funnel.json").read_text(encoding="utf-8"))
            rows = fr.get("rows", [])
            if rows:
                counts = {}
                for r in rows:
                    ev = r["dimensionValues"][1]["value"]
                    counts[ev] = counts.get(ev, 0) + float(r["metricValues"][0]["value"])
                lines.append("CONVERSIONS: " + ", ".join(f"{k}={v:.0f}" for k, v in counts.items()) + " (90d)")
            else:
                lines.append("conversions: no events yet (instrumentation pending or zero conversions)")
        except FileNotFoundError:
            pass

    # cross-referrals: sessions one of your sites sends to another
    hosts = seo_config.hosts()
    for host in hosts:
        p = DATA / "ga4" / host / "sources.json"
        if not p.exists():
            continue
        # exact host match (www stripped) — a substring test would count a
        # subdomain's own traffic as a referral from the apex
        others = {h.removeprefix("www.") for h in hosts if h != host}
        xref = []
        for r in json.loads(p.read_text(encoding="utf-8")).get("rows", []):
            name = r["dimensionValues"][0]["value"]
            if name.lower().removeprefix("www.") in others:
                xref.append(f"{name}={float(r['metricValues'][0]['value']):.0f}")
        if xref:
            lines.append(f"cross-referrals into {host} (90d sessions): " + ", ".join(xref))

    log = INSTANCE / "docs" / "daily-log.md"
    log.parent.mkdir(parents=True, exist_ok=True)
    if not log.exists():
        log.write_text("# Daily ops log\n\nAppended by ops/daily.py — newest entries last.\n")
    today = date.today().isoformat()
    entry = [f"\n## {today}\n"]
    entry += [f"- **ALERT:** {a}" for a in alerts]
    entry += [f"- {l}" for l in lines]
    body = "\n".join(entry) + "\n"

    # Re-running on the same day must replace today's entry, not stack a
    # second one under the same heading.
    text = log.read_text(encoding="utf-8")
    head = f"\n## {today}\n"
    start = text.find(head)
    if start == -1:
        log.write_text(text.rstrip("\n") + "\n" + body, encoding="utf-8")
    else:
        nxt = text.find("\n## ", start + len(head))
        tail = text[nxt:] if nxt != -1 else ""
        log.write_text(text[:start].rstrip("\n") + "\n" + body + tail.lstrip("\n"), encoding="utf-8")
    for a in alerts:
        print(f"ALERT: {a}")
    print(f"daily-log updated ({len(alerts)} alerts, {len(lines)} lines)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
