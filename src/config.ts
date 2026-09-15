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
import { createRequire } from "node:module";

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


/** The numbers the action engine ranks by.
 *
 *  These were literals scattered through actions.ts and data.ts, which meant
 *  disagreeing with any of them required editing the engine — and then living
 *  with the merge every time you upgraded. A practitioner's judgement about
 *  what counts as striking distance is exactly the thing they should be able
 *  to change without forking. */
export interface Rules {
  /** Impact is divided by this to rank. Higher = the effort costs more. */
  effortWeight: { S: number; M: number; L: number };
  strikingDistance: {
    minPosition: number;
    maxPosition: number;
    minImpressions: number;
    /** How many query rows to consider per site. */
    maxRows: number;
    /** Monthly clicks assumed per impression if the query moves into the top 5. */
    impactPerImpression: number;
  };
  ctrGap: {
    minImpressions: number;
    /** Flagged when actual CTR is below expected × this. */
    belowExpectedRatio: number;
  };
  engagement: { minSessions: number; maxEngagement: number; maxCards: number };
  trafficDrop: {
    minPriorSessions: number;
    /** Flagged when recent < prior × this. */
    dropRatio: number;
  };
  probe: { minVisibleTextBytes: number };
  metadata: { maxFindings: number };
  /** Ordering adjustments. Applied after the rules run, before the sort. */
  priorities: Priority[];
}

/** The policy a human follows, as opposed to the numbers a rule sorts by.
 *
 *  Read by the dashboard, the daily log and the agent skills, so changing the
 *  freeze here changes it everywhere it is stated — rather than in six places
 *  that drift apart. */
export interface OperatingRules {
  titleFreezeDays: number;
  metadataChangesPerWeek: number;
  /** Decisions ride this window; the long history is for totals only. */
  decisionWindowDays: number;
  historyMonths: number;
}

/** A named bundle of the two above, plus module defaults and skills.
 *  Resolved from `profile` in the config. See docs/PROFILES.md. */
export interface Profile {
  name: string;
  description?: string;
  version?: string;
  operatingRules?: Partial<OperatingRules>;
  rules?: DeepPartial<Rules>;
  modules?: Record<string, ModuleCfg>;
  /** Directory of SKILL.md folders, relative to the profile, copied by `n-seo init`. */
  skills?: string;
  /** The parts of a method that are not a number.
   *
   *  Building the first real profile is what surfaced this. A practitioner's
   *  method turned out to be barely distinguishable from ours in thresholds —
   *  the striking-distance floor never binds once rows are sorted by
   *  impressions — and almost entirely distinguishable in judgement: what to
   *  optimise for, what needs a human's approval, what never to automate.
   *  None of that is expressible as a threshold, and a profile that cannot
   *  carry it is not a method, just a settings file.
   *
   *  Shown on the dashboard and written into the instance's CLAUDE.md, so the
   *  owner and their agent read the same rules. */
  principles?: ProfilePrinciple[];
}

export interface ProfilePrinciple {
  title: string;
  body: string;
  /** `hard` rules are constraints an agent must not cross; `guide` is
   *  judgement it should apply. The dashboard shows them apart because they
   *  are different kinds of claim. */
  kind?: "hard" | "guide";
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export const DEFAULT_RULES: Rules = {
  effortWeight: { S: 1, M: 2.5, L: 5 },
  strikingDistance: { minPosition: 5, maxPosition: 15, minImpressions: 10, maxRows: 12, impactPerImpression: 0.06 },
  ctrGap: { minImpressions: 30, belowExpectedRatio: 0.5 },
  engagement: { minSessions: 30, maxEngagement: 0.25, maxCards: 3 },
  trafficDrop: { minPriorSessions: 50, dropRatio: 0.75 },
  probe: { minVisibleTextBytes: 500 },
  metadata: { maxFindings: 5 },
  priorities: [],
};

export const DEFAULT_OPERATING_RULES: OperatingRules = {
  titleFreezeDays: 28,
  metadataChangesPerWeek: 8,
  decisionWindowDays: 90,
  historyMonths: 16,
};

/** A declarative adjustment to the queue's ordering.
 *
 *  This is n-seo's answer to "custom rules", and it is deliberately not a
 *  plugin API. Building the first real profile showed what a practitioner
 *  actually wants to express: "prefer pages that lead somewhere", "stop
 *  showing me /legal". That is matching and weighting, not arbitrary code —
 *  and a profile that ships code means installing someone's method runs their
 *  program next to your Search Console credentials.
 *
 *  Two hard constraints on the design:
 *
 *    - A priority may reorder or hide, never invent. It cannot fabricate a
 *      card, so it cannot manufacture evidence.
 *    - Every card it touches says so, and says why. A queue that silently
 *      reorders itself is a queue whose order you cannot trust, and the whole
 *      product rests on showing its working. */
export interface Priority {
  /** Shown on every card this touches. Required: an unexplained boost is the
   *  one thing this must never be. */
  why: string;
  when: {
    /** Exact host, e.g. "example.com". */
    host?: string;
    /** Regular expression against the URL path of the page the card is about. */
    pathMatches?: string;
    /** Rule tag: metadata, striking, ctr-gap, engagement, hygiene, trend. */
    tag?: string;
    /** Substring of the card's `kind`, case-insensitive. */
    kind?: string;
  };
  /** Multiply the impact used for ordering. 1.5 = half again; 0.5 = half. */
  multiply?: number;
  /** Remove the card entirely. For pages you have decided not to work on. */
  drop?: boolean;
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
  /** Built-in name ("default"), a path, or an installed package. */
  profile?: string;
  rules: Rules;
  operatingRules: OperatingRules;
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

/** Where a profile spec resolves to, or null if it does not.
 *
 *  Three forms, in the order they are tried:
 *    "default"            a profile shipped with the engine
 *    "./x" or "/x"        a directory in or near the instance
 *    "n-seo-profile-acme" an installed package
 *
 *  Resolution is deliberately explicit rather than clever: a profile that
 *  cannot be found must be an error the owner sees, never a silent fallback
 *  to our defaults. Someone running a client's portfolio on their agency's
 *  method should not discover it quietly stopped applying. */
export function resolveProfileDir(spec: string): string | null {
  const builtin = path.join(ROOT, "profiles", spec);
  if (!spec.includes("/") && !spec.includes("\\") && fs.existsSync(path.join(builtin, PROFILE_FILE))) return builtin;

  const asPath = path.isAbsolute(spec) ? spec : path.resolve(INSTANCE, spec);
  if (fs.existsSync(path.join(asPath, PROFILE_FILE))) return asPath;

  try {
    const req = createRequire(path.join(INSTANCE, "package.json"));
    return path.dirname(req.resolve(`${spec}/${PROFILE_FILE}`));
  } catch {
    return null;
  }
}

export const PROFILE_FILE = "n-seo.profile.json";

/** The resolved profile, or null when none is configured. Throws when one is
 *  configured and cannot be found — see resolveProfileDir. */
export function loadProfile(spec: string | undefined): { profile: Profile; dir: string } | null {
  if (!spec) return null;
  const dir = resolveProfileDir(spec);
  if (!dir) {
    throw new Error(
      `profile "${spec}" could not be resolved.\n` +
      `  tried: a profile shipped with the engine (${path.join(ROOT, "profiles", spec)}),\n` +
      `         a directory relative to the instance (${path.resolve(INSTANCE, spec)}),\n` +
      `         and an installed package.\n` +
      `  install it, fix the path, or remove "profile" from the config.`,
    );
  }
  const profile = readJson<Profile>(path.join(dir, PROFILE_FILE));
  return { profile: { ...profile, name: profile.name || spec }, dir };
}

/** Recursive merge for the plain-object config trees. Later wins; undefined
 *  never overwrites, so a profile may set one threshold without restating the
 *  block it lives in. */
function merge<T>(base: T, ...layers: unknown[]): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const layer of layers) {
    if (!layer || typeof layer !== "object") continue;
    for (const [k, v] of Object.entries(layer as Record<string, unknown>)) {
      if (v === undefined) continue;
      const cur = out[k];
      out[k] = cur && typeof cur === "object" && !Array.isArray(cur) && v && typeof v === "object" && !Array.isArray(v)
        ? merge(cur, v)
        : v;
    }
  }
  return out as T;
}

function normalize(raw: Partial<Config>): Config {
  const loaded = loadProfile(raw.profile);
  const fromProfile = loaded?.profile;

  const modules: Record<string, ModuleCfg> = {};
  for (const m of MODULE_INFO) {
    modules[m.key] = { enabled: false, ...(MODULE_DEFAULTS[m.key] ?? {}), ...(fromProfile?.modules?.[m.key] ?? {}), ...(raw.modules?.[m.key] ?? {}) };
  }
  for (const [k, v] of Object.entries({ ...(fromProfile?.modules ?? {}), ...(raw.modules ?? {}) })) {
    if (!modules[k]) modules[k] = { ...v, enabled: !!v?.enabled };
  }
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
    profile: raw.profile,
    // engine defaults <- profile <- this instance. The instance always wins,
    // so a client can always see, and override, where they depart from the
    // method they installed.
    // `merge` replaces arrays rather than concatenating, so an instance that
    // sets `priorities` replaces the profile's outright. Appending would make
    // a profile's priority impossible to remove without forking it.
    rules: merge(DEFAULT_RULES, fromProfile?.rules, raw.rules),
    operatingRules: merge(DEFAULT_OPERATING_RULES, fromProfile?.operatingRules, raw.operatingRules),
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
