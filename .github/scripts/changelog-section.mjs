#!/usr/bin/env node
/**
 * Print one version's section from CHANGELOG.md, or exit 1 if it is not there.
 *
 * Used twice by the release workflow: once as a guard (a tag with no changelog
 * entry is a tag nobody can read) and once to supply the GitHub Release body.
 * Keeping it in one place means the guard and the published notes can never
 * disagree about what a version's section is.
 *
 * Usage: changelog-section.mjs <version>        e.g. 0.1.0
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version) {
  console.error("usage: changelog-section.mjs <version>");
  process.exit(2);
}

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const file = path.join(repo, "CHANGELOG.md");
const lines = fs.readFileSync(file, "utf8").split("\n");

// Keep a Changelog: "## [0.1.0] - 2026-09-09". Match the bracketed version
// exactly so 0.1.0 never matches 0.1.10.
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const header = new RegExp(`^## \\[${escaped}\\]`);
const start = lines.findIndex((l) => header.test(l));
if (start === -1) {
  console.error(`CHANGELOG.md has no "## [${version}]" section.`);
  console.error("Add one (dated, not Unreleased) before tagging.");
  process.exit(1);
}

let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
  if (/^## /.test(lines[i])) {
    end = i;
    break;
  }
}

// The last version's section runs to EOF, which sweeps up the link-reference
// definitions Keep a Changelog puts at the bottom. Those are markdown
// plumbing, not release notes, so drop them from the tail.
const section = lines.slice(start + 1, end);
while (section.length && /^\s*$|^\[[^\]]+\]:\s*\S+/.test(section[section.length - 1])) {
  section.pop();
}
const body = section.join("\n").trim();
if (!body) {
  console.error(`The "## [${version}]" section is empty.`);
  process.exit(1);
}
console.log(body);
