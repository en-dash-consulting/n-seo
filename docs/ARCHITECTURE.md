# Architecture

n-seo is a local-first control plane for organic growth across one or
more websites: **SEO** (classic search), **AEO** (answer engines: featured
snippets, AI Overviews) and **GEO** (being cited by ChatGPT, Claude,
Perplexity). It runs on a machine you control, keeps all data in local JSON files, and
turns them into a ranked queue of concrete actions.

```
                    ┌──────────── daily run (ops/daily.py) ────────────┐
   Search Console ──┤ ingest/pull_gsc.py         → data/gsc/…          │
   GA4 ─────────────┤ ingest/pull_ga4.py         → data/ga4/…          │
   your live sites ─┤ probes/site_probe.py       → data/probes/…       │
                    │ ingest/pull_timeseries.py  → data/timeseries/…   │
                    │ ingest/analyze_metadata.py → data/metadata-audit.json
                    │ ingest/pull_index_status.py→ data/index-status.json
                    │ ops/opportunity_scan.py    → data/trends-*.json, data/opportunity-proposals.json
                    │ ops/daily_diff.py          → docs/daily-log.md   │
                    │ ops/hn_digest.py (opt-in)  → data/hn-digest.json │
                    │ ops/reddit_digest.py (opt) → data/reddit-digest.json
                    │ ops/export_static.py (opt) → site/               │
                    │ ops/publish.py (opt)       → your bucket/host    │
                    └─────────────────────────────────────────────────┘
                                          │
                       dashboard (src/server.tsx, Hono + hono/jsx SSR)
                       reads data/ + config/ + content/ on every request
                                          │
                       MCP server (src/mcp.ts) — the same data for agents
```

## One config file

`n-seo.config.json` (copy from `n-seo.config.example.json`; path
overridable with `$N_SEO_CONFIG`) is read by the TypeScript app
(`src/config.ts`) **and** every Python script (`ingest/seo_config.py`). If
the file does not exist, both fall back to the example so a fresh checkout
can run the demo. Nothing else carries a site list.

| Key | Meaning |
|---|---|
| `name` | Shown in the dashboard header |
| `port` | Dashboard port (env `SEO_PORT` overrides) |
| `google.auth` | `service-account-key` (default) · `gcloud-impersonate` · `gcloud-user` |
| `google.serviceAccountKey` | Path to the SA JSON key (`~` ok). `$GOOGLE_APPLICATION_CREDENTIALS` also works |
| `google.impersonate` | SA email for the impersonation mode |
| `sites[]` | `host`, `label`, `gscProperty` (`sc-domain:x` or `https://x/`), `gscHost` (page-URL host filter; defaults to host), `ga4Property` (numeric id), `brand` (regex for branded queries), `repo`, `hosting` |
| `watchPages[]` | URLs whose GSC numbers the daily log reports every day |
| `conversions` | `{ site, events[], sourceDimension }` — GA4 key events that are your real goal (signups, leads). Optional |
| `participation.expertise` | Who you are / what you know first-hand. The only context the digest briefings get |
| `modules.<key>.enabled` | See "Modules" |

Derived helpers (identical in both languages): `gscSlug(property)` strips
`sc-domain:` / the scheme and the trailing slash and maps `/`→`_`;
`gscDataSlug(property)` is the `data/gsc/<slug>/` directory name — the same,
plus a `-urlprefix` suffix for url-prefix (`https://…`) properties so they
never share a directory with the domain property of the same host
(`sc-domain:example.com` → `example.com`, `https://www.example.com/` →
`www.example.com-urlprefix`).

## Data files (all under `data/`, gitignored, regenerable)

| Path | Written by | Shape |
|---|---|---|
| `gsc/<slug>/{queries,pages,query_page,dates}.json` | pull_gsc.py | `{site, dimensions, startDate, endDate, rowCount, rows:[{keys[], clicks, impressions, ctr, position}]}` — 16-month window |
| `gsc/<slug>/{queries,pages,query_page}_90d.json` | pull_gsc.py | same, trailing 90 days (**the decision window**) |
| `ga4/<host>/daily.json` | pull_ga4.py | raw GA4 runReport: dims `[date]`, mets `[sessions,totalUsers]`, 90d |
| `ga4/<host>/sources.json` | pull_ga4.py | dims `[sessionSource, sessionMedium]`, mets `[sessions,totalUsers]` |
| `ga4/<host>/landing.json` | pull_ga4.py | dims `[landingPage]`, mets `[sessions, engagementRate]` |
| `ga4/<host>/funnel.json` | pull_ga4.py (only for `conversions.site`) | dims `[date, eventName, <sourceDimension>]` (falls back to `[date,eventName]`), mets `[eventCount]` |
| `timeseries/gsc-<slug>.json` | pull_timeseries.py | `{site, startDate, endDate, rows:[{keys:[date,page], clicks, impressions}]}` 180d |
| `timeseries/ga4-<host>.json` | pull_timeseries.py | `{site, rows:[{date:"YYYYMMDD", page, sessions}]}` 180d |
| `timeseries/ga4-sources-<host>.json` | pull_timeseries.py | `{site, rows:[{date:"YYYYMMDD", source, medium, sessions}]}` 180d — daily traffic by source, bucketed into six groups (AI assistants, Search, Direct, Referral, Social, Other) by `classifySource` in `src/data.ts` |
| `probes/probe-YYYYmmdd-HHMMSS.json` | site_probe.py | `{probed_at, sites:[{site:"https://host", robots{status,exists,sitemap_declared,ai_crawlers_blocked[]}, sitemap{status,exists,url_count,newest_lastmod}, "llms.txt"{status,exists,bytes}, "llms-full.txt"{…}, homepage{status,title,meta_description,canonical,og_tags,jsonld_types[],h1_count,lang,visible_text_bytes}, soft_404{status,real_404}}]}` |
| `metadata-audit.json` | analyze_metadata.py | `{generated, window:"90d", sites:{host:[{page,title,description,imps,clicks,issues[],top_queries[{q,imps,clicks,pos,ctr}],missed_clicks_window}]}}` |
| `index-status.json` | pull_index_status.py | `{generated, sites:{host:{property, checked, indexed, neverCrawled, sitemap{submitted, entries[{path,lastSubmitted,lastDownloaded,pending,errors,warnings}]}, problems:[{url,coverage,lastCrawl,verdict,robots,canonicalMismatch,googleCanonical,detail}]}}}` |
| `trends-YYYY-MM-DD.json` | analyze_trends.py | `{generated, sites:{"<gscProperty>":{recent_split, prior_split, rising[], falling[], monthly{}}}, ai_referrals:{host:{ai{ym:n}, total{ym:n}}}}` |
| `opportunity-proposals.json` | opportunity_scan.py | `{generated, candidates[], proposals[{host,title,kind,why,how,spec[],impact,effort,tag}], verdicts[{title,verdict,evidence}], inference_ran}` |
| `hn-digest.json` | hn_digest.py | `{generated, stats{user,karma,created,comments}, picks[{id,title,url,story_url,comments,points,why,briefing,commented}]}` |
| `reddit-digest.json` | reddit_digest.py | `{generated, user, auth, picks[{id,title,url,sub,comments,score,age_days,why,briefing,commented}]}` |
| `last-run.json` | daily.py | `{ts, failures, steps:[{name, ok, seconds}]}` |
| `daily-ops.log` | daily.py | appended stdout of each run |

Committed, human-curated inputs:

| Path | Purpose |
|---|---|
| `config/backlog.json` | `{actions:[Action…], shippedWatch:{url:note}}` — your strategic queue. `Action` = `{id, host, title, kind, why, how, spec[], impact, effort:"S"\|"M"\|"L", tag, watching?}` |
| `config/insights.json` | `{date, insights:[{title, verdict, body[], move}]}` — optional narrative briefing |
| `content/drafts/*.md` | Distribution drafts with front-matter `title, order, action, channel, status, tags, notes` |
| `content/campaigns/*.json` | `{slug, name, site, summary, voice, targets[{rank,name,category,url,contact,angle,value,likelihood,evidence,status}], templates[{id,audience,subject,body}], plan[{day,action,template,notes}], week2, later, cautions[]}` |
| `docs/daily-log.md` | Appended by the daily run; one `## YYYY-MM-DD` section per day |

## The action engine (src/actions.ts)

Rules over the 90-day window, each producing `Action`s with an evidence
string, a concrete move, a spec, an impact estimate (clicks/month, **for
ordering only**) and an effort size. Score = impact / effort weight
(S=1, M=2.5, L=5). Rules: metadata-audit findings, CTR gaps, striking
distance (pos 5–15), probe hygiene, landing-page engagement mismatch, 28-day
traffic drop. Merged with `config/backlog.json`; any action whose page is in
`shippedWatch` is shown as *watching* instead of *active*.

The backlog file is hot-reloaded (stat polling) so edits — by hand or via
the dashboard's accept/watch/retire buttons — show up without a restart.

## Modules (opt-in, `modules.<key>.enabled`)

| Key | Default | What it turns on |
|---|---|---|
| `indexStatus` | on | URL Inspection sweep of each sitemap |
| `metadataAudit` | on | live title/description audit |
| `opportunityScan` | on | trend refresh + uncovered-riser detection |
| `llm` | off | local inference command (`command`, `fastCommand`; prompt on stdin, reply on stdout). Enables proposals/verdicts in the scan and briefings in the digests |
| `hackerNews` | off | HN thread digest (`user`, `topics:[[query, why]]`) |
| `reddit` | off | Reddit thread digest (`user`, `topics:[[sub, query, why]]`; creds in `.env`) |
| `indexNow` | off | key generation + pings (`keyFile`) |
| `staticExport` | off | dashboard → `site/` after each run (`signOutUrl`, `signOutLabel` add a sign-out link to every exported page) |
| `publish` | off | copy `site/` to `destination` (`target`: `gcs` \| `s3` \| `rsync` \| `command`; `delete`, `dryRun`, `env`) |
| `gitAutoCommit` | off | commit (+push) log/export after each run |
| `notifications` | off | macOS notification on step failure |

The dashboard's **Settings** page toggles these and edits the digest topics,
writing back to `n-seo.config.json`. Nothing in any module posts, sends,
or publishes on your behalf: digests produce briefings, the scan produces
proposals, campaigns produce templates. You act.

## Dashboard routes

`/` overview (Today board + portfolio strip) · `/actions` (proposed → active
→ watching, searchable) · `/insights` · `/trends[/N]` · `/content` (+
`/drafts/:slug`, `/campaigns/:slug`) · `/site/:host` · `/indexing` ·
`/probes` · `/logs` · `/settings` · `/api/actions` (JSON) · `/mcp` (HTTP
MCP, bearer token) · write endpoints: `POST /api/backlog/accept`,
`POST /api/backlog/:id/watch`, `POST /api/backlog/:id/retire`,
`POST /settings`.

## Engine and instance

The checkout is the **engine**: code, public assets, engine docs. An
**instance** is one user's config, queue, content and data. By default they
are the same directory ("in-place" mode — a plain clone works unchanged).
Set `N_SEO_INSTANCE=/path/to/instance` (or use the `n-seo` CLI, which sets it
for you) to keep them apart; upgrading the engine is then a `git pull` or
`npm update` that never touches instance files.

| Owned by | Paths |
|---|---|
| engine (`ROOT`) | `src/`, `ingest/`, `ops/`, `probes/`, `public/`, `bin/`, `tests/`, `n-seo.config.example.json`, `docs/PLAYBOOK.md`, `docs/OPERATING-RULES.md`, `docs/ARCHITECTURE.md` |
| instance (`INSTANCE`) | `n-seo.config.json` (`N_SEO_CONFIG` still overrides), `.env`, `config/backlog.json`, `config/insights.json`, `content/drafts/`, `content/campaigns/`, `data/`, `site/`, `docs/daily-log.md`, `docs/reports/`, the IndexNow key file (`modules.indexNow.keyFile`, relative to the instance) |

Both loaders expose the split: `src/config.ts` → `ROOT`, `INSTANCE`,
`engineInfo()`; `ingest/seo_config.py` → `ROOT`, `INSTANCE`, `DATA`,
`engine_info()`. Engine scripts always run with `cwd=ROOT` and find the
instance through the environment, never through the working directory.
Git auto-commit commits in the instance. `engine_info` (MCP), the Engine
card on `/settings`, `n-seo version` and the first block of `doctor` all
report version · commit · mode · engine path · instance path.

### Hooks

```json
"hooks": {
  "beforeRun": ["python3 my/prep.py"],
  "afterStep": { "daily-diff": ["python3 my/sync.py"] },
  "afterRun":  ["rsync -a site/ user@host:/srv/mirror/"]
}
```

Each entry is a shell string run by `ops/daily.py` with `cwd=INSTANCE` and
`N_SEO_ROOT`, `N_SEO_INSTANCE`, `N_SEO_STEP` (afterStep only) in the
environment. Output is teed to `data/daily-ops.log` like a step and each hook
is recorded in `last-run.json` as `hook:before:<i>`, `hook:<step>:<i>` or
`hook:after:<i>`. A failing hook counts as a failure (and notifies) but never
aborts the run. `afterRun` hooks see a complete `last-run.json`. `--skip hooks`
runs steps only; `--list` shows hooks in order.

Two things worth knowing before you put something destructive in a hook.
Hooks are run-level, not step-level: `beforeRun` and `afterRun` fire even
under `--only`, so a one-step smoke test still runs them (the command prints
a note when it is about to). And `afterStep` fires whether or not its step
succeeded, so a hook that publishes something should check the step's own
output rather than assume it ran.

### `gscExtraProperties`

```json
"gscExtraProperties": ["https://example.com/"]
```

Extra Search Console properties (for example a url-prefix property that
duplicates a domain property) pulled by `pull_gsc.py` and `pull_timeseries.py`
into `data/gsc/<gscDataSlug>/` with the same windows and datasets (a url-prefix
property lands in `<host>-urlprefix/`, never colliding with the domain
property's directory), and checked by `doctor`. They are not sites: nothing in the dashboard, the trend analysis or
the reports shows them.

### The `n-seo` CLI (`bin/n-seo.mjs`)

| Command | Does |
|---|---|
| `n-seo init [dir]` | Scaffold an instance: config from the example, empty `config/`, `content/`, `.env`, `.gitignore`, `.mcp.json` pointing at this engine, README. Never overwrites |
| `n-seo start` · `dev` · `daily` · `doctor` · `demo` · `mcp` · `check` · `export` | Run the engine's command against the instance (`--instance <path>`, else `$N_SEO_INSTANCE`, else cwd); remaining args pass through |
| `n-seo upgrade` | Git engine: `git pull --ff-only`, `npm ci` if the lockfile changed, `npm run check`; prints the exact `git reset --hard <sha>` if the check fails. npm engine: says to `npm update n-seo` |
| `n-seo version` | engine version, commit, engine path, instance path, mode |

## Operating rules the tooling encodes

- Decisions ride the 90-day window; 16-month data is for totals and history.
- Impact numbers order the queue. They are not forecasts.
- After changing a page's title/description, freeze that page's metadata for
  28 days. Stagger metadata changes (≈8/week max across all sites).
- Shipped work becomes *watching*, never deleted — the data decides next.
- Community participation is human: the tool briefs, you write.
