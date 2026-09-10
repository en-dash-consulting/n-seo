# n-seo — Product Requirements

This is the product definition the PRD tree in `.rex/` is generated from and
kept in sync with. It states what n-seo is for, who it serves, what it
deliberately does not do, and the capabilities that exist or are planned.
Each feature lists acceptance criteria in the form a test or a reviewer can
check. Status markers: **[shipped]**, **[planned]**, **[idea]**.

## Purpose

n-seo is a local-first control plane for organic growth across one or more
websites: classic search (SEO), answer engines (AEO) and generative engines
that cite sources (GEO). It replaces the monthly agency read-out with a loop
that runs every morning on the owner's machine: pull Search Console and GA4,
probe the live sites, turn the data into a ranked queue of concrete actions
with evidence attached, and measure yesterday's changes.

## Users

- **A site owner or small team** who wants to hone their own SEO practice
  without paying an agency: developers, indie makers, consultancies, small
  businesses with a technical person.
- **An operator running several sites** (a portfolio, an agency serving its
  own clients) who needs one queue across all of them.
- **An AI agent** (Claude Code, Claude Desktop, any MCP client) acting for
  the owner, which needs the same data in machine-readable form and must not
  be able to bypass the owner's approval gates.

## Principles (non-negotiable)

1. **Local-first.** All data lives in files on the owner's machine. The only
   outbound calls are to Google APIs the owner authorized and to a local LLM
   command the owner configured.
2. **It briefs; it never acts on the owner's behalf.** No module posts,
   sends, publishes, or edits a site. Community modules produce briefings,
   never comment text.
3. **Evidence before advice.** Every action shows the numbers behind it,
   then the move, then a spec and a success criterion.
4. **Encoded operating rules.** 28-day metadata freeze; ≈8 metadata changes
   per week; decisions on the trailing 90 days, 16 months for history; impact
   orders the queue and is never reported as a forecast; shipped work becomes
   *watching*, never deleted; machine proposals never self-promote.
5. **Upgradeable.** An instance (config, queue, content, data) is separable
   from the engine so an upgrade is a pull, not a merge.
6. **Stdlib Python, no-bundler TypeScript, no pip installs**, so "clone and
   run" is literally true.

## Non-goals

- Not a rank tracker or keyword-research SaaS; it reads what Google already
  reports about the owner's own sites.
- Not an auto-publisher, link builder, or comment bot.
- Not a hosted product; there is no account and no server-side component
  beyond an optional static mirror the owner hosts.
- Windows is not a target (WSL likely works; untested).

---

# Epic: Configuration and Google access [shipped]

## Feature: One config file for every component [shipped]

`n-seo.config.json` (path overridable by `N_SEO_CONFIG`) is read by the
TypeScript app and every Python script; the example file is the fallback so
a fresh checkout runs.

- Acceptance: adding a site to `sites[]` makes it appear in every pull,
  probe, audit, page and export with no other edit.
- Acceptance: both loaders derive the same `data/gsc/<slug>` from a property
  (`sc-domain:` and url-prefix forms).
- Acceptance: unknown keys are preserved when the Settings page saves.

## Feature: Service-account auth without gcloud [shipped]

- Acceptance: with only a service-account JSON key, `n-seo doctor` mints a
  token and lists accessible properties. No gcloud, no pip install and no
  openssl binary: the JWT is signed with node's crypto module, which the
  dashboard already requires.
- Acceptance: gcloud impersonation and gcloud user modes remain selectable.
- Acceptance: `ops/doctor.py` reports the exact email to add in Search
  Console and GA4 and which configured properties are not yet accessible.

# Epic: Ingest [shipped]

## Feature: Search Console pulls [shipped]

- Acceptance: per property, `queries`, `pages`, `query_page`, `dates` for the
  16-month window and `*_90d` for the trailing 90 days; transient failures
  retried; a 4xx fails loudly.
- Acceptance: `gscExtraProperties` are pulled into `data/gsc/<slug>` without
  appearing in the UI.

## Feature: GA4 pulls [shipped]

- Acceptance: `daily`, `sources`, `landing` per configured property id; a
  `funnel` report only for `conversions.site`, falling back when the custom
  dimension is unregistered.

## Feature: Time series, index coverage, metadata audit, trend analysis [shipped]

- Acceptance: date × page series for 180 days from both sources.
- Acceptance: URL Inspection verdict for every sitemap URL (sitemap indexes
  followed one level, ≤400 URLs/host), with sitemap submission state.
- Acceptance: metadata audit flags title/query mismatch, CTR below position
  expectation, missing/short/duplicate descriptions, long titles.
- Acceptance: trend file with branded/generic split, rising/falling queries
  (84d vs prior 84d), monthly trajectory and AI-referral sessions by month.

# Epic: Live-site probe [shipped]

- Acceptance: robots.txt (incl. AI-crawler disallows), sitemap.xml, llms.txt
  and llms-full.txt, homepage metadata/JSON-LD/visible-text bytes, and a real
  404 check, per configured host, written as a timestamped snapshot.
- Acceptance: the daily diff raises an ALERT line on any regression versus
  the previous snapshot.

# Epic: Action engine [shipped]

- Acceptance: six rules over the 90-day window (metadata findings, CTR
  gaps, striking distance, probe hygiene, engagement mismatch, traffic drop)
  produce actions with id, host, title, kind, why, how, spec[], impact,
  effort, tag, source.
- Acceptance: ranking is impact / effort weight (S=1, M=2.5, L=5).
- Acceptance: metadata findings suppress CTR-gap cards on the same page.
- Acceptance: pages in `shippedWatch` render as *watching*.
- Acceptance: `config/backlog.json` is merged and hot-reloaded without a
  restart, and a syntax error keeps the last good queue.

## Feature: Rule thresholds in config [planned]

Move the numeric thresholds (min impressions, position band, engagement
floor, drop percentage, effort weights) into an optional `rules` block of
the config with the current values as defaults.

- Acceptance: every threshold has a documented default and a config
  override; tests cover an override changing a rule's output.

# Epic: Dashboard [shipped]

- Acceptance: routes `/`, `/actions`, `/insights`, `/trends[/N]`,
  `/content`, `/drafts/:slug`, `/campaigns/:slug`, `/site/:host`,
  `/indexing`, `/probes`, `/logs`, `/settings`, `/api/actions` all render
  from demo data with no server error.
- Acceptance: Today board groups Fix / Approve / Publish / Comment / Ship;
  Comment appears only when a participation module is enabled.
- Acceptance: proposals can be accepted into the backlog; backlog items can
  be marked watching or retired; rule-derived items expose no write buttons.
- Acceptance: the server binds 127.0.0.1 by default and rejects cross-origin
  POSTs.
- Acceptance: light and dark themes; no external fonts.

## Feature: Settings page [shipped]

- Acceptance: toggles every module, edits digest topics, expertise, watch
  pages and conversions, and writes the config file (creating it from the
  example on first save); invalid topic lines are rejected with a message.

## Feature: Custom pages and rules in instance mode [idea]

Allow an instance to register extra routes and rules without forking the
engine (e.g. `instance/src/extensions.ts`).

# Epic: Modules (opt-in) [shipped]

- Acceptance: each of indexStatus, metadataAudit, opportunityScan, llm,
  hackerNews, reddit, indexNow, staticExport, gitAutoCommit, notifications is
  gated by `modules.<key>.enabled`; a disabled digest exits 0 with a message.
- Acceptance: the LLM module runs any command that reads a prompt on stdin;
  when unavailable, the scan records candidates only and digests skip
  briefings.
- Acceptance: briefing prompts forbid generating comment text.

## Feature: HTTP LLM adapter [planned]

Optional adapter that calls an OpenAI-compatible or Anthropic HTTP endpoint
instead of a CLI, with the key read from `.env`.

## Feature: Bing Webmaster ingest [idea]

## Feature: Core Web Vitals via CrUX [idea]

# Epic: Daily run and scheduling [shipped]

- Acceptance: `ops/daily.py` waits for the network, runs the enabled steps
  in order, retries a failed step once, tees output to `data/daily-ops.log`,
  writes `data/last-run.json` with per-step timing, honours `--only`,
  `--skip`, `--list`, `--no-network-wait`, and exits 1 on any failure.
- Acceptance: hooks (`beforeRun`, `afterRun`, `afterStep`) run in the
  instance directory and are logged like steps without aborting the run.
- Acceptance: launchd, cron and systemd templates plus an installer script.

# Epic: MCP server [shipped]

- Acceptance: stdio transport with no secret; HTTP transport that returns
  503 with no token configured and compares tokens in constant time.
- Acceptance: every tool is annotated read-only; tools cover the queue, a
  single action, sites, per-site report, top queries, striking distance, CTR
  gaps, metadata audit, time series, ops status, daily log, proposals,
  conversions, campaigns, settings and engine info; docs exposed as
  resources.

# Epic: Engine and instance [shipped]

- Acceptance: `N_SEO_INSTANCE` relocates every instance-owned path; in-place
  mode is unchanged when it is unset.
- Acceptance: `n-seo init|start|dev|daily|doctor|demo|mcp|check|export|
  upgrade|version` behave as documented in `docs/INSTANCE.md`.
- Acceptance: `n-seo upgrade` refuses to leave the engine on a commit that
  fails `npm run check` without printing the rollback command.

## Feature: Publish the engine to npm [planned]

- Acceptance: `npm i n-seo` installs a working engine; `npx n-seo init`
  scaffolds an instance; the `files` list excludes tests and the marketing
  site.

## Feature: Scheduled upgrade with gate [planned]

A documented weekly job (`n-seo upgrade`) with notification on failure, so
instances exercise the upgrade path routinely.

# Epic: Quality [shipped]

- Acceptance: `npm run check` runs typecheck, TypeScript tests (sandboxed
  copy) and Python tests; CI runs both suites, a demo-data dashboard smoke,
  `doctor --offline`, and a grep that fails on any private name.

# Epic: Onboarding and docs [shipped]

- Acceptance: `npm run demo` populates every page with synthetic data before
  any Google setup.
- Acceptance: README quickstart, SETUP-GOOGLE, SCHEDULING, ADDING-A-SITE,
  INSTANCE, MCP, OPERATING-RULES, PLAYBOOK, FAQ, CONTRIBUTING, SECURITY,
  CHANGELOG exist and match the CLI contracts.

## Feature: Interactive setup wizard [idea]

`n-seo init --guided`: asks for hosts, property ids and the key path, then
runs doctor.

# Epic: Marketing site [shipped]

- Acceptance: `www/` is a single static page deployed by the Pages workflow,
  with OG image, `llms.txt`, robots and sitemap; copy names the three
  promises (local data, evidence first, briefs-not-acts) and the operating
  rules.

## Feature: Custom domain [planned]

`www/CNAME` and URL updates once a domain is chosen.
