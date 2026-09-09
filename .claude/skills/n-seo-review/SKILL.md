---
name: n-seo-review
description: The weekly n-seo pass — what shipped, what moved, judge each watching item succeeded/failed/still cooking, retire what is done, refresh the insights briefing. Use for a weekly or monthly review.
---

# Weekly review

The loop only closes here. Shipped work sits in *watching* until someone
reads the data and says whether it worked.

```sh
E=<engine checkout>/bin/n-seo.mjs
I=<instance dir>
PORT=$(python3 -c "import json;print(json.load(open('$I/n-seo.config.json'))['port'])" 2>/dev/null || echo 4600)
```

Read the outputs; do not re-run the pipeline to review it.

## 1. Gather

```sh
cat "$I/data/last-run.json"                       # were the runs healthy this week
sed -n '/^## /,$p' "$I/docs/daily-log.md" | tail -120   # the week's entries
curl -s "http://localhost:$PORT/api/actions"      # or MCP list_actions status=watching
cat "$I/data/opportunity-proposals.json"          # verdicts + proposals
```

Also useful: MCP `trends_timeseries` for a page-level before/after, and
`git log --oneline --since='1 week ago'` in each site repo for what actually
shipped.

## 2. Judge every watching item

For each item with a `watching` note, find its page in the daily-log lines
across the week and compare against the note's own success criterion — CTR,
position, impressions, sessions, engagement, whichever the card named.

Assign one of three, and write the evidence next to it:

- **Succeeded** — the criterion is met. Say by how much.
- **Failed** — the window has passed and the number did not move, or moved the
  wrong way. Say what the data shows and propose the next move; a failed
  metadata change is a candidate for a different angle, not a repeat.
- **Still cooking** — the 28-day window has not closed, or impressions are too
  thin to read. Leave it and note when to look again.

The scan's own verdicts in `opportunity-proposals.json` are *review triggers*,
not conclusions. Read them, then judge from the data yourself.

Beware a page whose demand collapsed for reasons unrelated to the change —
falling query volume in the trends file means the fix can be fine while the
number still drops. Say that rather than scoring it failed.

## 3. Retire what is done

Only after it is judged succeeded, and only when there is nothing left to
watch:

```sh
curl -sX POST "http://localhost:$PORT/api/backlog/<id>/retire"
```

For a *failed* item, do not retire it. Either update its `watching` note with
what you learned and the next move, or replace it with a new card carrying
that evidence.

For rule-derived cards, remove or update the page's entry in `shippedWatch`
in `$I/config/backlog.json` — dropping the entry lets the card return as
active work if the underlying gap is still there, which is usually what you
want after a failure.

## 4. Sweep the rest

- **Proposals** — present each with its evidence; accept the good ones
  (Accept on `/actions`, or `POST /api/backlog/accept` with `index`) and say
  plainly which you are ignoring and why. Never accept silently.
- **Health** — probe regressions and index-coverage problems from the log.
  Pages Google has never crawled are a different problem from pages nobody
  searches for; the `/indexing` page separates them.
- **Freezes expiring** — list pages whose 28-day window closes in the coming
  week. Those are next week's metadata budget.
- **Conversions** — if `conversions` is configured, whether events are
  arriving (`conversions_status`).

## 5. Refresh the briefing if the picture changed

`$I/config/insights.json` is the hand-written narrative on `/insights`:
`{ "date": "YYYY-MM-DD", "insights": [ { "title", "verdict", "body": [], "move" } ] }`
with `verdict` one of `opportunity`, `warning`, `momentum`, `deprioritize`.

Rewrite it only when the picture actually changed — a new rising cluster, a
collapsing one, a bet that paid off. Update `date` when you do. Leave it alone
in a quiet week rather than churning it.

## 6. Write the summary

Short, for the owner:

- **Shipped this week** — what, and the verdict where the data allows one.
- **Moved** — the numbers that changed, with the caveat where demand shifted.
- **Next week** — the top few, with the metadata budget already applied.
- **Needs you** — proposals to accept, approvals, anything blocked.

Impact numbers order the queue; they are never reported as expected results.
Recalibrate them against what you just observed if a card's estimate was
clearly wrong.
