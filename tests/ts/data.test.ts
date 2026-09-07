import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { makeSandbox, type Sandbox } from "./sandbox.ts";

describe("data helpers", () => {
  let sb: Sandbox;
  let data: any;
  before(async () => {
    sb = makeSandbox({ data: false });
    data = await sb.mod("data.ts");
  });
  after(() => sb.cleanup());

  test("mdToHtml: headings, list, table, inline, escaping", () => {
    const html = data.mdToHtml([
      "# Title",
      "## Section",
      "### Sub",
      "",
      "Para with **bold**, `code`, and [a link](https://example.com/x).",
      "- one",
      "* two <script>",
      "",
      "| A | B |",
      "|---|---|",
      "| 1 | **2** |",
      "",
      "tail & end",
    ].join("\n"));
    assert.ok(html.includes("<h3>Title</h3>"));
    assert.ok(html.includes("<h3>Section</h3>"));
    assert.ok(html.includes("<h4>Sub</h4>"));
    assert.ok(html.includes("<b>bold</b>"));
    assert.ok(html.includes("<code>code</code>"));
    assert.ok(html.includes('<a href="https://example.com/x" target="_blank" rel="noopener">a link</a>'));
    assert.ok(html.includes('<ul class="md-list">'));
    assert.ok(html.includes("<li>two &lt;script&gt;</li>"), "html escaped inside list items");
    assert.equal((html.match(/<\/ul>/g) ?? []).length, 1, "list closed once");
    assert.ok(html.includes("<th>A</th><th>B</th>"));
    assert.ok(html.includes("<td>1</td><td><b>2</b></td>"), "inline markup inside cells; separator row dropped");
    assert.ok(html.includes("<p>tail &amp; end</p>"));
    assert.ok(!html.includes("<script>"));
  });

  test("drafts: front-matter incl. folded scalars, ordering, README and _ files ignored", () => {
    sb.write("content/drafts/b-second.md", [
      "---",
      'title: "Second post"',
      "order: 2",
      "channel: Blog",
      "status: ready to post",
      "notes: >",
      "  first line of the note",
      "  second line of the note",
      "tags: backlinks",
      "---",
      "Body **here**.",
    ].join("\n"));
    sb.write("content/drafts/a-first.md", "---\ntitle: First\norder: 1\n---\nhello");
    sb.write("content/drafts/_ignored.md", "---\ntitle: nope\norder: 0\n---\n");
    sb.write("content/drafts/no-meta.md", "just a body");
    const ds = data.drafts();
    assert.deepEqual(ds.map((d: any) => d.slug), ["a-first", "b-second", "no-meta"]);
    const s = ds[1];
    assert.equal(s.title, "Second post", "quotes stripped");
    assert.equal(s.order, 2);
    assert.equal(s.channel, "Blog");
    assert.equal(s.status, "ready to post");
    assert.equal(s.notes, "first line of the note second line of the note");
    assert.equal(s.tags, "backlinks");
    assert.equal(s.body, "Body **here**.");
    const n = ds[2];
    assert.equal(n.title, "no-meta.md", "falls back to the filename");
    assert.equal(n.order, 99);
    assert.equal(n.status, "draft");
    assert.equal(n.channel, "—");
    assert.equal(data.draftBySlug("a-first")?.body, "hello");
    assert.equal(data.draftBySlug("_ignored"), undefined);
  });

  test("campaigns: read from content/campaigns, skip README/_ files", () => {
    sb.write("content/campaigns/launch.json", JSON.stringify({
      name: "Launch", site: "example.com", summary: "s", voice: "v",
      targets: [{ rank: 1, name: "T", category: "c", url: "example.org", contact: "x", angle: "a", value: "v", likelihood: "l", evidence: "e" }],
      templates: [{ id: "A", audience: "aud", subject: "sub", body: "b" }],
      plan: [], week2: "", later: "", cautions: [],
    }));
    sb.write("content/campaigns/_draft.json", "{}");
    const cs = data.campaigns();
    assert.equal(cs.length, 1);
    assert.equal(cs[0].slug, "launch");
    assert.equal(data.campaignBySlug("launch")?.targets.length, 1);
  });

  test("dailyLogSections: newest first, blank lines dropped", () => {
    sb.write("docs/daily-log.md", "# Daily ops log\n\n## 2026-09-01\n\n- a\n- b\n\n## 2026-09-02\n- c\n");
    const secs = data.dailyLogSections();
    assert.deepEqual(secs.map((s: any) => s.heading), ["2026-09-02", "2026-09-01"]);
    assert.deepEqual(secs[1].lines, ["- a", "- b"]);
  });

  test("lastNDates ends three days back and is contiguous", () => {
    const ds = data.lastNDates(5);
    assert.equal(ds.length, 5);
    const end = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    assert.equal(ds.at(-1), end);
    for (let i = 1; i < ds.length; i++) {
      assert.equal(new Date(ds[i]).getTime() - new Date(ds[i - 1]).getTime(), 86400000);
    }
  });

  test("readers return null/empty when files are missing", () => {
    assert.equal(data.latestProbe(), null);
    assert.equal(data.metadataAudit(), null);
    assert.equal(data.indexStatus(), null);
    assert.equal(data.opportunityScan(), null);
    assert.equal(data.lastRun(), null);
    assert.deepEqual(data.drafts().filter((d: any) => d.slug.startsWith("x-none")), []);
    assert.equal(data.opsLogTail().includes("no daily-ops.log"), true);
  });
});
