# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **`n-seo init` refuses to scaffold inside a website.** An instance is a
  standalone project: it writes a config, a queue, drafts and a `data/` tree
  that the daily run rewrites every morning, and inside a site repo all of
  that gets committed and usually deployed. `init` now stops when the target
  directory (or the parent of a directory it is about to create) holds an
  application marker such as `package.json`, or sits inside a git repository
  that is not itself an instance. The error names the reason and shows the
  right command. `--force` overrides; re-running `init` on an existing
  instance is always allowed, and in-place mode in the engine checkout is
  unaffected. The README, the marketing site, `docs/INSTANCE.md` and the FAQ
  say the same thing in words.
- **The skills ship, and `init` installs them.** `.claude/skills/` was not in
  the npm `files` list, so an `npm i n-seo` install had none of the operating
  skills at all. The seven instance-facing ones are now packaged, and `init`
  copies them into the new instance with this install's real engine and
  instance paths substituted for the placeholders, alongside a `CLAUDE.md`
  carrying the operating rules. Opening an instance in Claude Code is now
  enough to run setup, triage, shipping and the weekly review by asking. The
  contributor skills (`ndx-*`) stay in the engine checkout.
- **Command output points at the skills where it is useful.** `n-seo init`
  ends with the prompts to try, `n-seo demo` names the one that connects real
  sites, `n-seo start` prints the triage prompt, and `n-seo doctor` suggests
  `/n-seo-setup` only when it found problems to fix. Each is gated on the
  skills actually being present.

### Changed
- **The site shows the setup instead of describing it.** Someone opened their
  own website's repo and ran `n-seo init` inside it, which is a fair reading
  of a quickstart that never says where the command should be run. There is
  now a "Where it goes" section on n-seo.dev with the wrong filesystem layout
  beside the right one, a breakdown of what each command in the quickstart
  actually does, and three cards naming what n-seo touches: your repos never,
  Google's APIs read-only, its own directory for everything it writes. The
  README and `docs/INSTANCE.md` carry the same trees as text.
- **Typography, self-hosted.** Montserrat and Merriweather replace DM Sans,
  DM Mono and the Google Fonts CDN on the marketing site; the dashboard's
  headings and brand mark move to Montserrat while its tables keep the system
  UI font. Both families are shipped as latin-subset variable woff2 files
  served from the same origin, so there is no third-party request, no
  render-blocking stylesheet on another domain, and the dashboard renders
  correctly on a host with no outbound internet. Licences are in
  `www/fonts/OFL.txt` and `public/fonts/OFL.txt`. The static export copies the
  font alongside `styles.css`.
- **The indexing page says what to do, per verdict.** Every coverage state now
  carries a remediation line and a marker saying whether Request Indexing will
  help. It helps for "URL is unknown to Google" and "Discovered - currently
  not indexed", where Google has formed no judgement about the content. It
  does not help for "Soft 404" or "Crawled - currently not indexed": Google
  fetched the page, judged it, and would judge the same content the same way
  again, so a re-request spends a slot of a roughly ten-a-day quota for
  nothing. Redirects, canonicals, duplicates, robots blocks and noindex are
  covered too. The FAQ answer on stale soft 404s was rewritten for the same
  reason.

## [0.2.0] - 2026-09-09

### Changed
- **Says what it is.** n-seo is an agentic tool: your model turns findings
  into proposals, verdicts and briefings, and your coding agent works the
  queue over MCP. That was the seventh heading in the README and absent from
  the npm description; it is now the second section on the site and near the
  top of the README. "En Dash SEO" appears beside the wordmark, since `n-seo`
  reads as noise to someone landing cold. The LLM module remains opt-in and
  nothing posts, publishes or edits a site.

### Fixed
- The docs claimed 15 MCP tools where the server registers 16 (`engine_info`
  was missing from the table), the README skills list omitted `n-seo-deploy`,
  and `llms.txt` still carried the pre-npm clone quickstart.
- Two MCP error messages told the reader to run a Python script directly
  rather than the CLI command that works on every platform.

### Added
- **Windows support.** CI runs the whole check job on `windows-latest` —
  typecheck, both test suites, every dashboard route, the MCP stdio smoke and
  a scaffolded instance — alongside Ubuntu on Node 20 and 22. Nothing is
  gated off for Windows. `ops/templates/n-seo-daily-task.xml` is a Task
  Scheduler definition for the daily run, with the catch-up behaviour launchd
  gives on macOS.
- `ops/py.mjs` resolves the Python interpreter this machine actually has, and
  the npm scripts and the CLI both go through it. `$PYTHON` still overrides.
- `tests/py/test_portability.py` enforces the two rules that make the above
  hold: every text file call names `encoding="utf-8"`, and no shipped code
  invokes `openssl`.

### Changed
- The service-account JWT is signed with node's crypto module instead of the
  `openssl` binary. That removes an external dependency on every platform, and
  removes the temporary private-key file the old path wrote to disk. The
  Docker image no longer installs openssl.
- Dashboard copy names the CLI (`n-seo daily --only probe`) rather than
  `python3 probes/site_probe.py`, which is not a command on Windows.

### Fixed
- Python file I/O and stdout used the platform's locale encoding, which is
  cp1252 on a stock Windows install rather than UTF-8. Non-ASCII Search
  Console queries would have raised `UnicodeEncodeError` and ended the daily
  run there. All 85 call sites are explicit now, and `seo_config` forces UTF-8
  stdio on import.
- A command configured with an unbalanced quote in Settings raised
  `ValueError` out of `shlex` and took down the daily run on every platform.
  It degrades to "no command", and `n-seo doctor` says the command could not
  be parsed rather than reporting it as unconfigured.
- `shlex.split` treated backslashes in a configured LLM command as escapes,
  turning `C:\tools\claude.exe` into `C:toolsclaude.exe`.
- The TypeScript test sandbox spawned `python3` to seed its dataset, so on
  Windows every Python-seeded suite would have taken its skip branch and
  reported a green run that tested none of them.

## [0.1.1] - 2026-09-09

### Changed
- Install instructions lead with `npm install -g n-seo` now that the package
  is published; the clone path stays documented for people changing the
  engine itself. README carries npm, CI and licence badges.
- The site moves to https://n-seo.dev, and `www/CNAME` ships inside the Pages
  artifact so a redeploy cannot drop the custom domain.

### Fixed
- The release smoke script no longer parses `npm pack --json`, whose shape
  differs between npm 10 and npm 12. The release job upgrades npm before
  running it, so it saw a different shape than CI did and failed one step
  before publishing.

### Security
- Releases are staged rather than published directly. CI submits with
  `npm stage publish`; a maintainer approves with 2FA before anything is
  live, so a compromised runner or a stray tag cannot put code on the
  registry.

## [0.1.0] - 2026-09-09

First public release.

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

- `npm i n-seo` produced an install that could not serve a page. The CLI
  refused to start because it looked for `node_modules` inside the engine,
  which npm hoists to the consumer instead; and `tsconfig.json` was not in the
  published files, so tsx fell back to the React JSX transform and every
  server-rendered route answered 500. Both found by installing the packed
  tarball and running it, which is now the release check.

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

[Unreleased]: https://github.com/en-dash-consulting/n-seo/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/en-dash-consulting/n-seo/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/en-dash-consulting/n-seo/releases/tag/v0.1.0
