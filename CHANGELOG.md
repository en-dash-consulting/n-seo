# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Security
- Dashboard binds `127.0.0.1` by default (`SEO_HOST` overrides) and rejects
  cross-origin `POST`s, since Settings can set the LLM command that the daily
  run executes.
- The static export omits `/settings` (local paths and the service-account
  email do not belong on a mirror).

### Added
- **Engine / instance split**: `N_SEO_INSTANCE` points the engine at a separate
  directory holding your config, queue, content and data, so upgrading the
  engine is a `git pull` (or `npm update`) that never touches your files.
  In-place mode (no env var) is unchanged.
- **`n-seo` CLI** (`bin/n-seo.mjs`): `init` scaffolds an instance;
  `start`/`dev`/`daily`/`doctor`/`demo`/`mcp`/`check`/`export` run the engine
  against it; `upgrade` pulls, reinstalls and re-checks the engine with a
  printed rollback; `version` shows engine + instance.
- **Hooks** (`hooks.beforeRun` / `hooks.afterStep.<step>` / `hooks.afterRun`):
  your own shell commands around the daily run, logged and recorded like steps.
- **`gscExtraProperties`**: extra Search Console properties pulled for their
  data without appearing as sites.
- `engine_info` MCP tool; Engine card on Settings; `doctor` engine block.
- **One config file** (`n-seo.config.json`) read by the dashboard and every
  Python script: sites, Google auth, watch pages, conversions, module switches.
  Falls back to the example so a fresh checkout runs.
- **Google auth without gcloud**: service-account JSON key, JWT signed locally
  with the `openssl` CLI. gcloud impersonation and user modes remain available.
- **Ingest**: Search Console (16-month and 90-day windows), GA4 (daily, sources,
  landing pages, conversion events), per-page time series, URL Inspection
  index-coverage sweep, live-site probes (robots, sitemap, llms.txt, soft 404s,
  AI-crawler blocks, JS-shell detection), metadata audit, 84-day trend analysis.
- **Action engine**: metadata findings, CTR gaps, striking-distance queries,
  probe hygiene, landing-page engagement mismatch, traffic-drop investigation;
  ranked by impact per unit of effort and merged with a curated queue in
  `config/backlog.json` (hot-reloaded). Shipped pages show as *watching*.
- **Dashboard** (Hono SSR, no bundler): Today board, action queue with
  accept / mark-watching / retire, Insights, Trends (band charts + heatmap),
  Content (drafts, campaigns, participation briefings), per-site pages,
  Indexing, Probes, Logs, and a **Settings** page that toggles modules and
  writes the config. Light and dark themes.
- **Opt-in modules**: LLM inference through any stdin CLI, Hacker News and
  Reddit digests (briefings only, never comment text), IndexNow, static export,
  git auto-commit, desktop notifications.
- **MCP server** (stdio and bearer-token HTTP, read-only) exposing the queue,
  metrics, audit, ops status, proposals, campaigns and settings to agents.
- **Operations**: `ops/daily.py` orchestrator with network wait and one retry,
  `ops/doctor.py` setup checker, `ops/demo_data.py` synthetic dataset,
  launchd / cron / systemd templates and a launchd installer.
- **Tests and CI**: `node --test` suites for config, backlog writes, action
  engine invariants and data helpers; `unittest` suites for config parity,
  HTTP retry classification, JWT signing, daily-diff and demo-data conformance;
  GitHub Actions running all of it plus a dashboard smoke test and a grep that
  rejects private names.
- Docs: README, ARCHITECTURE, SETUP-GOOGLE, SCHEDULING, OPERATING-RULES,
  PLAYBOOK, MCP, ADDING-A-SITE, FAQ, CONTRIBUTING, SECURITY.

[Unreleased]: https://github.com/en-dash-consulting/n-seo/compare/main...HEAD
