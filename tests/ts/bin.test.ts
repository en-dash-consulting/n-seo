/** The n-seo CLI: init scaffolds an instance; version reports the split. */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO } from "./sandbox.ts";

const BIN = path.join(REPO, "bin", "n-seo.mjs");
const cli = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", env: { ...process.env, N_SEO_INSTANCE: "", ...env } });

describe("bin/n-seo.mjs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "n-seo-cli-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("help prints usage and exits 0; unknown command exits 2", () => {
    const h = cli(["help"]);
    assert.equal(h.status, 0);
    assert.match(h.stdout, /usage: n-seo <command>/);
    const u = cli(["frobnicate"]);
    assert.equal(u.status, 2);
    assert.match(u.stderr, /unknown command/);
  });

  test("init scaffolds an instance and never overwrites", () => {
    const r = cli(["init", dir]);
    assert.equal(r.status, 0, r.stderr);
    for (const rel of ["n-seo.config.json", "config/backlog.json", "config/insights.json", "content/drafts/README.md",
      "content/campaigns/README.md", ".env", ".gitignore", ".mcp.json", "README.md"]) {
      assert.ok(fs.existsSync(path.join(dir, rel)), rel);
    }
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, "n-seo.config.json"), "utf8"));
    assert.equal(cfg.name, path.basename(dir));
    assert.ok(Array.isArray(cfg.sites));
    const mcp = JSON.parse(fs.readFileSync(path.join(dir, ".mcp.json"), "utf8"));
    assert.equal(mcp.mcpServers["n-seo"].env.N_SEO_INSTANCE, dir);
    assert.equal(mcp.mcpServers["n-seo"].args[0], BIN);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "config", "backlog.json"), "utf8")).actions, []);

    fs.writeFileSync(path.join(dir, "n-seo.config.json"), '{"sites":[],"name":"kept"}');
    const again = cli(["init", dir]);
    assert.equal(again.status, 0);
    assert.match(again.stdout, /exists, kept\s+n-seo\.config\.json/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "n-seo.config.json"), "utf8")).name, "kept");
  });

  test("version reports engine + instance; --instance and $N_SEO_INSTANCE both work", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
    const a = cli(["version", "--instance", dir]);
    assert.equal(a.status, 0);
    assert.match(a.stdout, new RegExp(`n-seo ${pkg.version.replace(/\./g, "\\.")}`));
    assert.match(a.stdout, new RegExp(`engine:\\s+${REPO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(a.stdout, new RegExp(`instance:\\s+${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(a.stdout, /mode:\s+instance/);

    const b = cli(["version"], { N_SEO_INSTANCE: dir });
    assert.match(b.stdout, /mode:\s+instance/);

    const c = spawnSync(process.execPath, [BIN, "version"], { encoding: "utf8", cwd: REPO, env: { ...process.env, N_SEO_INSTANCE: "" } });
    assert.match(c.stdout, /mode:\s+in-place/);
  });

  test("daily --list runs the engine against the instance", () => {
    const r = cli(["daily", "--instance", dir, "--list"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /engine .* \(instance\) — instance /);
    assert.match(r.stdout, /probe\s+probes\/site_probe\.py/);
  });
});
