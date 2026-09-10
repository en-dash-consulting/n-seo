#!/usr/bin/env python3
"""Daily Reddit comment-opportunity digest (modules.reddit).

Mirrors ops/hn_digest.py for the subreddits where your audience lives.
Reddit blocks unauthenticated JSON from most IPs, so this needs a free
"script" app (https://www.reddit.com/prefs/apps) with REDDIT_CLIENT_ID /
REDDIT_CLIENT_SECRET in .env. Briefings only — the comments are yours; the
prompt forbids generating participation text.

Config: modules.reddit.topics = [[subreddit, query, why-you], ...],
modules.reddit.user = your username (marks threads you already joined).
"""

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ingest"))
import seo_config  # noqa: E402
import llm  # noqa: E402

UA = "n-seo/0.1 (participation research)"
MAX_AGE_DAYS = 7
MAX_COMMENTS = 80  # not already saturated; early threads are prime real estate
MAX_PICKS = 6

_TOKEN = None


def oauth_token():
    """App-only OAuth token; '' when no credentials are configured."""
    global _TOKEN
    if _TOKEN is not None:
        return _TOKEN
    cid, secret = seo_config.env("REDDIT_CLIENT_ID"), seo_config.env("REDDIT_CLIENT_SECRET")
    if not cid or not secret:
        _TOKEN = ""
        return ""
    p = subprocess.run(
        ["curl", "-s", "--max-time", "20", "-A", UA, "-u", f"{cid}:{secret}",
         "-d", "grant_type=client_credentials",
         "https://www.reddit.com/api/v1/access_token"],
        capture_output=True, text=True)
    try:
        _TOKEN = json.loads(p.stdout).get("access_token", "")
    except json.JSONDecodeError:
        _TOKEN = ""
    return _TOKEN


def get_json(url):
    token = oauth_token()
    if token:
        url = url.replace("https://www.reddit.com/", "https://oauth.reddit.com/")
        cmd = ["curl", "-s", "--max-time", "20", "-A", UA,
               "-H", f"Authorization: Bearer {token}", url]
    else:
        cmd = ["curl", "-s", "--max-time", "20", "-A", UA, url]
    p = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return json.loads(p.stdout)
    except json.JSONDecodeError:
        return {}


def search(sub, query):
    url = (f"https://www.reddit.com/r/{sub}/search.json?q={quote(query)}"
           f"&restrict_sr=on&sort=new&t=week&limit=8&raw_json=1")
    children = (get_json(url).get("data") or {}).get("children") or []
    return [c.get("data", {}) for c in children if c.get("kind") == "t3"]


def my_commented_links(user):
    if not user:
        return set()
    url = f"https://www.reddit.com/user/{user}/comments.json?limit=100&raw_json=1"
    children = (get_json(url).get("data") or {}).get("children") or []
    return {c.get("data", {}).get("link_id", "").replace("t3_", "") for c in children}


def briefing(pick, expertise):
    body = (pick.get("selftext") or "")[:3000]
    prompt = (
        f"About the reader (first-hand expertise): {expertise}\n\n"
        f"Reddit thread in r/{pick['sub']}: {pick['title']}\n"
        f"Post body:\n{body or '(link post or empty body)'}\n\n"
        "Write a briefing for the reader in EXACTLY this format, one line each:\n"
        "GIST: <one sentence — what the post is asking or saying>\n"
        "ANGLE: <1-2 sentences — where the reader's genuine first-hand experience connects, and "
        "whether linking one of their own resources would be welcome in this sub or read as "
        "self-promo. If their expertise does not genuinely connect, say 'weak fit — skip "
        "unless personally interested.'>\n"
        "Do NOT write any comment text or suggested wording — briefing only."
    )
    out = llm.infer(prompt, fast=True) or ""
    return out if "GIST:" in out else ""


def main():
    m = seo_config.module("reddit")
    if not m.get("enabled"):
        print("reddit module disabled (modules.reddit.enabled) — skipping")
        return 0
    topics = [t for t in (m.get("topics") or []) if isinstance(t, list) and len(t) >= 2 and t[0]]
    if not topics:
        print("reddit: no topics configured — add [subreddit, query, why] rows in Settings")
        return 0
    expertise = (seo_config.load()["participation"] or {}).get("expertise", "").strip()
    user = (m.get("user") or "").strip()

    now = datetime.now(timezone.utc).timestamp()
    picks, seen = [], set()
    for sub, query, *rest in topics:
        why = rest[0] if rest else ""
        for d in search(sub, query):
            pid = d.get("id")
            if not pid or pid in seen:
                continue
            age_days = (now - (d.get("created_utc") or now)) / 86400
            if age_days > MAX_AGE_DAYS or (d.get("num_comments") or 0) >= MAX_COMMENTS:
                continue
            seen.add(pid)
            picks.append({
                "id": pid,
                "title": d.get("title", ""),
                "url": f"https://www.reddit.com{d.get('permalink', '')}",
                "sub": d.get("subreddit", sub),
                "comments": d.get("num_comments", 0),
                "score": d.get("score", 0),
                "age_days": round(age_days, 1),
                "why": why,
                "selftext": d.get("selftext", ""),
            })
    # freshest, least-saturated, still-alive threads first
    picks.sort(key=lambda p: (-(p["score"] + 2 * p["comments"]) / (1 + p["age_days"])))
    picks = picks[:MAX_PICKS]

    commented = my_commented_links(user)
    can_brief = llm.available(fast=True) and bool(expertise)
    if picks and not can_brief:
        print("briefings skipped: " + ("participation.expertise is empty" if not expertise
                                       else "llm module off"))
    for p in picks:
        p["commented"] = p["id"] in commented
        p["briefing"] = briefing(p, expertise) if (can_brief and not p["commented"]) else ""
        p.pop("selftext", None)

    seo_config.DATA.mkdir(parents=True, exist_ok=True)
    (seo_config.DATA / "reddit-digest.json").write_text(json.dumps(
        {"generated": datetime.now(timezone.utc).isoformat(timespec="minutes"),
         "user": user or None, "auth": bool(oauth_token()), "picks": picks}, indent=1), encoding="utf-8")
    for p in picks:
        print(f"- r/{p['sub']}: {p['title']} ({p['comments']}c/{p['score']}pts, {p['age_days']}d) {p['url']}")
    if not picks:
        if not oauth_token():
            print("no picks — Reddit blocks unauthenticated JSON from most IPs. One-time fix: "
                  "create a 'script' app at https://www.reddit.com/prefs/apps and add "
                  "REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET to .env")
        else:
            print("no matching active threads this week")
    return 0


if __name__ == "__main__":
    sys.exit(main())
