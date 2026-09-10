# Running n-seo as an engine + instance

> **An instance is a standalone project.** It is never a subdirectory of a
> website you are optimising, and `n-seo init` refuses to scaffold into an
> application directory or a git repository it does not own (`--force`
> overrides). n-seo reads your sites through the Search Console and GA4 APIs;
> it has no reason to live in their code, and living there means committing
> and deploying its config, its queue and a `data/` tree that is rewritten
> every morning. One instance watches as many sites as you own.

n-seo can run two ways. In the simplest, you clone the repo, put your config
in the checkout and run it there. In the second, the checkout is an **engine**
you never edit, and everything that is yours — config, queue, content, data,
logs — lives in a separate **instance** directory that the engine is pointed
at. This document is about the second way, and about why you would want it.

## Why split them

- **Upgrades without merges.** Upstream changes touch engine files; your
  files live somewhere else. Upgrading is `git pull` (or `npm update`) and a
  test run. There is nothing to reconcile.
- **Your work in your own repo.** The queue you curate, the drafts and
  campaigns you write, the daily log that accumulates — those are yours, with
  their own history, in a repo you control. Private if you want.
- **Several instances, one engine.** A consultancy can run one engine and an
  instance per client. A team can run a shared engine on one machine and
  keep each portfolio separate.
- **The upgrade path gets exercised.** Because upgrading is cheap, you do it
  routinely, and the engine's `check` run is your regression test against
  your own data.

## Who owns what

| Engine (the n-seo checkout) | Instance (your directory) |
|---|---|
| `src/`, `ingest/`, `ops/`, `probes/`, `public/`, `bin/`, `tests/` | `n-seo.config.json` (or whatever `$N_SEO_CONFIG` names) |
| `n-seo.config.example.json` | `.env` |
| `docs/PLAYBOOK.md`, `docs/OPERATING-RULES.md`, `docs/ARCHITECTURE.md` | `config/backlog.json`, `config/insights.json` |
| | `content/drafts/*.md`, `content/campaigns/*.json` |
| | `data/` (regenerable), `site/` (static export) |
| | `docs/daily-log.md`, `docs/reports/` |
| | the IndexNow key file |
| | `.mcp.json`, `CLAUDE.md`, `.claude/` (your agent's rules) |

The engine resolves the instance from, in order: `--instance <path>` on the
CLI, then `$N_SEO_INSTANCE`, then the current directory. With none of those
set and a config file next to the engine's `src/`, you are in in-place mode
and the engine checkout *is* the instance. Nothing in the engine ever writes
outside the instance directory.

## Three ways to run

### A. In place

Clone, configure, run. One directory.

```sh
git clone https://github.com/en-dash-consulting/n-seo && cd n-seo
npm install
cp n-seo.config.example.json n-seo.config.json   # edit sites, auth
python3 ops/doctor.py
npm start
```

Upgrade:

```sh
git pull --ff-only && npm ci && npm run check
```

Merge conflicts are only possible in files you edited. After 0.1, upstream
does not change `config/backlog.json`, `config/insights.json` or anything
under `content/`, so a config-only setup pulls clean. If you edit engine
files — a rule in `src/actions.ts`, a page in `src/views.tsx` — you are
forking; add `upstream` as a remote and rebase or merge on your schedule:

```sh
git remote add upstream https://github.com/en-dash-consulting/n-seo
git fetch upstream && git rebase upstream/main   # or merge
```

### B. Engine + instance directory

Two directories. The engine is a plain checkout; the instance is scaffolded
by the CLI and holds everything that is yours.

```sh
git clone https://github.com/en-dash-consulting/n-seo ~/tools/n-seo
cd ~/tools/n-seo && npm install

node ~/tools/n-seo/bin/n-seo.mjs init ~/sites/search-ops
cd ~/sites/search-ops
#   edit n-seo.config.json, .env
n-seo doctor          # via the .mcp.json/env the scaffold wrote, or:
node ~/tools/n-seo/bin/n-seo.mjs doctor --instance ~/sites/search-ops
```

`n-seo init` writes: `n-seo.config.json` (from the example), empty
`config/backlog.json` and `config/insights.json`, `content/drafts/README.md`
and `content/campaigns/README.md`, `.env` (from `.env.example`), a
`.gitignore` that excludes `data/`, `site/` and `.env`, a `.mcp.json` that
spawns the engine's MCP server with `N_SEO_INSTANCE` set, and a short README.

It also makes the instance agent-ready, which is how most people should drive
it:

- `.claude/skills/` — the seven operating skills (`orient`, `n-seo-setup`,
  `n-seo-add-site`, `n-seo-triage`, `n-seo-ship`, `n-seo-review`,
  `n-seo-deploy`), copied from the engine with this install's real engine and
  instance paths substituted in, so every command in them is copy-pasteable.
  The engine's contributor skills (`ndx-*`) are not copied — they are for
  developing n-seo, not operating it.
- `CLAUDE.md` — the operating rules an agent working in this directory has to
  follow: the 28-day freeze, the weekly metadata budget, impact-is-not-a-
  forecast, decisions on the 90-day window, shipped-becomes-watching,
  proposals never self-promote, site changes ship as pull requests.

With those two files plus `.mcp.json`, opening the instance in Claude Code is
enough: it can read the queue and the metrics, and it already knows the rules.

```sh
cd ~/sites/search-ops && claude
  "set this up for my sites"        → /n-seo-setup
  "what should I work on today?"    → /n-seo-triage
  "do the first one"                → /n-seo-ship
  "how did last month go?"          → /n-seo-review
```

Both files are yours once written. `n-seo init` never overwrites, so editing
`CLAUDE.md` to add your own rules survives every re-run and every engine
upgrade. To pick up improved skills from a newer engine, delete the ones you
have not customised and re-run `n-seo init`.

To make `n-seo` a command, link the engine once:

```sh
cd ~/tools/n-seo && npm link      # puts `n-seo` on your PATH
```

Daily use, from inside the instance directory (or with `--instance`):

```sh
n-seo start            # dashboard on the config's port
n-seo daily            # the morning run
n-seo daily --only probe,gsc
n-seo doctor
n-seo export           # static export → <instance>/site/
n-seo mcp              # stdio MCP server for this instance
```

Scheduling: the templates in `ops/templates/` run `ops/daily.py` and
`src/server.tsx` from the engine checkout. For an instance, change the
program to the CLI and name the instance, either as an argument:

```xml
<key>ProgramArguments</key>
<array>
  <string>/usr/bin/env</string>
  <string>node</string>
  <string>/Users/you/tools/n-seo/bin/n-seo.mjs</string>
  <string>daily</string>
  <string>--instance</string>
  <string>/Users/you/sites/search-ops</string>
</array>
```

or as an environment variable in the plist / unit / crontab:

```xml
<key>EnvironmentVariables</key>
<dict>
  <key>N_SEO_INSTANCE</key>
  <string>/Users/you/sites/search-ops</string>
</dict>
```

```cron
0 7 * * * N_SEO_INSTANCE=/home/you/sites/search-ops /usr/bin/env node /home/you/tools/n-seo/bin/n-seo.mjs daily >> /home/you/sites/search-ops/data/daily-cron.log 2>&1
```

Log paths in the templates point at `data/` inside the checkout; in instance
mode point them at `<instance>/data/` instead. Do the same for the dashboard
service (`start` instead of `daily`, `KeepAlive` / `Restart=always` as in the
templates).

Upgrade:

```sh
n-seo upgrade
```

This runs `git pull --ff-only` in the engine, `npm ci` if the lockfile
changed, then `npm run check` (typecheck plus both test suites). If the check
fails it prints the rollback command — `git -C <engine> checkout <previous sha>`
followed by `npm ci` — and exits non-zero. Nothing in the instance is touched
by an upgrade.

### C. npm dependency

The instance is a small npm project that depends on the engine. Nothing to
clone; upgrades are `npm update`.

```sh
mkdir ~/sites/search-ops && cd ~/sites/search-ops
npm init -y
npm install github:en-dash-consulting/n-seo     # or `n-seo@^0.1` once published
npx n-seo init .
```

`package.json` scripts make the commands local:

```json
{
  "scripts": {
    "start": "n-seo start",
    "daily": "n-seo daily",
    "doctor": "n-seo doctor",
    "export": "n-seo export",
    "upgrade": "npm update n-seo && n-seo check"
  },
  "dependencies": { "n-seo": "github:en-dash-consulting/n-seo" }
}
```

The engine lives in `node_modules/n-seo`; the instance is the current
directory. `n-seo upgrade` recognizes an npm install and tells you to run
`npm update n-seo` instead of pulling. Pin with a version or a commit
(`github:en-dash-consulting/n-seo#<sha>`) when you need to.

Python is still required on the machine — the engine's ingest scripts run
with `python3` from the package directory.

## The instance repo

A typical instance, committed to its own git repo:

```
search-ops/
  n-seo.config.json      sites, auth, modules, hooks         ← commit
  .env                   Reddit creds, MCP token             ← never commit
  config/backlog.json    your curated queue                  ← commit
  config/insights.json   your narrative briefing             ← commit
  content/drafts/        distribution drafts (markdown)      ← commit
  content/campaigns/     outreach campaigns (json)           ← commit
  docs/daily-log.md      appended by every run               ← commit
  docs/reports/          analyze_gsc / analyze_ga4 output    ← commit
  data/                  snapshots, regenerable              ← ignore
  site/                  static export                       ← ignore (or commit if you deploy it from git)
  indexnow.key           public by design                    ← commit
  ops/                   your own scripts, run by hooks      ← commit
  .mcp.json, CLAUDE.md, .claude/                             ← commit
```

`.gitignore` written by `n-seo init`:

```
data/
site/
.env
__pycache__/
node_modules/
```

If `modules.gitAutoCommit` is on, the daily run commits `docs/daily-log.md`,
`docs/reports/` and `site/` (when tracked) in the **instance** repo and pushes
if it has a remote. The engine checkout is never committed to by the run.

## Hooks: your scripts in the daily run

`hooks` in the config attach shell commands to the run. Each command runs
with the instance directory as its working directory and these variables
set: `N_SEO_ROOT` (the engine), `N_SEO_INSTANCE`, and for `afterStep`,
`N_SEO_STEP`. Hook output goes to `data/daily-ops.log` like a step; a
failing hook is recorded in `data/last-run.json` and never aborts the run.

```json
"hooks": {
  "beforeRun": [],
  "afterStep": {
    "gsc": ["python3 ops/flag_new_queries.py"],
    "daily-diff": ["git add docs/daily-log.md && git commit -qm \"daily log $(date +%F)\" || true", "git push -q origin main || true"]
  },
  "afterRun": [
    "rsync -a --delete site/ deploy@mirror.example.com:/srv/search-ops/",
    "CLOUDSDK_CONFIG=$HOME/.config/my-gcloud gcloud storage rsync site gs://my-search-ops-mirror --recursive --delete-unmatched-destination-objects"
  ]
}
```

Three patterns that cover most needs:

1. **Publish a mirror after the run.** With `modules.staticExport` on, the
   run leaves `site/` in the instance; an `afterRun` `rsync` or
   `gcloud storage rsync` puts it behind whatever auth you already have.
   Choose one of the two lines above, not both.
2. **Push the instance repo as soon as the log is written.** The
   `afterStep.daily-diff` pair above commits and pushes the day's entry
   before the slower digest steps run. Leave `gitAutoCommit` off if you do
   this, or you will get two commits a day.
3. **Run your own analysis on fresh data.** Anything under the instance's
   own `ops/` can read `data/` (the layout is in `docs/ARCHITECTURE.md`)
   and write wherever you like. `afterStep.gsc` runs right after the Search
   Console pull lands, before the audit and the scan.

Step names, for `afterStep`: `probe`, `gsc`, `ga4`, `timeseries`,
`metadata-audit`, `index-status`, `opportunity-scan`, `daily-diff`,
`hn-digest`, `reddit-digest`, `static-export`. A hook on a step whose module
is off never runs.

## Extra Search Console properties

A host can be verified in Search Console as both a domain property and a
URL-prefix property, and the two report differently. The sites list takes one
`gscProperty` per site; anything else you want pulled for history goes in
`gscExtraProperties`:

```json
"gscExtraProperties": ["https://example.com/"]
```

They land in `data/gsc/<slug>/` with the same files as any property. A
url-prefix property gets a `-urlprefix` suffix (`https://example.com/` →
`data/gsc/example.com-urlprefix/`), so it never collides with the domain
property's directory. Nothing in the UI reads extras — they are for your own
scripts and for comparison.

## Your agent, in the instance

`n-seo init` writes a `.mcp.json` that spawns the engine's stdio MCP server
with `N_SEO_INSTANCE` pointing at the instance, so opening the instance
directory in Claude Code gives the agent the instance's queue and data:

```json
{
  "mcpServers": {
    "n-seo": {
      "command": "node",
      "args": ["/Users/you/tools/n-seo/bin/n-seo.mjs", "mcp"],
      "env": { "N_SEO_INSTANCE": "/Users/you/sites/search-ops" }
    }
  }
}
```

`CLAUDE.md` and `.claude/skills/` in the instance are yours: put the
operating rules that are specific to your sites there (approval gates,
freeze dates, who may post where). The engine's generic rules stay in
`docs/OPERATING-RULES.md` and are also served as the MCP resource
`seo://docs/operating-rules`. The `engine_info` tool reports the engine
version, commit, mode and both paths, so an agent can tell which engine it
is talking to.

## Testing the upgrade path as routine

The point of the split is that upgrading is boring. Make it a habit:

- **Weekly, automatically.** A `beforeRun` hook on Mondays:
  ```json
  "hooks": { "beforeRun": ["[ \"$(date +%u)\" = 1 ] && n-seo upgrade || true"] }
  ```
  or a separate scheduled job (a second launchd plist or cron line) that
  runs `n-seo upgrade` an hour before the daily run.
- **`npm run check` is the gate.** `n-seo upgrade` refuses to leave the
  engine on a commit whose typecheck or tests fail. Your `data/` is not
  used by the tests (they run on a sandboxed copy with demo data), so a
  failing check means the engine is broken, not your instance.
- **Rollback is one command**, printed on failure:
  ```sh
  git -C ~/tools/n-seo checkout <previous-sha> && (cd ~/tools/n-seo && npm ci)
  ```
- **Pin when you need to.** `git -C ~/tools/n-seo checkout v0.1.0` (or a
  sha) holds the engine; `n-seo upgrade` then fast-forwards only when you
  move back to `main`. In npm mode, pin the version in `package.json`.
- **Watch the Settings page.** It shows the engine version and commit the
  dashboard is running, which is how you notice a scheduled upgrade
  silently failed. `n-seo doctor` prints the same block.

## FAQ

**Can I change a rule (a threshold in the action engine, a probe check)?**
Not from an instance — the rules are engine code. Either run in-place mode
as a fork (mode A with an `upstream` remote) or send the change upstream as a
pull request, which is the better outcome if the rule is generally right.
Instance-level customization is what `config/backlog.json`, `watchPages`,
`conversions`, the module fields and hooks are for.

**Where do custom dashboard pages go?**
Instance mode does not support them yet. Fork. If a page would be useful to
others, propose it.

**What happens when upstream changes a data file format?**
The engine's readers, writers and `demo_data.py` move together in one
commit, and `data/` is regenerable: the next daily run rewrites every file.
If a format change ever needs a manual step, the changelog says so and
`n-seo upgrade` prints it.

**Can two instances share one `data/`?**
No. `data/` belongs to an instance. Two instances with the same sites will
pull the same data twice; that is fine within Google's quotas.

**Does the engine ever write to the instance's `config/backlog.json`?**
Only through the dashboard's accept / mark-watching / retire buttons, which
you click. The daily run never writes the queue.
