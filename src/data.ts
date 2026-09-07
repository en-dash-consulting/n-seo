/** Data layer: reads the JSON snapshots the ingest scripts write under data/,
 *  plus the committed, hand-curated inputs under config/ and content/.
 *  Everything is re-read per call — the files are small and this keeps a
 *  long-lived process (dashboard, MCP server) honest about what is on disk. */
import fs from "node:fs";
import path from "node:path";
import { ROOT, config, gscSlug, type SiteCfg } from "./config.js";
import { BACKLOG_PATH } from "./backlog.js";

const DATA = path.join(ROOT, "data");

// ---------- GSC ----------

export interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

const gscDir = (site: SiteCfg): string | undefined =>
  site.gscProperty ? gscSlug(site.gscProperty) : undefined;

function gscRows(dir: string | undefined, dataset: string): GscRow[] {
  if (!dir) return [];
  const d = readJson<{ rows?: GscRow[] }>(path.join(DATA, "gsc", dir, `${dataset}.json`));
  return d?.rows ?? [];
}

/** Recent-window (90d) rows, falling back to the full 16-month pull if the
 * recent file doesn't exist yet. Decisions should use recent; totals use full. */
function gscRowsRecent(dir: string | undefined, dataset: string): { rows: GscRow[]; recent: boolean } {
  if (!dir) return { rows: [], recent: false };
  const r = readJson<{ rows?: GscRow[] }>(path.join(DATA, "gsc", dir, `${dataset}_90d.json`));
  if (r?.rows) return { rows: r.rows, recent: true };
  return { rows: gscRows(dir, dataset), recent: false };
}

const hostOf = (url: string): string => url.split("/")[2] ?? "";

/** query+page rows for this site's host (used by the action engine to name pages). */
export function rawQueryPage(site: SiteCfg, recent = false): GscRow[] {
  const dir = gscDir(site);
  const src = recent ? gscRowsRecent(dir, "query_page").rows : gscRows(dir, "query_page");
  return src.filter((r) => hostOf(r.keys[1]) === site.gscHost);
}

/** Queries for one host. A domain property covers subdomains, so aggregate query_page filtered by page host. */
export function queries(site: SiteCfg, recent = false): GscRow[] {
  const qp = rawQueryPage(site, recent);
  const byQuery = new Map<string, { clicks: number; impressions: number; posW: number }>();
  for (const r of qp) {
    const cur = byQuery.get(r.keys[0]) ?? { clicks: 0, impressions: 0, posW: 0 };
    cur.clicks += r.clicks;
    cur.impressions += r.impressions;
    cur.posW += r.position * r.impressions;
    byQuery.set(r.keys[0], cur);
  }
  return [...byQuery.entries()]
    .map(([q, v]) => ({
      keys: [q],
      clicks: v.clicks,
      impressions: v.impressions,
      ctr: v.impressions ? v.clicks / v.impressions : 0,
      position: v.impressions ? v.posW / v.impressions : 0,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
}

export function pages(site: SiteCfg): GscRow[] {
  return gscRows(gscDir(site), "pages")
    .filter((r) => hostOf(r.keys[0]) === site.gscHost)
    .sort((a, b) => b.clicks - a.clicks);
}

export interface GscSummary {
  clicks: number;
  impressions: number;
  ctr: number;
}

export function gscSummary(site: SiteCfg): GscSummary {
  const ps = pages(site);
  const clicks = ps.reduce((s, r) => s + r.clicks, 0);
  const impressions = ps.reduce((s, r) => s + r.impressions, 0);
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0 };
}

/** Position 5–15 queries with meaningful impressions — the cheapest ranking wins. */
export function strikingDistance(site: SiteCfg, minImpressions = 10): GscRow[] {
  // Recent window: decisions ride the last 90 days, not 16-month history.
  return queries(site, true)
    .filter((r) => r.position >= 5 && r.position <= 15 && r.impressions >= minImpressions)
    .sort((a, b) => b.impressions - a.impressions);
}

export const EXPECTED_CTR: Record<number, number> = { 1: 0.28, 2: 0.15, 3: 0.1, 4: 0.07, 5: 0.05, 6: 0.04 };

/** Ranking well but rarely clicked — title/snippet problems. */
export function ctrGaps(site: SiteCfg, minImpressions = 30): (GscRow & { expected: number })[] {
  // Recent window: a page fixed last week must stop being accused within 90 days.
  return queries(site, true)
    .flatMap((r) => {
      const expected = EXPECTED_CTR[Math.round(r.position)];
      return expected && r.impressions >= minImpressions && r.ctr < expected * 0.5
        ? [{ ...r, expected }]
        : [];
    })
    .sort((a, b) => b.impressions * (b.expected - b.ctr) - a.impressions * (a.expected - a.ctr));
}

// ---------- GA4 ----------

interface Ga4Report {
  rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
  pulled?: string;
}

function ga4Rows(site: SiteCfg, report: string): { dims: string[]; mets: number[] }[] {
  const d = readJson<Ga4Report>(path.join(DATA, "ga4", site.host, `${report}.json`));
  return (d?.rows ?? []).map((r) => ({
    dims: r.dimensionValues.map((v) => v.value),
    mets: r.metricValues.map((v) => Number(v.value)),
  }));
}

export const AI_SOURCE = /chatgpt|chat\.openai|openai\.com|perplexity|claude\.ai|copilot|gemini\.google|edgeservices|you\.com|poe\.com|phind|kagi|mistral|deepseek/i;
export const SEARCH_SOURCE = /google|bing|duckduckgo|yahoo|ecosia|brave|yandex|baidu/i;

export interface TrafficMix {
  sessions: number;
  ai: number;
  search: number;
  aiSources: { source: string; sessions: number }[];
}

export function trafficMix(site: SiteCfg): TrafficMix {
  const rows = ga4Rows(site, "sources");
  let sessions = 0,
    ai = 0,
    search = 0;
  const aiSources: { source: string; sessions: number }[] = [];
  for (const { dims, mets } of rows) {
    const [source, medium] = dims;
    sessions += mets[0];
    if (AI_SOURCE.test(source)) {
      ai += mets[0];
      aiSources.push({ source: `${source}/${medium}`, sessions: mets[0] });
    } else if (SEARCH_SOURCE.test(source)) {
      search += mets[0];
    }
  }
  aiSources.sort((a, b) => b.sessions - a.sessions);
  return { sessions, ai, search, aiSources };
}

/** Sessions in the trailing 28 days vs the 28 before, from the GA4 daily report. */
export function sessionTrend(site: SiteCfg): { recent: number; prior: number } {
  const rows = ga4Rows(site, "daily")
    .map(({ dims, mets }) => ({ date: dims[0], sessions: mets[0] }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const recent = rows.slice(-28).reduce((s, r) => s + r.sessions, 0);
  const prior = rows.slice(-56, -28).reduce((s, r) => s + r.sessions, 0);
  return { recent, prior };
}

export function landingPages(site: SiteCfg): { page: string; sessions: number; engagement: number }[] {
  return ga4Rows(site, "landing").map(({ dims, mets }) => ({
    page: dims[0],
    sessions: mets[0],
    engagement: mets[1],
  }));
}

/** Sessions referred from your OTHER configured sites — measures cross-linking. */
export function crossReferrals(site: SiteCfg): { source: string; sessions: number }[] {
  // Exact host match (www stripped): with a subdomain layout, a substring
  // test would count docs.example.com's own traffic as a referral from example.com.
  const others = new Set(config().sites.filter((s) => s.host !== site.host).map((s) => s.host.replace(/^www\./, "")));
  return ga4Rows(site, "sources")
    .filter(({ dims }) => others.has(dims[0].toLowerCase().replace(/^www\./, "")))
    .map(({ dims, mets }) => ({ source: dims[0], sessions: mets[0] }))
    .sort((a, b) => b.sessions - a.sessions);
}

// ---------- probes ----------

export interface ProbeSite {
  site: string;
  robots: { status?: number | null; exists?: boolean; sitemap_declared?: boolean; ai_crawlers_blocked?: string[] };
  sitemap: { status?: number | null; exists?: boolean; url_count?: number; newest_lastmod?: string | null };
  "llms.txt": { exists?: boolean; bytes?: number };
  "llms-full.txt": { exists?: boolean; bytes?: number };
  homepage: {
    status?: number | null;
    title?: string;
    meta_description?: string | null;
    canonical?: string | null;
    og_tags?: number;
    jsonld_types?: string[];
    h1_count?: number;
    lang?: string | null;
    visible_text_bytes?: number;
  };
  soft_404: { status?: number | null; real_404?: boolean };
}

export interface IndexProblem {
  url: string;
  coverage: string;
  lastCrawl?: string | null;
  verdict?: string;
  robots?: string;
  canonicalMismatch?: boolean;
  googleCanonical?: string | null;
  detail?: string;
}

export interface IndexStatus {
  generated: string;
  sites: Record<
    string,
    {
      property: string;
      checked: number;
      indexed: number;
      neverCrawled: number;
      sitemap?: {
        submitted: number;
        entries: {
          path?: string;
          lastSubmitted?: string | null;
          lastDownloaded?: string | null;
          pending?: boolean;
          errors?: number;
          warnings?: number;
        }[];
      };
      problems: IndexProblem[];
    }
  >;
}

/** Search Console's own verdict on each sitemap URL — written by
 *  ingest/pull_index_status.py. Distinguishes "nobody searches for this"
 *  from "Google has never fetched this", which look identical in GSC's
 *  performance data because both are zero impressions. */
export function indexStatus(): IndexStatus | null {
  return readJson(path.join(DATA, "index-status.json"));
}

export function latestProbe(): { probed_at: string; sites: ProbeSite[] } | null {
  const dir = path.join(DATA, "probes");
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return null;
  }
  const last = files.at(-1);
  return last ? readJson(path.join(dir, last)) : null;
}

export function probeFor(site: SiteCfg | string): ProbeSite | undefined {
  const hosts = typeof site === "string" ? [site] : [site.gscHost, site.host];
  const sites = latestProbe()?.sites ?? [];
  return sites.find((s) => hosts.some((h) => s.site === `https://${h}` || s.site === `http://${h}`));
}

/** The checks that make a site "healthy" — the same list ops/daily_diff.py counts. */
export function probeFindings(p: ProbeSite | undefined): string[] {
  if (!p) return ["no probe data"];
  const out: string[] = [];
  if (!p.robots.exists) out.push("robots.txt missing");
  if (!p.sitemap.exists) out.push("sitemap.xml missing");
  if (!p["llms.txt"].exists) out.push("llms.txt missing");
  if (!p.soft_404.real_404) out.push("soft 404 (missing pages do not return 404)");
  if (p.homepage.status !== 200) out.push(`homepage returned ${p.homepage.status ?? "no status"}`);
  return out;
}

export const probeHealthy = (p: ProbeSite | undefined): boolean => !!p && probeFindings(p).length === 0;

export function dataFreshness(): { label: string; path: string; mtime: string }[] {
  const spots = [
    { label: "Search Console pull", path: path.join(DATA, "gsc") },
    { label: "GA4 pull", path: path.join(DATA, "ga4") },
    { label: "Site probe", path: path.join(DATA, "probes") },
    { label: "Metadata audit", path: path.join(DATA, "metadata-audit.json") },
    { label: "Index status", path: path.join(DATA, "index-status.json") },
  ];
  return spots.map((s) => {
    let mtime = "never";
    try {
      const st = fs.statSync(s.path);
      let newest = st.mtime.getTime();
      if (st.isDirectory()) {
        newest =
          fs
            .readdirSync(s.path, { recursive: true, encoding: "utf8" })
            .map((f) => fs.statSync(path.join(s.path, f)).mtime.getTime())
            .sort()
            .at(-1) ?? 0;
      }
      if (newest) mtime = new Date(newest).toISOString().slice(0, 16).replace("T", " ") + " UTC";
    } catch {
      /* stays "never" */
    }
    return { label: s.label, path: s.path, mtime };
  });
}

/** How long this process has been running, and how old the queue file is.
 *  Everything in dataFreshness() is re-read per call, so a long-lived reader
 *  can report fresh data while serving a stale queue if hot-reload ever
 *  breaks. Surfacing both makes the mismatch visible instead of silent. */
export function processFreshness(): {
  startedAt: string;
  uptimeHours: number;
  queueMtime: string;
} {
  const startedMs = Date.now() - process.uptime() * 1000;
  let queueMs = 0;
  try {
    queueMs = fs.statSync(BACKLOG_PATH).mtime.getTime();
  } catch {
    /* leave 0 */
  }
  return {
    startedAt: new Date(startedMs).toISOString().slice(0, 16).replace("T", " ") + " UTC",
    uptimeHours: Math.round((process.uptime() / 3600) * 10) / 10,
    queueMtime: queueMs ? new Date(queueMs).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "unknown",
  };
}

// ---------- trends (analysis runs) ----------

export interface TrendsFile {
  generated: string;
  sites: Record<string, {
    recent_split?: { branded_clicks: number; generic_clicks: number; branded_imps: number; generic_imps: number };
    prior_split?: { branded_clicks: number; generic_clicks: number; branded_imps: number; generic_imps: number };
    rising?: { query: string; recent_imps: number; prior_imps: number; recent_pos: number; recent_clicks: number }[];
    falling?: { query: string; recent_imps: number; prior_imps: number }[];
    monthly?: Record<string, { clicks: number; imps: number }>;
  }>;
  ai_referrals?: Record<string, { ai: Record<string, number>; total: Record<string, number> }>;
}

export function latestTrends(): TrendsFile | null {
  let files: string[] = [];
  try {
    files = fs.readdirSync(DATA).filter((f) => f.startsWith("trends-") && f.endsWith(".json")).sort();
  } catch {
    return null;
  }
  const last = files.at(-1);
  return last ? readJson<TrendsFile>(path.join(DATA, last)) : null;
}

// ---------- community digests (opt-in modules) ----------

export interface HnDigest {
  generated: string;
  stats?: { user: string; karma?: number; created?: number; comments?: number };
  picks: { id?: string; title: string; url: string; story_url?: string; comments: number; points: number; why: string; briefing?: string; commented?: boolean }[];
}

export function hnDigest(): HnDigest | null {
  return readJson<HnDigest>(path.join(DATA, "hn-digest.json"));
}

export interface RedditDigest {
  generated: string;
  user?: string | null;
  auth?: boolean;
  picks: { id: string; title: string; url: string; sub: string; comments: number; score: number; age_days: number; why: string; briefing?: string; commented?: boolean }[];
}

export function redditDigest(): RedditDigest | null {
  return readJson<RedditDigest>(path.join(DATA, "reddit-digest.json"));
}

/** Reddit search links derived from modules.reddit.topics ([sub, query, why]).
 *  Reddit blocks anonymous API reads, so these open Reddit's own past-week
 *  search in your logged-in browser — useful even with the digest off. */
export function redditHunts(): { sub: string; q: string; why: string }[] {
  const topics = (config().modules.reddit?.topics as unknown[] | undefined) ?? [];
  return topics
    .filter((t): t is string[] => Array.isArray(t) && t.length >= 2 && !!t[0])
    .map((t) => ({ sub: String(t[0]).replace(/^r\//, ""), q: String(t[1] ?? ""), why: String(t[2] ?? "") }))
    .filter((t) => !/^subreddit$/i.test(t.sub)); // skip the example placeholder
}

// ---------- distribution drafts (content/drafts/*.md) ----------

export interface Draft {
  slug: string;
  title: string;
  channel: string;
  status: string;
  /** publish sequence — the checklist is ordered by this */
  order: number;
  /** one imperative line: exactly what you do with this draft */
  action?: string;
  tags?: string;
  notes?: string;
  body: string;
}

/** Curated, committed launch assets: markdown files with simple front-matter.
 *  Unlike data/ (gitignored, machine-refreshed), content/drafts/ is
 *  hand-curated and versioned — a draft leaves by being deleted or
 *  status-flipped. Files starting with "_" and README.md are ignored. */
export function drafts(): Draft[] {
  const dir = path.join(ROOT, "content", "drafts");
  let files: string[] = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md") && !f.startsWith("_") && f.toLowerCase() !== "readme.md")
      .sort();
  } catch {
    return [];
  }
  const out: Draft[] = [];
  for (const f of files) {
    let text = "";
    try {
      text = fs.readFileSync(path.join(dir, f), "utf8");
    } catch {
      continue;
    }
    const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
    const meta: Record<string, string> = {};
    let body = text;
    if (m) {
      body = text.slice(m[0].length).trim();
      const lines = m[1].split("\n");
      let key = "";
      for (const line of lines) {
        const kv = line.match(/^([a-z_]+):\s*(.*)$/);
        if (kv) {
          key = kv[1];
          // ">"-folded scalars accumulate from the indented lines below
          meta[key] = kv[2] === ">" ? "" : kv[2].replace(/^"|"$/g, "");
        } else if (key && /^\s+\S/.test(line)) {
          meta[key] = (meta[key] ? meta[key] + " " : "") + line.trim();
        }
      }
    }
    out.push({
      slug: f.replace(/\.md$/, ""),
      title: meta.title || f,
      channel: meta.channel || "—",
      status: meta.status || "draft",
      order: Number(meta.order) || 99,
      action: meta.action,
      tags: meta.tags,
      notes: meta.notes,
      body,
    });
  }
  return out.sort((a, b) => a.order - b.order);
}

export function draftBySlug(slug: string): Draft | undefined {
  return drafts().find((d) => d.slug === slug);
}

// ---------- campaigns (content/campaigns/*.json) ----------

export interface Campaign {
  slug: string;
  name: string;
  site?: string;
  summary?: string;
  voice?: string;
  targets: { rank: number; name: string; category: string; url: string; contact: string; angle: string; value: string; likelihood: string; evidence?: string; status?: string }[];
  templates: { id: string; audience: string; subject: string; body: string }[];
  plan: { day: string; action: string; template: string; notes: string }[];
  week2?: string;
  later?: string;
  cautions: string[];
}

export function campaigns(): Campaign[] {
  const dir = path.join(ROOT, "content", "campaigns");
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_")).sort();
  } catch {
    return [];
  }
  const out: Campaign[] = [];
  for (const f of files) {
    const raw = readJson<Partial<Campaign>>(path.join(dir, f));
    if (!raw) continue;
    const slug = raw.slug || f.replace(/\.json$/, "");
    out.push({
      slug,
      name: raw.name || slug,
      site: raw.site,
      summary: raw.summary,
      voice: raw.voice,
      targets: raw.targets ?? [],
      templates: raw.templates ?? [],
      plan: raw.plan ?? [],
      week2: raw.week2,
      later: raw.later,
      cautions: raw.cautions ?? [],
    });
  }
  return out;
}

export function campaignBySlug(slug: string): Campaign | undefined {
  return campaigns().find((c) => c.slug === slug);
}

// ---------- opportunity scan (automated discovery) ----------

export interface ScanOutput {
  generated: string;
  candidates: { host: string; query: string; prior_imps: number; recent_imps: number; recent_pos: number }[];
  proposals: { host: string; title: string; kind: string; why: string; how: string; spec: string[]; impact: number; effort: string; tag: string }[];
  verdicts: { title: string; verdict: string; evidence: string }[];
  inference_ran: boolean;
}

export function opportunityScan(): ScanOutput | null {
  const s = readJson<Partial<ScanOutput>>(path.join(DATA, "opportunity-proposals.json"));
  if (!s) return null;
  return {
    generated: s.generated ?? "",
    candidates: s.candidates ?? [],
    proposals: s.proposals ?? [],
    verdicts: s.verdicts ?? [],
    inference_ran: !!s.inference_ran,
  };
}

// ---------- conversions (your real goal, from GA4 key events) ----------

export interface FunnelDay { date: string; event: string; sourceApp: string; count: number }

export function funnelEvents(site: SiteCfg): FunnelDay[] {
  const rows = ga4Rows(site, "funnel");
  return rows.map(({ dims, mets }) => ({
    date: `${dims[0].slice(0, 4)}-${dims[0].slice(4, 6)}-${dims[0].slice(6, 8)}`,
    event: dims[1],
    sourceApp: dims[2] ?? "(source dimension not registered)",
    count: mets[0],
  }));
}

export interface FunnelSummary {
  configured: boolean;
  instrumented: boolean;
  site?: string;
  events: string[];
  total28: Record<string, number>;
  bySource: Record<string, number>;
}

export function funnelSummary(): FunnelSummary {
  const conv = config().conversions;
  if (!conv) return { configured: false, instrumented: false, events: [], total28: {}, bySource: {} };
  const site = config().sites.find((s) => s.host === conv.site) ?? ({ host: conv.site, gscHost: conv.site, label: conv.site } as SiteCfg);
  const rows = funnelEvents(site);
  const cutoff = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
  const recent = rows.filter((r) => r.date >= cutoff);
  const total28: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const primary = conv.events[0];
  for (const r of recent) {
    total28[r.event] = (total28[r.event] ?? 0) + r.count;
    if (r.event === primary) bySource[r.sourceApp || "(unset)"] = (bySource[r.sourceApp || "(unset)"] ?? 0) + r.count;
  }
  return { configured: true, instrumented: rows.length > 0, site: conv.site, events: conv.events, total28, bySource };
}

// ---------- the Today board: every move waiting on you, derived live ----------

export interface TodayItem { title: string; href: string; chip?: string; }
export interface TodayGroup { verb: string; blurb: string; items: TodayItem[]; }

/** Aggregates "what should I do right now" across every data source the
 *  dashboard already has — probes, the daily run, drafts, digests, the scan —
 *  so the answer lives on one board instead of five pages. The queue's top
 *  items (Ship) are appended by the view, which owns the action engine. */
export function todayBoard(): TodayGroup[] {
  const groups: TodayGroup[] = [];
  const mods = config().modules;

  // FIX — system health first
  const fix: TodayItem[] = [];
  const lr = lastRun();
  if (lr && lr.failures.trim()) fix.push({ title: `The daily run failed: ${lr.failures.trim()}`, href: "/logs", chip: "run" });
  const probe = latestProbe();
  for (const p of probe?.sites ?? []) {
    const missing: string[] = [];
    if (!p.robots.exists) missing.push("robots.txt");
    if (!p.sitemap.exists) missing.push("sitemap");
    if (!p["llms.txt"].exists) missing.push("llms.txt");
    if (!p.soft_404.real_404) missing.push("soft 404s");
    if (missing.length) fix.push({ title: `${p.site.replace(/^https?:\/\//, "")} — ${missing.join(", ")} missing`, href: "/probes", chip: "probe" });
  }
  if (fix.length) groups.push({ verb: "Fix", blurb: "health regressions the probes or the daily run flagged", items: fix });

  // APPROVE — things blocked on your sign-off
  const approve: TodayItem[] = [];
  for (const d of drafts().filter((d) => d.status.includes("approval"))) {
    approve.push({ title: d.title, href: `/drafts/${d.slug}`, chip: d.channel });
  }
  const scan = opportunityScan();
  if (scan?.proposals.length) approve.push({ title: `${scan.proposals.length} scan proposal${scan.proposals.length > 1 ? "s" : ""} from the daily riser scan`, href: "/actions#proposed", chip: "scan" });
  if (approve.length) groups.push({ verb: "Approve", blurb: "waiting on your yes/no — the cheapest unblocks on the board", items: approve });

  // PUBLISH — drafts, readiest first
  const pub = drafts().filter((d) => !d.status.includes("approval"));
  if (pub.length) {
    groups.push({
      verb: "Publish",
      blurb: "finished assets — open one, make it yours, post it",
      items: pub.map((d) => ({ title: d.title, href: `/drafts/${d.slug}`, chip: d.status.startsWith("ready") ? "ready" : "voice pass" })),
    });
  }

  // COMMENT — today's participation (only with a digest module on)
  if (mods.hackerNews?.enabled || mods.reddit?.enabled) {
    const comment: TodayItem[] = [];
    if (mods.hackerNews?.enabled) {
      const hn = hnDigest();
      const fresh = (hn?.picks ?? []).filter((p) => !p.commented).length;
      if (fresh) comment.push({ title: `${fresh} fresh HN thread${fresh > 1 ? "s" : ""} briefed for you`, href: "/content#participate", chip: "HN" });
    }
    if (mods.reddit?.enabled) {
      const rd = redditDigest();
      const fresh = (rd?.picks ?? []).filter((p) => !p.commented).length;
      comment.push({ title: fresh ? `${fresh} Reddit thread${fresh > 1 ? "s" : ""} briefed` : "Reddit hunt links — one click per community", href: "/content#participate", chip: "Reddit" });
    }
    if (comment.length) groups.push({ verb: "Comment", blurb: "a few genuine comments a day; briefings ready, the words are yours", items: comment });
  }

  return groups;
}

// ---------- stylesheet cache-busting ----------

/** mtime-derived version for /styles.css?v=… — a CSS change invalidates
 *  browser/mirror caches without manual purges. */
export function styleVersion(): string {
  try {
    return String(Math.floor(fs.statSync(path.join(ROOT, "public", "styles.css")).mtimeMs)).slice(-8);
  } catch {
    return "0";
  }
}

// ---------- logs ----------

/** docs/daily-log.md split into dated sections, newest first */
export function dailyLogSections(): { heading: string; lines: string[] }[] {
  let text = "";
  try {
    text = fs.readFileSync(path.join(ROOT, "docs", "daily-log.md"), "utf8");
  } catch {
    return [];
  }
  const sections: { heading: string; lines: string[] }[] = [];
  let cur: { heading: string; lines: string[] } | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      if (cur) sections.push(cur);
      cur = { heading: line.slice(3).trim(), lines: [] };
    } else if (cur && line.trim()) {
      cur.lines.push(line.trim());
    }
  }
  if (cur) sections.push(cur);
  return sections.reverse();
}

export function opsLogTail(maxLines = 150): string {
  try {
    const text = fs.readFileSync(path.join(DATA, "daily-ops.log"), "utf8");
    return text.split("\n").slice(-maxLines).join("\n");
  } catch {
    return "(no daily-ops.log yet — ops/daily.py writes it)";
  }
}

export interface LastRun { ts: string; failures: string; steps?: { name: string; ok: boolean; seconds?: number }[] }

export function lastRun(): LastRun | null {
  const r = readJson<Partial<LastRun>>(path.join(DATA, "last-run.json"));
  if (!r) return null;
  return { ts: r.ts ?? "", failures: r.failures ?? "", steps: r.steps };
}

// ---------- time series (Trends view) ----------

export interface DayPage { date: string; page: string; clicks: number; impressions: number }

/** GSC date×page rows for this site's host, trailing ~180d */
export function gscTimeseries(site: SiteCfg): DayPage[] {
  const dir = gscDir(site);
  if (!dir) return [];
  const d = readJson<{ rows?: { keys: string[]; clicks: number; impressions: number }[] }>(
    path.join(DATA, "timeseries", `gsc-${dir}.json`));
  return (d?.rows ?? [])
    .filter((r) => hostOf(r.keys[1]) === site.gscHost)
    .map((r) => ({ date: r.keys[0], page: r.keys[1], clicks: r.clicks, impressions: r.impressions }));
}

/** GA4 date×pagePath sessions, trailing 180d (dates as YYYYMMDD in source) */
export function ga4Timeseries(site: SiteCfg): { date: string; page: string; sessions: number }[] {
  const d = readJson<{ rows?: { date: string; page: string; sessions: number }[] }>(
    path.join(DATA, "timeseries", `ga4-${site.host}.json`));
  return (d?.rows ?? []).map((r) => ({
    date: `${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6, 8)}`,
    page: r.page,
    sessions: r.sessions,
  }));
}

export function lastNDates(n: number, endOffsetDays = 3): string[] {
  const out: string[] = [];
  const end = new Date(Date.now() - endOffsetDays * 86400000);
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(end.getTime() - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

// ---------- metadata audit ----------

export interface MetaFinding {
  page: string; title: string; description: string;
  imps: number; clicks: number; issues: string[];
  top_queries: { q: string; imps: number; clicks: number; pos: number; ctr: number }[];
  missed_clicks_window: number;
}

export function metadataAudit(): { generated: string; sites: Record<string, MetaFinding[]> } | null {
  return readJson(path.join(DATA, "metadata-audit.json"));
}

// ---------- markdown docs (rendered in-app) ----------

const escapeHtml = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Minimal markdown → HTML: headings, tables, lists, bold, links, code, paragraphs. */
export function mdToHtml(md: string): string {
  const inline = (t: string) =>
    t.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
     .replace(/`([^`]+)`/g, "<code>$1</code>")
     .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0, inList = false;
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  while (i < lines.length) {
    const raw = lines[i];
    const line = escapeHtml(raw);
    if (/^\s*\|/.test(raw) && /^\s*\|/.test(lines[i + 1] ?? "") ) {
      closeList();
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells.map(escapeHtml));
        i++;
      }
      out.push('<div class="tbl-wrap"><table><thead><tr>' +
        rows[0].map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>" +
        rows.slice(1).map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") +
        "</tbody></table></div>");
      continue;
    }
    if (/^### /.test(raw)) { closeList(); out.push(`<h4>${inline(line.slice(4))}</h4>`); }
    else if (/^## /.test(raw)) { closeList(); out.push(`<h3>${inline(line.slice(3))}</h3>`); }
    else if (/^# /.test(raw)) { closeList(); out.push(`<h3>${inline(line.slice(2))}</h3>`); }
    else if (/^\s*[-*] /.test(raw)) {
      if (!inList) { out.push('<ul class="md-list">'); inList = true; }
      out.push(`<li>${inline(line.replace(/^\s*[-*] /, ""))}</li>`);
    }
    else if (raw.trim() === "") { closeList(); }
    else { closeList(); out.push(`<p>${inline(line)}</p>`); }
    i++;
  }
  closeList();
  return out.join("\n");
}

export function docHtml(name: string): string | null {
  try {
    return mdToHtml(fs.readFileSync(path.join(ROOT, "docs", name), "utf8"));
  } catch {
    return null;
  }
}
