/**
 * MCP server over the n-seo data layer.
 *
 * Read-only by design. The queue is edited in config/backlog.json (or via the
 * dashboard's buttons); an agent reaching this server gets the same view you
 * get on the dashboard, not a way to change it. Every tool is annotated
 * readOnlyHint.
 *
 * All the real data lives in data/ on this machine, so this server only makes
 * sense running locally, next to the files. Two transports use it:
 * src/mcp-stdio.ts (a local client spawns it; the OS process boundary is the
 * auth) and POST /mcp on the dashboard (bearer token; see src/server.tsx).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { ROOT, INSTANCE, SITES, config, siteByHost, MODULE_INFO, engineInfo } from "./config.js";
import { allActions, score, type Action } from "./actions.js";
import * as data from "./data.js";

/** Tools hand back JSON as text: compact, and every client can read it. */
const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

const fail = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  isError: true,
});

const knownHosts = () => SITES().map((s) => s.host).join(", ") || "(no sites configured)";

const clip = (s: string | undefined, n: number) =>
  !s ? "" : s.length <= n ? s : s.slice(0, n - 1) + "…";

/** Ranked the way the dashboard ranks: impact per unit of effort. */
const ranked = (list: Action[]) => [...list].sort((a, b) => score(b) - score(a));

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "n-seo", version: "0.1.0" },
    {
      instructions:
        "Read-only access to a local SEO control plane: the action queue, " +
        "per-site Search Console / GA4 metrics, the metadata audit, live-site " +
        "probe health, the daily ops log, and machine-generated opportunity " +
        "proposals. Decisions ride the 90-day window; 16-month data is for " +
        "totals and history. Impact numbers order the queue — they are not " +
        "forecasts. After a title/description change, that page's metadata is " +
        "frozen for 28 days. Nothing here writes: propose changes to the " +
        "user, don't apply them.",
    }
  );

  const readOnly = { readOnlyHint: true, openWorldHint: false };

  /* ---------- the queue ---------- */

  server.registerTool(
    "list_actions",
    {
      title: "List the action queue",
      description:
        "The single source of 'what's next'. Active items are unstarted; " +
        "watching items have shipped and are being measured. Ranked by " +
        "impact per unit of effort.",
      inputSchema: {
        status: z.enum(["active", "watching", "all"]).default("active")
          .describe("active = not yet done, watching = shipped and being measured"),
        host: z.string().optional().describe(`filter to one site (${knownHosts()})`),
        tag: z.string().optional().describe("e.g. metadata, ctr-gap, striking, hygiene, engagement, content, distribution"),
        limit: z.number().int().min(1).max(100).default(25),
      },
      annotations: readOnly,
    },
    async ({ status, host, tag, limit }) => {
      let list = allActions();
      if (status === "active") list = list.filter((a) => !a.watching);
      if (status === "watching") list = list.filter((a) => a.watching);
      if (host) list = list.filter((a) => a.host === host);
      if (tag) list = list.filter((a) => a.tag === tag);
      const rows = ranked(list).slice(0, limit).map((a, i) => ({
        rank: i + 1,
        id: a.id,
        title: a.title,
        host: a.host,
        tag: a.tag,
        impact: a.impact,
        effort: a.effort,
        kind: a.kind,
        source: a.source,
        why: clip(a.why, 240),
        watching: a.watching ? clip(a.watching, 240) : undefined,
      }));
      return json({ matched: list.length, returned: rows.length, actions: rows });
    }
  );

  server.registerTool(
    "get_action",
    {
      title: "Get one action in full",
      description:
        "Full record for a single queue item including its spec and success " +
        "criteria. Match by id, or case-insensitive substring on the title.",
      inputSchema: { title: z.string().describe("action id, or a substring of the title") },
      annotations: readOnly,
    },
    async ({ title }) => {
      const q = title.toLowerCase();
      const all = allActions();
      const byId = all.find((a) => a.id === title);
      if (byId) return json(byId);
      const hits = all.filter((a) => a.title.toLowerCase().includes(q));
      if (hits.length === 0) return fail(`No action matching "${title}".`);
      if (hits.length > 1 && !hits.some((h) => h.title.toLowerCase() === q)) {
        return json({
          ambiguous: true,
          matches: hits.map((h) => ({ id: h.id, title: h.title, host: h.host })),
        });
      }
      return json(hits.find((h) => h.title.toLowerCase() === q) ?? hits[0]);
    }
  );

  /* ---------- sites + per-site metrics ---------- */

  server.registerTool(
    "list_sites",
    {
      title: "List the configured sites",
      description:
        "Every site this control plane governs, with its 16-month Search Console " +
        "totals, 28-day session trend, and current probe status.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => {
      const probe = data.latestProbe();
      return json({
        probed_at: probe?.probed_at ?? null,
        sites: SITES().map((s) => {
          const p = data.probeFor(s);
          const trend = data.sessionTrend(s);
          return {
            host: s.host,
            gscProperty: s.gscProperty ?? null,
            ga4Property: s.ga4Property ?? null,
            repo: s.repo ?? null,
            hosting: s.hosting ?? null,
            gsc16mo: data.gscSummary(s),
            sessions28d: trend.recent,
            sessionsPrior28d: trend.prior,
            probeHealthy: p ? data.probeHealthy(p) : null,
            probeFindings: data.probeFindings(p),
          };
        }),
      });
    }
  );

  server.registerTool(
    "site_report",
    {
      title: "Per-site report",
      description:
        "Search Console totals, traffic mix (search vs AI assistants vs direct), " +
        "session trend, top landing pages, referrals from your other sites, and " +
        "probe findings for one site.",
      inputSchema: {
        host: z.string().describe(knownHosts()),
        landingLimit: z.number().int().min(1).max(50).default(10),
      },
      annotations: readOnly,
    },
    async ({ host, landingLimit }) => {
      const site = siteByHost(host);
      if (!site) return fail(`Unknown host "${host}". Known: ${knownHosts()}`);
      return json({
        host: site.host,
        repo: site.repo ?? null,
        hosting: site.hosting ?? null,
        gsc16mo: data.gscSummary(site),
        trafficMix90d: data.trafficMix(site),
        sessionTrend28d: data.sessionTrend(site),
        landingPages: data.landingPages(site).slice(0, landingLimit),
        crossReferrals: data.crossReferrals(site),
        probe: data.probeFor(site) ?? null,
      });
    }
  );

  server.registerTool(
    "top_queries",
    {
      title: "Top search queries for a site",
      description:
        "Search Console queries with clicks, impressions, CTR and position. Use the " +
        "90-day window for decisions; 16-month is for totals and history.",
      inputSchema: {
        host: z.string().describe(knownHosts()),
        window: z.enum(["90d", "16mo"]).default("90d"),
        limit: z.number().int().min(1).max(200).default(25),
      },
      annotations: readOnly,
    },
    async ({ host, window, limit }) => {
      const site = siteByHost(host);
      if (!site) return fail(`Unknown host "${host}". Known: ${knownHosts()}`);
      const rows = data.queries(site, window === "90d").slice(0, limit)
        .map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));
      return json({ host: site.host, window, count: rows.length, queries: rows });
    }
  );

  server.registerTool(
    "striking_distance",
    {
      title: "Striking-distance queries",
      description:
        "Queries ranking just off page one (position 5–15), where a small move " +
        "converts existing impressions into clicks. 90-day window.",
      inputSchema: {
        host: z.string().describe(knownHosts()),
        minImpressions: z.number().int().min(1).default(10),
        limit: z.number().int().min(1).max(100).default(25),
      },
      annotations: readOnly,
    },
    async ({ host, minImpressions, limit }) => {
      const site = siteByHost(host);
      if (!site) return fail(`Unknown host "${host}". Known: ${knownHosts()}`);
      const rows = data.strikingDistance(site, minImpressions).slice(0, limit)
        .map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));
      return json({ host: site.host, count: rows.length, queries: rows });
    }
  );

  server.registerTool(
    "ctr_gaps",
    {
      title: "Queries whose CTR trails their position",
      description:
        "Ranking well but under-clicked — usually a title/description problem. " +
        "`expected` is the CTR the position would normally earn.",
      inputSchema: {
        host: z.string().describe(knownHosts()),
        minImpressions: z.number().int().min(1).default(30),
        limit: z.number().int().min(1).max(100).default(25),
      },
      annotations: readOnly,
    },
    async ({ host, minImpressions, limit }) => {
      const site = siteByHost(host);
      if (!site) return fail(`Unknown host "${host}". Known: ${knownHosts()}`);
      const rows = data.ctrGaps(site, minImpressions).slice(0, limit)
        .map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, expected: r.expected, position: r.position }));
      return json({ host: site.host, count: rows.length, queries: rows });
    }
  );

  server.registerTool(
    "metadata_audit",
    {
      title: "Metadata audit findings",
      description:
        "Per-page title/description findings from the daily crawl. Note the " +
        "hard rules before acting: 28-day freeze after any title change, and " +
        "at most ~8 metadata changes per week across all sites.",
      inputSchema: { host: z.string().optional().describe(`one of ${knownHosts()}; omit for all`) },
      annotations: readOnly,
    },
    async ({ host }) => {
      const audit = data.metadataAudit();
      if (!audit) return fail("No metadata audit on disk yet — run python3 ingest/analyze_metadata.py.");
      if (!host) return json(audit);
      const findings = audit.sites[host];
      if (!findings) return fail(`No audit entry for "${host}". Known: ${Object.keys(audit.sites).join(", ")}`);
      return json({ generated: audit.generated, host, findings });
    }
  );

  /* ---------- trends ---------- */

  server.registerTool(
    "trends_timeseries",
    {
      title: "Daily clicks and sessions",
      description:
        "Per-day Google clicks and GA4 sessions for a site over the last N days, " +
        "for spotting inflections the 90-day aggregate hides.",
      inputSchema: {
        host: z.string().describe(knownHosts()),
        days: z.number().int().min(7).max(180).default(90),
      },
      annotations: readOnly,
    },
    async ({ host, days }) => {
      const site = siteByHost(host);
      if (!site) return fail(`Unknown host "${host}". Known: ${knownHosts()}`);
      const dates = data.lastNDates(days);
      const clicks = new Map<string, number>();
      for (const r of data.gscTimeseries(site)) {
        clicks.set(r.date, (clicks.get(r.date) ?? 0) + r.clicks);
      }
      const sessions = new Map<string, number>();
      for (const r of data.ga4Timeseries(site)) {
        sessions.set(r.date, (sessions.get(r.date) ?? 0) + r.sessions);
      }
      return json({
        host: site.host,
        days,
        series: dates.map((d) => ({
          date: d,
          clicks: clicks.get(d) ?? 0,
          sessions: sessions.get(d) ?? 0,
        })),
      });
    }
  );

  /* ---------- ops health, log, proposals ---------- */

  server.registerTool(
    "ops_status",
    {
      title: "Batch and data health",
      description:
        "Whether the last daily run succeeded, how stale each dataset is, and " +
        "the current probe results. Check this before trusting any numbers.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => {
      const probe = data.latestProbe();
      return json({
        lastRun: data.lastRun(),
        server: data.processFreshness(),
        freshness: data.dataFreshness(),
        probe: probe
          ? {
              probed_at: probe.probed_at,
              healthy: probe.sites.filter((s) => data.probeHealthy(s)).length,
              total: probe.sites.length,
              sites: probe.sites.map((s) => ({ host: s.site, findings: data.probeFindings(s) })),
            }
          : null,
      });
    }
  );

  server.registerTool(
    "daily_log",
    {
      title: "Recent daily-ops log entries",
      description:
        "What the batch observed each day: probe health, watched-page numbers, " +
        "conversions, cross-referrals. Newest first.",
      inputSchema: { days: z.number().int().min(1).max(30).default(5) },
      annotations: readOnly,
    },
    async ({ days }) => {
      const all = data.dailyLogSections();
      return json({ entries: all.slice(0, days) });
    }
  );

  server.registerTool(
    "opportunity_proposals",
    {
      title: "Machine-proposed work awaiting review",
      description:
        "Riser detection plus (with the LLM module on) inferred proposals from " +
        "the daily scan, and verdicts on watched items. Proposals never " +
        "self-promote into the queue — the user accepts them on the dashboard.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => {
      const scan = data.opportunityScan();
      if (!scan) return fail("No opportunity scan on disk yet — run python3 ops/opportunity_scan.py.");
      return json(scan);
    }
  );

  server.registerTool(
    "conversions_status",
    {
      title: "Conversion instrumentation",
      description:
        "Whether the configured GA4 key events (signups, leads…) are flowing, " +
        "their 28-day counts, and the primary event by source.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => json(data.funnelSummary())
  );

  server.registerTool(
    "campaigns",
    {
      title: "Outreach campaigns",
      description:
        "Standing outreach plays from content/campaigns/: ranked targets with " +
        "contact routes and pitch angles, templates, and the send plan. Omit " +
        "slug to list; pass it for one campaign in full.",
      inputSchema: {
        slug: z.string().optional(),
        onlySubmitted: z.boolean().default(false).describe("only targets with a status set"),
      },
      annotations: readOnly,
    },
    async ({ slug, onlySubmitted }) => {
      const all = data.campaigns();
      if (!slug) {
        return json(all.map((c) => ({ slug: c.slug, name: c.name, site: c.site, targets: c.targets.length, templates: c.templates.length, planned: c.plan.length })));
      }
      const c = all.find((x) => x.slug === slug);
      if (!c) return fail(`No campaign "${slug}". Known: ${all.map((x) => x.slug).join(", ") || "(none)"}`);
      const targets = onlySubmitted ? c.targets.filter((t) => t.status) : c.targets;
      return json({ ...c, targets });
    }
  );

  server.registerTool(
    "settings",
    {
      title: "Current configuration (no secrets)",
      description: "Name, sites, auth mode, and which modules are enabled. Never returns keys or tokens.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => {
      const cfg = config();
      return json({
        name: cfg.name,
        port: cfg.port,
        googleAuthMode: cfg.google.auth,
        sites: cfg.sites.map((s) => ({ host: s.host, gscProperty: s.gscProperty ?? null, ga4Property: s.ga4Property ?? null, brand: s.brand ?? null })),
        watchPages: cfg.watchPages,
        conversions: cfg.conversions ?? null,
        modules: Object.fromEntries(MODULE_INFO.map((m) => [m.key, !!cfg.modules[m.key]?.enabled])),
      });
    }
  );

  /* ---------- docs as resources ---------- */

  server.registerTool(
    "engine_info",
    {
      title: "Engine and instance",
      description:
        "Which n-seo engine is running (version, commit, path), which instance directory it serves, " +
        "and which modules are on. Check this before assuming a feature exists.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => {
      const cfg = config();
      return json({
        ...engineInfo(),
        modules: Object.fromEntries(MODULE_INFO.map((m) => [m.key, !!cfg.modules[m.key]?.enabled])),
      });
    }
  );

  /* Engine docs (playbook, rules) ship with the code; the daily log is the
     instance's own history. */
  const doc = (name: string, file: string, description: string, base: string = ROOT) =>
    server.registerResource(
      name,
      `seo://docs/${name}`,
      { title: file, description, mimeType: "text/markdown" },
      async (uri) => {
        const p = path.join(base, "docs", file);
        if (!fs.existsSync(p)) throw new Error(`${file} not found`);
        return {
          contents: [{ uri: uri.href, mimeType: "text/markdown", text: fs.readFileSync(p, "utf8") }],
        };
      }
    );

  doc("playbook", "PLAYBOOK.md", "The SEO / AEO / GEO strategy this queue implements.");
  doc("daily-log", "daily-log.md", "Full daily ops log, one entry per day.", INSTANCE);
  doc("operating-rules", "OPERATING-RULES.md", "The rules that keep the loop honest: freeze windows, batching, what the numbers mean.");

  return server;
}
