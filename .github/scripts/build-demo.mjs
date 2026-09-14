#!/usr/bin/env node
/**
 * Build www/demo/ — a real, clickable n-seo dashboard on synthetic data.
 *
 * The marketing site used to show screenshots. A screenshot cannot be
 * clicked, goes stale silently, and asks the reader to take your word for it.
 * This scaffolds an instance, fills it with the same demo dataset `n-seo demo`
 * gives a new user, exports it as static HTML, and drops it on the site. What
 * a visitor pokes at is the actual product, built from the commit being
 * deployed — so it cannot drift from what they would install, and a build
 * that breaks the dashboard fails the marketing deploy too.
 *
 * The export needs post-processing before it can live under a sub-path:
 *
 *   - Absolute links (`/actions`, `/styles.css`) have to become `/demo/...`,
 *     or clicking Actions inside the frame lands on a 404 at the site root.
 *   - The Settings link is in the nav but the page is deliberately not
 *     exported — it shows local paths and a service-account email — so it
 *     would be a dead link.
 *   - The export injects a staleness banner that shouts once the snapshot is
 *     more than 36 hours old. That is right for an ops mirror and wrong here:
 *     the demo is as old as the last deploy, by design.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = path.join(REPO, "bin", "n-seo.mjs");
const OUT = path.join(REPO, "www", "demo");
const BRAND = process.env.DEMO_BRAND || "Acme";

const log = (m) => console.log(`build-demo: ${m}`);

function freePort(start = 4810) {
  return new Promise((resolve, reject) => {
    const probe = (port) => {
      if (port > start + 60) return reject(new Error("no free port"));
      const s = net.createServer();
      s.once("error", () => probe(port + 1));
      s.once("listening", () => s.close(() => resolve(port)));
      s.listen(port, "127.0.0.1");
    };
    probe(start);
  });
}

function node(args, opts = {}) {
  const r = spawnSync(process.execPath, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) {
    throw new Error(`failed: node ${args.join(" ")}`);
  }
}

/** Make an export written for the site root work under /demo/. */
function reroot(dir) {
  let files = 0;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!p.endsWith(".html")) continue;
      let html = fs.readFileSync(p, "utf8");

      // href="/x" and src="/x" -> "/demo/x". The negative lookahead keeps a
      // second pass idempotent and leaves protocol-relative URLs alone.
      html = html.replace(/(href|src)="\/(?!demo\/|\/)/g, '$1="/demo/');

      // Every exported page is <dir>/index.html, so `/demo/actions` costs a
      // 301 to `/demo/actions/` on every click. Link the canonical form.
      // Skips anything with a file extension (styles.css, favicon.svg) and
      // keeps the fragment on the end where it belongs.
      html = html.replace(/href="(\/demo\/[^"#?]*?)(#[^"]*)?"/g, (m, p, frag) => {
        // A known asset extension, not merely "contains a dot" — the
        // per-site pages are /demo/site/example.com, which is a directory
        // whose name looks exactly like a filename.
        if (/\.(css|js|mjs|json|svg|png|jpe?g|webp|ico|xml|txt|woff2?)$/i.test(p) || p.endsWith("/")) return m;
        return `href="${p}/${frag ?? ""}"`;
      });

      // The Settings page is not exported; its nav link would 404.
      html = html.replace(/<a href="\/demo\/settings\/?"[^>]*>Settings<\/a>/g, "");

      // The ops staleness banner is meaningless on a marketing page.
      html = html.replace(/<script>\(function\(\)\{var g=new Date\([^<]*?\}\)\(\);<\/script>/g, "");

      fs.writeFileSync(p, html);
      files++;
    }
  };
  walk(dir);
  return files;
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "n-seo-demo-"));
const inst = path.join(work, "demo-instance");
let server = null;

try {
  log("scaffolding an instance");
  node([CLI, "init", inst], { stdio: "ignore" });

  // The brand shows in the dashboard's top bar; "demo-instance" would read as
  // a build artefact rather than somebody's portfolio.
  const cfgPath = path.join(inst, "n-seo.config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  cfg.name = BRAND;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");

  log("generating the demo dataset");
  node([CLI, "demo", "--instance", inst], { stdio: "ignore" });

  const port = await freePort();
  log(`starting the dashboard on ${port}`);
  // detached, so the whole process group can be killed. `n-seo start` spawns
  // tsx, which spawns the server: killing only the wrapper leaves a grandchild
  // holding the stdio pipes, and this script then hangs forever waiting for
  // handles that will never close.
  server = spawn(process.execPath, [CLI, "start", "--instance", inst], {
    env: { ...process.env, SEO_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let serverLog = "";
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));

  const deadline = Date.now() + 60_000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/actions`);
      if (r.ok) { up = true; break; }
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!up) throw new Error(`the dashboard never came up.\n${serverLog}`);

  log("exporting");
  node([CLI, "export", "--instance", inst], { env: { ...process.env, SEO_PORT: String(port) }, stdio: "ignore" });

  const site = path.join(inst, "site");
  if (!fs.existsSync(path.join(site, "index.html"))) throw new Error("the export produced no index.html");

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.cpSync(site, OUT, { recursive: true });
  // robots.txt only has meaning at a domain root; every exported page already
  // carries its own noindex, which is what keeps demo data out of the index.
  fs.rmSync(path.join(OUT, "robots.txt"), { force: true });

  // The dashboard follows the visitor's colour scheme. Embedded in a navy
  // marketing page, a light-mode visitor would get a white panel that reads
  // as a rendering bug. `@media all` always matches, so rewriting the four
  // dark blocks pins this copy — and only this copy — to dark.
  const cssPath = path.join(OUT, "styles.css");
  let css = fs.readFileSync(cssPath, "utf8");
  const blocks = (css.match(/@media \(prefers-color-scheme: dark\)/g) || []).length;
  if (!blocks) throw new Error("no prefers-color-scheme blocks found — has the dashboard CSS changed?");
  css = css.replace(/@media \(prefers-color-scheme: dark\)/g, "@media all");
  // color-scheme makes the scrollbars and any form controls dark too.
  css = ":root { color-scheme: dark; }\n" + css;
  fs.writeFileSync(cssPath, css);
  log(`pinned the demo to dark (${blocks} media blocks)`);

  const n = reroot(OUT);
  log(`wrote www/demo/ — ${n} pages, brand "${BRAND}"`);
} finally {
  if (server?.pid) {
    // Negative pid = the whole group, so tsx and the server go with it.
    try { process.kill(-server.pid, "SIGTERM"); } catch { /* already gone */ }
    server.stdout?.destroy();
    server.stderr?.destroy();
  }
  fs.rmSync(work, { recursive: true, force: true });
}

// The killed group can still leave this process with open handles for a
// moment. Nothing is outstanding by here, so say so rather than waiting.
process.exit(0);
