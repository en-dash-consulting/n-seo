/** Priorities: the declarative half of "custom rules".
 *
 * A priority may reorder or hide, never invent — it cannot fabricate a card,
 * so it cannot manufacture evidence. And every card it touches has to say so.
 * A queue that silently reorders itself is a queue whose order you cannot
 * argue with, and the product rests on showing its working. */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeSandbox, REPO, type Sandbox } from "./sandbox.ts";

const card = (over: Record<string, unknown> = {}) => ({
  id: "x", host: "example.com", title: "t", kind: "Meta/template change",
  why: "w", how: "h", spec: ["Page: https://example.com/tools/thing"],
  impact: 100, effort: "M", tag: "striking", source: "rule", ...over,
});

describe("priorities", () => {
  let sb: Sandbox;
  let actions: any;
  before(async () => {
    sb = makeSandbox({ data: false });
    fs.cpSync(path.join(REPO, "profiles"), path.join(sb.root, "profiles"), { recursive: true });
    actions = await sb.mod("actions.ts");
  });
  after(() => sb.cleanup());

  const withPriorities = (priorities: unknown[]) =>
    sb.write("n-seo.config.json", JSON.stringify({
      name: "t", sites: [], rules: { priorities },
    }));

  test("no priorities leaves the queue exactly as it was", () => {
    withPriorities([]);
    const out = actions.prioritize([card(), card({ id: "y" })]);
    assert.equal(out.length, 2);
    assert.equal(out[0].impact, 100);
    assert.ok(!out[0].priorityNotes);
  });

  test("a path match multiplies impact and says why on the card", () => {
    withPriorities([{ why: "pages with a next step", when: { pathMatches: "^/tools/" }, multiply: 1.5 }]);
    const [out] = actions.prioritize([card()]);
    assert.equal(out.impact, 150);
    assert.equal(out.priorityNotes.length, 1);
    assert.match(out.priorityNotes[0], /100 → 150/);
    assert.match(out.priorityNotes[0], /pages with a next step/);
    assert.ok(out.spec.some((l: string) => l.includes("pages with a next step")),
      "the reason must reach the spec, which is what the card shows");
  });

  test("a non-matching path is left alone", () => {
    withPriorities([{ why: "x", when: { pathMatches: "^/legal/" }, multiply: 9 }]);
    const [out] = actions.prioritize([card()]);
    assert.equal(out.impact, 100);
    assert.ok(!out.priorityNotes);
  });

  test("drop removes the card", () => {
    withPriorities([{ why: "not working on these", when: { pathMatches: "^/tools/" }, drop: true }]);
    assert.equal(actions.prioritize([card()]).length, 0);
  });

  test("host, tag and kind all match", () => {
    withPriorities([{ why: "h", when: { host: "example.com" }, multiply: 2 }]);
    assert.equal(actions.prioritize([card()])[0].impact, 200);
    withPriorities([{ why: "t", when: { tag: "striking" }, multiply: 2 }]);
    assert.equal(actions.prioritize([card()])[0].impact, 200);
    withPriorities([{ why: "k", when: { kind: "meta" }, multiply: 2 }]);
    assert.equal(actions.prioritize([card({ kind: "Meta/template change" })])[0].impact, 200,
      "kind matching is a case-insensitive substring");
    withPriorities([{ why: "no", when: { host: "other.com" }, multiply: 2 }]);
    assert.equal(actions.prioritize([card()])[0].impact, 100);
  });

  test("boosts compound, in the order they are written", () => {
    withPriorities([
      { why: "first", when: { tag: "striking" }, multiply: 2 },
      { why: "second", when: { host: "example.com" }, multiply: 3 },
    ]);
    const [out] = actions.prioritize([card()]);
    assert.equal(out.impact, 600);
    assert.equal(out.priorityNotes.length, 2, "each adjustment is explained separately");
  });

  test("a priority with no conditions matches nothing", () => {
    // Applying to the entire queue is never what anyone means, and is a
    // miserable way to discover the shape of the config.
    withPriorities([{ why: "oops", when: {}, multiply: 10 }]);
    assert.equal(actions.prioritize([card()])[0].impact, 100);
  });

  test("a priority with no reason is ignored", () => {
    withPriorities([{ when: { tag: "striking" }, multiply: 10 }]);
    assert.equal(actions.prioritize([card()])[0].impact, 100,
      "an unexplained boost is the one thing this must never do");
  });

  test("a broken regex matches nothing and does not throw", () => {
    withPriorities([{ why: "bad", when: { pathMatches: "([" }, multiply: 10 }]);
    assert.doesNotThrow(() => actions.prioritize([card()]));
    assert.equal(actions.prioritize([card()])[0].impact, 100);
  });

  test("nonsense multipliers are ignored rather than corrupting the sort", () => {
    for (const bad of [0, -2, NaN, "abc", null]) {
      withPriorities([{ why: "b", when: { tag: "striking" }, multiply: bad }]);
      const [out] = actions.prioritize([card()]);
      assert.equal(out.impact, 100, `multiply: ${JSON.stringify(bad)} should be ignored`);
    }
  });

  test("a card with no page is never matched by a path rule", () => {
    // Hygiene and traffic-drop cards are about a whole site.
    withPriorities([{ why: "x", when: { pathMatches: ".*" }, multiply: 5 }]);
    const [out] = actions.prioritize([card({ spec: ["Serve robots.txt"] })]);
    assert.equal(out.impact, 100);
  });

  test("a priority cannot create a card", () => {
    withPriorities([{ why: "x", when: { tag: "striking" }, multiply: 2 }]);
    assert.equal(actions.prioritize([]).length, 0);
  });
});
