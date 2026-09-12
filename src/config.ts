/**
 * Configuration: one JSON file drives everything.
 *
 * n-seo.config.json (or $N_SEO_CONFIG) is read by BOTH this app and
 * every Python script (ingest/seo_config.py). One site list, one module
 * switchboard, one auth block — adding a site here adds it to every pull,
 * probe, audit and page. The example file documents every field.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { execFileSync } from "node:child_process";

/** The engine checkout: code, public assets, engine docs. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** The instance: one user's config, queue, content and data. Defaults to the
 *  engine checkout ("in-place" mode) so a plain clone works unchanged; set
 *  N_SEO_INSTANCE to keep them apart so upgrading the engine is a git pull. */
export const INSTANCE = process.env.N_SEO_INSTANCE
  ? path.resolve(process.env.N_SEO_INSTANCE)
  : ROOT;
export const CONFIG_PATH = process.env.N_SEO_CONFIG
  ? path.resolve(process.env.N_SEO_CONFIG)
  : path.join(INSTANCE, "n-seo.config.json");
export const EXAMPLE_CONFIG_PATH = path.join(ROOT, "n-seo.config.example.json");

export const ENGINE_VERSION: string = (() => {
  try {
    return (JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

export interface EngineInfo {
  version: string;
  commit: string | null;
  root: string;
  instance: string;
  mode: "in-place" | "instance";
}

/** What is running: engine version + commit, where the engine and the
 *  instance live. Shown on Settings, by `n-seo version` and the MCP tool. */
export function engineInfo(): EngineInfo {
  let commit: string | null = null;
  try {
    commit = execFileSync("git", ["-C", ROOT, "rev-parse", "--short", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim() || null;
  } catch {
    commit = null;
  }
  return { version: ENGINE_VERSION, commit, root: ROOT, instance: INSTANCE, mode: INSTANCE === ROOT ? "in-place" : "instance" };
}

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

export interface Hooks {
  /** shell commands run in the instance dir before the first step */
  beforeRun: string[];
  /** … after the last step (and after last-run.json is written) */
  afterRun: string[];
  /** … after a named step, e.g. { "daily-diff": ["node my_sync.mjs"] } */
  afterStep: Record<string, string[]>;
}

export interface Config {
  name: string;
  port: number;
  google: {
    /** `metadata` is the GCE / Cloud Run / GKE runtime service account: no
     *  key file anywhere. See docs/SETUP-GOOGLE.md. */
    auth: "service-account-key" | "gcloud-impersonate" | "gcloud-user" | "metadata";
    serviceAccountKey?: string;
    impersonate?: string;
  };
  sites: SiteCfg[];
  watchPages: string[];
  conversions?: { site: string; events: string[]; sourceDimension?: string };
  participation?: { expertise?: string };
  modules: Record<string, ModuleCfg>;
  /** extra Search Console properties pulled into data/gsc/<slug>/ but not shown as sites */
  gscExtraProperties: string[];
  hooks: Hooks;
}

/** Per-module defaults, so a half-written block cannot make a step guess.
 *  Mirrors MODULE_DEFAULTS in ingest/seo_config.py. */
export const MODULE_DEFAULTS: Record<string, Record<string, unknown>> = {
  // The one module that ships on — see the note in ingest/seo_config.py.
  updateCheck: { enabled: true },
  staticExport: { signOutUrl: "", signOutLabel: "Sign out" },
  publish: { target: "gcs", destination: "", command: "", delete: false, dryRun: false, env: {} },
};

export const MODULE_INFO: { key: string; title: string; blurb: string; needs?: string }[] = [
  { key: "indexStatus", title: "Index coverage sweep", blurb: "Ask Search Console's URL Inspection API whether each sitemap URL is actually indexed. ~1 call per URL, 2,000/day quota per property." },
  { key: "metadataAudit", title: "Metadata audit", blurb: "Fetch each ranking page's live title/description and judge them against the queries it ranks for." },
  { key: "opportunityScan", title: "Opportunity scan", blurb: "Refresh the 84-day trend analysis and detect rising queries no queue item covers. With the LLM module on, also drafts proposals and verdicts." },
  { key: "llm", title: "LLM inference", blurb: "Drafts briefings and proposals, either through a local command or an HTTP endpoint. Nothing is auto-applied — output lands as proposals you accept or ignore.", needs: "a CLI that reads a prompt on stdin, or an `http` block with an API key (the only option on a server)" },
  { key: "hackerNews", title: "Hacker News digest", blurb: "Find fresh HN threads in your expertise areas and brief you on each. Briefings only — no comment text is ever generated.", needs: "your HN username (to mark threads you already joined)" },
  { key: "reddit", title: "Reddit digest", blurb: "Same idea for subreddits. Reddit blocks anonymous API reads, so this needs a free 'script' app's credentials in .env.", needs: "REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET" },
  { key: "indexNow", title: "IndexNow", blurb: "Generate a key and ping Bing/Copilot/Yandex with changed URLs on publish. Free and instant; does nothing for Google." },
  { key: "staticExport", title: "Static export", blurb: "Snapshot the dashboard into site/ as static HTML after each daily run, for hosting a read-only mirror behind your own auth. `signOutUrl` adds a sign-out link to every exported page." },
  { key: "publish", title: "Publish the mirror", blurb: "Copy site/ to a bucket, an object store or a box over ssh after the export — a real pipeline step, so it is logged and retried like the rest. `dryRun` prints the command without running it, which is how you rehearse a cutover.", needs: "gcloud, aws or rsync on PATH, depending on the target" },
  { key: "gitAutoCommit", title: "Git auto-commit", blurb: "Commit the daily log and export after each run (and push if a remote is set)." },
  { key: "notifications", title: "Desktop notifications", blurb: "macOS notification when a daily step fails (osascript)." },
  { key: "updateCheck", title: "Update check", blurb: "Once a day, during the run, ask the registry whether a newer engine has been published and note it on this page. The only module that is on by default. The dashboard itself never makes the request — it reads the result — so pages still render with no network. Nothing about this instance is sent." },
];

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

/** Fill in defaults so the rest of the app can assume the shape. */
function normalize(raw: Partial<Config>): Config {
  const modules: Record<string, ModuleCfg> = {};
  for (const m of MODULE_INFO) modules[m.key] = { enabled: false, ...(MODULE_DEFAULTS[m.key] ?? {}), ...(raw.modules?.[m.key] ?? {}) };
  for (const [k, v] of Object.entries(raw.modules ?? {})) if (!modules[k]) modules[k] = { ...v, enabled: !!v?.enabled };
  const sites = (raw.sites ?? []).map((s) => ({
    ...s,
    label: s.label || s.host,
    gscHost: s.gscHost || s.host,
    gscProperty: s.gscProperty || undefined,
    ga4Property: s.ga4Property || undefined,
    brand: s.brand || undefined,
  }));
  const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);
  const rawHooks = (raw.hooks ?? {}) as Partial<Record<string, unknown>>;
  const afterStep: Record<string, string[]> = {};
  for (const [k, v] of Object.entries((rawHooks.afterStep as Record<string, unknown>) ?? {})) afterStep[k] = strList(v);
  return {
    name: raw.name || "n-seo",
    port: Number(process.env.SEO_PORT ?? raw.port ?? 4600),
    google: { ...(raw.google ?? {}), auth: raw.google?.auth || "service-account-key" } as Config["google"],
    sites,
    watchPages: raw.watchPages ?? [],
    conversions: raw.conversions?.site ? raw.conversions : undefined,
    participation: raw.participation,
    modules,
    gscExtraProperties: strList(raw.gscExtraProperties),
    hooks: { beforeRun: strList(rawHooks.beforeRun), afterRun: strList(rawHooks.afterRun), afterStep },
  };
}

/** One KEY=value from the instance's .env (quotes stripped). */
export function dotEnv(key: string): string | undefined {
  try {
    for (const line of fs.readFileSync(path.join(INSTANCE, ".env"), "utf8").split("\n")) {
      const t = line.trim();
      if (t.startsWith(`${key}=`)) return t.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") || undefined;
    }
  } catch {
    /* no .env */
  }
  return undefined;
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

/** The data/gsc/ directory for a property. A url-prefix property
 *  ("https://example.com/") would slug to the same name as the domain
 *  property ("sc-domain:example.com"), so it gets a "-urlprefix" suffix.
 *  Must match ingest/seo_config.py gsc_data_slug(). */
export function gscDataSlug(property: string): string {
  return /^https?:\/\//i.test(property) ? gscSlug(property) + "-urlprefix" : gscSlug(property);
}

export const siteByHost = (host: string): SiteCfg | undefined =>
  SITES().find((s) => s.host === host || s.gscHost === host);
