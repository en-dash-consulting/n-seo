/**
 * Configuration: one JSON file drives everything.
 *
 * seo-agent.config.json (or $SEO_AGENT_CONFIG) is read by BOTH this app and
 * every Python script (ingest/seo_config.py). One site list, one module
 * switchboard, one auth block — adding a site here adds it to every pull,
 * probe, audit and page. The example file documents every field.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CONFIG_PATH = process.env.SEO_AGENT_CONFIG
  ? path.resolve(process.env.SEO_AGENT_CONFIG)
  : path.join(ROOT, "seo-agent.config.json");
export const EXAMPLE_CONFIG_PATH = path.join(ROOT, "seo-agent.config.example.json");

export interface SiteCfg {
  /** canonical hostname — the URL slug in this app and the key in data/ga4/<host>/ */
  host: string;
  label: string;
  /** Search Console property: "sc-domain:example.com" or "https://www.example.com/" */
  gscProperty?: string;
  /** hostname to filter GSC page URLs by (a domain property covers subdomains) */
  gscHost: string;
  /** numeric GA4 property id, e.g. "123456789" */
  ga4Property?: string;
  /** regex (case-insensitive) matching branded queries, for the branded/generic split */
  brand?: string;
  repo?: string;
  hosting?: string;
}

export interface ModuleCfg {
  enabled: boolean;
  [k: string]: unknown;
}

export interface Config {
  name: string;
  port: number;
  google: {
    auth: "service-account-key" | "gcloud-impersonate" | "gcloud-user";
    serviceAccountKey?: string;
    impersonate?: string;
  };
  sites: SiteCfg[];
  watchPages: string[];
  conversions?: { site: string; events: string[]; sourceDimension?: string };
  participation?: { expertise?: string };
  modules: Record<string, ModuleCfg>;
}

export const MODULE_INFO: { key: string; title: string; blurb: string; needs?: string }[] = [
  { key: "indexStatus", title: "Index coverage sweep", blurb: "Ask Search Console's URL Inspection API whether each sitemap URL is actually indexed. ~1 call per URL, 2,000/day quota per property." },
  { key: "metadataAudit", title: "Metadata audit", blurb: "Fetch each ranking page's live title/description and judge them against the queries it ranks for." },
  { key: "opportunityScan", title: "Opportunity scan", blurb: "Refresh the 84-day trend analysis and detect rising queries no queue item covers. With the LLM module on, also drafts proposals and verdicts." },
  { key: "llm", title: "LLM inference", blurb: "Runs a local command (default: the claude CLI) for briefings and proposals. Nothing is auto-applied — output lands as proposals you accept or ignore.", needs: "a CLI that reads a prompt on stdin and prints a reply" },
  { key: "hackerNews", title: "Hacker News digest", blurb: "Find fresh HN threads in your expertise areas and brief you on each. Briefings only — no comment text is ever generated.", needs: "your HN username (to mark threads you already joined)" },
  { key: "reddit", title: "Reddit digest", blurb: "Same idea for subreddits. Reddit blocks anonymous API reads, so this needs a free 'script' app's credentials in .env.", needs: "REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET" },
  { key: "indexNow", title: "IndexNow", blurb: "Generate a key and ping Bing/Copilot/Yandex with changed URLs on publish. Free and instant; does nothing for Google." },
  { key: "staticExport", title: "Static export", blurb: "Snapshot the dashboard into site/ as static HTML after each daily run, for hosting a read-only mirror behind your own auth." },
  { key: "gitAutoCommit", title: "Git auto-commit", blurb: "Commit the daily log and export after each run (and push if a remote is set)." },
  { key: "notifications", title: "Desktop notifications", blurb: "macOS notification when a daily step fails (osascript)." },
];

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

/** Fill in defaults so the rest of the app can assume the shape. */
function normalize(raw: Partial<Config>): Config {
  const modules: Record<string, ModuleCfg> = {};
  for (const m of MODULE_INFO) modules[m.key] = { enabled: false, ...(raw.modules?.[m.key] ?? {}) };
  for (const [k, v] of Object.entries(raw.modules ?? {})) if (!modules[k]) modules[k] = { ...v, enabled: !!v?.enabled };
  const sites = (raw.sites ?? []).map((s) => ({
    ...s,
    label: s.label || s.host,
    gscHost: s.gscHost || s.host,
    gscProperty: s.gscProperty || undefined,
    ga4Property: s.ga4Property || undefined,
    brand: s.brand || undefined,
  }));
  return {
    name: raw.name || "SEO Agent",
    port: Number(process.env.SEO_PORT ?? raw.port ?? 4600),
    google: { auth: "service-account-key", ...(raw.google ?? {}) } as Config["google"],
    sites,
    watchPages: raw.watchPages ?? [],
    conversions: raw.conversions?.site ? raw.conversions : undefined,
    participation: raw.participation,
    modules,
  };
}

/** True when the user has not created their own config yet — the app then
 *  runs on the example so the UI can explain what to do instead of crashing. */
export let USING_EXAMPLE_CONFIG = !fs.existsSync(CONFIG_PATH);

export function loadConfig(): Config {
  USING_EXAMPLE_CONFIG = !fs.existsSync(CONFIG_PATH);
  const p = USING_EXAMPLE_CONFIG ? EXAMPLE_CONFIG_PATH : CONFIG_PATH;
  return normalize(readJson<Partial<Config>>(p));
}

/** Rewrite the config file, keeping unknown keys. Creates it from the example
 *  on first save (that is how the Settings page bootstraps a new install). */
export function saveConfig(mutate: (raw: Record<string, unknown>) => void): Config {
  const src = fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : EXAMPLE_CONFIG_PATH;
  const raw = readJson<Record<string, unknown>>(src);
  mutate(raw);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2) + "\n");
  return loadConfig();
}

/** Live view: re-read on every access so a hand edit shows up without a
 *  restart (the file is tiny; the cost is nothing next to the data reads). */
export const config = (): Config => loadConfig();
export const SITES = (): SiteCfg[] => loadConfig().sites;
export const PORT = loadConfig().port;

/** data/gsc/<slug>/ — must match ingest/seo_config.py gsc_slug(). */
export function gscSlug(property: string): string {
  return property
    .replace(/^sc-domain:/, "")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .replace(/\//g, "_");
}

export const siteByHost = (host: string): SiteCfg | undefined =>
  SITES().find((s) => s.host === host || s.gscHost === host);
