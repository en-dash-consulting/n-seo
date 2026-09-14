/** The release-notes page generator.
 *
 * It turns CHANGELOG.md into www/releases/index.html at deploy time. The
 * markdown converter is deliberately small, which means its edges have to be
 * held still: one earlier version used a bare number as the placeholder for a
 * lifted-out code span, so any digit in the prose — and the changelog is full
 * of "28 days", "90-day", "404" — was swapped for a code span that did not
 * exist.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO } from "./sandbox.ts";

const SCRIPT = path.join(REPO, ".github", "scripts", "build-releases.mjs");

/** Run the generator against a throwaway copy of the repo layout it needs. */
function build(changelog: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "n-seo-rel-"));
  fs.mkdirSync(path.join(root, ".github", "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "www"), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(root, ".github", "scripts", "build-releases.mjs"));
  fs.writeFileSync(path.join(root, "CHANGELOG.md"), changelog);
  const r = spawnSync(process.execPath, [path.join(root, ".github", "scripts", "build-releases.mjs")], {
    encoding: "utf8",
  });
  const page = path.join(root, "www", "releases", "index.html");
  return {
    status: r.status,
    stderr: r.stderr,
    html: fs.existsSync(page) ? fs.readFileSync(page, "utf8") : "",
    sitemap: (() => {
      const f = path.join(root, "www", "sitemap.xml");
      return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
    })(),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

const HEAD = "# Changelog\n\n## [Unreleased]\n\nNothing yet.\n\n";

describe("build-releases.mjs", () => {
  test("numbers in prose survive the code-span placeholder", () => {
    const b = build(`${HEAD}## [1.0.0] - 2026-01-01

### Fixed
- Leave titles alone for 28 days, decide on the 90 day window, and make
  unknown paths return 404 rather than 200. Run \`n-seo upgrade\` after.
`);
    try {
      assert.equal(b.status, 0, b.stderr);
      for (const n of ["28 days", "90 day", "404", "200"]) {
        assert.ok(b.html.includes(n), `"${n}" was mangled by the code-span placeholder`);
      }
      assert.ok(b.html.includes("<code>n-seo upgrade</code>"), "the real code span was lost");
      assert.ok(!/CODE\d/.test(b.html), "a placeholder leaked into the page");
    } finally { b.cleanup(); }
  });

  test("markup in the changelog is escaped, never emitted", () => {
    const b = build(`${HEAD}## [1.0.0] - 2026-01-01

### Fixed
- A <script>alert(1)</script> tag and an <img src=x onerror=y> in the notes.
`);
    try {
      assert.equal(b.status, 0, b.stderr);
      // The page has legitimate <script> tags of its own (analytics, JSON-LD),
      // so the check is that *this* markup did not survive as markup — the
      // attribute text is harmless once the angle brackets are escaped.
      assert.ok(!b.html.includes("<script>alert(1)</script>"), "raw script tag reached the page");
      assert.ok(!b.html.includes("<img src=x"), "raw img tag reached the page");
      assert.ok(b.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "should appear escaped, as text");
      assert.ok(b.html.includes("&lt;img src=x onerror=y&gt;"), "should appear escaped, as text");
    } finally { b.cleanup(); }
  });

  test("bold, links and hanging indents convert", () => {
    const b = build(`${HEAD}## [2.1.0] - 2026-02-02

### Added
- **A lead sentence.** Then more text that wraps onto
  a second line and should join the first.
- See [the docs](https://example.com/x) for detail.
`);
    try {
      assert.match(b.html, /<strong>A lead sentence\.<\/strong>/);
      assert.match(b.html, /wraps onto a second line/, "a hanging indent must join its bullet");
      assert.match(b.html, /<a href="https:\/\/example\.com\/x">the docs<\/a>/);
      assert.match(b.html, /<h3>Added<\/h3>/);
    } finally { b.cleanup(); }
  });

  test("releases are newest first, Unreleased is dropped, and the sitemap lists the page", () => {
    const b = build(`${HEAD}## [2.0.0] - 2026-02-02

### Added
- Two.

## [1.0.0] - 2026-01-01

### Added
- One.
`);
    try {
      assert.ok(b.html.indexOf('id="v2.0.0"') < b.html.indexOf('id="v1.0.0"'), "newest first");
      assert.ok(!b.html.includes("Unreleased"), "the Unreleased section is not a release");
      assert.match(b.html, /<strong>2\.0\.0<\/strong>/, "the newest version is shown as current");
      assert.match(b.sitemap, /<loc>https:\/\/n-seo\.dev\/releases\/<\/loc>/);
    } finally { b.cleanup(); }
  });

  test("an empty changelog fails loudly rather than publishing a blank page", () => {
    const b = build("# Changelog\n\n## [Unreleased]\n\nNothing yet.\n");
    try {
      assert.notEqual(b.status, 0);
      assert.match(b.stderr, /refusing to write an empty page/);
      assert.equal(b.html, "", "nothing should have been written");
    } finally { b.cleanup(); }
  });

  test("the real CHANGELOG.md builds, and every shipped version appears", () => {
    const real = fs.readFileSync(path.join(REPO, "CHANGELOG.md"), "utf8");
    const b = build(real);
    try {
      assert.equal(b.status, 0, b.stderr);
      const versions = [...real.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);
      assert.ok(versions.length >= 1, "no versions found in the real changelog");
      for (const v of versions) {
        assert.ok(b.html.includes(`id="v${v}"`), `${v} is missing from the page`);
      }
      assert.ok(!/CODE\d/.test(b.html), "a placeholder leaked into the real page");
      assert.ok(!/\*\*/.test(b.html), "unconverted bold markers reached the real page");
    } finally { b.cleanup(); }
  });
});
