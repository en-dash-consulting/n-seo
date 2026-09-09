/** Server-rendered views (hono/jsx). */
import type { FC, PropsWithChildren } from "hono/jsx";
import { SITES, config, loadConfig, USING_EXAMPLE_CONFIG, type SiteCfg } from "./config.js";
import * as data from "./data.js";
import { actionsFor, allActions, type Action } from "./actions.js";
import { insights as loadInsights } from "./insights.js";

const pct = (x: number, digits = 1) => `${(100 * x).toFixed(digits)}%`;
const num = (x: number) => Math.round(x).toLocaleString("en-US");

/** The n-seo mark: the rising line breaking out of the plot, on brand teal.
 *  Kept in step with public/favicon.svg and the marketing site. */
export const Mark: FC<{ size?: number }> = ({ size = 22 }) => (
  <svg class="brand-mark" width={size} height={size} viewBox="0 0 300 300" fill="none" aria-hidden="true">
    <path d="M300 0H0V300H300V0Z" fill="#00E5B9" />
    <path d="M300 239.902H32.0074V255.489H300V239.902Z" fill="#00FFCE" />
    <path d="M55.7684 202.351L118.59 139.53L160.47 181.41L244.232 97.6489" stroke="#001769" stroke-width="27.4428" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M181.411 97.6489H244.232V160.47" stroke="#001769" stroke-width="27.4428" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
);

export const Layout: FC<PropsWithChildren<{ title: string; active: string }>> = ({
  title,
  active,
  children,
}) => {
  loadConfig(); // refresh USING_EXAMPLE_CONFIG
  const cfg = config();
  const sites = cfg.sites;
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="stylesheet" href={`/styles.css?v=${data.styleVersion()}`} />
      </head>
      <body>
        <header class="topbar">
          <a href="/" class="brand"><Mark /> <span class="brand-name">{cfg.name}</span> <span class="brand-sub">n-seo</span></a>
          <nav>
            <a href="/" class={active === "overview" ? "on" : ""}>Overview</a>
            <a href="/actions" class={active === "actions" ? "on" : ""}>Actions</a>
            <a href="/insights" class={active === "insights" ? "on" : ""}>Insights</a>
            <a href="/trends" class={active === "trends" ? "on" : ""}>Trends</a>
            <a href="/content" class={active === "content" ? "on" : ""}>Content</a>
            <details class="nav-menu">
              <summary class={sites.some((s) => s.host === active) ? "on" : ""}>Sites ▾</summary>
              <div class="nav-panel">
                {sites.map((s) => (
                  <a href={`/site/${s.host}`} class={active === s.host ? "on" : ""}>{s.host}</a>
                ))}
                {sites.length === 0 && <span class="nav-empty">no sites configured</span>}
              </div>
            </details>
            <a href="/indexing" class={active === "indexing" ? "on" : ""}>Indexing</a>
            <a href="/probes" class={active === "probes" ? "on" : ""}>Probes</a>
            <a href="/logs" class={active === "logs" ? "on" : ""}>Logs</a>
            <a href="/settings" class={active === "settings" ? "on" : ""}>Settings</a>
          </nav>
          {/* Empty here on purpose. ops/export_static.py replaces this span
              with a sign-out link when the mirror sits behind an auth proxy
              (modules.staticExport.signOutUrl); the live dashboard has
              nothing to sign out of. */}
          <span id="export-slot"></span>
        </header>
        {USING_EXAMPLE_CONFIG && (
          <div class="notice-bar">
            Running on the example config — <a href="/settings">open Settings</a> to create yours (or copy <code>n-seo.config.example.json</code> to <code>n-seo.config.json</code>).
          </div>
        )}
        <main>{children}</main>
        <footer>
          Local controller · refreshed by <code>ops/daily.py</code> · queue in <code>config/backlog.json</code> · nothing here posts or publishes for you
        </footer>
        <script dangerouslySetInnerHTML={{ __html: `document.addEventListener('click',function(e){var d=e.target.closest('dialog');if(d&&e.target===d)d.close();});` }} />
      </body>
    </html>
  );
};

const Delta: FC<{ recent: number; prior: number }> = ({ recent, prior }) => {
  if (!prior) return <span class="delta flat">—</span>;
  const change = (recent - prior) / prior;
  const cls = change > 0.05 ? "up" : change < -0.05 ? "down" : "flat";
  const arrow = change > 0.05 ? "▲" : change < -0.05 ? "▼" : "•";
  return <span class={`delta ${cls}`}>{arrow} {pct(Math.abs(change), 0)}</span>;
};

const effortLabel = (e: Action["effort"], long = false) =>
  e === "S" ? (long ? "small effort" : "small") : e === "M" ? (long ? "medium effort" : "medium") : long ? "large effort" : "large";

export const ActionModal: FC<{ a: Action; id: string }> = ({ a, id }) => (
  <dialog id={id} class="action-modal">
    <div class="modal-head">
      <div>
        <div class="action-kind">{a.kind} · {a.host}</div>
        <h3>{a.title}</h3>
      </div>
      <form method="dialog"><button class="close" aria-label="Close">✕</button></form>
    </div>
    <div class="modal-chips">
      <span class="chip impact" title="estimated clicks/month — orders the queue, not a forecast">≈ +{a.impact} clicks/mo</span>
      <span class={`chip effort e-${a.effort}`}>{effortLabel(a.effort, true)}</span>
      <span class="chip tag">{a.tag}</span>
      <span class="chip">{a.source === "backlog" ? "curated" : a.source === "proposal" ? "proposed" : "data-derived"}</span>
    </div>
    {a.watching && <p class="action-watching">⏳ {a.watching}</p>}
    <h4>Why (the data)</h4>
    <p>{a.why}</p>
    <h4>The move</h4>
    <p>{a.how}</p>
    <h4>Spec</h4>
    <ul class="spec">
      {a.spec.map((s) => <li>{s}</li>)}
    </ul>
    {a.source === "backlog" ? (
      <div class="modal-actions">
        {!a.watching && (
          <form method="post" action={`/api/backlog/${encodeURIComponent(a.id)}/watch`} class="inline-form">
            <input type="text" name="note" placeholder="what shipped, when — e.g. 'title rewritten 3/4, frozen until 4/1'" />
            <button type="submit" class="btn">Mark watching</button>
          </form>
        )}
        <form method="post" action={`/api/backlog/${encodeURIComponent(a.id)}/retire`} class="inline-form"
          onsubmit="return confirm('Remove this item from config/backlog.json? Prefer Mark watching if the work shipped.')">
          <button type="submit" class="btn btn-quiet">Retire</button>
        </form>
      </div>
    ) : a.source === "proposal" ? (
      <p class="modal-note">Proposed by the opportunity scan. Accept it into your queue with the button on the card, or ignore it — it is replaced on the next scan.</p>
    ) : (
      <p class="modal-note">Data-derived: this card disappears on its own once the numbers move. If the fix shipped, add the page to <code>shippedWatch</code> in <code>config/backlog.json</code> with a dated note and it shows as watching.</p>
    )}
  </dialog>
);

const searchText = (a: Action) => `${a.title} ${a.host} ${a.tag} ${a.kind} ${a.why}`.toLowerCase();

export const ActionCard: FC<{ a: Action; rank: number; id: string; showHost?: boolean }> = ({ a, rank, id, showHost }) => (
  <>
    <button class="action" data-search={searchText(a)} onclick={`document.getElementById('${id}').showModal()`}>
      <div class="action-head">
        <span class="rank">{rank}</span>
        <span class="chip impact" title="estimated clicks/month gained — orders the queue, not a forecast">+{a.impact}/mo</span>
        <span class={`chip effort e-${a.effort}`}>{effortLabel(a.effort)}</span>
      </div>
      <div class="action-title">{a.title}</div>
      <div class="action-kind">{a.kind}</div>
      <div class="action-why">{a.why}</div>
      <div class="action-foot">
        {showHost && <span class="action-host">{a.host}</span>}
        <span class="chip tag">{a.tag}</span>
        <span class="spacer" />
        <span class="details-link">details</span>
      </div>
    </button>
    <ActionModal a={a} id={id} />
  </>
);

export const WatchRow: FC<{ a: Action; id: string }> = ({ a, id }) => (
  <>
    <button class="watch-row" data-search={searchText(a)} onclick={`document.getElementById('${id}').showModal()`}>
      <span class="strip-title">{a.title}</span>
      <span class="action-host">{a.host}</span>
      <span class="watch-note">{a.watching}</span>
      <span class="spacer" />
      <span class="chip tag">{a.tag}</span>
    </button>
    <ActionModal a={a} id={id} />
  </>
);

export const SearchBox: FC = () => (
  <input
    id="action-search"
    class="search-box"
    type="search"
    placeholder="Filter by title, site, tag, kind…"
    oninput="var q=this.value.toLowerCase();document.querySelectorAll('[data-search]').forEach(function(el){el.style.display=el.dataset.search.indexOf(q)>-1?'':'none'});"
  />
);

export const ActionQueue: FC<{ actions: Action[]; showHost?: boolean; idPrefix: string }> = ({ actions, showHost, idPrefix }) => (
  <div class="actions">
    {actions.map((a, i) => (
      <ActionCard a={a} rank={i + 1} id={`${idPrefix}-${i}`} showHost={showHost} />
    ))}
  </div>
);

export const SplitQueue: FC<{ actions: Action[]; idPrefix: string }> = ({ actions, idPrefix }) => {
  const active = actions.filter((a) => !a.watching);
  const watching = actions.filter((a) => a.watching);
  return (
    <>
      <h2 id="active">Active <small>({active.length} — ranked by clicks/month per unit of effort)</small></h2>
      {active.length ? (
        <ActionQueue actions={active} showHost idPrefix={`${idPrefix}-a`} />
      ) : (
        <p class="empty">Nothing active. Either the data has no findings yet (run <code>python3 ops/daily.py</code>) or the queue is clear — add strategic items in <code>config/backlog.json</code>.</p>
      )}
      {watching.length > 0 && (
        <>
          <h2 id="watching">Watching <small>({watching.length} — shipped; the data decides what happens next)</small></h2>
          <div class="action-strip watch-list">
            {watching.map((a, i) => <WatchRow a={a} id={`${idPrefix}-w-${i}`} />)}
          </div>
        </>
      )}
    </>
  );
};

const ProposalCard: FC<{ p: data.ScanOutput["proposals"][number]; index: number }> = ({ p, index }) => {
  const a: Action = { ...p, id: `proposal-${index}`, source: "proposal", effort: (["S", "M", "L"].includes(p.effort) ? p.effort : "M") as Action["effort"], spec: p.spec ?? [] };
  const id = `prop-${index}`;
  return (
    <div class="proposal">
      <ActionCard a={a} rank={index + 1} id={id} showHost />
      <form method="post" action="/api/backlog/accept" class="proposal-accept">
        <input type="hidden" name="index" value={String(index)} />
        <button type="submit" class="btn">Accept into queue</button>
      </form>
    </div>
  );
};

export const ActionsPage: FC<{ flash?: string }> = ({ flash }) => {
  const scan = data.opportunityScan();
  return (
    <>
      <div class="strip-head">
        <h1>Action queue</h1>
        <SearchBox />
      </div>
      <p class="sub">Data-derived rules (90-day window) + your curated queue (<code>config/backlog.json</code>). Click any item for the full spec. Impact numbers rank the queue — they are estimates for ordering, not forecasts.</p>
      {flash && <p class="flash">{flash}</p>}

      {scan && (scan.proposals.length > 0 || scan.verdicts.length > 0) && (
        <div class="scan-panel" id="proposed">
          <h2>Proposed by the opportunity scan <small>· {scan.generated} — rising queries no queue item covers, turned into candidate moves. Accepting copies a proposal into your queue; nothing self-modifies it.</small></h2>
          {scan.proposals.length > 0 && (
            <div class="actions">
              {scan.proposals.map((pr, i) => <ProposalCard p={pr} index={i} />)}
            </div>
          )}
          {scan.verdicts.length > 0 && (
            <>
              <h3 class="or-h">Scan verdicts on watching items <small>— review triggers, not auto-actions</small></h3>
              <ul class="log-lines">
                {scan.verdicts.map((v) => (
                  <li class={v.verdict === "failed" ? "log-alert" : ""}>
                    <b>{v.verdict.toUpperCase()}</b> — {v.title}: {v.evidence}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {scan && !scan.proposals.length && scan.candidates.length > 0 && (
        <p class="sub">The scan found {scan.candidates.length} uncovered rising quer{scan.candidates.length === 1 ? "y" : "ies"} but the LLM module is off, so there are no drafted proposals — see <a href="/insights">Insights</a> for the raw risers, or enable it in <a href="/settings">Settings</a>.</p>
      )}

      <SplitQueue actions={allActions()} idPrefix="all" />
    </>
  );
};

const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export const Overview: FC = () => {
  const now = new Date();
  const dateLabel = `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`;
  const sites = SITES();
  const lr = data.lastRun();
  const runFailed = Boolean(lr && lr.failures.trim());
  const probe = data.latestProbe();
  const probed = probe?.sites ?? [];
  const healthy = probed.filter((p) => data.probeHealthy(p)).length;
  const board = data.todayBoard();
  const ship = allActions().filter((a) => !a.watching).slice(0, 3);
  const VERB_CLASS: Record<string, string> = { Fix: "v-fix", Approve: "v-approve", Publish: "v-publish", Comment: "v-comment", Ship: "v-ship" };
  const f = data.funnelSummary();
  return (
    <>
      <div class="ov-hero">
        <div>
          <h1>{dateLabel}</h1>
          <p class="sub">Your moves first, then the sites. Everything below is derived live from the data on disk.</p>
        </div>
        <div class="chip-row ov-status">
          {lr ? (runFailed
            ? <a class="chip bad" href="/logs">daily run FAILED</a>
            : <a class="chip good" href="/logs">daily run OK · {lr.ts.slice(5, 16)}</a>)
            : <a class="chip" href="/logs">no daily run yet</a>}
          {probed.length > 0 && (
            <a class={`chip ${healthy === probed.length ? "good" : "bad"}`} href="/probes">{healthy}/{probed.length} sites healthy</a>
          )}
        </div>
      </div>

      <section class="wb">
        <div class="wb-head">
          <span class="wb-num">→</span>
          <div>
            <h2>Today</h2>
            <p class="sub">What's waiting on you, grouped by the kind of move. Every row is a link.</p>
          </div>
        </div>
        <div class="today-grid">
          {board.map((g) => (
            <div class={`today-col ${VERB_CLASS[g.verb] ?? ""}`}>
              <div class="today-verb">{g.verb} <span class="today-count">{g.items.length}</span></div>
              <p class="today-blurb">{g.blurb}</p>
              {g.items.slice(0, 3).map((it) => (
                <a class="today-item" href={it.href}>
                  <span class="today-title">{it.title}</span>
                  {it.chip && <span class="chip">{it.chip}</span>}
                </a>
              ))}
              {g.items.length > 3 && (
                <a class="today-more" href={g.items[0].href.startsWith("/drafts") ? "/content#publish" : g.items[0].href}>
                  +{g.items.length - 3} more →
                </a>
              )}
            </div>
          ))}
          <div class="today-col v-ship">
            <div class="today-verb">Ship <span class="today-count">{ship.length}</span></div>
            <p class="today-blurb">top of the action queue by impact per effort</p>
            {ship.map((a) => (
              <a class="today-item" href="/actions">
                <span class="today-title">{a.title}</span>
                <span class="chip impact">+{a.impact}/mo</span>
              </a>
            ))}
            {ship.length === 0 && <p class="today-blurb">queue is empty — run the daily job or add items to config/backlog.json</p>}
            <a class="today-more" href="/actions">full queue →</a>
          </div>
        </div>
      </section>

      <h2>Sites <small>— click a row for the full picture</small></h2>
      {sites.length ? (
        <div class="action-strip">
          <div class="p-row p-head">
            <span>site</span><span></span><span>sessions · 90d</span><span>28d</span><span>Google clicks · 16mo</span><span>AI</span><span>search</span><span></span>
          </div>
          {sites.map((site) => {
            const mix = data.trafficMix(site);
            const trend = data.sessionTrend(site);
            const gsc = data.gscSummary(site);
            const p = data.probeFor(site);
            const ok = data.probeHealthy(p);
            return (
              <a class="p-row" href={`/site/${site.host}`}>
                <span class="domain">{site.host}</span>
                <span class={`dot ${p ? (ok ? "ok" : "warn") : "none"}`} title={p ? (ok ? "probe healthy" : "probe findings") : "not probed yet"} />
                <span class="p-num">{mix.sessions || site.ga4Property ? num(mix.sessions) : "—"}</span>
                <span>{mix.sessions || site.ga4Property ? <Delta recent={trend.recent} prior={trend.prior} /> : <span class="delta flat">—</span>}</span>
                <span class="p-num">{gsc.impressions || site.gscProperty ? num(gsc.clicks) : "—"}</span>
                <span class="p-num">{mix.sessions ? pct(mix.ai / mix.sessions) : "—"}</span>
                <span class="p-num">{mix.sessions ? pct(mix.search / mix.sessions, 0) : "—"}</span>
                <span class="details-link">→</span>
              </a>
            );
          })}
        </div>
      ) : (
        <p class="empty">No sites configured yet — add them to <code>n-seo.config.json</code> (see <a href="/settings">Settings</a>).</p>
      )}

      {f.configured && (f.instrumented ? (
        <div class="funnel-panel">
          <div class="strip-head"><h2>Conversions <small>— {f.site}: the goal the traffic serves</small></h2></div>
          <div class="stat-row">
            {f.events.map((ev) => (
              <div class="stat"><b>{(f.total28[ev] ?? 0).toLocaleString()}</b><small>{ev} · 28d</small></div>
            ))}
            <div class="chip-row">
              {Object.entries(f.bySource).sort((a, b) => b[1] - a[1]).map(([src, n]) => (
                <span class="chip ai">{src}: {n}</span>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p class="funnel-line">
          <b>Conversions</b> — configured for {f.site} ({f.events.join(", ")}) but no events have arrived yet. Register them as GA4 key events; this becomes live numbers once they flow.
        </p>
      ))}

      <details class="wb-fold">
        <summary>Data freshness <small>— what the daily run last refreshed</small></summary>
        <div class="tbl-wrap">
          <table class="slim">
            {data.dataFreshness().map((fr) => (
              <tr>
                <td>{fr.label}</td>
                <td class="mono">{fr.mtime}</td>
              </tr>
            ))}
          </table>
        </div>
      </details>
    </>
  );
};

const QueryTable: FC<{ rows: data.GscRow[] }> = ({ rows }) => (
  <div class="tbl-wrap">
    <table>
      <thead>
        <tr><th>Query</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Pos</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr>
            <td>{r.keys[0]}</td>
            <td>{num(r.clicks)}</td>
            <td>{num(r.impressions)}</td>
            <td>{pct(r.ctr)}</td>
            <td>{r.position.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const SiteDetail: FC<{ site: SiteCfg }> = ({ site }) => {
  const mix = data.trafficMix(site);
  const trend = data.sessionTrend(site);
  const gsc = data.gscSummary(site);
  const striking = data.strikingDistance(site).slice(0, 15);
  const gaps = data.ctrGaps(site).slice(0, 12);
  const topQueries = data.queries(site).slice(0, 15);
  const topPages = data.pages(site).slice(0, 12);
  const landing = data.landingPages(site).slice(0, 12);
  const probe = data.probeFor(site);
  const xref = data.crossReferrals(site);
  const siteActions = actionsFor(site);
  return (
    <>
      <h1>{site.host}</h1>
      <p class="sub">
        {site.hosting && <>hosted on {site.hosting} · </>}
        {site.repo && <>repo <code>{site.repo}</code> · </>}
        {site.gscProperty ? <>Search Console <code>{site.gscProperty}</code></> : "no Search Console property configured"}
        {site.ga4Property ? <> · GA4 <code>{site.ga4Property}</code></> : " · no GA4 property configured"}
      </p>
      <div class="statline">
        <span><b>{num(mix.sessions)}</b> sessions · 90d</span>
        <span>28d <Delta recent={trend.recent} prior={trend.prior} /> ({num(trend.recent)} vs {num(trend.prior)})</span>
        <span title="Google Search only, over the full 16-month retention window"><b>{num(gsc.clicks)}</b> Google clicks / <b>{num(gsc.impressions)}</b> impressions · 16 mo · CTR {pct(gsc.ctr)}</span>
        <span class={mix.ai ? "ai-badge" : ""}>AI referrals: <b>{num(mix.ai)}</b> ({mix.sessions ? pct(mix.ai / mix.sessions) : "—"})</span>
      </div>

      {probe && (
        <div class="probe-line">
          {([
            ["robots.txt", probe.robots.exists],
            ["sitemap", probe.sitemap.exists],
            ["llms.txt", probe["llms.txt"].exists],
            ["real 404", probe.soft_404.real_404],
            ["JSON-LD", (probe.homepage.jsonld_types?.length ?? 0) > 0],
          ] as [string, boolean | undefined][]).map(([label, ok]) => (
            <span class={`pill ${ok ? "ok" : "bad"}`}>{label}</span>
          ))}
          <span class="pill neutral">{num(probe.homepage.visible_text_bytes ?? 0)}B visible text</span>
        </div>
      )}

      {siteActions.length > 0 && (
        <>
          <h2>Do next</h2>
          <ActionQueue actions={siteActions.slice(0, 8)} idPrefix="site" />
        </>
      )}

      {mix.aiSources.length > 0 && (
        <>
          <h2>AI referral sources · 90d</h2>
          <div class="tbl-wrap"><table>
            <tbody>
              {mix.aiSources.map((s) => (
                <tr><td class="mono">{s.source}</td><td>{num(s.sessions)} sessions</td></tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}

      {xref.length > 0 && (
        <>
          <h2>Referrals from your other sites · 90d</h2>
          <div class="tbl-wrap"><table>
            <tbody>
              {xref.map((s) => (
                <tr><td class="mono">{s.source}</td><td>{num(s.sessions)} sessions</td></tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}

      <h2>Striking distance <small>(pos 5–15, the cheapest wins)</small></h2>
      {striking.length ? <QueryTable rows={striking} /> : <p class="empty">none at threshold</p>}

      <h2>CTR gaps <small>(ranking well, clicked rarely — title/snippet problems)</small></h2>
      {gaps.length ? <QueryTable rows={gaps} /> : <p class="empty">none at threshold</p>}

      <h2>Top queries · 16mo</h2>
      {topQueries.length ? <QueryTable rows={topQueries} /> : <p class="empty">no Search Console data yet</p>}

      <h2>Top pages (Google clicks)</h2>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Page</th><th>Clicks</th><th>Impressions</th><th>Pos</th></tr></thead>
        <tbody>
          {topPages.map((r) => (
            <tr>
              <td class="mono trunc">{r.keys[0].replace(/^https?:\/\/[^/]+/, "") || "/"}</td>
              <td>{num(r.clicks)}</td>
              <td>{num(r.impressions)}</td>
              <td>{r.position.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>

      {landing.length > 0 && (
        <>
          <h2>Landing pages (GA4 · 90d)</h2>
          <div class="tbl-wrap"><table>
            <thead><tr><th>Page</th><th>Sessions</th><th>Engagement</th></tr></thead>
            <tbody>
              {landing.map((l) => (
                <tr>
                  <td class="mono trunc">{l.page}</td>
                  <td>{num(l.sessions)}</td>
                  <td class={l.engagement < 0.2 ? "bad-text" : ""}>{pct(l.engagement, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}
    </>
  );
};

export const Probes: FC = () => {
  const probe = data.latestProbe();
  if (!probe) return <><h1>Live-site probe</h1><p class="empty">No probe snapshots yet — run <code>python3 probes/site_probe.py</code></p></>;
  return (
    <>
      <h1>Live-site probe</h1>
      <p class="sub">Snapshot {probe.probed_at} · no-auth checks of what crawlers actually see. Re-run any time: <code>python3 probes/site_probe.py</code></p>
      <div class="tbl-wrap"><table>
        <thead>
          <tr><th>Site</th><th>robots</th><th>AI crawlers</th><th>sitemap</th><th>llms.txt</th><th>404</th><th>JSON-LD</th><th>visible text</th><th>Title</th></tr>
        </thead>
        <tbody>
          {probe.sites.map((s) => (
            <tr>
              <td class="mono">{s.site.replace(/^https?:\/\//, "")}</td>
              <td>{s.robots.exists ? "✓" : "✗"}</td>
              <td class={s.robots.ai_crawlers_blocked?.length ? "bad-text" : ""}>{s.robots.ai_crawlers_blocked?.length ? `blocks ${s.robots.ai_crawlers_blocked.join(", ")}` : "open"}</td>
              <td>{s.sitemap.exists ? `✓ ${s.sitemap.url_count ?? ""}` : "✗"}</td>
              <td>{s["llms.txt"].exists ? "✓" : "✗"}</td>
              <td>{s.soft_404.real_404 ? "✓" : "soft!"}</td>
              <td class="mono">{(s.homepage.jsonld_types ?? []).join(", ") || "—"}</td>
              <td class={(s.homepage.visible_text_bytes ?? 0) < 500 ? "bad-text" : ""}>{num(s.homepage.visible_text_bytes ?? 0)}B</td>
              <td class="trunc">{s.homepage.title ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
};

/** Worst first: a page Google has never fetched needs a different response
 *  from one it fetched and declined. */
const COVERAGE_ORDER = [
  "URL is unknown to Google",
  "Discovered - currently not indexed",
  "Soft 404",
  "Crawled - currently not indexed",
];

const COVERAGE_HELP: Record<string, string> = {
  "URL is unknown to Google": "Not discovered at all — check the sitemap and internal links.",
  "Discovered - currently not indexed": "Known but never fetched. Request Indexing (manual, in the Search Console UI) moves these.",
  "Soft 404": "Serves 200 but Google reads it as an error or empty page.",
  "Crawled - currently not indexed": "Google fetched it and declined — a content/value judgement.",
};

const STALE_DAYS = 90;

/** A verdict is only as current as the crawl behind it. A URL can read as
 *  "Soft 404" off a crawl from months ago while serving a perfectly healthy
 *  page today — chasing that as a template bug is wasted work. Flag the age
 *  so the page can't imply a problem it can't see. */
function staleVerdict(lastCrawl?: string | null): boolean {
  if (!lastCrawl) return false;
  const days = (Date.now() - new Date(lastCrawl).getTime()) / 86_400_000;
  return days > STALE_DAYS;
}

/** Search Console's sitemap state. Worth showing because the console prints
 *  a bare "Couldn't fetch" for a sitemap Google has merely not read yet,
 *  which looks like a failure — pending with zero errors is a queue, not a
 *  problem. */
const SitemapLine: FC<{ sitemap?: data.IndexStatus["sites"][string]["sitemap"] }> = ({ sitemap }) => {
  if (!sitemap) return null;
  if (sitemap.submitted === 0) {
    return <p class="idx-sitemap">No sitemap submitted in Search Console.</p>;
  }
  return (
    <>
      {sitemap.entries.map((e) => (
        <p class="idx-sitemap">
          sitemap {e.errors ? <strong>{e.errors} errors</strong> : "0 errors"}
          {e.warnings ? `, ${e.warnings} warnings` : ""} ·{" "}
          {e.lastDownloaded
            ? `last read ${e.lastDownloaded.slice(0, 10)}`
            : e.pending
              ? "queued — Google has not read it yet (this is what the console shows as “Couldn’t fetch”)"
              : "never read"}
        </p>
      ))}
    </>
  );
};

export const IndexingPage: FC = () => {
  const status = data.indexStatus();
  if (!status) {
    return (
      <>
        <h1>Indexing</h1>
        <p class="empty">
          No index snapshot yet — enable the <b>Index coverage sweep</b> module and run <code>python3 ingest/pull_index_status.py</code>
        </p>
      </>
    );
  }
  const hosts = Object.entries(status.sites);
  const totalProblems = hosts.reduce((n, [, s]) => n + s.problems.length, 0);
  const totalNever = hosts.reduce((n, [, s]) => n + s.neverCrawled, 0);
  return (
    <>
      <h1>Indexing</h1>
      <p class="sub">
        Search Console's verdict on every sitemap URL · {totalProblems} not indexed,{" "}
        {totalNever} never crawled · snapshot {status.generated.slice(0, 16).replace("T", " ")}
      </p>
      {hosts.map(([host, s]) => {
        if (s.problems.length === 0) {
          return (
            <section class="idx-host">
              <h2>
                {host} <small>{s.indexed}/{s.checked} indexed — all clear</small>
              </h2>
            </section>
          );
        }
        const groups = [...s.problems].sort(
          (a, b) =>
            (COVERAGE_ORDER.indexOf(a.coverage) + 1 || 99) -
              (COVERAGE_ORDER.indexOf(b.coverage) + 1 || 99) ||
            a.url.localeCompare(b.url),
        );
        let lastCoverage = "";
        return (
          <section class="idx-host">
            <h2>
              {host}{" "}
              <small>
                {s.indexed}/{s.checked} indexed · {s.neverCrawled} never crawled
              </small>
            </h2>
            <SitemapLine sitemap={s.sitemap} />
            <div class="tbl-wrap">
              <table>
                <thead>
                  <tr><th>URL</th><th>Last crawled</th></tr>
                </thead>
                <tbody>
                  {groups.map((p) => {
                    const header = p.coverage !== lastCoverage ? p.coverage : null;
                    lastCoverage = p.coverage;
                    return (
                      <>
                        {header && (
                          <tr class="idx-group">
                            <td colspan={2}>
                              <strong>{header}</strong>{" "}
                              <span class="idx-help">{COVERAGE_HELP[header] ?? p.detail ?? ""}</span>
                            </td>
                          </tr>
                        )}
                        <tr>
                          <td class="mono trunc">
                            <a href={p.url} target="_blank" rel="noopener noreferrer">
                              {p.url.replace(/^https?:\/\/[^/]+/, "") || "/"}
                            </a>
                            {p.canonicalMismatch && (
                              <span class="chip"> canonical → {p.googleCanonical}</span>
                            )}
                          </td>
                          <td class="mono">
                            {p.lastCrawl ? p.lastCrawl.slice(0, 10) : "never"}
                            {staleVerdict(p.lastCrawl) && (
                              <span class="idx-stale" title="Google has not looked since this verdict — recheck before treating it as a live bug">
                                {" "}stale
                              </span>
                            )}
                          </td>
                        </tr>
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
};

const VERDICT_LABEL: Record<string, string> = {
  opportunity: "Opportunity",
  warning: "Course correction",
  momentum: "Momentum",
  deprioritize: "Deprioritize",
};

export const InsightsPage: FC = () => {
  const t = data.latestTrends();
  const ins = loadInsights();
  const hostOfProp = (prop: string) => prop.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  return (
    <>
      <h1>Insights</h1>
      <p class="sub">
        {ins.insights.length
          ? <>Your briefing of {ins.date || "(undated)"} from <code>config/insights.json</code>, then the live trend tables (trailing 84 days vs the 84 before).</>
          : <>Live trend tables — trailing 84 days vs the 84 before, per Search Console property. Add your own narrative cards in <code>config/insights.json</code> and they appear above these.</>}
      </p>

      {ins.insights.length > 0 && (
        <div class="insights-grid">
          {ins.insights.map((i) => (
            <div class={`insight v-${i.verdict}`}>
              <div class="insight-verdict">{VERDICT_LABEL[i.verdict] ?? i.verdict}</div>
              <h3>{i.title}</h3>
              <p class="insight-move">{i.move}</p>
              <details class="insight-why">
                <summary>Why</summary>
                {i.body.map((p) => <p>{p}</p>)}
              </details>
            </div>
          ))}
        </div>
      )}

      {t ? (
        <>
          <h2>Rising & falling queries <small>— 84d vs prior 84d · analysis of {t.generated}</small></h2>
          {Object.entries(t.sites).filter(([, d]) => d.rising?.length || d.falling?.length).map(([site, d]) => (
            <details class="trend-tile">
              <summary>
                <span class="domain">{hostOfProp(site)}</span>
                <span class="chip good">{(d.rising ?? []).length} rising</span>
                <span class="chip bad">{(d.falling ?? []).length} falling</span>
                {d.recent_split && (
                  <span class="chip" title="clicks on non-branded queries, recent 84d">{Math.round(d.recent_split.generic_clicks).toLocaleString()} generic clicks</span>
                )}
                {d.recent_split && d.prior_split && (
                  <span class="chip" title="branded clicks recent vs prior 84d">branded {Math.round(d.prior_split.branded_clicks).toLocaleString()} → {Math.round(d.recent_split.branded_clicks).toLocaleString()}</span>
                )}
                <span class="spacer" />
                <span class="details-link">expand</span>
              </summary>
              <div class="tile-body">
                <div class="tbl-wrap"><table>
                  <thead><tr><th>Query</th><th>Prior 84d</th><th>Recent 84d</th><th>Pos</th><th></th></tr></thead>
                  <tbody>
                    {(d.rising ?? []).slice(0, 10).map((m) => (
                      <tr><td>{m.query}</td><td>{m.prior_imps.toLocaleString()}</td><td>{m.recent_imps.toLocaleString()}</td><td>{m.recent_pos}</td><td class="delta up">▲</td></tr>
                    ))}
                    {(d.falling ?? []).slice(0, 5).map((m) => (
                      <tr><td>{m.query}</td><td>{m.prior_imps.toLocaleString()}</td><td>{m.recent_imps.toLocaleString()}</td><td></td><td class="delta down">▼</td></tr>
                    ))}
                  </tbody>
                </table></div>
              </div>
            </details>
          ))}

          {t.ai_referrals && Object.keys(t.ai_referrals).length > 0 && (() => {
            const months = [...new Set(Object.values(t.ai_referrals!).flatMap((d) => Object.keys(d.total)))].sort().slice(-6);
            return (
              <details class="trend-tile">
                <summary>
                  <span class="domain">AI-referral sessions by month</span>
                  <span class="chip">the GEO scoreboard</span>
                  <span class="spacer" />
                  <span class="details-link">expand</span>
                </summary>
                <div class="tile-body">
                  <div class="tbl-wrap"><table>
                    <thead><tr><th>Site</th>{months.map((m) => <th>{m.slice(0, 4)}-{m.slice(4)}</th>)}</tr></thead>
                    <tbody>
                      {Object.entries(t.ai_referrals!).map(([site, d]) => (
                        <tr><td class="mono">{site}</td>{months.map((m) => <td>{Math.round(d.ai[m] ?? 0)}</td>)}</tr>
                      ))}
                    </tbody>
                  </table></div>
                </div>
              </details>
            );
          })()}
        </>
      ) : (
        <p class="empty">No trend analysis yet — run <code>python3 ingest/analyze_trends.py</code> (the opportunity-scan module does this daily).</p>
      )}
    </>
  );
};

const channelClass = (ch: string) => "ch-" + ch.toLowerCase().replace(/[^a-z]+/g, "");

const Briefing: FC<{ text?: string; labels: string[] }> = ({ text, labels }) => {
  const re = new RegExp(`^(${labels.join("|")}):\\s*(.*)$`);
  return (
    <>
      {(text || "").split("\n").filter((l) => l.trim()).map((line) => {
        const m = line.match(re);
        return m ? <p><span class="brief-label">{m[1]}</span> {m[2]}</p> : <p>{line}</p>;
      })}
      {!text && <p class="empty">No briefing generated (enable the LLM module for briefings) — open the thread directly.</p>}
    </>
  );
};

export const ContentPage: FC = () => {
  const mods = config().modules;
  const hnOn = !!mods.hackerNews?.enabled;
  const rdOn = !!mods.reddit?.enabled;
  const participate = hnOn || rdOn;
  const hn = hnOn ? data.hnDigest() : null;
  const rd = rdOn ? data.redditDigest() : null;
  const hunts = rdOn ? data.redditHunts() : [];
  const ds = data.drafts();
  const cs = data.campaigns();
  const contentActions = allActions().filter((a) => ["content", "distribution", "outreach"].includes(a.tag));
  const hnFresh = (hn?.picks ?? []).filter((p) => !p.commented).length;
  const activeCount = contentActions.filter((a) => !a.watching).length;
  let step = 0;
  const next = () => String(++step);
  const participateNum = participate ? next() : "";
  const publishNum = next();
  const campaignsNum = next();
  return (
    <>
      <h1>Content & distribution</h1>
      <p class="sub">
        Ordered like the work: {participate ? "comment daily, " : ""}publish what's ready, run the campaigns, check the queue. Nothing here posts on your behalf.
      </p>
      <div class="wb-nav">
        {participate && <a href="#participate"><span class="wb-num">{participateNum}</span> Participate <small>{hnOn ? `${hnFresh} HN briefed` : ""}{hnOn && rdOn ? " · " : ""}{rdOn ? `${hunts.length} Reddit hunts` : ""}</small></a>}
        <a href="#publish"><span class="wb-num">{publishNum}</span> Publish <small>{ds.length} draft{ds.length === 1 ? "" : "s"}</small></a>
        <a href="#campaigns"><span class="wb-num">{campaignsNum}</span> Campaigns <small>{cs.length ? `${cs.length} running` : "none"}</small></a>
        <a href="/actions"><span class="wb-num">→</span> Queue <small>{activeCount} content/distribution active</small></a>
      </div>

      {participate && (
        <section class="wb" id="participate">
          <div class="wb-head">
            <span class="wb-num">{participateNum}</span>
            <div>
              <h2>Participate</h2>
              <p class="sub">A few genuine comments a day where you actually know things — that account history is what makes launches land later. Briefings only; the words are always yours.</p>
            </div>
          </div>

          {hnOn && (
            <>
              <h3 class="wb-sub">Hacker News <small>{hn ? `· refreshed ${hn.generated.slice(0, 10)}` : ""}{hn?.stats?.user ? ` · ${hn.stats.user}: ${hn.stats.karma ?? "?"} karma, ${hn.stats.comments ?? 0} recent comments` : ""}</small></h3>
              {hn?.picks.length ? (
                <div class="action-strip">
                  {hn.picks.map((p) => (
                    <details class="hn-item">
                      <summary class="strip-row">
                        {p.commented && <span class="chip commented" title="you have already commented here">✓</span>}
                        <span class="strip-title" style="max-width:55%">{p.title}</span>
                        <span class="why">{p.why}</span>
                        <span class="spacer" />
                        <span class="chip" title="comments in the thread">{p.comments} comments</span>
                        <span class="chip" title="HN points">{p.points} pts</span>
                      </summary>
                      <div class="hn-brief">
                        <Briefing text={p.briefing} labels={["GIST", "THREAD", "ANGLE"]} />
                        <p><a href={p.url} target="_blank" rel="noopener">Open the HN thread →</a></p>
                        <p class="brief-note">Briefing only — the comment is yours to write.</p>
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <p class="empty">No fresh threads — the daily run refreshes this list (<code>python3 ops/hn_digest.py</code> any time).</p>
              )}
            </>
          )}

          {rdOn && (
            <>
              <h3 class="wb-sub">Reddit <small>· each chip opens that sub's past-week search in your browser — link a resource only when it directly answers the question</small></h3>
              {hunts.length ? (
                <div class="hunt-row">
                  {hunts.map((h) => (
                    <a
                      class="hunt-chip"
                      target="_blank"
                      rel="noopener"
                      title={`${h.q}${h.why ? ` — ${h.why}` : ""}`}
                      href={`https://www.reddit.com/r/${h.sub}/search/?q=${encodeURIComponent(h.q)}&restrict_sr=1&sort=new&t=week`}
                    >
                      r/{h.sub} <span class="hunt-go">→</span>
                    </a>
                  ))}
                </div>
              ) : (
                <p class="empty">Add subreddit topics in <a href="/settings">Settings</a> to get hunt links here.</p>
              )}
              {rd?.picks.length ? (
                <>
                  <h3 class="wb-sub">Auto-found Reddit picks <small>· {rd.generated.slice(0, 10)}</small></h3>
                  <div class="action-strip">
                    {rd.picks.map((p) => (
                      <details class="hn-item">
                        <summary class="strip-row">
                          {p.commented && <span class="chip commented" title="already commented here">✓</span>}
                          <span class="chip src">r/{p.sub}</span>
                          <span class="strip-title" style="max-width:50%">{p.title}</span>
                          <span class="why">{p.why}</span>
                          <span class="spacer" />
                          <span class="chip" title="comments in the thread">{p.comments} comments</span>
                          <span class="chip" title="thread age">{p.age_days}d old</span>
                        </summary>
                        <div class="hn-brief">
                          <Briefing text={p.briefing} labels={["GIST", "ANGLE"]} />
                          <p><a href={p.url} target="_blank" rel="noopener">Open the Reddit thread →</a></p>
                          <p class="brief-note">Briefing only — the comment is yours to write.</p>
                        </div>
                      </details>
                    ))}
                  </div>
                </>
              ) : rd && !rd.auth ? (
                <p class="empty">Reddit digest ran without credentials, so no threads were fetched — add REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET to <code>.env</code>.</p>
              ) : null}
            </>
          )}
        </section>
      )}

      <section class="wb" id="publish">
        <div class="wb-head">
          <span class="wb-num">{publishNum}</span>
          <div>
            <h2>Publish</h2>
            <p class="sub">Finished assets waiting on your voice pass. Open a card for the instructions and the full text.</p>
          </div>
        </div>
        {ds.length ? (
          <div class="action-strip">
            {ds.map((d) => (
              <a class="strip-row draft-row" href={`/drafts/${d.slug}`}>
                <span class="wb-num">{d.order}</span>
                <span class="draft-row-main">
                  <span class="draft-row-title">{d.title}</span>
                  {d.action && <span class="draft-row-action">{d.action}</span>}
                </span>
                <span class="spacer" />
                <span class={`chip src ${channelClass(d.channel)}`}>{d.channel}</span>
                <span class={`chip ${d.status.startsWith("ready") ? "good" : ""}`}>{d.status}</span>
                <span class="details-link">open →</span>
              </a>
            ))}
          </div>
        ) : (
          <p class="empty">No drafts staged. Add markdown files with front-matter (title, order, action, channel, status) in <code>content/drafts/</code>.</p>
        )}
      </section>

      <section class="wb" id="campaigns">
        <div class="wb-head">
          <span class="wb-num">{campaignsNum}</span>
          <div>
            <h2>Campaigns</h2>
            <p class="sub">Standing plays with their own targets, templates, and weekly plan. Sends are yours.</p>
          </div>
        </div>
        {cs.length ? (
          <div class="action-strip">
            {cs.map((c) => (
              <a class="today-item campaign-sum" href={`/campaigns/${c.slug}`}>
                <span class="today-title">{c.name}{c.site ? ` · ${c.site}` : ""} — {c.plan.length} planned sends, {c.templates.length} templates, {c.targets.length} ranked targets</span>
                <span class="chip good">open the playbook →</span>
              </a>
            ))}
          </div>
        ) : (
          <p class="empty">No campaign running. Add a JSON file in <code>content/campaigns/</code> (schema in docs/ARCHITECTURE.md).</p>
        )}
      </section>
    </>
  );
};

export const DraftPage: FC<{ d: data.Draft }> = ({ d }) => (
  <>
    <p class="crumb"><a href="/content#publish">← Content · Publish</a></p>
    <div class="chip-row">
      <span class={`chip src ${channelClass(d.channel)}`}>{d.channel}</span>
      <span class={`chip ${d.status.startsWith("ready") ? "good" : ""}`}>{d.status}</span>
      {d.tags && <span class="chip tag">{d.tags}</span>}
      <span class="chip">step {d.order} of the publish order</span>
    </div>
    <h1 class="draft-title">{d.title}</h1>

    <div class="draft-todo">
      <h2>What to do</h2>
      {d.action && <p class="draft-todo-action">{d.action}</p>}
      {d.notes && <p class="sub">{d.notes}</p>}
    </div>

    <div class="draft-page-body">
      <div class="draft-body-head">
        <span>The full text <small>· markdown, ready to paste</small></span>
        <button
          class="copy-btn"
          type="button"
          onclick="var b=document.querySelector('.draft-body');navigator.clipboard.writeText(b.textContent).then(()=>{this.textContent='copied ✓';setTimeout(()=>this.textContent='copy markdown',1500)});"
        >copy markdown</button>
      </div>
      <pre class="email-body draft-body">{d.body}</pre>
    </div>
    <p class="sub">Source: content/drafts/{d.slug}.md — edit there; delete the file to retire it.</p>
  </>
);

export const CampaignPage: FC<{ c: data.Campaign }> = ({ c }) => (
  <>
    <p class="crumb"><a href="/content#campaigns">← Content · Campaigns</a></p>
    <h1>{c.name}</h1>
    <p class="sub">
      {c.site && <>{c.site} · </>}{c.targets.length} targets{c.voice ? <> · voice: {c.voice}</> : null}. {c.summary || "Sends are yours; everything is prepared to personalize and go."}
    </p>

    {c.plan.length > 0 && (
      <>
        <h4 class="or-h">This week's sends</h4>
        <div class="action-strip">
          {c.plan.map((p) => (
            <div class="strip-row or-plan">
              <span class="chip">{p.day}</span>
              <span class="strip-title" style="max-width:45%">{p.action}</span>
              {p.template && <span class="chip tag">tmpl {p.template}</span>}
              <span class="or-note">{p.notes}</span>
            </div>
          ))}
        </div>
      </>
    )}

    {c.templates.length > 0 && (
      <details class="wb-fold">
        <summary>Templates <small>({c.templates.length})</small></summary>
        <div class="email-grid">
          {c.templates.map((t) => (
            <div class="email-card">
              <div class="email-head">
                <div class="email-meta"><span>To:</span> {t.audience}</div>
                <div class="email-subject">{t.subject}</div>
              </div>
              <pre class="email-body">{t.body}</pre>
            </div>
          ))}
        </div>
      </details>
    )}

    <details class="wb-fold" open={c.plan.length === 0}>
      <summary>All targets <small>({c.targets.length}, ranked — hook, contact path, and odds for each)</small></summary>
      <div class="tbl-wrap"><table class="or-table">
        <thead><tr><th>#</th><th>Target</th><th>Type</th><th>Status</th><th>How to reach</th><th>The hook</th><th>Value</th><th>Odds</th></tr></thead>
        <tbody>
          {c.targets.map((t) => (
            <tr>
              <td>{t.rank}</td>
              <td>{t.url ? <a href={/^https?:/.test(t.url) ? t.url : `https://${t.url.split(" ")[0]}`} target="_blank" rel="noopener">{t.name}</a> : t.name}</td>
              <td><span class="chip tag">{t.category}</span></td>
              <td>{t.status ? <span class="chip good">{t.status}</span> : <span class="chip">—</span>}</td>
              <td class="or-cell">{t.contact}</td>
              <td class="or-cell">{t.angle}</td>
              <td>{t.value}</td>
              <td>{t.likelihood}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {c.week2 && <p class="sub"><b>Week 2:</b> {c.week2}</p>}
      {c.later && <p class="sub"><b>Later / long plays:</b> {c.later}</p>}
      {c.cautions.length > 0 && (
        <p class="sub"><b>Cautions:</b> {c.cautions.join(" · ")}</p>
      )}
    </details>
    <p class="sub">Source: content/campaigns/{c.slug}.json</p>
  </>
);

const logLine = (l: string) => {
  const alert = l.includes("ALERT");
  const text = l.replace(/^- /, "").replace(/\*\*/g, "");
  return <li class={alert ? "log-alert" : ""}>{text}</li>;
};

export const LogsPage: FC = () => {
  const sections = data.dailyLogSections();
  const lr = data.lastRun();
  return (
    <>
      <h1>Operations log</h1>
      <p class="sub">What each daily run found, newest first. ALERT lines mean a probe regression or a watched metric moved. Raw run output below.</p>

      {lr?.steps?.length ? (
        <div class="chip-row" style="margin-bottom:14px">
          {lr.steps.map((s) => (
            <span class={`chip ${s.ok ? "good" : "bad"}`} title={s.seconds != null ? `${s.seconds}s` : ""}>{s.ok ? "✓" : "✗"} {s.name}</span>
          ))}
        </div>
      ) : null}

      {sections.length ? sections.map((sec) => (
        <div class="log-day">
          <h2>{sec.heading}</h2>
          <ul class="log-lines">{sec.lines.map(logLine)}</ul>
        </div>
      )) : <p class="empty">No daily-log entries yet — <code>python3 ops/daily.py</code> writes <code>docs/daily-log.md</code>.</p>}

      <h2>Raw run output <small>(data/daily-ops.log, last 150 lines — look here if a run failed)</small></h2>
      <div class="tbl-wrap"><pre class="ops-log">{data.opsLogTail()}</pre></div>
    </>
  );
};

/** Unified trends: one window drives charts + heatmap on identical geometry. */
export const TREND_RANGES = [30, 60, 90, 120, 180];

const BandChart: FC<{ dates: string[]; values: number[]; title: string; unit: string }> = ({ dates, values, title, unit }) => {
  const N = dates.length, W = N * 10, H = 100;
  const max = Math.max(1, ...values);
  const x = (i: number) => i * 10 + 5;
  const y = (v: number) => 4 + (H - 8) - (v / max) * (H - 8);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(N - 1)},${H - 4} L${x(0)},${H - 4} Z`;
  const peak = Math.max(...values), last = values[N - 1] ?? 0;
  return (
    <>
      <div class="tg-label">
        <div class="chart-title">{title}</div>
        <div class="chart-stats">peak {Math.round(peak).toLocaleString()} · latest <b>{Math.round(last).toLocaleString()}</b></div>
      </div>
      <div class="tg-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={title}>
          <line x1="0" x2={W} y1={y(max)} y2={y(max)} class="grid" vector-effect="non-scaling-stroke" />
          <line x1="0" x2={W} y1={y(max / 2)} y2={y(max / 2)} class="grid" vector-effect="non-scaling-stroke" />
          <line x1="0" x2={W} y1={H - 4} y2={H - 4} class="axis" vector-effect="non-scaling-stroke" />
          <path d={area} class="area-fill" />
          <path d={line} class="area-line" vector-effect="non-scaling-stroke" />
          {values.map((v, i) => (
            <rect x={i * 10} y="0" width="10" height={H} class="hover-col" data-date={dates[i]}>
              <title>{dates[i]}: {Math.round(v).toLocaleString()} {unit}</title>
            </rect>
          ))}
        </svg>
      </div>
    </>
  );
};

const heatColor = (v: number, max: number) => {
  if (v <= 0) return "var(--code-bg)";
  const t = Math.sqrt(v / max);
  return `rgba(55, 87, 214, ${(0.16 + 0.84 * t).toFixed(2)})`;
};

export const TrendsPage: FC<{ days: number }> = ({ days }) => {
  const dates = data.lastNDates(days);
  const window = new Set(dates);
  const sites = SITES();
  return (
    <>
      <div class="strip-head">
        <h1>Trends</h1>
        <div class="range-picker">
          {TREND_RANGES.map((r) => (
            <a href={`/trends/${r}`} class={r === days ? "on" : ""}>{r}d</a>
          ))}
        </div>
      </div>
      <p class="sub">One window drives everything: daily Google clicks, GA4 sessions, and which pages were hit on which days — hover any day to highlight it across all rows. The window ends {data.lastNDates(1).at(-1)} because Search Console finalizes daily data about three days behind real time (GA4 runs a day behind); the last few days always fill in as Google publishes them.</p>
      {sites.length === 0 && <p class="empty">No sites configured.</p>}
      {sites.map((site) => {
        const ts = data.gscTimeseries(site);
        const ga = data.ga4Timeseries(site);
        // A configured site with no data yet gets a flat row rather than
        // disappearing. Silent omission reads as "the pipeline missed it".
        if (!ts.length && !ga.length) {
          return (
            <div class="trend-tile trend-empty">
              <span class="domain">{site.host}</span>
              <span class="chip">{site.gscProperty ? "Search Console connected" : "no Search Console property"}</span>
              <span class="chip">{site.ga4Property ? "GA4 connected" : "no GA4 property"}</span>
              <span class="trend-empty-note">no time series yet — run <code>python3 ingest/pull_timeseries.py</code></span>
            </div>
          );
        }

        const clicksByDate = new Map<string, number>();
        for (const r of ts) clicksByDate.set(r.date, (clicksByDate.get(r.date) ?? 0) + r.clicks);
        const sessByDate = new Map<string, number>();
        for (const r of ga) sessByDate.set(r.date, (sessByDate.get(r.date) ?? 0) + r.sessions);

        const byPage = new Map<string, { total: number; cells: Map<string, { clicks: number; imps: number }> }>();
        for (const r of ts) {
          if (!window.has(r.date)) continue;
          const cur = byPage.get(r.page) ?? { total: 0, cells: new Map() };
          cur.total += r.clicks;
          cur.cells.set(r.date, { clicks: r.clicks, imps: r.impressions });
          byPage.set(r.page, cur);
        }
        const top = [...byPage.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 10);
        const cellMax = Math.max(1, ...top.flatMap(([, v]) => [...v.cells.values()].map((c) => c.clicks)));

        const sparkVals = dates.map((d) => (ts.length ? clicksByDate.get(d) ?? 0 : sessByDate.get(d) ?? 0));
        const sparkMax = Math.max(1, ...sparkVals);
        const sparkPts = sparkVals.map((v, i) => `${(i / Math.max(1, sparkVals.length - 1)) * 120},${26 - (v / sparkMax) * 24}`).join(" ");
        const last7 = dates.slice(-7);
        const avg = (m: Map<string, number>) => last7.reduce((a, d) => a + (m.get(d) ?? 0), 0) / Math.max(1, last7.length);
        const avgClicks = avg(clicksByDate);
        const avgSess = avg(sessByDate);
        const pagePath = (p: string) => p.replace(/^https?:\/\/[^/]+/, "") || "/";
        return (
          <details class="trend-tile">
            <summary>
              <span class="domain">{site.host}</span>
              <svg class="trend-spark" viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true">
                <polyline points={sparkPts} />
              </svg>
              <span class="chip" title="average over the last 7 window days">{ts.length ? `~${num(avgClicks)} clicks/day` : "no Search Console yet"}</span>
              <span class="chip">{ga.length ? `~${num(avgSess)} sessions/day` : "no GA4 yet"}</span>
              <span class="spacer" />
              <span class="details-link">expand</span>
            </summary>
            <div class="trend-grid" style={`--n:${days}`}>
              <div class="tg-label"></div>
              <div class="tg-months">
                {dates.map((d, i) => (
                  <span>{i === 0 || d.slice(8) === "01" ? d.slice(5, 7) : ""}</span>
                ))}
              </div>
              {ts.length > 0 && <BandChart dates={dates} values={dates.map((d) => clicksByDate.get(d) ?? 0)} title="Google clicks / day" unit="clicks" />}
              {ga.length > 0 && <BandChart dates={dates} values={dates.map((d) => sessByDate.get(d) ?? 0)} title="GA4 sessions / day" unit="sessions" />}
              {top.map(([page, v]) => (
                <>
                  <div class="tg-label hm-label" title={page}>{pagePath(page)}</div>
                  <div class="tg-cells">
                    {dates.map((d) => {
                      const c = v.cells.get(d);
                      return (
                        <div class="hm-cell" data-date={d} style={`background:${heatColor(c?.clicks ?? 0, cellMax)}`}>
                          <span class="hm-tip">{pagePath(page)} — {d}: {c?.clicks ?? 0} clicks, {c?.imps ?? 0} impressions</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ))}
            </div>
          </details>
        );
      })}
      <script dangerouslySetInnerHTML={{ __html: `
document.addEventListener('mouseover', function(e) {
  var t = e.target.closest('[data-date]');
  document.querySelectorAll('.day-hi').forEach(function(el){ el.classList.remove('day-hi'); });
  if (!t) return;
  var d = t.dataset.date;
  document.querySelectorAll('[data-date="' + d + '"]').forEach(function(el){ el.classList.add('day-hi'); });
});` }} />
    </>
  );
};
