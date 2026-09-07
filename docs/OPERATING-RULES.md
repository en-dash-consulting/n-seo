# Operating rules

These are the rules the tooling encodes and the docs keep repeating. Each one
exists because the opposite was tried and cost something. An agent working in
this repo is bound by them too (see `CLAUDE.md`).

## The queue is the single source of "what's next"

`config/backlog.json` merged with the data-derived rules, shown on `/actions`
and via the MCP `list_actions` tool. New findings become entries with
evidence and a spec. Shipped work gets a `watching` note. Corrections from the
owner are applied immediately.

**Why:** the moment "what's next" lives in three places — a doc, a chat, a
head — the data stops deciding and recency does.

## Shipped work becomes *watching*; it is never deleted

When an action ships, set `watching` to a dated note ("title trimmed 3/14,
frozen until 4/11, watching CTR") and add the page to `shippedWatch` so the
data-derived cards for that page show as watching too.

**Why:** the point of the change was to move a number. If the item disappears
you never learn whether it did, and the same page gets "fixed" again in six
weeks by someone reading the same CTR gap.

## Decisions ride the 90-day window

Rules, audits and rankings read the `*_90d.json` files and the 90-day
metadata audit. The 16-month pull is for totals and history only.

**Why:** a page fixed last week must stop being accused within a season.
Sixteen-month aggregates keep a dead query cluster looking alive and a fixed
page looking broken.

## Impact numbers order the queue. They are not forecasts

Every action carries an impact estimate (clicks per month). It exists so
that impact ÷ effort can sort the list. It is not a prediction, and it is
never reported as an expected result. When observed data exists for a
shipped item, recalibrate against it.

**Why:** the estimates are rough by construction (industry CTR curves ×
impressions). Treating them as promises leads to disappointment on the
misses and over-investment on the flukes.

## Title-change freeze: 28 days

After rewriting a page's title or description, do not touch that page's
metadata again for 28 days. Measure, then move.

**Why:** search engines re-evaluate a page after a title change and need
weeks of impression data to settle. Iterating inside that window destroys
the measurement and, at scale, reads as manipulation.

## Stagger metadata batches: ≈8 per week across all sites

Even when the audit lists 25 pages with title problems, ship about eight a
week.

**Why:** a burst of simultaneous title changes across a site is a churn
pattern that invites re-evaluation of the whole site rather than the pages
you changed. Batching also keeps the 28-day freezes from all expiring on the
same day, which is what makes weekly measurement readable.

## Proposals never self-promote into the queue

The opportunity scan writes `data/opportunity-proposals.json`. Its proposals
show on `/actions` as *proposed* until you click accept (or add them to the
backlog by hand). Its verdicts on watching items (succeeded / failed /
keep-watching) are review triggers, not actions.

**Why:** a machine adding items to its own to-do list has no brake. Keeping
the accept step human keeps the queue something you believe in.

## Participation is human

The Hacker News and Reddit modules find threads where your first-hand
experience applies and write a briefing: what the piece says, what the
thread is debating, where you genuinely connect. They never draft the
comment, and neither should any agent using this repo. Sustainable pace is
two to four genuine comments a day.

**Why:** generated participation is detectable, against the rules of the
communities involved, and a ban destroys the account history that makes
your own launches land later. The briefing gets you to the thread fast; the
words are what make it worth being there.

## Site changes ship as branches and PRs

Changes to your sites go into an `seo-*` branch off freshly pulled main in
the site's own repo, pushed, and reviewed as a PR. Never direct to main. If a
checkout has uncommitted work, use a git worktree rather than touching it.

**Why:** the change log is how movement gets attributed. A PR with the queue
item's evidence in its description is the record that lets the next daily
run say "this moved because of that."

## Read the outputs; don't re-derive them

The daily run pulls, probes, audits and logs. To answer "how are we doing,"
read `docs/daily-log.md`, `data/last-run.json` and the dashboard — do not
re-run the pipeline, re-crawl the sites, or recompute the trends.

**Why:** each re-run spends API quota and time to reproduce a file that
already exists, and it invites two versions of the truth.
