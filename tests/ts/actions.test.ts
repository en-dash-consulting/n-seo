/** Action-engine invariants over the demo dataset (ops/demo_data.py). */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { makeSandbox, hasPython, type Sandbox } from "./sandbox.ts";

describe("action engine", { skip: !hasPython() && "python3 is required to seed the test dataset" }, () => {
  let sb: Sandbox;
  let actions: any, data: any, cfg: any;
  before(async () => {
    sb = makeSandbox({ data: true });
    sb.write("config/backlog.json", JSON.stringify({
      actions: [
        { host: "example.com", title: "Curated item", kind: "k", why: "w", how: "h", spec: [], impact: 3, effort: "S", tag: "content" },
        { host: "gone.example.org", title: "Orphan for a removed site", kind: "k", why: "w", how: "h", spec: [], impact: 1, effort: "S", tag: "content" },
      ],
      shippedWatch: {},
    }));
    cfg = await sb.mod("config.ts");
    data = await sb.mod("data.ts");
    actions = await sb.mod("actions.ts");
  });
  after(() => sb.cleanup());

  const REQUIRED = ["id", "host", "title", "kind", "why", "how", "spec", "impact", "effort", "tag"];

  test("every action is complete and typed", () => {
    const all = actions.allActions();
    assert.ok(all.length > 5, `expected a populated queue, got ${all.length}`);
    for (const a of all) {
      for (const k of REQUIRED) assert.ok(k in a && a[k] !== undefined, `${a.title} missing ${k}`);
      assert.ok(Array.isArray(a.spec), "spec[]");
      assert.ok(["S", "M", "L"].includes(a.effort), a.effort);
      assert.equal(typeof a.impact, "number");
      assert.ok(Number.isFinite(a.impact));
      assert.ok(["rule", "backlog"].includes(a.source), a.source);
    }
  });

  test("ids are unique and rule ids carry the gen- prefix", () => {
    const all = actions.allActions();
    const ids = all.map((a: any) => a.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate ids");
    for (const a of all.filter((x: any) => x.source === "rule")) assert.match(a.id, /^gen-[a-z-]+-/);
  });

  test("sorted by impact per unit of effort, descending", () => {
    const all = actions.allActions();
    for (let i = 1; i < all.length; i++) {
      assert.ok(actions.score(all[i - 1]) >= actions.score(all[i]), `rank ${i} out of order`);
    }
    assert.equal(actions.score({ impact: 10, effort: "S" }), 10);
    assert.equal(actions.score({ impact: 10, effort: "M" }), 4);
    assert.equal(actions.score({ impact: 10, effort: "L" }), 2);
  });

  test("curated items merge in; orphans for removed hosts survive", () => {
    const all = actions.allActions();
    assert.ok(all.some((a: any) => a.title === "Curated item" && a.source === "backlog"));
    assert.ok(all.some((a: any) => a.host === "gone.example.org"));
    assert.equal(actions.actionById("example-com-curated-item")?.title, "Curated item");
  });

  test("striking distance: position 5–15, impressions ≥ threshold, 90-day rows", () => {
    for (const site of cfg.SITES()) {
      const rows = data.strikingDistance(site, 10);
      for (const r of rows) {
        assert.ok(r.position >= 5 && r.position <= 15, `${r.keys[0]} pos ${r.position}`);
        assert.ok(r.impressions >= 10);
      }
      for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].impressions >= rows[i].impressions);
    }
  });

  test("ctr gaps: expected CTR above actual and below half of it", () => {
    let seen = 0;
    for (const site of cfg.SITES()) {
      for (const g of data.ctrGaps(site)) {
        seen++;
        assert.ok(g.expected > g.ctr, g.keys[0]);
        assert.ok(g.ctr < g.expected * 0.5);
        assert.ok(g.impressions >= 30);
      }
    }
    assert.ok(seen > 0, "demo data is built to contain CTR gaps");
  });

  test("metadata findings suppress the ctr-gap card on the same page", () => {
    for (const site of cfg.SITES()) {
      const list = actions.actionsFor(site);
      const metaPages = new Set(list.filter((a: any) => a.tag === "metadata").map((a: any) => a.spec[0]));
      for (const a of list.filter((x: any) => x.tag === "ctr-gap")) {
        assert.ok(!metaPages.has(a.spec[0]), `duplicate card for ${a.spec[0]}`);
      }
    }
  });

  test("shippedWatch turns a rule card into a watching card", async () => {
    const site = cfg.SITES()[0];
    const before = actions.actionsFor(site).filter((a: any) => a.source === "rule" && !a.watching && a.spec[0]?.startsWith("Page: "));
    assert.ok(before.length > 0);
    const page = before[0].spec[0].replace("Page: ", "");
    const file = sb.json("config/backlog.json");
    file.shippedWatch[page] = "shipped yesterday";
    sb.write("config/backlog.json", JSON.stringify(file));
    const after = actions.actionsFor(site).filter((a: any) => a.spec[0] === `Page: ${page}`);
    assert.ok(after.length > 0);
    for (const a of after) assert.equal(a.watching, "shipped yesterday", a.title);
  });

  test("probe hygiene: the site missing llms.txt gets a card", () => {
    const withGap = cfg.SITES().find((s: any) => data.probeFor(s) && !data.probeFor(s)["llms.txt"].exists);
    assert.ok(withGap, "demo data has a site without llms.txt");
    const titles = actions.actionsFor(withGap).map((a: any) => a.title);
    assert.ok(titles.includes("Add llms.txt"), titles.join(" | "));
  });

  test("engagement mismatch card exists for the low-engagement landing page", () => {
    const all = actions.allActions();
    assert.ok(all.some((a: any) => a.tag === "engagement"), "demo data has a <25% engagement page with ≥30 sessions");
  });

  test("queries aggregates query_page by host and weights position by impressions", () => {
    const site = cfg.SITES()[0];
    const qs = data.queries(site, true);
    assert.ok(qs.length > 0);
    for (const q of qs) {
      assert.equal(q.keys.length, 1);
      assert.ok(q.ctr >= 0 && q.ctr <= 1);
      assert.ok(q.position > 0);
    }
    const raw = data.rawQueryPage(site, true);
    const host = new Set(raw.map((r: any) => r.keys[1].split("/")[2]));
    assert.deepEqual([...host], [site.gscHost]);
  });

  test("traffic mix classifies AI and search sources", () => {
    const site = cfg.SITES()[0];
    const mix = data.trafficMix(site);
    assert.ok(mix.sessions > 0);
    assert.ok(mix.ai > 0, "demo sources include chatgpt/perplexity");
    assert.ok(mix.search > 0);
    assert.ok(mix.ai + mix.search <= mix.sessions);
    assert.ok(data.AI_SOURCE.test("chatgpt.com"));
    assert.ok(!data.AI_SOURCE.test("google"));
    assert.ok(data.SEARCH_SOURCE.test("bing"));
  });

  test("todayBoard omits Comment when no participation module is enabled", () => {
    const verbs = data.todayBoard().map((g: any) => g.verb);
    assert.ok(!verbs.includes("Comment"), verbs.join(","));
    assert.ok(verbs.includes("Fix"), "probe gap → Fix");
    assert.ok(verbs.includes("Approve"), "scan proposals → Approve");
  });

  test("funnelSummary reports not configured on the example config", () => {
    const f = data.funnelSummary();
    assert.equal(f.configured, false);
    assert.equal(f.instrumented, false);
  });
});
