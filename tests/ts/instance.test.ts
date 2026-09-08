/**
 * Engine / instance split: N_SEO_INSTANCE moves every instance-owned path
 * out of the engine checkout; unset, everything stays in-place.
 *
 * config.ts reads the env var at import time, so each case imports a fresh
 * copy of the module (a query string defeats the module cache).
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { makeSandbox } from "./sandbox.ts";

const fresh = async (root: string, file: string, env: Record<string, string | undefined>) => {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await import(pathToFileURL(path.join(root, "src", file)).href + `?t=${Date.now()}${Math.random()}`);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

describe("engine / instance", () => {
  const sb = makeSandbox({ data: false });
  const inst = fs.mkdtempSync(path.join(os.tmpdir(), "n-seo-instance-"));
  after(() => {
    sb.cleanup();
    fs.rmSync(inst, { recursive: true, force: true });
  });

  test("unset: INSTANCE === ROOT and mode is in-place", async () => {
    const cfg = await fresh(sb.root, "config.ts", { N_SEO_INSTANCE: undefined, N_SEO_CONFIG: undefined });
    assert.equal(cfg.INSTANCE, cfg.ROOT);
    assert.equal(cfg.CONFIG_PATH, path.join(cfg.ROOT, "n-seo.config.json"));
    const info = cfg.engineInfo();
    assert.equal(info.mode, "in-place");
    assert.equal(info.root, cfg.ROOT);
    assert.equal(info.instance, cfg.ROOT);
  });

  test("set: paths resolve under the instance; engine paths stay under ROOT", async () => {
    const cfg = await fresh(sb.root, "config.ts", { N_SEO_INSTANCE: inst, N_SEO_CONFIG: undefined });
    assert.equal(cfg.INSTANCE, inst);
    assert.notEqual(cfg.INSTANCE, cfg.ROOT);
    assert.equal(cfg.CONFIG_PATH, path.join(inst, "n-seo.config.json"));
    assert.equal(cfg.EXAMPLE_CONFIG_PATH, path.join(cfg.ROOT, "n-seo.config.example.json"));
    assert.equal(cfg.engineInfo().mode, "instance");

    // config falls back to the engine's example when the instance has none
    assert.equal(cfg.USING_EXAMPLE_CONFIG, true);
    const c = cfg.loadConfig();
    assert.equal(c.sites.length, 2);

    // backlog + data readers follow the instance
    const bl = await fresh(sb.root, "backlog.ts", { N_SEO_INSTANCE: inst });
    assert.equal(bl.BACKLOG_PATH, path.join(inst, "config", "backlog.json"));
    fs.mkdirSync(path.join(inst, "config"), { recursive: true });
    fs.writeFileSync(path.join(inst, "config", "backlog.json"), JSON.stringify({
      actions: [{ host: "example.com", title: "Instance item", kind: "k", why: "w", how: "h", spec: [], impact: 3, effort: "S", tag: "content" }],
      shippedWatch: {},
    }));
    const items = bl.BACKLOG();
    assert.equal(items.length, 1);
    assert.equal(items[0].title, "Instance item");

    // .env is read from the instance
    fs.writeFileSync(path.join(inst, ".env"), 'SEO_MCP_TOKEN="from-instance"\n');
    assert.equal(cfg.dotEnv("SEO_MCP_TOKEN"), "from-instance");
  });

  test("relative N_SEO_INSTANCE resolves against cwd", async () => {
    const rel = path.relative(process.cwd(), inst);
    const cfg = await fresh(sb.root, "config.ts", { N_SEO_INSTANCE: rel, N_SEO_CONFIG: undefined });
    assert.equal(cfg.INSTANCE, inst);
  });

  test("engineInfo has the documented shape; version matches package.json", async () => {
    const cfg = await fresh(sb.root, "config.ts", { N_SEO_INSTANCE: undefined });
    const info = cfg.engineInfo();
    assert.deepEqual(Object.keys(info).sort(), ["commit", "instance", "mode", "root", "version"]);
    const pkg = JSON.parse(fs.readFileSync(path.join(sb.root, "package.json"), "utf8"));
    assert.equal(info.version, pkg.version);
    assert.equal(cfg.ENGINE_VERSION, pkg.version);
    assert.ok(info.commit === null || /^[0-9a-f]{7,}$/.test(info.commit));
  });

  test("hooks and gscExtraProperties normalize with defaults", async () => {
    const cfg = await fresh(sb.root, "config.ts", { N_SEO_INSTANCE: inst, N_SEO_CONFIG: undefined });
    fs.writeFileSync(path.join(inst, "n-seo.config.json"), JSON.stringify({ sites: [] }));
    let c = cfg.loadConfig();
    assert.deepEqual(c.hooks, { beforeRun: [], afterRun: [], afterStep: {} });
    assert.deepEqual(c.gscExtraProperties, []);
    fs.writeFileSync(path.join(inst, "n-seo.config.json"), JSON.stringify({
      sites: [],
      gscExtraProperties: ["https://example.com/", "", 3],
      hooks: { beforeRun: ["echo hi"], afterStep: { "daily-diff": ["true", ""] }, afterRun: "not-a-list" },
    }));
    c = cfg.loadConfig();
    assert.deepEqual(c.gscExtraProperties, ["https://example.com/"]);
    assert.deepEqual(c.hooks, { beforeRun: ["echo hi"], afterRun: [], afterStep: { "daily-diff": ["true"] } });
  });
});
