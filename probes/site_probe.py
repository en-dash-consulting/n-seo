#!/usr/bin/env python3
"""No-auth SEO health probe for every configured site.

Checks each site's robots.txt (incl. AI-crawler rules), sitemap.xml, llms.txt,
llms-full.txt, homepage HTML (title, meta description, canonical, OG, JSON-LD,
server-rendered text) and 404 behaviour. Prints a summary and writes a
timestamped JSON snapshot to data/probes/ so regressions can be diffed
day over day — deploys are where SEO quietly dies.

Stdlib only — no pip installs needed.
"""

import json
import re
import sys
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ingest"))
import seo_config  # noqa: E402
from http_util import fetch_text  # noqa: E402

# gscHost rather than host so a site served on www is probed where it lives.
SITES = [f"https://{s['gscHost']}" for s in seo_config.sites()]

AI_CRAWLERS = [
    "GPTBot", "ClaudeBot", "Claude-Web", "PerplexityBot",
    "Google-Extended", "CCBot", "Bytespider", "OAI-SearchBot",
]

UA = "Mozilla/5.0 (compatible; seo-agent-probe/0.1)"


def fetch(url, timeout=15):
    return fetch_text(url, timeout=timeout, ua=UA)


class MetaParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ""
        self._in_title = False
        self.meta_description = None
        self.canonical = None
        self.og = {}
        self.jsonld_types = []
        self._in_jsonld = False
        self.h1s = []
        self._in_h1 = False
        self.lang = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "html":
            self.lang = a.get("lang")
        elif tag == "title":
            self._in_title = True
        elif tag == "h1":
            self._in_h1 = True
            self.h1s.append("")
        elif tag == "meta":
            if a.get("name") == "description":
                self.meta_description = a.get("content")
            prop = a.get("property", "")
            if prop.startswith("og:"):
                self.og[prop] = a.get("content")
        elif tag == "link" and a.get("rel") == "canonical":
            self.canonical = a.get("href")
        elif tag == "script" and a.get("type") == "application/ld+json":
            self._in_jsonld = True

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag == "h1":
            self._in_h1 = False
        elif tag == "script":
            self._in_jsonld = False

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        if self._in_h1 and self.h1s:
            self.h1s[-1] += data
        if self._in_jsonld:
            try:
                d = json.loads(data)
                items = d if isinstance(d, list) else [d]
                for item in items:
                    t = item.get("@type")
                    if t:
                        self.jsonld_types.append(t)
            except (json.JSONDecodeError, AttributeError):
                pass


def visible_text_bytes(html):
    """Rough server-rendering signal: bytes of visible text once tags and
    scripts are stripped. A JS shell scores near zero — and AI crawlers
    don't run JS."""
    stripped = re.sub(r"<(script|style|noscript)[^>]*>.*?</\1>", " ", html,
                      flags=re.DOTALL | re.IGNORECASE)
    stripped = re.sub(r"<[^>]+>", " ", stripped)
    return len(re.sub(r"\s+", " ", stripped).strip())


def probe_site(base):
    result = {"site": base}

    status, body = fetch(base + "/robots.txt")
    robots = {"status": status, "exists": status == 200}
    if status == 200:
        robots["sitemap_declared"] = "sitemap:" in body.lower()
        blocked = []
        for bot in AI_CRAWLERS:
            m = re.search(rf"user-agent:\s*{re.escape(bot)}\s*\n(?:[^\n]*\n)*?\s*disallow:\s*/\s*$",
                          body, re.IGNORECASE | re.MULTILINE)
            if m:
                blocked.append(bot)
        robots["ai_crawlers_blocked"] = blocked
    result["robots"] = robots

    status, body = fetch(base + "/sitemap.xml")
    sitemap = {"status": status,
               "exists": bool(status == 200 and ("<urlset" in body or "<sitemapindex" in body))}
    if status == 200:
        sitemap["url_count"] = body.count("<loc>")
        lastmods = re.findall(r"<lastmod>([^<]+)</lastmod>", body)
        sitemap["newest_lastmod"] = max(lastmods) if lastmods else None
    result["sitemap"] = sitemap

    for f in ("llms.txt", "llms-full.txt"):
        status, body = fetch(f"{base}/{f}")
        ok = status == 200 and not body.lstrip().lower().startswith("<!doctype")
        result[f] = {"status": status, "exists": ok, "bytes": len(body) if ok else 0}

    status, body = fetch(base + "/")
    home = {"status": status}
    if status == 200:
        p = MetaParser()
        try:
            p.feed(body)
        except Exception:
            pass
        home.update({
            "title": p.title.strip()[:120],
            "meta_description": (p.meta_description or "")[:200] or None,
            "canonical": p.canonical,
            "og_tags": len(p.og),
            "jsonld_types": p.jsonld_types,
            "h1_count": len(p.h1s),
            "lang": p.lang,
            "visible_text_bytes": visible_text_bytes(body),
        })
    result["homepage"] = home

    status, _ = fetch(base + "/definitely-not-a-real-page-9x7q")
    result["soft_404"] = {"status": status, "real_404": status == 404}

    return result


def main():
    if not SITES:
        print("no sites configured — nothing to probe")
        return 0
    snapshot = {
        "probed_at": datetime.now(timezone.utc).isoformat(),
        "sites": [probe_site(s) for s in SITES],
    }

    out_dir = seo_config.DATA / "probes"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"probe-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.json"
    out.write_text(json.dumps(snapshot, indent=2))

    for s in snapshot["sites"]:
        h = s["homepage"]
        print(f"\n{s['site']}")
        print(f"  robots.txt: {'OK' if s['robots']['exists'] else 'MISSING'}"
              + (f" (blocks AI: {s['robots']['ai_crawlers_blocked']})"
                 if s['robots'].get('ai_crawlers_blocked') else ""))
        print(f"  sitemap.xml: {'OK, %s URLs' % s['sitemap'].get('url_count') if s['sitemap'].get('exists') else 'MISSING'}")
        print(f"  llms.txt: {'OK' if s['llms.txt']['exists'] else 'missing'}"
              f" | llms-full.txt: {'OK' if s['llms-full.txt']['exists'] else 'missing'}")
        if h.get("status") == 200:
            print(f"  title: {h.get('title') or 'MISSING'}")
            print(f"  meta description: {'OK' if h.get('meta_description') else 'MISSING'}"
                  f" | canonical: {'OK' if h.get('canonical') else 'MISSING'}"
                  f" | JSON-LD: {h.get('jsonld_types') or 'none'}")
            print(f"  visible text: {h.get('visible_text_bytes')} bytes"
                  f" ({'likely JS shell' if h.get('visible_text_bytes', 0) < 500 else 'server-rendered content'})")
        print(f"  404 handling: {'real 404' if s['soft_404']['real_404'] else 'SOFT 404 (status %s)' % s['soft_404']['status']}")

    print(f"\nSnapshot written: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
