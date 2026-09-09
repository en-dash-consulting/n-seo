---
name: n-seo-triage
description: Answer "what should I work on today" from an n-seo instance — the ranked queue, the last run, and the scan proposals, with the evidence and the operating rules applied. Use for any status or what-next question.
---

# Triage — what to do today

Read the system's outputs. **Do not re-run pulls, re-crawl sites, or
recompute trends to answer a status question** — the daily run already
produced all of it, and a re-run spends quota to reproduce a file that exists.

```sh
E=<engine checkout>/bin/n-seo.mjs
I=<instance dir>
PORT=$(python3 -c "import json;print(json.load(open('$I/n-seo.config.json'))['port'])" 2>/dev/null || echo 4600)
```

## 1. Trust the data before you use it

```sh
cat "$I/data/last-run.json"        # ts, failures, per-step timing
```

Or the MCP `ops_status` tool, which adds dataset staleness and probe results.
If `failures` is non-empty, **say so first** — the numbers below are stale in
whatever the failing step feeds. `data/daily-ops.log` has the reason.

## 2. Read the queue

```sh
curl -s "http://localhost:$PORT/api/actions"
```

Or MCP `list_actions` (`status: active`, optional `host`, `tag`, `limit`),
which returns the same ranked list. If the dashboard is not running, start it
(`node $E start --instance "$I"`) or read `config/backlog.json` plus the
rule-derived cards from the MCP server.

Each action carries `impact`, `effort`, `why` (the evidence), `how`, `spec`,
`tag`, and `watching` when it has shipped. Ranking is impact ÷ effort weight.

## 3. Read what happened lately

```sh
tail -30 "$I/docs/daily-log.md"                 # or MCP daily_log
cat "$I/data/opportunity-proposals.json"        # or MCP opportunity_proposals
```

The log gives probe health, the watched pages' numbers, the conversions line
and cross-referrals. The proposals file gives rising queries no card covers,
machine proposals awaiting accept, and verdicts on watching items.

## 4. Apply the rules before recommending

- **28-day freeze.** A page whose title or description changed inside 28 days
  is off limits for another metadata change. Check `shippedWatch` in
  `config/backlog.json` and the dated `watching` notes for the page.
- **≈8 metadata changes a week across all sites.** Count what has already
  shipped this week from the recent `watching` notes before proposing more.
  If the audit lists twenty, recommend the top few, not the list.
- **Impact orders, it does not forecast.** Never present an impact number as
  an expected result. "Ranked highest" not "will earn 60 clicks."
- **Decisions ride the 90 days.** Cite the 90-day figures the cards use, not
  16-month totals.
- **Proposals are not queue items** until accepted.

## 5. Answer

Short, ranked, evidence attached. For each recommendation:

- the move, in one line;
- the numbers behind it, from the card's `why`;
- why now (freeze expired, riser, regression, seasonal window);
- what it costs (`effort`).

Then, separately and briefly:

- **Blocked or broken** — failing steps, probe regressions, index problems.
- **Waiting on the owner** — scan proposals to accept or ignore, drafts whose
  status contains `approval`.
- **Watching** — shipped work whose window is closing, and what the data says
  so far. Verdicts of *succeeded* or *failed* are review triggers; hand them
  to `/n-seo-review` rather than acting on them here.

## Stay inside the lines

- Do not write to `config/backlog.json` here. Triage reads.
- Do not draft comments for Hacker News or Reddit. The digests brief; the
  human writes. Point at the briefing and stop.
- Do not enable modules or change settings as part of answering.
