# n-seo — Product Requirements

This is the product definition the PRD tree in `.rex/` is generated from and
kept in sync with. It states what n-seo is for, who it serves, what it
deliberately does not do, and the capabilities that exist or are planned.
Each feature lists acceptance criteria in the form a test or a reviewer can
check. Status markers: **[shipped]**, **[planned]**, **[idea]**.

Some capabilities are stated as epic-level acceptance criteria rather than as
their own `## Feature:` section — the epic *is* the capability, and splitting
it would add a heading without adding a claim. Those still appear as features
in the `.rex/` tree, which needs a node to schedule work against. The two
files agree on what exists and on its status; the tree is simply finer-grained
in places.

## Purpose

n-seo is a local-first control plane for organic growth across one or more
websites: classic search (SEO), answer engines (AEO) and generative engines
that cite sources (GEO). It replaces the monthly read-out with a loop
that runs every morning on the owner's machine: pull Search Console and GA4,
probe the live sites, turn the data into a ranked queue of concrete actions
with evidence attached, and measure yesterday's changes.

## Users

- **A site owner or small team** who wants to run their own search practice
  and understand it: developers, indie makers, consultancies, small businesses
  with a technical person. Note that agencies and consultancies are users
  here, not the thing being displaced — the copy should never imply otherwise,
  and the tool is as useful to someone doing this for clients as for
  themselves.
- **An operator running several sites** (a portfolio, an agency serving its
  own clients) who needs one queue across all of them.
- **An AI agent** (Claude Code, Claude Desktop, any MCP client) acting for
  the owner, which needs the same data in machine-readable form and must not
  be able to bypass the owner's approval gates.

## Principles (non-negotiable)

1. **Local-first.** All data lives in files on the owner's machine. The only
   outbound calls are to Google APIs the owner authorized, the LLM provider
   the owner configured, and — once per daily run, from the `updateCheck`
   module — a public registry query for the engine's own latest version. That
   last one is the only thing enabled by default that talks to a third party;
   it sends nothing about the instance and is disabled in one line. The
   dashboard itself never makes a network request, so every page renders with
   the machine offline.
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
- Not a hosted control panel for other people's sites; one owner, one
  instance, their own credentials.

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

# Epic: Ingest and site health [shipped]


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

## Feature: Time series, index coverage, metadata audit and trend analysis [shipped]

- Acceptance: date × page series for 180 days from both sources.
- Acceptance: URL Inspection verdict for every sitemap URL (sitemap indexes
  followed one level, ≤400 URLs/host), with sitemap submission state.
- Acceptance: each coverage state renders with what it means, what to do
  about it, and whether Request Indexing helps — true only where Google has
  formed no judgement on the content (unknown, discovered-never-crawled),
  false where it fetched and declined (soft 404, crawled-not-indexed).
- Acceptance: metadata audit flags title/query mismatch, CTR below position
  expectation, missing/short/duplicate descriptions, long titles.
- Acceptance: trend file with branded/generic split, rising/falling queries
  (84d vs prior 84d), monthly trajectory and AI-referral sessions by month.

## Feature: No-auth health probe with regression alerts [shipped]


- Acceptance: robots.txt (incl. AI-crawler disallows), sitemap.xml, llms.txt
  and llms-full.txt, homepage metadata/JSON-LD/visible-text bytes, and a real
  404 check, per configured host, written as a timestamped snapshot.
- Acceptance: the daily diff raises an ALERT line on any regression versus
  the previous snapshot.

# Epic: Action engine and profiles [shipped]


- Acceptance: six rules over the 90-day window (metadata findings, CTR
  gaps, striking distance, probe hygiene, engagement mismatch, traffic drop)
  produce actions with id, host, title, kind, why, how, spec[], impact,
  effort, tag, source.
- Acceptance: ranking is impact / effort weight (S=1, M=2.5, L=5).
- Acceptance: metadata findings suppress CTR-gap cards on the same page.
- Acceptance: pages in `shippedWatch` render as *watching*.
- Acceptance: `config/backlog.json` is merged and hot-reloaded without a
  restart, and a syntax error keeps the last good queue.

## Feature: Profiles — a method you can install [shipped]

n-seo ships one operating model; a practitioner has their own. A **profile**
packages thresholds, policy numbers and module defaults so a method can be
published once and installed many times. Full reference: `docs/PROFILES.md`.

- Acceptance: `"profile": "<built-in | path | package>"` resolves in that
  order, and every value remains overridable by the instance.
- Acceptance: a profile that cannot be resolved fails the load with a message
  naming each location tried, rather than falling back to the defaults.
- Acceptance: `n-seo profile` prints the active profile and every value this
  instance overrides; the Settings page shows the same, and `doctor` reports
  an unresolvable profile before the daily run reaches it.
- Acceptance: the TypeScript and Python loaders resolve every shipped profile
  to identical numbers, asserted by a test that runs both.
- Acceptance: `default`, `patient` and `aggressive` ship with the engine, and
  `default` restates the engine defaults exactly — asserted, so the two cannot
  drift.
- Acceptance: `rules.priorities` reweights or drops queue cards by host,
  path, tag or kind; a matched card carries the reason in its spec and a
  *reweighted* chip; a priority with no `why` or no conditions is ignored; a
  bad regex or a nonsense multiplier is ignored rather than throwing or
  corrupting the sort.
- Acceptance: a priority can never create a card. Everything in the queue
  still came from data.
- Acceptance: `principles` carries the part of a method that is not a number —
  a title, a body, and a kind. `hard` is a constraint an agent must not cross;
  `guide` is judgement it should apply. They render at the top of the action
  queue and on Settings, and `n-seo init` writes them into the instance's
  `CLAUDE.md`, so the owner and their agent read the same rules.
- Decided: a profile is data only and may not ship executable code. Installing
  a method should not mean running its author's code on the machine holding
  your Search Console credentials. `priorities` covers reordering and hiding
  declaratively, which is what practitioners actually asked to express. A
  genuinely new *kind* of card — one reading data no existing rule reads —
  remains a fork, and is the open question.

## Feature: Rule thresholds in config [shipped]

- Acceptance: every threshold the action engine ranks by lives in `rules`,
  with the engine defaults documented in `src/config.ts` and mirrored in
  `ingest/seo_config.py`; tests cover an override changing a rule's output.

# Epic: Dashboard and agent access [shipped]


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
- Acceptance: light and dark themes; no external fonts — the one webfont is
  served from the app's own origin, so the dashboard renders identically on a
  host with no outbound internet and leaks no request to a font CDN.

## Feature: Settings page [shipped]

- Acceptance: toggles every module, edits digest topics, expertise, watch
  pages and conversions, and writes the config file (creating it from the
  example on first save); invalid topic lines are rejected with a message.

## Feature: Read-only MCP over stdio and authenticated HTTP [shipped]


- Acceptance: stdio transport with no secret; HTTP transport that returns
  503 with no token configured and compares tokens in constant time.
- Acceptance: every tool is annotated read-only; tools cover the queue, a
  single action, sites, per-site report, top queries, striking distance, CTR
  gaps, metadata audit, time series, ops status, daily log, proposals,
  conversions, campaigns, settings and engine info; docs exposed as
  resources.

## Feature: Indexing problems on the individual site page [planned]

`/site/:host` says nothing about indexing today, so someone looking at one
site has to leave for `/indexing` and find their host in a list. The data is
already keyed by host — `indexStatus()` carries problems, never-crawled,
indexed and checked per site — so this is surfacing, not a new pull.

- Acceptance: the site page shows that host's indexed/checked counts, its
  problems grouped by coverage state, and its never-crawled count.
- Acceptance: each problem keeps its coverage-state explanation and whether
  Request Indexing helps — true only where Google has formed no judgement,
  false where it fetched and declined.
- Acceptance: a host that is all clear, or has no sitemap coverage, says so
  explicitly rather than rendering an empty panel; it links through to
  `/indexing` for the cross-site view.
- Acceptance: renders from demo data with no server error, in both themes.

## Feature: Custom pages and rules in instance mode [idea]

Allow an instance to register extra routes and rules without forking the
engine (e.g. `instance/src/extensions.ts`).

# Epic: Optional modules [shipped]


- Acceptance: each of indexStatus, metadataAudit, opportunityScan, llm,
  hackerNews, reddit, indexNow, staticExport, gitAutoCommit, notifications,
  updateCheck is gated by `modules.<key>.enabled`; a disabled digest exits 0
  with a message.
- Acceptance: `updateCheck` is the only module enabled by default. It writes
  `data/update-check.json`, exits 0 when the registry is unreachable without
  disturbing the previous result, and makes no request at all when disabled.
- Acceptance: the LLM module runs any command that reads a prompt on stdin;
  when unavailable, the scan records candidates only and digests skip
  briefings.
- Acceptance: briefing prompts forbid generating comment text.

## Feature: HTTP LLM adapter [shipped]

Optional adapter that calls an OpenAI-compatible or Anthropic HTTP endpoint
instead of a CLI, with the key read from `.env`.

- Acceptance: `modules.llm.http` takes `provider` (`anthropic` or `openai`),
  `model`, an optional `baseUrl` and a key resolved from the environment;
  `http` wins when configured and its key resolves, otherwise the CLI command
  runs, and with neither the scan records candidates only.

## Feature: Bing Webmaster ingest [idea]

## Feature: Core Web Vitals via CrUX [idea]

# Epic: Engine and instance [shipped]


- Acceptance: `N_SEO_INSTANCE` relocates every instance-owned path; in-place
  mode is unchanged when it is unset.
- Acceptance: `n-seo init|start|dev|daily|doctor|demo|mcp|check|export|
  upgrade|version` behave as documented in `docs/INSTANCE.md`.
- Acceptance: an instance is a standalone project. `n-seo init` exits 2
  without writing anything when the target holds an application marker, or
  when the directory it would create falls inside a git repository that is
  not an instance; `--force` overrides, re-running on an existing instance
  succeeds, and in-place mode in the engine checkout is unaffected.
- Acceptance: `init` installs the seven instance-facing skills and a
  `CLAUDE.md` with the operating rules, substituting the real engine and
  instance paths, and leaves the contributor (`ndx-*`) skills behind.
- Acceptance: `n-seo upgrade` refuses to leave the engine on a commit that
  fails `npm run check` without printing the rollback command.

## Feature: Portable orchestrator with hooks and scheduler templates [shipped]


- Acceptance: `ops/daily.py` waits for the network, runs the enabled steps
  in order, retries a failed step once, tees output to `data/daily-ops.log`,
  writes `data/last-run.json` with per-step timing, honours `--only`,
  `--skip`, `--list`, `--no-network-wait`, and exits 1 on any failure.
- Acceptance: hooks (`beforeRun`, `afterRun`, `afterStep`) run in the
  instance directory and are logged like steps without aborting the run.
- Acceptance: launchd, cron and systemd templates plus an installer script.

## Feature: Publish the engine to npm [shipped]

- Acceptance: `npm i n-seo` installs a working engine; `npx n-seo init`
  scaffolds an instance; the `files` list excludes tests and the marketing
  site, and includes the instance-facing skills.

## Feature: Upgrading is visible and one command [shipped]

- Acceptance: `n-seo upgrade` detects how the engine was installed — git
  checkout, npm global (including a custom prefix), npm local — and performs
  the upgrade itself rather than printing advice. It prints the old and new
  versions, the section of the new CHANGELOG, the rollback command, and a
  reminder to restart the dashboard.
- Acceptance: `n-seo upgrade --check` reports what is available and changes
  nothing.
- Acceptance: a newer published version is shown on the Settings page and in
  `doctor`, both read from `data/update-check.json` rather than the network,
  and both compare against the engine running now — so an upgrade stops the
  notice immediately rather than at the next daily run.

## Feature: Weekly upgrade check on a schedule [planned]

The gate and the one-command upgrade shipped in 0.4.0; what remains is running
the check on a schedule rather than by hand.

- Acceptance: a launchd plist and a cron line in `ops/templates/`, beside the
  daily-run templates, running `n-seo upgrade --check` weekly. The check
  reports; it never installs unattended.
- Acceptance: documented beside the daily run in `docs/SCHEDULING.md`, and the
  VM case (`manage upgrade`) in the Upgrades section of `docs/DEPLOY.md`.

# Epic: Onboarding, docs and quality [shipped]


- Acceptance: `npm run demo` populates every page with synthetic data before
  any Google setup.
- Acceptance: README quickstart, SETUP-GOOGLE, SCHEDULING, ADDING-A-SITE,
  INSTANCE, MCP, OPERATING-RULES, PLAYBOOK, FAQ, CONTRIBUTING, SECURITY,
  CHANGELOG exist and match the CLI contracts.

## Feature: Tests and CI [shipped]


- Acceptance: `npm run check` runs typecheck, TypeScript tests (sandboxed
  copy) and Python tests; CI runs both suites, a demo-data dashboard smoke,
  `doctor --offline`, and a grep that fails on any private name.

## Feature: Interactive setup wizard [idea]

`n-seo init --guided`: asks for hosts, property ids and the key path, then
runs doctor.

# Epic: Marketing site [shipped]

- Acceptance: `www/` is a single static page deployed by the Pages workflow,
  with OG image, `llms.txt`, robots and sitemap; copy names the three
  promises (local data, evidence first, briefs-not-acts) and the operating
  rules.

## Feature: Custom domain [shipped]

`www/CNAME` carries n-seo.dev; analytics are guarded on the hostname so a
fork's Pages deploy never reports into the project's property.

- Acceptance: typography is self-hosted (latin-subset variable woff2 from the
  page's own origin), so the site makes no third-party request.
