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

  test("init installs the operating skills and a CLAUDE.md, with real paths substituted", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "n-seo-skills-"));
    try {
      const r = cli(["init", d]);
      assert.equal(r.status, 0, r.stderr);
      for (const skill of ["orient", "n-seo-setup", "n-seo-add-site", "n-seo-triage", "n-seo-ship", "n-seo-review", "n-seo-deploy"]) {
        assert.ok(fs.existsSync(path.join(d, ".claude", "skills", skill, "SKILL.md")), skill);
      }
      // Contributor skills are for developing the engine, not operating an
      // instance; shipping them would offer commands that do not apply.
      assert.ok(!fs.existsSync(path.join(d, ".claude", "skills", "ndx-plan")));
      const triage = fs.readFileSync(path.join(d, ".claude", "skills", "n-seo-triage", "SKILL.md"), "utf8");
      assert.ok(!triage.includes("<engine checkout>"), "engine placeholder left unsubstituted");
      assert.ok(!triage.includes("<instance dir>"), "instance placeholder left unsubstituted");
      assert.ok(triage.includes(path.join(REPO, "bin", "n-seo.mjs")));
      assert.ok(triage.includes(d));
      const claude = fs.readFileSync(path.join(d, "CLAUDE.md"), "utf8");
      assert.match(claude, /28-day metadata freeze/);
      assert.match(claude, /not\*{0,2} a website|\*\*not\*\* a website/);
      assert.ok(claude.includes(REPO), "CLAUDE.md should name the engine directory");
      assert.match(r.stdout, /skills are installed/);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  test("init refuses to scaffold into an application directory, and inside a foreign git repo", () => {
    const app = fs.mkdtempSync(path.join(os.tmpdir(), "n-seo-app-"));
    try {
      // An app directory: the marker file is enough, no git needed.
      fs.writeFileSync(path.join(app, "package.json"), '{"name":"my-site"}');
      const here = cli(["init", app]);
      assert.equal(here.status, 2, here.stdout);
      assert.match(here.stderr, /refusing to scaffold/);
      assert.match(here.stderr, /package\.json/);
      assert.ok(!fs.existsSync(path.join(app, "n-seo.config.json")), "nothing should be written");

      // A new subdirectory inherits the parent's problem.
      const nested = cli(["init", path.join(app, "my-sites")]);
      assert.equal(nested.status, 2);
      assert.ok(!fs.existsSync(path.join(app, "my-sites")), "the directory should not even be created");

      // --force is the documented escape hatch.
      const forced = cli(["init", path.join(app, "my-sites"), "--force"]);
      assert.equal(forced.status, 0, forced.stderr);
      assert.ok(fs.existsSync(path.join(app, "my-sites", "n-seo.config.json")));
    } finally {
      fs.rmSync(app, { recursive: true, force: true });
    }

    // A directory inside someone else's git repository, with no app markers.
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "n-seo-git-"));
    try {
      fs.mkdirSync(path.join(repo, ".git"));
      const r = cli(["init", path.join(repo, "seo")]);
      assert.equal(r.status, 2, r.stdout);
      assert.match(r.stderr, /inside the git repository/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test("re-running init on an existing instance is always allowed", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "n-seo-reinit-"));
    try {
      assert.equal(cli(["init", d]).status, 0);
      // Make it look like an app AND a foreign repo; the existing config wins.
      fs.writeFileSync(path.join(d, "package.json"), "{}");
      fs.mkdirSync(path.join(d, ".git"));
      const again = cli(["init", d]);
      assert.equal(again.status, 0, again.stderr);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
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
