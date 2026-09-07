import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeSandbox, type Sandbox } from "./sandbox.ts";

describe("config", () => {
  let sb: Sandbox;
  let cfg: any;
  before(async () => {
    sb = makeSandbox({ data: false });
    cfg = await sb.mod("config.ts");
  });
  after(() => sb.cleanup());

  test("gscSlug matches the Python gsc_slug on the shared cases", () => {
    const cases: [string, string][] = [
      ["sc-domain:example.com", "example.com"],
      ["https://www.example.com/", "www.example.com"],
      ["https://example.com/blog/", "example.com_blog"],
      ["http://example.com", "example.com"],
      ["sc-domain:sub.example.com", "sub.example.com"],
      ["https://example.com///", "example.com"],
    ];
    for (const [input, want] of cases) assert.equal(cfg.gscSlug(input), want, input);
  });

  test("falls back to the example config and flags it", () => {
    const c = cfg.loadConfig();
    assert.equal(cfg.USING_EXAMPLE_CONFIG, true);
    assert.equal(c.name, "My sites");
    assert.equal(c.sites.length, 2);
    assert.equal(c.port, 4600);
  });

  test("normalizes sites: label/gscHost default to host, empty strings become undefined", () => {
    sb.write("seo-agent.config.json", JSON.stringify({
      sites: [{ host: "a.example.com", gscProperty: "", ga4Property: "", brand: "" }],
    }));
    const c = cfg.loadConfig();
    assert.equal(cfg.USING_EXAMPLE_CONFIG, false);
    const s = c.sites[0];
    assert.equal(s.label, "a.example.com");
    assert.equal(s.gscHost, "a.example.com");
    assert.equal(s.gscProperty, undefined);
    assert.equal(s.ga4Property, undefined);
    assert.equal(s.brand, undefined);
    assert.equal(c.name, "SEO Agent");
    assert.equal(c.google.auth, "service-account-key");
    assert.deepEqual(c.watchPages, []);
    assert.equal(c.conversions, undefined);
  });

  test("every MODULE_INFO key is present with enabled=false by default; unknown modules survive", () => {
    sb.write("seo-agent.config.json", JSON.stringify({
      sites: [],
      modules: { llm: { enabled: true, command: "cat" }, custom: { enabled: "yes", x: 1 } },
    }));
    const c = cfg.loadConfig();
    for (const m of cfg.MODULE_INFO) {
      assert.ok(m.key in c.modules, m.key);
      assert.equal(typeof c.modules[m.key].enabled, "boolean", m.key);
    }
    assert.equal(c.modules.llm.enabled, true);
    assert.equal(c.modules.llm.command, "cat");
    assert.equal(c.modules.hackerNews.enabled, false);
    assert.equal(c.modules.custom.enabled, true, "truthy non-boolean is coerced");
    assert.equal(c.modules.custom.x, 1);
  });

  test("conversions kept only when a site is named", () => {
    sb.write("seo-agent.config.json", JSON.stringify({
      sites: [], conversions: { site: "example.com", events: ["sign_up"] },
    }));
    assert.equal(cfg.loadConfig().conversions?.site, "example.com");
    sb.write("seo-agent.config.json", JSON.stringify({ sites: [], conversions: { site: "", events: ["x"] } }));
    assert.equal(cfg.loadConfig().conversions, undefined);
  });

  test("SEO_PORT overrides the file", () => {
    sb.write("seo-agent.config.json", JSON.stringify({ sites: [], port: 4700 }));
    assert.equal(cfg.loadConfig().port, 4700);
    process.env.SEO_PORT = "4999";
    try {
      assert.equal(cfg.loadConfig().port, 4999);
    } finally {
      delete process.env.SEO_PORT;
    }
  });

  test("saveConfig bootstraps from the example and preserves unknown keys", () => {
    fs.rmSync(`${sb.root}/seo-agent.config.json`, { force: true });
    cfg.saveConfig((raw: any) => {
      raw.modules.hackerNews.enabled = true;
      raw.someFutureKey = { keep: "me" };
    });
    const written = sb.json("seo-agent.config.json");
    assert.equal(written.modules.hackerNews.enabled, true);
    assert.equal(written.name, "My sites", "copied from the example");
    assert.deepEqual(written.someFutureKey, { keep: "me" });
    cfg.saveConfig((raw: any) => { raw.name = "Renamed"; });
    assert.deepEqual(sb.json("seo-agent.config.json").someFutureKey, { keep: "me" }, "second save keeps it");
    assert.equal(cfg.loadConfig().name, "Renamed");
  });

  test("siteByHost matches host or gscHost", () => {
    sb.write("seo-agent.config.json", JSON.stringify({
      sites: [{ host: "example.com", gscHost: "www.example.com" }],
    }));
    assert.equal(cfg.siteByHost("www.example.com")?.host, "example.com");
    assert.equal(cfg.siteByHost("example.com")?.host, "example.com");
    assert.equal(cfg.siteByHost("nope.example.com"), undefined);
  });
});
