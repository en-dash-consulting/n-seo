#!/usr/bin/env node
/**
 * Stamp the current npm download count into www/index.html at deploy time.
 *
 * The obvious way to show this is a shields.io <img>. We don't, for one
 * reason that matters on this site in particular: it currently makes **zero**
 * third-party requests. The fonts are self-hosted, the release notes are
 * generated rather than fetched, and the demo is a real export. A badge image
 * would be the first external host on the page — one that blocks a paint, can
 * be slow or down, and leaves a broken box when it fails. For the marketing
 * site of a tool that flags exactly these problems on other people's sites,
 * that trade is a bad one.
 *
 * So the number is fetched here, at build time, and written into the HTML as
 * text. Same information, no request, cannot break at view time.
 *
 * The cost is staleness between deploys, which the workflow answers with a
 * daily schedule.
 *
 * Failure is never fatal: if the registry cannot be reached the markers keep
 * whatever they already hold, and the page ships without a number rather than
 * with a wrong one or a build error.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGE = path.join(REPO, "www", "index.html");
const PKG = "n-seo";

/** Content between <!--npm:downloads--> and <!--/npm:downloads--> is ours. */
const OPEN = "<!--npm:downloads-->";
const CLOSE = "<!--/npm:downloads-->";

const log = (m) => console.log(`build-npm-badge: ${m}`);

/** Downloads in the trailing month, or null. */
async function downloads() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    // Overridable so the unreachable-registry path can actually be tested,
    // rather than assumed to work because it is in a try/catch.
    const base = process.env.NPM_DOWNLOADS_API || "https://api.npmjs.org/downloads/point/last-month";
    const r = await fetch(`${base}/${PKG}`, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    });
    if (!r.ok) {
      log(`registry answered ${r.status} — leaving the page as it is`);
      return null;
    }
    const n = (await r.json())?.downloads;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch (e) {
    log(`could not reach the registry (${e.name}) — leaving the page as it is`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** 997 -> "997", 1_400 -> "1.4k", 23_000 -> "23k". A download count is a
 *  rough signal, and the extra digits read as false precision. */
function human(n) {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(n / 1000)}k`;
}

const n = await downloads();
if (n === null) process.exit(0);

let html = fs.readFileSync(PAGE, "utf8");
const start = html.indexOf(OPEN);
const end = html.indexOf(CLOSE);
if (start === -1 || end === -1 || end < start) {
  console.error(`build-npm-badge: markers ${OPEN} … ${CLOSE} not found in www/index.html`);
  process.exit(1);
}

const replacement = `${human(n)} downloads/month`;
html = html.slice(0, start + OPEN.length) + replacement + html.slice(end);
fs.writeFileSync(PAGE, html);
log(`stamped "${replacement}" (${n.toLocaleString()} raw)`);
