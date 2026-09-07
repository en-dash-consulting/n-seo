import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { makeSandbox, type Sandbox } from "./sandbox.ts";

describe("backlog", () => {
  let sb: Sandbox;
  let bl: any;
  before(async () => {
    sb = makeSandbox({ data: false });
    sb.write("config/backlog.json", JSON.stringify({
      _comment: "test",
      actions: [
        { host: "example.com", title: "Write the Widgets guide", kind: "New page", why: "w", how: "h", spec: ["a"], impact: 10, effort: "M", tag: "content" },
        { id: "custom-id", host: "docs.example.com", title: "Fix nav", kind: "k", why: "w", how: "h", spec: [], impact: 5, effort: "S", tag: "hygiene", watching: "2026-01-01: shipped" },
      ],
      shippedWatch: { "https://example.com/docs/": "title trimmed" },
    }));
    sb.write("data/opportunity-proposals.json", JSON.stringify({
      generated: "2026-09-07",
      candidates: [],
      proposals: [
        { host: "example.com", title: "Write the Widgets guide", kind: "New page", why: "rising", how: "write", spec: ["Page: /guides/widgets/"], impact: 40, effort: "L", tag: "content" },
        { host: "example.com", title: "Second", why: "y", spec: ["s"], impact: "7", effort: "XL", tag: "" },
      ],
      verdicts: [],
      inference_ran: true,
    }));
    bl = await sb.mod("backlog.ts");
  });
  after(() => sb.cleanup());

  test("slug", () => {
    assert.equal(bl.slug("https://Example.com/Docs/Getting Started/"), "example-com-docs-getting-started");
    assert.equal(bl.slug("---"), "");
    assert.equal(bl.slug("a".repeat(100)).length, 80);
  });

  test("ids derived from host+title when missing, kept when present, source=backlog", () => {
    const actions = bl.BACKLOG();
    assert.equal(actions.length, 2);
    assert.equal(actions[0].id, "example-com-write-the-widgets-guide");
    assert.equal(actions[1].id, "custom-id");
    assert.ok(actions.every((a: any) => a.source === "backlog"));
    assert.deepEqual(bl.SHIPPED_WATCH(), { "https://example.com/docs/": "title trimmed" });
  });

  test("acceptProposal copies into the queue with a unique id, coerces fields, and removes the proposal", () => {
    const a = bl.acceptProposal(0);
    assert.equal(a.id, "example-com-write-the-widgets-guide-2", "collides with the existing item → suffixed");
    assert.equal(a.effort, "L");
    assert.equal(a.impact, 40);
    const file = sb.json("config/backlog.json");
    assert.equal(file.actions.length, 3);
    assert.equal(file._comment, "test", "comment preserved");
    assert.ok(!("source" in file.actions[2]), "source is runtime-only");
    const scan = sb.json("data/opportunity-proposals.json");
    assert.equal(scan.proposals.length, 1);
    assert.equal(scan.proposals[0].title, "Second");
    assert.equal(scan.inference_ran, true, "other keys preserved");

    const b = bl.acceptProposal(0);
    assert.equal(b.effort, "M", "invalid effort defaults to M");
    assert.equal(b.impact, 7, "string impact coerced");
    assert.equal(b.tag, "content");
    assert.equal(b.kind, "Proposed by the opportunity scan");
    assert.equal(bl.acceptProposal(0), null, "nothing left");
    assert.equal(bl.acceptProposal(99), null);
  });

  test("setWatching stamps a date and retire removes", () => {
    assert.equal(bl.setWatching("custom-id", "  shipped in PR 12  "), true);
    const w = sb.json("config/backlog.json").actions.find((a: any) => a.id === "custom-id").watching;
    assert.match(w, /^\d{4}-\d{2}-\d{2}: shipped in PR 12$/);
    assert.equal(bl.setWatching("example-com-write-the-widgets-guide", ""), true);
    const w2 = sb.json("config/backlog.json").actions[0].watching;
    assert.match(w2, /^\d{4}-\d{2}-\d{2}: shipped — watching the data$/);
    assert.equal(bl.setWatching("nope", "x"), false);

    assert.equal(bl.retire("custom-id"), true);
    assert.equal(bl.retire("custom-id"), false);
    assert.ok(!bl.BACKLOG().some((a: any) => a.id === "custom-id"));
  });

  test("a broken file keeps the last good queue", () => {
    const before = bl.BACKLOG().length;
    sb.write("config/backlog.json", "{ not json");
    // ensureFresh() sees a new mtime, tries to reload, fails, keeps current
    const origErr = console.error;
    console.error = () => {};
    try {
      assert.equal(bl.BACKLOG().length, before);
    } finally {
      console.error = origErr;
    }
  });
});
