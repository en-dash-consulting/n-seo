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

  test("classifySource: one bucket per source, AI ahead of everything", () => {
    const c = data.classifySource;
    // AI wins over medium and over the search pattern: an assistant arrives
    // as a referral, and gemini.google.com would otherwise read as Search.
    assert.equal(c("chatgpt.com", "referral"), "AI assistants");
    assert.equal(c("gemini.google.com", "organic"), "AI assistants");
    assert.equal(c("perplexity.ai", "referral"), "AI assistants");
    assert.equal(c("claude.ai", "referral"), "AI assistants");

    assert.equal(c("google", "organic"), "Search");
    assert.equal(c("bing", "cpc"), "Search");
    assert.equal(c("duckduckgo", "organic"), "Search");

    assert.equal(c("(direct)", "(none)"), "Direct");
    assert.equal(c("anything", "direct"), "Direct");

    assert.equal(c("t.co", "referral"), "Social");
    assert.equal(c("linkedin.com", "referral"), "Social");
    assert.equal(c("somewhere", "social"), "Social");

    assert.equal(c("news.ycombinator.com", "referral"), "Referral");
    assert.equal(c("github.com", "referral"), "Referral");

    assert.equal(c("mailchimp", "email"), "Other");
    assert.equal(c("", ""), "Other");
  });

  test("sourceMixTimeseries: a row per day, every group present, totals add up", () => {
    const site = { host: "example.com", gscHost: "example.com", label: "x" } as any;
    assert.deepEqual(data.sourceMixTimeseries(site), [], "a missing file is empty, not a crash");

    sb.write("data/timeseries/ga4-sources-example.com.json", JSON.stringify({
      site: "example.com",
      rows: [
        { date: "20260902", source: "google", medium: "organic", sessions: 10 },
        { date: "20260902", source: "chatgpt.com", medium: "referral", sessions: 3 },
        { date: "20260902", source: "(direct)", medium: "(none)", sessions: 5 },
        { date: "20260901", source: "github.com", medium: "referral", sessions: 2 },
      ],
    }));
    const series = data.sourceMixTimeseries(site);
    assert.equal(series.length, 2);
    assert.deepEqual(series.map((d: any) => d.date), ["2026-09-01", "2026-09-02"], "sorted ascending");

    const day = series[1];
    assert.equal(day.total, 18);
    assert.equal(day.groups["Search"], 10);
    assert.equal(day.groups["AI assistants"], 3);
    assert.equal(day.groups["Direct"], 5);
    for (const g of data.SOURCE_GROUPS) {
      assert.equal(typeof day.groups[g], "number", `${g} always present`);
    }
    assert.equal(
      data.SOURCE_GROUPS.reduce((s: number, g: string) => s + day.groups[g], 0),
      day.total,
      "groups sum to the day's total",
    );
    assert.equal(series[0].groups["Referral"], 2);
  });
});
