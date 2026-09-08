#!/usr/bin/env python3
"""Automated opportunity discovery.

Closes the loop that otherwise needs a human analysis session:
  1. Refreshes the trend analysis (rising/falling queries, 84d windows).
  2. SCRIPTED detection: rising queries not covered by any existing queue
     action become candidates.
  3. INFERENCE (optional, modules.llm): candidates + queue summary + watching
     items go to the model, which returns strictly-JSON *proposals* (new
     queue cards) and *verdicts* on watching items (succeeded / failed /
     keep-watching).
  4. Output -> data/opportunity-proposals.json, rendered on the Actions page
     as PROPOSED cards. Nothing self-modifies the curated queue — you accept
     proposals into config/backlog.json (the dashboard has a button).

Inference runs when there are new candidates, and always on Mondays (weekly
review of watching items). Without the LLM module it still writes candidates.
"""

import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ingest"))
import seo_config  # noqa: E402
import llm  # noqa: E402

ROOT = seo_config.ROOT
DATA = seo_config.DATA
RISE_MIN_IMPS = 30       # a riser must reach this many imps in the recent 84d
RISE_MIN_RATIO = 2.5     # and have grown at least this much vs prior 84d


def latest_trends():
    files = sorted(DATA.glob("trends-*.json"))
    return json.loads(files[-1].read_text()) if files else None


def queue():
    """The live queue from the dashboard (data-derived + curated). Falls back
    to the curated backlog alone when the dashboard is not running."""
    p = subprocess.run(["curl", "-sf", "--max-time", "30", seo_config.dashboard_base() + "/api/actions"],
                       capture_output=True, text=True)
    try:
        acts = json.loads(p.stdout)
        if isinstance(acts, list):
            return acts
    except json.JSONDecodeError:
        pass
    try:
        return json.loads((seo_config.INSTANCE / "config" / "backlog.json").read_text()).get("actions", [])
    except (OSError, json.JSONDecodeError):
        return []


def portfolio_description():
    parts = []
    for s in seo_config.sites():
        desc = s["host"]
        if s.get("label") and s["label"] != s["host"]:
            desc += f" ({s['label']})"
        parts.append(desc)
    return ", ".join(parts)


def _host_resolver(prop):
    """query -> the configured host a riser belongs to.

    A domain property can cover several configured sites, and a url-prefix
    property's slug is not a host at all, so the trend file's key cannot be
    used directly. One site on the property: that site. Several: the host of
    the page with the most impressions for that query in the 90-day
    query x page pull, falling back to the first configured site.
    """
    owners = [s for s in seo_config.sites() if s.get("gscProperty") == prop]
    if not owners:
        return lambda q: seo_config.gsc_slug(prop)  # a bare host is the best we have
    if len(owners) == 1:
        return lambda q: owners[0]["host"]
    by_gsc_host = {s["gscHost"]: s["host"] for s in owners}
    best = {}
    qp = seo_config.DATA / "gsc" / seo_config.gsc_data_slug(prop) / "query_page_90d.json"
    try:
        for r in json.loads(qp.read_text()).get("rows", []):
            q, page = r["keys"][0], r["keys"][1]
            h = page.split("/")[2] if page.count("/") >= 2 else ""
            if h in by_gsc_host and r["impressions"] > best.get(q, (0, ""))[0]:
                best[q] = (r["impressions"], by_gsc_host[h])
    except (OSError, json.JSONDecodeError, KeyError, IndexError):
        pass
    return lambda q: best.get(q, (0, owners[0]["host"]))[1]


def main():
    # 1. refresh trends (also keeps the /insights tables current)
    if seo_config.gsc_properties() or seo_config.ga4_properties():
        r = subprocess.run([sys.executable, str(ROOT / "ingest" / "analyze_trends.py")],
                           capture_output=True, text=True)
        if r.returncode != 0:
            last = (r.stderr or r.stdout).strip().splitlines()
            print("trend refresh failed:", last[-1][:200] if last else "(no output)",
                  "— using the latest trends file on disk")

    trends = latest_trends()
    if not trends:
        print("no trends file — scan aborted (run ingest/analyze_trends.py once data exists)")
        return 1
    actions = queue()

    queue_text = " || ".join(
        f"{a.get('title','')} :: {a.get('why','')} :: {' '.join(a.get('spec', []))}" for a in actions
    ).lower()
    active = [a for a in actions if not a.get("watching")]
    watching = [a for a in actions if a.get("watching")]

    # 2. scripted candidate detection: uncovered risers
    candidates = []
    for site, d in trends.get("sites", {}).items():
        host_for = _host_resolver(site)
        for m in d.get("rising", []):
            if m["recent_imps"] < RISE_MIN_IMPS:
                continue
            if m["prior_imps"] and m["recent_imps"] / max(1, m["prior_imps"]) < RISE_MIN_RATIO:
                continue
            if m["query"].lower() in queue_text:
                continue  # already covered by an action
            candidates.append({"host": host_for(m["query"]), **m})
    candidates.sort(key=lambda c: -c["recent_imps"])
    candidates = candidates[:12]

    run_inference = (bool(candidates) or date.today().weekday() == 0) and llm.available()
    out = {"generated": date.today().isoformat(), "candidates": candidates,
           "proposals": [], "verdicts": [], "inference_ran": False}

    if run_inference:
        prompt = (
            "You are the SEO strategist for a small portfolio of websites: "
            + portfolio_description() + ". "
            "Growth levers available: new/updated pages, titles/meta, internal links, llms.txt/AI-crawler surface, "
            "distribution (communities, newsletters, directories). No paid ads.\n\n"
            "UNCOVERED RISING QUERIES (84d vs prior 84d, none matched by existing queue actions):\n"
            + json.dumps(candidates, indent=1)
            + "\n\nEXISTING ACTIVE QUEUE (titles only — do NOT duplicate):\n"
            + json.dumps([a.get("title") for a in active], indent=1)
            + "\n\nWATCHING ITEMS (shipped work + status note; judge each against its note):\n"
            + json.dumps([{"title": a.get("title"), "note": a.get("watching"), "why": a.get("why", "")} for a in watching], indent=1)
            + "\n\nReturn STRICT JSON only, no prose, matching exactly:\n"
            '{"proposals":[{"host":"...","title":"...","kind":"...","why":"... (cite the query numbers)",'
            '"how":"...","spec":["..."],"impact":<int clicks/mo estimate>,"effort":"S|M|L","tag":"content|striking|metadata|distribution|hygiene"}],'
            '"verdicts":[{"title":"<exact watching title>","verdict":"succeeded|failed|keep-watching","evidence":"..."}]}\n'
            "Rules: 0-4 proposals, only where the rising-query evidence genuinely supports a concrete move; "
            "each proposal must name real pages/URLs in spec; impact is an ordering estimate, not a forecast — be conservative; "
            "verdicts only where the data above lets you judge — otherwise keep-watching with a one-line reason."
        )
        raw = llm.infer(prompt) or ""
        m = re.search(r"\{.*\}", raw, re.S)
        if m:
            try:
                parsed = json.loads(m.group(0))
                out["proposals"] = [x for x in parsed.get("proposals", [])
                                    if x.get("title") and x.get("host") and x.get("spec")]
                out["verdicts"] = parsed.get("verdicts", [])
                out["inference_ran"] = True
            except json.JSONDecodeError:
                print("inference returned unparseable JSON — kept candidates only")
        else:
            print("inference produced no JSON — kept candidates only")
    elif candidates and not llm.available():
        print("llm module off — candidates recorded without proposals")

    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "opportunity-proposals.json").write_text(json.dumps(out, indent=1))
    print(f"candidates: {len(candidates)} | proposals: {len(out['proposals'])} | "
          f"verdicts: {len(out['verdicts'])} | inference: {out['inference_ran']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
