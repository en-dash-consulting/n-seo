/**
 * config/backlog.json is edited by hand, so it is untrusted input. These
 * cover the two ways a single bad entry used to corrupt the whole queue:
 * a NaN score silently randomising the order of every card, and two long
 * titles sharing a truncated id so retire() deleted both.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { makeSandbox, hasPython, type Sandbox } from "./sandbox.ts";

const item = (title: string, extra: Record<string, unknown>) => ({
  host: "example.com", title, kind: "k", why: "w", how: "h",
  spec: [], tag: "content", impact: 1, effort: "S", ...extra,
});

describe("queue integrity", { skip: !hasPython() && "python3 is required to seed the test dataset" }, () => {
  let sb: Sandbox;
  let actions: any;
  let bl: any;

  before(async () => {
    sb = makeSandbox({ data: true });
    sb.write("config/backlog.json", JSON.stringify({
      actions: [
        item("Valid small", { impact: 10, effort: "S" }),
        item("Bad effort typo", { impact: 999, effort: "XL" }),
        item("Numeric string impact", { impact: "40", effort: "S" }),
        item("Impact is not a number", { impact: "lots", effort: "M" }),
      ],
      shippedWatch: {},
    }));
    bl = await sb.mod("backlog.ts");
    actions = await sb.mod("actions.ts");
  });
  after(() => sb.cleanup());

  test("one unrecognised effort cannot poison the ranking", () => {
    const all = actions.allActions();
    for (const a of all) {
      assert.ok(Number.isFinite(actions.score(a)), `${a.title} scored ${actions.score(a)}`);
    }
    const scores = all.map((a: any) => actions.score(a));
    for (let i = 1; i < scores.length; i++) {
      assert.ok(scores[i - 1] >= scores[i], `queue not descending at ${i}: ${scores[i - 1]} then ${scores[i]}`);
    }
  });

  test("hand-edited efforts and impacts are coerced on load", () => {
    const items = bl.BACKLOG();
    const by = (t: string) => items.find((a: any) => a.title === t);
    assert.equal(by("Bad effort typo").effort, "M", "unknown effort falls back to medium");
    assert.equal(by("Numeric string impact").impact, 40);
    assert.equal(by("Impact is not a number").impact, 0);
  });

  test("titles that collide after truncation still get one id each", async () => {
    const long = "Rewrite the interminable guide to widgets and their many uses across teams".padEnd(95, "x");
    const sb2 = makeSandbox({ data: false });
    try {
      sb2.write("config/backlog.json", JSON.stringify({
        actions: [item(`${long}A`, {}), item(`${long}B`, {})],
        shippedWatch: {},
      }));
      const bl2: any = await sb2.mod("backlog.ts");
      const ids = bl2.BACKLOG().map((a: any) => a.id);
      assert.equal(new Set(ids).size, 2, `ids collided: ${ids.join(", ")}`);

      assert.equal(bl2.retire(ids[0]), true);
      const left = JSON.parse(sb2.read("config/backlog.json")).actions;
      assert.equal(left.length, 1, "retire removed more than the card it addressed");
      assert.ok(left[0].title.endsWith("B"));
    } finally {
      sb2.cleanup();
    }
  });
});
