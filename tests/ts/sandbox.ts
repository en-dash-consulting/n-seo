/**
 * A throwaway copy of the repo for tests that touch files.
 *
 * config.ts derives ROOT from its own location, and backlog.ts / data.ts
 * build every path from ROOT, so importing the copied `src/` gives a module
 * graph whose reads and writes land in the sandbox — never in the checkout.
 *
 * Two things keep that promise honest:
 *
 *   - `mod()` neutralizes N_SEO_INSTANCE / N_SEO_CONFIG for the duration of
 *     the import. `n-seo check` (and therefore `n-seo upgrade`) sets
 *     N_SEO_INSTANCE, and config.ts reads it at import time, so without this
 *     the sandboxed modules would resolve to the caller's real instance and
 *     the suite would assert against live data.
 *   - `{ data: true }` generates the demo dataset into the sandbox instead of
 *     copying `data/` out of the checkout. The engine checkout has no data/ in
 *     instance mode, and an in-place install has the owner's real data; both
 *     made these tests either vanish or run against whatever was on disk.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface Sandbox {
  root: string;
  /** import a module from the sandbox's src/, e.g. mod("actions.ts") */
  mod: <T = any>(file: string) => Promise<T>;
  write: (rel: string, content: string) => void;
  read: (rel: string) => string;
  json: <T = any>(rel: string) => T;
  cleanup: () => void;
}

export function makeSandbox(opts: { data?: boolean } = {}): Sandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "n-seo-test-"));
  for (const dir of ["src", "config", "content", "docs"]) {
    fs.cpSync(path.join(REPO, dir), path.join(root, dir), { recursive: true });
  }
  for (const f of ["n-seo.config.example.json", "package.json", "tsconfig.json"]) {
    fs.copyFileSync(path.join(REPO, f), path.join(root, f));
  }
  fs.symlinkSync(path.join(REPO, "node_modules"), path.join(root, "node_modules"));
  fs.mkdirSync(path.join(root, "data"));
  if (opts.data === true) generateDemoData(root);
  return {
    root,
    mod: async (file) => {
      const saved = {
        N_SEO_INSTANCE: process.env.N_SEO_INSTANCE,
        N_SEO_CONFIG: process.env.N_SEO_CONFIG,
      };
      delete process.env.N_SEO_INSTANCE;
      delete process.env.N_SEO_CONFIG;
      try {
        return await import(pathToFileURL(path.join(root, "src", file)).href);
      } finally {
        for (const [k, v] of Object.entries(saved)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }
    },
    write: (rel, content) => {
      const p = path.join(root, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
    },
    read: (rel) => fs.readFileSync(path.join(root, rel), "utf8"),
    json: (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/** The demo generator is Python, and so is half the engine, so a checkout
 *  without it cannot run these tests at all. */
export const hasPython = (): boolean =>
  spawnSync("python3", ["--version"], { stdio: "ignore" }).status === 0;

/** Deterministic (seeded) synthetic dataset for the example config, written
 *  into the sandbox. Fails loudly: a silent miss here used to drop the whole
 *  action-engine suite from the run without changing the reported counts. */
function generateDemoData(root: string): void {
  const r = spawnSync("python3", [path.join(REPO, "ops", "demo_data.py")], {
    env: { ...process.env, N_SEO_INSTANCE: root },
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(
      `demo_data.py failed to seed the sandbox (exit ${r.status}):\n${r.stderr || r.stdout}`,
    );
  }
}
