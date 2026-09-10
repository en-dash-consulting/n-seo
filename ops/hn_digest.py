#!/usr/bin/env python3
"""Daily Hacker News comment-opportunity digest (modules.hackerNews).

Finds active HN threads in your expertise areas via the public Algolia API
and writes the best candidates, each with a short briefing, to
data/hn-digest.json for the dashboard. The point is to make GENUINE
participation fast — the comments themselves are yours. This script never
generates comment text, and the briefing prompt forbids it.

Config: modules.hackerNews.topics = [[query, why-you], ...],
modules.hackerNews.user = your HN username (marks threads you already joined),
participation.expertise = the persona the briefing is written for.
Briefings need modules.llm; without it, picks are listed unbriefed.
"""

import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ingest"))
import seo_config  # noqa: E402
import llm  # noqa: E402
from http_util import fetch_text, get_json  # noqa: E402

CUTOFF_HOURS = 48
MIN_COMMENTS = 0    # early threads are prime commenting real estate
MAX_COMMENTS = 120  # not already saturated
MAX_PICKS = 5


def search(query):
    since = int((datetime.now(timezone.utc) - timedelta(hours=CUTOFF_HOURS)).timestamp())
    filters = quote(f"created_at_i>{since},num_comments>={MIN_COMMENTS},num_comments<{MAX_COMMENTS}")
    url = ("https://hn.algolia.com/api/v1/search_by_date?tags=story"
           f"&numericFilters={filters}&hitsPerPage=5&query={quote(query)}")
    try:
        return get_json(url, label="hn search").get("hits", [])
    except RuntimeError:
        return []


def article_text(url, cap=4000):
    if not url:
        return ""
    _, body = fetch_text(url)
    t = re.sub(r"<(script|style|noscript)[^>]*>.*?</\1>", " ", body, flags=re.S | re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", t).strip()[:cap]


def top_comments(object_id, cap=5):
    try:
        kids = get_json(f"https://hn.algolia.com/api/v1/items/{object_id}", label="hn item").get("children", [])[:cap]
    except RuntimeError:
        return ""
    out = []
    for k in kids:
        txt = re.sub(r"<[^>]+>", " ", k.get("text") or "")
        if txt.strip():
            out.append(re.sub(r"\s+", " ", txt).strip()[:400])
    return "\n".join(out)


def briefing(pick, expertise):
    prompt = (
        f"About the reader (first-hand expertise): {expertise}\n\n"
        f"HN story: {pick['title']}\n"
        f"Article excerpt:\n{article_text(pick.get('story_url')) or '(no article text — likely a Show HN app or paywalled)'}\n\n"
        f"Top comments so far:\n{top_comments(pick.get('id')) or '(none yet)'}\n\n"
        "Write a briefing for the reader in EXACTLY this format, one line each:\n"
        "GIST: <one sentence — what the article/story actually says>\n"
        "THREAD: <one sentence — what commenters are focusing on or debating>\n"
        "ANGLE: <1-2 sentences — where the reader's genuine first-hand experience connects, and any of THEIR OWN facts worth citing. If their expertise does not genuinely connect, say 'weak fit — skip unless personally interested.'>\n"
        "Do NOT write any comment text or suggested wording — briefing only."
    )
    out = llm.infer(prompt, fast=True) or ""
    return out if "GIST:" in out else ""


def _fb(path):
    try:
        return get_json(f"https://hacker-news.firebaseio.com/v0/{path}.json", label="hn firebase") or {}
    except RuntimeError:
        return {}


def my_activity(user, recent=30):
    """Story ids the user has commented on + profile stats. Uses the Firebase
    API rather than Algolia's author search, which can lag days behind for
    young accounts. Comments carry only a parent id, so walk up to the story."""
    if not user:
        return set(), None
    profile = _fb(f"user/{user}")
    submitted = profile.get("submitted", []) or []
    story_ids, comment_count = set(), 0
    for item_id in submitted[:recent]:
        it = _fb(f"item/{item_id}")
        if it.get("type") != "comment" or it.get("dead"):
            continue
        comment_count += 1
        cur = it
        for _ in range(8):
            parent = cur.get("parent")
            if parent is None:
                break
            cur = _fb(f"item/{parent}")
            if cur.get("type") == "story":
                story_ids.add(str(parent))
                break
    return story_ids, {"user": user, "karma": profile.get("karma"),
                       "created": profile.get("created"), "comments": comment_count}


def main():
    m = seo_config.module("hackerNews")
    if not m.get("enabled"):
        print("hackerNews module disabled (modules.hackerNews.enabled) — skipping")
        return 0
    topics = [t for t in (m.get("topics") or []) if isinstance(t, list) and t and t[0]]
    if not topics:
        print("hackerNews: no topics configured — add [query, why] pairs in Settings")
        return 0
    expertise = (seo_config.load()["participation"] or {}).get("expertise", "").strip()

    picks, seen = [], set()
    for query, *rest in topics:
        why = rest[0] if rest else ""
        for h in search(query):
            oid = h.get("objectID")
            if oid in seen:
                continue
            seen.add(oid)
            picks.append({
                "id": oid,
                "title": h.get("title", ""),
                "url": f"https://news.ycombinator.com/item?id={oid}",
                "story_url": h.get("url") or "",
                "comments": h.get("num_comments", 0),
                "points": h.get("points", 0),
                "why": why,
            })
    picks.sort(key=lambda p: -((p["points"] or 0) + 2 * (p["comments"] or 0)))
    picks = picks[:MAX_PICKS]

    commented_ids, stats = my_activity((m.get("user") or "").strip())
    can_brief = llm.available(fast=True) and bool(expertise)
    if picks and not can_brief:
        print("briefings skipped: " + ("participation.expertise is empty" if not expertise
                                       else "llm module off"))
    for pick in picks:
        pick["commented"] = str(pick.get("id")) in commented_ids
        pick["briefing"] = briefing(pick, expertise) if (can_brief and not pick["commented"]) else ""

    seo_config.DATA.mkdir(parents=True, exist_ok=True)
    (seo_config.DATA / "hn-digest.json").write_text(json.dumps(
        {"generated": datetime.now(timezone.utc).isoformat(timespec="minutes"),
         "stats": stats, "picks": picks}, indent=1), encoding="utf-8")
    for p in picks:
        print(f"- {p['title']} ({p['comments']}c/{p['points']}p) {p['url']}  [{p['why']}]")
    if not picks:
        print("no matching active threads today")
    return 0


if __name__ == "__main__":
    sys.exit(main())
