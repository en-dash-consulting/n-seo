/** The action engine: turns snapshot data into a ranked, concrete to-do queue.
 *
 *  Rule-derived actions are recomputed on every call from the 90-day window,
 *  then merged with the curated queue in config/backlog.json. Pages listed in
 *  the backlog's `shippedWatch` map turn their rule-derived cards into
 *  "watching" entries — the fix shipped; the data decides what happens next. */
import { SITES, type SiteCfg } from "./config.js";
import * as data from "./data.js";
import { BACKLOG, SHIPPED_WATCH, slug, type Action, type Effort } from "./backlog.js";

export type { Action, Effort } from "./backlog.js";

const EFFORT_WEIGHT: Record<Effort, number> = { S: 1, M: 2.5, L: 5 };

/** Impact per unit of effort. Never returns NaN: one unrecognised effort or a
 *  non-numeric impact would otherwise make the sort comparator return NaN and
 *  leave the order of the entire queue undefined. backlog.ts coerces on load;
 *  this is the second line of defence for any other producer. */
export const score = (a: Action) =>
  (Number.isFinite(a.impact) ? a.impact : 0) / (EFFORT_WEIGHT[a.effort] ?? EFFORT_WEIGHT.M);

const WINDOW_MONTHS = 3; // decision window = trailing 90 days

const pathOf = (url: string): string => "/" + url.split("/").slice(3).join("/");
const gid = (tag: string, page: string) => `gen-${tag}-${slug(page) || "root"}`;

/** query -> the page that ranks for it (top impressions), host-filtered */
function topPageForQueries(site: SiteCfg): Map<string, string> {
  const best = new Map<string, { page: string; imps: number }>();
  for (const r of data.rawQueryPage(site, true)) {
    const cur = best.get(r.keys[0]);
    if (!cur || r.impressions > cur.imps) best.set(r.keys[0], { page: r.keys[1], imps: r.impressions });
  }
  return new Map([...best.entries()].map(([q, v]) => [q, v.page]));
}

function ctrGapActions(site: SiteCfg): Action[] {
  const gaps = data.ctrGaps(site);
  if (!gaps.length) return [];
  const watch = SHIPPED_WATCH();
  const pageFor = topPageForQueries(site);
  const byPage = new Map<string, (data.GscRow & { expected: number })[]>();
  for (const g of gaps) {
    const page = pageFor.get(g.keys[0]) ?? `https://${site.gscHost}/`;
    byPage.set(page, [...(byPage.get(page) ?? []), g]);
  }
  return [...byPage.entries()].map(([page, qs]) => {
    const missed = qs.reduce((s, q) => s + (q.impressions / WINDOW_MONTHS) * (q.expected - q.ctr), 0);
    const top = qs.slice(0, 3).map((q) => `“${q.keys[0]}” (${q.impressions.toLocaleString()} imps, ${(100 * q.ctr).toFixed(1)}% CTR at pos ${q.position.toFixed(1)})`);
    const watching = watch[page];
    return {
      id: gid("ctr-gap", page),
      host: site.host,
      title: `Rewrite title/description: ${pathOf(page)}`,
      kind: "Meta/template change — no new content",
      why: `Ranks but rarely clicked (90d) — ${top.join("; ")}`,
      how: `Make the <title> restate the query as its answer; description = 150-char direct answer. Then request reindexing in Search Console.`,
      spec: [
        `Page: ${page}`,
        `Queries being lost: ${qs.map((q) => `“${q.keys[0]}” (${q.impressions.toLocaleString()} imps, ${(100 * q.ctr).toFixed(1)}% CTR, pos ${q.position.toFixed(1)})`).join(" · ")}`,
        `Title formula: [query phrased as its answer] — [differentiator]. Keep under ~60 chars; front-load the query words.`,
        `Description: one ~150-char sentence that directly answers the query (this becomes the SERP snippet).`,
        `Ship: meta change only — no body-content edits needed. Then Search Console → URL Inspection → Request Indexing.`,
        `Success: CTR on these queries reaches ≥ half of position-expected within 28 days (watch on this dashboard). Then leave the title alone — title churn resets Google's evaluation.`,
      ],
      impact: Math.round(missed),
      effort: "S" as Effort,
      tag: "ctr-gap",
      source: "rule" as const,
      ...(watching ? { watching } : {}),
    };
  });
}

function strikingActions(site: SiteCfg): Action[] {
  const rows = data.strikingDistance(site).slice(0, 12);
  if (!rows.length) return [];
  const watch = SHIPPED_WATCH();
  const pageFor = topPageForQueries(site);
  const byPage = new Map<string, data.GscRow[]>();
  for (const r of rows) {
    const page = pageFor.get(r.keys[0]) ?? `https://${site.gscHost}/`;
    byPage.set(page, [...(byPage.get(page) ?? []), r]);
  }
  return [...byPage.entries()].map(([page, qs]) => {
    const imps = qs.reduce((s, q) => s + q.impressions, 0);
    const impact = Math.round((imps / WINDOW_MONTHS) * 0.06);
    const top = qs.slice(0, 3).map((q) => `“${q.keys[0]}” pos ${q.position.toFixed(1)} (${q.impressions.toLocaleString()} imps)`);
    const watching = watch[page];
    return {
      id: gid("striking", page),
      host: site.host,
      title: `Push to page 1: ${pathOf(page)}`,
      kind: "Content addition to an existing page",
      why: `Position 5–15 in the last 90d for ${top.join("; ")}`,
      how: `Add a section that answers these queries verbatim (H2 phrased as the query + direct answer), add 2–3 internal links to this page from related pages, refresh dateModified.`,
      spec: [
        `Page: ${page}`,
        `Target queries: ${qs.map((q) => `“${q.keys[0]}” (pos ${q.position.toFixed(1)}, ${q.impressions.toLocaleString()} imps)`).join(" · ")}`,
        `Add one H2 per query cluster, phrased as the query, followed by a 40–60 word direct answer, then detail.`,
        `Internal links: 2–3 links to this page from the site's highest-authority related pages, using the query as anchor text.`,
        `Freshness: a real content change → dateModified updates → sitemap lastmod moves.`,
        `Success: these queries move from pos 5–15 into the top 5 within ~6 weeks.`,
      ],
      impact,
      effort: "M" as Effort,
      tag: "striking",
      source: "rule" as const,
      ...(watching ? { watching } : {}),
    };
  }).filter((a) => a.impact >= 1);
}

function probeActions(site: SiteCfg): Action[] {
  const p = data.probeFor(site);
  if (!p) return [];
  const out: Action[] = [];
  const mk = (key: string, title: string, how: string): Action => ({
    id: `gen-hygiene-${slug(site.host)}-${key}`,
    host: site.host, title, kind: "Config change", why: "Live probe failing on this check", how,
    spec: [how, `Verify with: python3 probes/site_probe.py after deploy.`],
    impact: 5, effort: "S", tag: "hygiene", source: "rule",
  });
  if (!p.robots.exists) out.push(mk("robots", "Add robots.txt", "Serve robots.txt with a Sitemap: pointer and explicit AI-crawler allowances."));
  if (!p.sitemap.exists) out.push(mk("sitemap", "Add sitemap.xml", "Generate one with honest lastmod dates, reference it from robots.txt, submit it in Search Console."));
  if (!p["llms.txt"].exists) out.push(mk("llms", "Add llms.txt", "A markdown site summary with links to the key pages — the surface AI crawlers read first."));
  if (!p.soft_404.real_404) out.push(mk("soft404", "Fix soft 404s", "Unknown paths must return HTTP 404, not 200 — soft 404s waste crawl budget and dilute the index."));
  if ((p.robots.ai_crawlers_blocked?.length ?? 0) > 0)
    out.push(mk("ai-block", `Unblock AI crawlers (${p.robots.ai_crawlers_blocked!.join(", ")})`, "Remove the Disallow rules — blocked AI crawlers can't cite the site."));
  if ((p.homepage.visible_text_bytes ?? 0) < 500 && p.homepage.status === 200)
    out.push({ ...mk("ssr", "Server-render homepage content", "AI crawlers don't run JS — add static H1 + intro text to the shell."), impact: 15, effort: "M" });
  return out;
}

function engagementActions(site: SiteCfg): Action[] {
  const watch = SHIPPED_WATCH();
  return data
    .landingPages(site)
    .filter((l) => l.sessions >= 30 && l.engagement < 0.25 && l.page !== "(not set)")
    .slice(0, 3)
    .map((l) => {
      const url = `https://${site.gscHost}${l.page}`;
      // GA landing paths carry no trailing slash; shippedWatch keys may have one
      const watching = watch[url] ?? watch[`${url}/`];
      return {
        id: gid("engagement", url),
        host: site.host,
        title: `Fix content mismatch: ${l.page}`,
        kind: "Content rewrite of an existing page",
        why: `${l.sessions.toLocaleString()} sessions/90d land here but only ${(100 * l.engagement).toFixed(0)}% engage — the page isn't delivering what the click promised`,
        how: `Read the top queries landing here, rewrite the opening to deliver that answer immediately, move setup/context below.`,
        spec: [
          `Page: ${url}`,
          `Evidence: ${l.sessions.toLocaleString()} sessions/90d, ${(100 * l.engagement).toFixed(0)}% engagement (a healthy content page sits around 40–70%).`,
          `Check this site's queries for the ones landing on this path — the rewrite must answer THOSE in the first screenful.`,
          `Keep the URL; rewrite opening + structure, don't relocate.`,
          `Success: engagement above 35% within 28 days of shipping.`,
        ],
        impact: Math.round((l.sessions / 3) * 0.3),
        effort: "M" as Effort,
        tag: "engagement",
        source: "rule" as const,
        ...(watching ? { watching } : {}),
      };
    });
}

function trendActions(site: SiteCfg): Action[] {
  const t = data.sessionTrend(site);
  if (t.prior >= 50 && t.recent < t.prior * 0.75) {
    return [{
      id: `gen-trend-${slug(site.host)}`,
      host: site.host,
      title: `Investigate traffic drop`,
      kind: "Investigation",
      why: `Sessions down ${(100 * (1 - t.recent / t.prior)).toFixed(0)}% — ${t.recent.toLocaleString()} last 28d vs ${t.prior.toLocaleString()} prior`,
      how: `Check Search Console for position/impression drops by page, the probe for regressions, and recent deploys in the change window.`,
      spec: [
        `Compare the pages report for the two windows — find which pages lost impressions vs position.`,
        `Check docs/daily-log.md and data/probes/ for regressions in the window.`,
        `Cross-reference deploy dates (git log in the site repo) against the drop start.`,
        `The impact figure is a capped estimate of monthly traffic that recovering this drop would return — it ranks the card, it is not a forecast.`,
      ],
      // Every other rule emits recoverable clicks per month; this one starts
      // from sessions lost across a 28-day window, so normalize before it can
      // be compared. Discounted because an investigation is not a fix, and
      // capped: an unbounded loss on effort S would pin this card to the top
      // of the queue until the traffic came back on its own.
      impact: Math.min(60, Math.max(1, Math.round(((t.prior - t.recent) / 28) * 30 * 0.3))),
      effort: "S",
      tag: "trend",
      source: "rule",
    }];
  }
  return [];
}

function metadataActions(site: SiteCfg): Action[] {
  const audit = data.metadataAudit();
  const findings = audit?.sites[site.host] ?? audit?.sites[site.gscHost] ?? [];
  const watch = SHIPPED_WATCH();
  return findings.slice(0, 5).map((f) => {
    const pagePath = f.page.replace(/^https?:\/\/[^/]+/, "") || "/";
    const monthly = Math.max(1, Math.round(f.missed_clicks_window / 3)); // audit window is 90d
    const watching = watch[f.page];
    return {
      id: gid("metadata", f.page),
      host: site.host,
      title: `Metadata fix: ${pagePath}`,
      kind: "Title/meta rewrite — audit finding",
      why: `${f.imps.toLocaleString()} impressions in 90d; issues: ${f.issues.join("; ")}`,
      how: `Rewrite the title to carry the ranking-query language and the description as a ~150-char direct answer; respect the ~60-char title budget.`,
      spec: [
        `Page: ${f.page}`,
        `Current title: "${f.title}"`,
        f.description ? `Current description: "${f.description}"` : "Current description: (none)",
        `Top queries: ${f.top_queries.map((q) => `“${q.q}” (${q.imps} imps, pos ${q.pos}, ${(100 * q.ctr).toFixed(1)}% CTR)`).join(" · ")}`,
        ...f.issues.map((i) => `Issue: ${i}`),
        `Success: CTR on the listed queries reaches ≥ half of position-expected within 28 days. Freeze the title for those 28 days.`,
      ],
      impact: monthly,
      effort: "S" as Effort,
      tag: "metadata",
      source: "rule" as const,
      ...(watching ? { watching } : {}),
    };
  });
}

export function actionsFor(site: SiteCfg): Action[] {
  const metaActions = metadataActions(site);
  const metaPages = new Set(metaActions.map((a) => a.spec[0]?.replace("Page: ", "")));
  const generated = [
    ...metaActions,
    ...ctrGapActions(site).filter((a) => !metaPages.has(a.spec[0]?.replace("Page: ", ""))),
    ...strikingActions(site),
    ...probeActions(site),
    ...engagementActions(site),
    ...trendActions(site),
  ];
  const backlog = BACKLOG().filter((b) => b.host === site.host);
  return [...generated, ...backlog].sort((a, b) => score(b) - score(a));
}

export function allActions(): Action[] {
  const sites = SITES();
  const known = new Set(sites.map((s) => s.host));
  // Backlog items for hosts no longer in the config still deserve a place.
  const orphans = BACKLOG().filter((b) => !known.has(b.host));
  return [...sites.flatMap((s) => actionsFor(s)), ...orphans].sort((a, b) => score(b) - score(a));
}

export function actionById(id: string): Action | undefined {
  return allActions().find((a) => a.id === id);
}
