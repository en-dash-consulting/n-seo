# Architecture

seo-agent is a local-first control plane for organic growth across one or
more websites: **SEO** (classic search), **AEO** (answer engines: featured
snippets, AI Overviews) and **GEO** (being cited by ChatGPT, Claude,
Perplexity). It runs on your machine, keeps all data in local JSON files, and
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
                    └─────────────────────────────────────────────────┘
                                          │
                       dashboard (src/server.tsx, Hono + hono/jsx SSR)
                       reads data/ + config/ + content/ on every request
                                          │
                       MCP server (src/mcp.ts) — the same data for agents
```

## One config file

`seo-agent.config.json` (copy from `seo-agent.config.example.json`; path
overridable with `$SEO_AGENT_CONFIG`) is read by the TypeScript app
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

Derived helpers (identical in both languages): `gscSlug(property)` → the
`data/gsc/<slug>/` directory name: strip `sc-domain:` / scheme, strip the
trailing slash, `/`→`_`.

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
| `staticExport` | off | dashboard → `site/` after each run |
| `gitAutoCommit` | off | commit (+push) log/export after each run |
| `notifications` | off | macOS notification on step failure |

The dashboard's **Settings** page toggles these and edits the digest topics,
writing back to `seo-agent.config.json`. Nothing in any module posts, sends,
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

## Operating rules the tooling encodes

- Decisions ride the 90-day window; 16-month data is for totals and history.
- Impact numbers order the queue. They are not forecasts.
- After changing a page's title/description, freeze that page's metadata for
  28 days. Stagger metadata changes (≈8/week max across all sites).
- Shipped work becomes *watching*, never deleted — the data decides next.
- Community participation is human: the tool briefs, you write.
