# seo-agent — operating rules for agents working in this repo

This repo is a local search-ops control plane. Read README.md and
docs/OPERATING-RULES.md before substantive work; docs/ARCHITECTURE.md has the
file layout and data shapes. Start every fresh session with the `orient`
skill — it reads current state from the running system instead of
re-deriving it from raw data.

## Hard rules

- **The queue is the single source of "what's next."** It lives in
  `config/backlog.json` merged with data-derived rules. Read it via
  `GET /api/actions` or the MCP `list_actions` tool. Do not write to
  `config/backlog.json` except through the documented flow (the dashboard's
  accept / watch / retire buttons) or with the owner's explicit, per-item
  approval. Shipped work gets a `watching` note; it is never deleted.
- **Proposals never self-promote.** `data/opportunity-proposals.json` is
  machine output awaiting a human. Verdicts of succeeded/failed are review
  triggers, not actions.
- **Title-change freeze.** After any page's title or description changes,
  leave that page's metadata alone for 28 days. Title churn reads as
  manipulation and resets the search engine's evaluation. Measure, then move.
- **Stagger metadata batches.** At most about 8 title/description changes
  per week across all sites.
- **Impact numbers order the queue. They are not forecasts.** Never report
  them as expected results.
- **Decisions ride the 90-day window** (`*_90d.json`, the metadata audit).
  16-month data is for totals and history only.
- **Never generate community participation text.** No HN comments, no Reddit
  comments, no forum posts, no "suggested wording." Briefings, research and
  thread-finding only. This is what keeps the owner's accounts credible.
- **Site changes ship as branches and PRs** in the site repos, off freshly
  pulled main. Never commit directly to main. If a checkout is dirty, use a
  git worktree; never touch the owner's uncommitted files.
- **Don't re-run pulls to answer status questions.** The daily run refreshes
  everything; read `data/`, `docs/daily-log.md`, and `data/last-run.json`.
- **Secrets stay out of the repo.** The service-account key, `.env`, and the
  MCP token live outside version control. Never copy them in, print them, or
  commit them.

## Frequent commands

```sh
npm start                          # dashboard on the configured port (default :4600)
npm run typecheck
python3 ops/daily.py               # full daily run; --only / --skip / --list
python3 ops/doctor.py              # setup checker
python3 ops/demo_data.py           # synthetic dataset
python3 ingest/google_auth.py      # auth smoke test
python3 ingest/analyze_trends.py   # fresh 84-day trend analysis (feeds /insights)
npm run mcp:smoke                  # MCP server check
```

If the dashboard runs as a launchd service, restart it after code changes:
`launchctl kickstart -k gui/$(id -u)/com.seo-agent.dashboard`.

## Design language

Flat cards with hairline borders; no one-sided accent borders. Dashboards
lead with actionable content, stay compact and searchable, and split Active
from Watching clearly. Light and dark themes both have to work.
