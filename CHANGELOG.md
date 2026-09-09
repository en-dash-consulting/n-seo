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
- **Traffic sources over time.** `pull_timeseries.py` also pulls GA4
  `date × source/medium` for 180 days into
  `data/timeseries/ga4-sources-<host>.json`, and `classifySource` buckets it
  into AI assistants, Search, Direct, Referral, Social and Other. Trends and
  every site page get a stacked "sessions by source" chart, plus a dedicated
  **AI assistants / day** chart on its own axis — inside the stack AI is a
  percent or two, so the trend worth watching is invisible there.
- **Site pages show trends**, with the same window picker `/trends` has
  (`/site/<host>/<days>`).

- **`modules.publish`**: getting `site/` to wherever people read it is now a
  pipeline step rather than a hook you write yourself, so it is logged,
  retried once and recorded in `last-run.json`. Targets: `gcs`
  (`gcloud storage rsync`), `s3` (`aws s3 sync`), `rsync`, and `command` for
  anything else. `delete` makes the mirror match the export; `dryRun` prints
  the exact command without running it, which is how you rehearse a cutover
  against a bucket that is already serving something; `env` is merged into
  that command's environment only, with key names logged and values never.
  It refuses clearly when the destination is empty, the tool is missing from
  `PATH`, or there is no `site/` to publish.
- **`modules.staticExport.signOutUrl`** (with `signOutLabel`) adds a sign-out
  link to every exported page, for a mirror behind IAP, oauth2-proxy,
  Cloudflare Access or anything else with a sign-out URL. The live dashboard
  renders nothing for it.
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

- **Deployment off a laptop**: `google.auth: "metadata"` uses the GCE /
  Cloud Run / GKE runtime service account, so a hosted install needs no key
  file at all. The metadata token is `cloud-platform` scoped and Search
  Console rejects that, so the account mints a correctly scoped token for
  itself through IAM Credentials; a missing Token Creator binding is
  reported with the exact `gcloud` command that fixes it.
- **LLM over HTTP**: `modules.llm.http` calls an Anthropic or
  OpenAI-compatible endpoint instead of a local CLI, with the key read from
  the environment or `.env`. Without it the opportunity scan and the digests
  are silently inert on any machine you did not sign a CLI into. `http` wins
  when its key resolves, so one config file works on both a laptop and a
  server.

- **Deployment**: a container image (`Dockerfile`, 328 MB, Node + stdlib
  Python + curl + openssl) whose entrypoint takes `serve`, `daily`, `doctor`,
  `demo`, `init` or `cron`, with the instance as a volume at `/instance`.
  `docker/compose.yml` runs the dashboard and a scheduler on one volume and
  binds the dashboard to loopback, so a bare `docker compose up` is not an
  open dashboard; `docker/compose.caddy.yml` adds TLS and basic auth and
  refuses to start without credentials configured.
- **GCP scaffolding**: `deploy/gcp/setup.sh` (idempotent, `--dry-run`)
  provisions a service account with the Token Creator self-binding, a private
  mirror bucket, a data disk, a VM with no external IP reachable only over
  IAP, and the Cloud Run mirror; `deploy/vm/startup.sh` brings the same stack
  up on any Debian or Ubuntu host, so a VPS or a NAS works the same way.
  `docs/DEPLOY.md` is the narrative and says plainly why the engine does not
  belong on Cloud Run: the static export finishes with a directory rename,
  which GCS FUSE cannot do atomically.
- **`n-seo-deploy` skill** walks an agent through choosing a host, running the
  scaffolding, verifying with `doctor` and a probe-only run, and handing back
  the console steps that cannot be scripted.

### Changed
- **The site page stops wasting the screen.** Query tables and the narrow
  source lists sit in a 2:1 split instead of every table spanning the full
  width, and "Do next" caps at six cards with a link to the full queue.
- **Seven nav items instead of ten.** Indexing, Probes, Logs and Settings
  fold into one **System** menu.

- The Trends page opens with a portfolio source mix and an AI-assistants
  chart for every site combined, so "where is the traffic coming from" is
  answered without expanding a tile.

### Fixed
- **Data loss**: a Search Console, GA4 or time-series pull that hit an API
  error overwrote the previous snapshot with zero rows and still reported the
  step as successful. The pulls now keep the last good file and fail the step.
- **Wrong advice**: the metadata audit ignored the HTTP status, so a page that
  had started 404ing was audited against its error page and produced a
  top-ranked "rewrite this title" card. It now reports the dead page instead,
  counting both 200 and 206 as serving because a ranged request returns 206
  from any server that honours the Range header.
  Descriptions containing an apostrophe were truncated at it and then flagged
  as too short, and HTML entities were blanked rather than decoded.
- **Inverted GEO signal**: the robots.txt check matched across `User-agent`
  group boundaries, so a crawler the file explicitly allowed could be reported
  as blocked, with a hygiene action to match.
- **Queue ordering**: one unrecognised `effort` in `config/backlog.json` made
  the sort comparator return NaN, leaving the order of every other card
  undefined. Values are coerced on load and scoring can no longer produce NaN.
- Two long titles could share a truncated id, so retiring one deleted both.
- The traffic-drop card measured 28-day sessions but was ranked and rendered
  as monthly clicks, so it outranked everything else by roughly fifty times.
- The static export emptied `site/` before fetching, so a failed export
  published an empty mirror through the `afterRun` rsync hook.
- `--no-network-wait` was ignored on the retry path, so an offline run waited
  the full timeout for every failing step.
- GA4 time series and trend queries were unpaginated and truncated silently;
  the URL Inspection budget was per host although the quota is per property.
- The JWT is backdated 60s so a slightly fast clock cannot fail
  authentication, and `GOOGLE_APPLICATION_CREDENTIALS` is honoured when the
  configured key path does not exist.
- The opportunity scan dropped genuine risers whose query appeared as a
  substring anywhere in the queue's prose.
- `tsx` moved from devDependencies to dependencies. The engine runs
  TypeScript directly with no build step, so `npm ci --omit=dev` — and
  therefore any published `npm i n-seo` — produced an install whose dashboard
  could not start.
- The test sandbox now seeds its own demo dataset and neutralizes
  `N_SEO_INSTANCE` while importing. Previously the action-engine suite was
  dropped from the run whenever the checkout had no `data/` — which is the
  normal state of an engine in instance mode, and therefore of every
  `n-seo upgrade` gate — without changing the reported test counts, and an
  in-place install ran those assertions against the owner's live data.

[Unreleased]: https://github.com/en-dash-consulting/n-seo/compare/main...HEAD
