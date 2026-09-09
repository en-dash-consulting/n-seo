---
name: n-seo-ship
description: Implement one card from the n-seo queue in the site's own repo and record it as watching. Use when someone picks an action to do. Enforces the 28-day metadata freeze and the weekly batch limit.
---

# Ship one queue card

One card, one branch, one PR, then record it. If the owner has not named a
card, run `/n-seo-triage` first and let them choose.

```sh
E=<engine checkout>/bin/n-seo.mjs
I=<instance dir>
PORT=$(python3 -c "import json;print(json.load(open('$I/n-seo.config.json'))['port'])" 2>/dev/null || echo 4600)
```

## 1. Read the whole card

```sh
curl -s "http://localhost:$PORT/api/actions" | python3 -m json.tool
```

Or MCP `get_action` with a title substring. Use `spec` — it names the page,
the target queries, the shape of the change and the success criterion. Note
`id`, `host`, `tag` and whether it is rule-derived or curated (`source`).

## 2. Freeze and batch check — STOP HERE IF EITHER FAILS

Only for cards that change a title or meta description (`tag` of `metadata`
or `ctr-gap`, or any card whose `how` rewrites metadata):

1. **28-day freeze.** Look up the page in `shippedWatch` and in the dated
   `watching` notes in `$I/config/backlog.json`. If its metadata changed
   within 28 days, **stop and ask.** Say when the window opens. Iterating
   inside it destroys the measurement the last change was making.
2. **Weekly batch.** Count metadata changes already recorded this week across
   every site. At roughly eight, **stop and ask** before adding another.

Content additions, internal links, schema, and hygiene fixes are not metadata
changes and are not limited by either rule — but a page inside its freeze
still gets no title or description edit while you are in there.

## 3. Work in the site's repo, never in the instance

The site's code is in its own repository (`repo` on the site's page and in
the config). The instance holds config and content only.

```sh
cd <site repo>
git status --porcelain          # if dirty, use a worktree; never touch uncommitted work
git checkout main && git pull
git checkout -b seo-<short-slug>
```

If the checkout is dirty, `git worktree add ../<repo>-seo-<slug> -b seo-<slug>`
and work there instead.

Make exactly what the spec describes. For the common kinds:

- **Metadata fix / CTR gap** — the `<title>` restates the ranking query as its
  answer, front-loaded, under about 60 characters. The description is one
  ~150-character sentence that answers the query directly. Metadata only.
- **Striking distance ("push to page 1")** — a section that answers the target
  queries verbatim: an H2 phrased as the query, then a 40–60 word direct
  answer, then detail. Two or three internal links to the page from related
  pages using the query as anchor text.
- **Engagement mismatch** — rewrite the opening so it delivers what the click
  promised; keep the URL.
- **Hygiene** — robots.txt, sitemap, `llms.txt`, real 404s, unblocking AI
  crawlers, server-rendering the shell. Verify with
  `node $E daily --instance "$I" --only probe` after deploy.

## 4. Verify before opening the PR

Run whatever the site repo uses (build, tests, lint). Check the rendered page
locally. Confirm the change is actually in the served HTML, not only in
source — the metadata audit reads the live page.

Push and open a PR whose description carries the card's evidence: the queries,
the numbers, the success criterion. That description is how the next daily run
gets attributed. Never push to `main` directly.

## 5. Record it — the step people skip

After it is merged and live:

**Mark the card watching** with a dated note saying what changed and what you
are waiting for:

```sh
curl -sX POST "http://localhost:$PORT/api/backlog/<id>/watch" \
  --data-urlencode "note=title rewritten for the widgets cluster, frozen until <date>, watching CTR"
```

The endpoint prefixes today's date. Rule-derived cards have no backlog entry
to write to — for those, add the page to `shippedWatch` in
`$I/config/backlog.json` instead, with the same dated note, so the card shows
as watching rather than reappearing as new work:

```json
"shippedWatch": {
  "https://example.com/pricing": "2026-05-04: title rewritten, frozen until 2026-06-01, watching CTR"
}
```

**Add the page to `watchPages`** in `n-seo.config.json` if it is not there, so
its numbers appear in every daily-log entry.

Do not delete the card. Shipped work becomes watching; deleting it is how the
same page gets "fixed" again in six weeks by someone reading the same gap.

## 6. Report

Say what shipped, the PR link, the success criterion, and the date the freeze
lifts. The next runs decide whether it worked.

## Never

- Never edit `config/backlog.json` except to add a `shippedWatch` entry or via
  the accept / watch / retire endpoints.
- Never touch a page inside its freeze window without the owner saying so.
- Never commit a secret, and never push to a site's `main`.
