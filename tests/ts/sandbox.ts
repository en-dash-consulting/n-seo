/**
 * A throwaway copy of the repo for tests that touch files.
 *
 * config.ts derives ROOT from its own location, and backlog.ts / data.ts
 * build every path from ROOT, so importing the copied `src/` gives a module
 * graph whose reads and writes land in the sandbox — never in the checkout.
 */
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seo-agent-test-"));
  for (const dir of ["src", "config", "content", "docs"]) {
    fs.cpSync(path.join(REPO, dir), path.join(root, dir), { recursive: true });
  }
  for (const f of ["seo-agent.config.example.json", "package.json", "tsconfig.json"]) {
    fs.copyFileSync(path.join(REPO, f), path.join(root, f));
  }
  fs.symlinkSync(path.join(REPO, "node_modules"), path.join(root, "node_modules"));
  if (opts.data !== false && fs.existsSync(path.join(REPO, "data"))) {
    fs.cpSync(path.join(REPO, "data"), path.join(root, "data"), { recursive: true });
  } else {
    fs.mkdirSync(path.join(root, "data"));
  }
  return {
    root,
    mod: (file) => import(pathToFileURL(path.join(root, "src", file)).href),
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

export const hasDemoData = () => fs.existsSync(path.join(REPO, "data", "gsc"));
