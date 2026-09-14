/** What profile is active, and exactly where this instance departs from it.
 *
 *  The second half is the point. Someone running a client's portfolio on an
 *  agency's method needs to see, at a glance, which numbers came from the
 *  agency and which they changed themselves — otherwise "we follow your
 *  model" is an unverifiable claim. */
import fs from "node:fs";
import path from "node:path";
import {
  CONFIG_PATH, EXAMPLE_CONFIG_PATH, PROFILE_FILE, DEFAULT_RULES, DEFAULT_OPERATING_RULES,
  ROOT, config, loadProfile, type Profile,
} from "./config.js";

export interface Departure {
  /** Dotted path, e.g. "rules.strikingDistance.maxRows". */
  key: string;
  /** What the layer beneath says: the profile, or the engine defaults. */
  inherited: unknown;
  /** What this instance sets instead. */
  instance: unknown;
}

export interface ProfileReport {
  /** The `profile` value from the config, if any. */
  spec?: string;
  name: string;
  description?: string;
  version?: string;
  dir?: string;
  departures: Departure[];
}

/** Flatten a nested tree to dotted leaves, so two layers can be diffed. */
function flatten(v: unknown, prefix = "", out: Record<string, unknown> = {}) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v)) flatten(val, prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) {
    out[prefix] = v;
  }
  return out;
}

function mergeDeep<T>(base: T, over: unknown): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  if (over && typeof over === "object") {
    for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
      if (v === undefined) continue;
      const cur = out[k];
      out[k] = cur && typeof cur === "object" && v && typeof v === "object" && !Array.isArray(v)
        ? mergeDeep(cur, v)
        : v;
    }
  }
  return out as T;
}

/** The config as written, not the normalized one. Normalization has already
 *  merged the layers, so it can no longer say who set what. */
function rawConfig(): Record<string, unknown> {
  const p = fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : EXAMPLE_CONFIG_PATH;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function profileReport(): ProfileReport {
  const cfg = config();
  const raw = rawConfig();
  const loaded = cfg.profile ? loadProfile(cfg.profile) : null;
  const profile = loaded?.profile ?? null;

  const inherited = flatten({
    rules: mergeDeep(DEFAULT_RULES, profile?.rules),
    operatingRules: mergeDeep(DEFAULT_OPERATING_RULES, profile?.operatingRules),
  });
  const instanceSet = flatten({ rules: raw.rules, operatingRules: raw.operatingRules });

  const departures = Object.entries(instanceSet)
    .filter(([key, value]) => inherited[key] !== value)
    .map(([key, value]) => ({ key, inherited: inherited[key], instance: value }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    spec: cfg.profile,
    name: profile?.name ?? "engine defaults",
    description: profile?.description,
    version: profile?.version,
    dir: loaded?.dir,
    departures,
  };
}

/** Profiles shipped with the engine. */
export function builtinProfiles(): { spec: string; name: string; description?: string }[] {
  const dir = path.join(ROOT, "profiles");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, PROFILE_FILE)))
    .map((e) => {
      const p = JSON.parse(fs.readFileSync(path.join(dir, e.name, PROFILE_FILE), "utf8")) as Profile;
      return { spec: e.name, name: p.name || e.name, description: p.description };
    })
    .sort((a, b) => a.spec.localeCompare(b.spec));
}
