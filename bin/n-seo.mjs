#!/usr/bin/env node
/**
 * n-seo — run the engine against an instance directory.
 *
 * The engine is wherever this file lives (a git checkout or an npm install);
 * the instance is `--instance <path>`, else $N_SEO_INSTANCE, else the current
 * directory. Every command below just sets N_SEO_INSTANCE and runs the
 * engine's own npm script or Python entry point with cwd = the engine, so the
 * engine can be upgraded without touching a single instance file.
 *
 *   n-seo init [dir]      scaffold an instance directory
 *   n-seo start           dashboard for the instance in cwd
 *   n-seo daily --only probe
 *   n-seo upgrade         git pull + npm ci + npm run check, with a rollback hint
 */
import { spawnSync, execFileSync } from "node:child_process";
import { pythonBin } from "../ops/py.mjs";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

const USAGE = `n-seo ${PKG.version} — an SEO on your machine

usage: n-seo <command> [--instance <dir>] [args...]

  init [dir]      scaffold a standalone instance directory (default: cwd); never
                  overwrites, and refuses to scaffold inside a website's repo
                  (--force overrides)
  start           run the dashboard for the instance
  dev             dashboard with reload on engine code changes
  daily           the morning run (args pass through: --only, --skip, --list, …)
  doctor          setup checker (--offline for local checks only)
  demo            write a synthetic dataset for the instance's configured sites
  mcp             the read-only MCP server on stdio (for .mcp.json)
  export          static export of the dashboard into <instance>/site/
  check           engine self-test: typecheck + unit tests
  upgrade         update the engine (git pull / npm ci / check) with a rollback hint
  version         engine version, commit, paths, mode
  help            this text

instance = --instance <dir>, else $N_SEO_INSTANCE, else the current directory.
engine   = ${ROOT}
`;

function parseArgs(argv) {
  const out = { cmd: argv[0] ?? "help", instance: undefined, rest: [] };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--instance") {
      const value = argv[++i];
      // Silently falling back to the cwd here would point `daily` — and its
      // afterRun hooks — at the wrong directory.
      if (!value || value.startsWith("-")) {
        console.error("--instance needs a directory, e.g. --instance ~/my-sites");
        process.exit(2);
      }
      out.instance = value;
      continue;
    }
    if (argv[i].startsWith("--instance=")) { out.instance = argv[i].slice("--instance=".length); continue; }
    out.rest.push(argv[i]);
  }
  return out;
}

function gitCommit() {
  try {
    return execFileSync("git", ["-C", ROOT, "rev-parse", "--short", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null;
  } catch {
    return null;
  }
}

const isGitEngine = () => fs.existsSync(path.join(ROOT, ".git"));

function resolveInstance(flag) {
  const p = flag ?? process.env.N_SEO_INSTANCE ?? process.cwd();
  return path.resolve(p);
}

function run(cmd, args, instance, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, N_SEO_INSTANCE: instance, ...(opts.env ?? {}) },
  });
  if (r.error) {
    console.error(`could not run ${cmd}: ${r.error.message}`);
    return 1;
  }
  return r.status ?? 1;
}

/* Resolve the engine's own dependencies.
 *
 * A git checkout has them in <engine>/node_modules; an npm install has them
 * hoisted into the CONSUMER's node_modules, and <engine>/node_modules does not
 * exist at all. Testing for that directory therefore refused to start a
 * perfectly good `npm i n-seo` install. Resolution works for both layouts. */
const engineRequire = createRequire(path.join(ROOT, "package.json"));

function resolvePkgDir(name) {
  try {
    return path.dirname(engineRequire.resolve(`${name}/package.json`));
  } catch {
    return null;
  }
}

/** The engine runs TypeScript through tsx, with no build step. */
function tsxBin() {
  const dir = resolvePkgDir("tsx");
  if (!dir) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.tsx;
    return rel ? path.join(dir, rel) : null;
  } catch {
    return null;
  }
}

/* npm, npx and similar arrive as `.cmd` batch shims on Windows, which
 * spawnSync cannot execute without a shell — a bare `npm` fails there with
 * ENOENT. (The Python interpreter has the same problem; ops/py.mjs solves
 * it, and this file imports pythonBin from there so the CLI and the npm
 * scripts resolve the interpreter identically.) */
function npmBin(name = "npm") {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function missingDeps(cmd, what) {
  const installed = ROOT.includes(`${path.sep}node_modules${path.sep}`);
  console.error(`${cmd} needs ${what}.`);
  console.error(installed
    ? `  the package looks incomplete — reinstall it: npm i n-seo`
    : `  run: npm ci   (in ${ROOT})`);
  return 1;
}

/* ---------- init ---------- */

/** Files that mean "this directory is an application", not a place to keep
 *  search-ops files. n-seo is a standalone project: it writes a config, a
 *  queue, drafts and a data/ tree that the daily run rewrites every morning.
 *  Dropped into a website's repo those files get committed, deployed, and
 *  eventually served — and `n-seo upgrade` starts fighting the site's own
 *  package.json. The instance sits beside the sites it watches, never inside
 *  one. */
const APP_MARKERS = [
  "package.json", "index.html", "next.config.js", "next.config.mjs", "next.config.ts",
  "vite.config.js", "vite.config.ts", "astro.config.mjs", "nuxt.config.ts",
  "svelte.config.js", "gatsby-config.js", "remix.config.js", "angular.json",
  "Gemfile", "go.mod", "Cargo.toml", "pyproject.toml", "composer.json",
  "hugo.toml", "config.toml", "_config.yml", "wp-config.php", "Dockerfile",
];

/** The nearest ancestor holding a .git, or null. */
function gitRootOf(dir) {
  let cur = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(cur, ".git"))) return cur;
    const up = path.dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
}

/** Why this directory is the wrong place for an instance, or null if it is
 *  fine.
 *
 *  `forChild` means the instance will be a NEW directory created inside
 *  `dir`, which changes one answer: a repository root is a fine place to put
 *  an instance (it becomes its own repo) but a terrible parent for one (the
 *  new directory lands inside that repo's working tree).
 *
 *  Re-running init on an existing instance is always allowed. */
function wrongPlaceFor(dir, forChild = false) {
  if (fs.existsSync(path.join(dir, "n-seo.config.json"))) return null;
  // In-place mode: the engine checkout is the instance. It has a package.json
  // and a .git of its own, both of which would otherwise trip every check.
  if (!forChild && path.resolve(dir) === ROOT) return null;
  const marker = APP_MARKERS.find((f) => fs.existsSync(path.join(dir, f)));
  if (marker) {
    return forChild
      ? `${dir} contains ${marker} — an instance created here would sit inside an application`
      : `${dir} contains ${marker} — that is an application, not an n-seo instance`;
  }
  const root = gitRootOf(dir);
  const insideSomeoneElsesRepo = root && (forChild || root !== path.resolve(dir));
  if (insideSomeoneElsesRepo && !fs.existsSync(path.join(root, "n-seo.config.json"))) {
    return `${dir} is inside the git repository at ${root} — the instance would be committed to it`;
  }
  return null;
}

function init(dirArg, force = false) {
  const dir = path.resolve(dirArg ?? process.cwd());
  // A directory that does not exist yet inherits its parent's problem: a new
  // folder created inside a site repo is still inside that site repo.
  const wrong = fs.existsSync(dir) ? wrongPlaceFor(dir) : wrongPlaceFor(path.dirname(dir), true);
  if (wrong && !force) {
    console.error(`n-seo init: refusing to scaffold here.

  ${wrong}

n-seo is a standalone project, not something you add to a website. It keeps a
config, an action queue, content drafts and a data/ tree that the daily run
rewrites every morning; inside a site repo those get committed and deployed.
The instance watches your sites over the Search Console API — it never needs
to live in their code.

Do this instead:

  cd ~            # anywhere outside your site repos
  n-seo init my-sites
  cd my-sites

Then list the sites you own in my-sites/n-seo.config.json.

If you really mean it here, pass --force.`);
    return 2;
  }
  fs.mkdirSync(dir, { recursive: true });
  const name = path.basename(dir);
  const put = (rel, content) => {
    const p = path.join(dir, rel);
    if (fs.existsSync(p)) { console.log(`  exists, kept   ${rel}`); return; }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    console.log(`  created        ${rel}`);
  };
  const example = JSON.parse(fs.readFileSync(path.join(ROOT, "n-seo.config.example.json"), "utf8"));
  example.name = name;
  put("n-seo.config.json", JSON.stringify(example, null, 2) + "\n");
  put("config/backlog.json", JSON.stringify({
    _comment: "Your curated strategic queue. The dashboard merges these with data-derived actions. Add items with evidence (why) and a spec; when something ships, set `watching` to a dated note instead of deleting it. `shippedWatch` maps page URLs to notes so data-derived cards on those pages show as watching too.",
    actions: [],
    shippedWatch: {},
  }, null, 2) + "\n");
  put("config/insights.json", JSON.stringify({
    _comment: "Optional hand-written marketer briefing shown on /insights above the live trend tables. verdict: opportunity | warning | momentum | deprioritize. Leave the list empty to show only the live tables.",
    date: "",
    insights: [],
  }, null, 2) + "\n");
  for (const rel of ["content/drafts/README.md", "content/campaigns/README.md"]) {
    const src = path.join(ROOT, rel);
    put(rel, fs.existsSync(src) ? fs.readFileSync(src, "utf8") : `# ${rel}\n`);
  }
  // The skills are the product's front door: with them in place the instance
  // is a directory an agent can be pointed at, and setup / triage / shipping
  // become a conversation instead of a docs-reading exercise. The engine's
  // own contributor skills (ndx-*) stay behind — they are for working on
  // n-seo, not with it. Placeholders become this install's real paths so the
  // commands in them are copy-pasteable.
  const INSTANCE_SKILLS = ["orient", "n-seo-setup", "n-seo-add-site", "n-seo-triage", "n-seo-ship", "n-seo-review", "n-seo-deploy"];
  let skillsCopied = 0;
  for (const skill of INSTANCE_SKILLS) {
    const src = path.join(ROOT, ".claude", "skills", skill, "SKILL.md");
    if (!fs.existsSync(src)) continue;
    const body = fs
      .readFileSync(src, "utf8")
      .replaceAll("<engine checkout>/bin/n-seo.mjs", path.join(ROOT, "bin", "n-seo.mjs"))
      .replaceAll("<instance dir>", dir);
    put(path.join(".claude", "skills", skill, "SKILL.md"), body);
    skillsCopied++;
  }

  put("CLAUDE.md", `# ${name} — an n-seo instance

This directory is an n-seo instance: config, the curated action queue, content
drafts, and the data the daily run writes. It is **not** a website. The sites
it watches live in their own repositories and are read over the Search Console
and GA4 APIs.

Engine (the code): ${ROOT}
Docs: ${path.join(ROOT, "docs")}

## Working here

Skills in \`.claude/skills/\` cover the routine work — start with
\`/orient\` in a fresh session, then \`/n-seo-triage\` for what to do today,
\`/n-seo-ship\` to implement one card, \`/n-seo-review\` for the weekly pass.

## Rules that are not negotiable

- **28-day metadata freeze.** After a page's title or description changes,
  leave that page's metadata alone for 28 days. Title churn reads as
  manipulation and resets Google's evaluation.
- **At most ~8 title/description changes a week** across all sites.
- **Impact numbers order the queue. They are not forecasts.** Never report
  one as an expected result.
- **Decisions ride the trailing 90 days.** The 16-month data is for totals
  and history only.
- **Shipped work becomes \`watching\`, never deleted** — that is how the loop
  closes.
- **Machine proposals never self-promote.** They wait in the holding area on
  /actions until a human accepts them.
- **Site changes ship as branches and pull requests** in the site's own repo,
  never committed straight to its main branch.
`);

  const envExample = path.join(ROOT, ".env.example");
  put(".env", fs.existsSync(envExample) ? fs.readFileSync(envExample, "utf8") : "");
  put(".gitignore", "data/\nsite/\n.env\n__pycache__/\nnode_modules/\n");
  put(".mcp.json", JSON.stringify({
    mcpServers: {
      "n-seo": {
        command: "node",
        args: [path.join(ROOT, "bin", "n-seo.mjs"), "mcp"],
        env: { N_SEO_INSTANCE: dir },
      },
    },
  }, null, 2) + "\n");
  put("README.md", `# ${name} — an n-seo instance

This directory holds one n-seo instance: the config, the curated queue
(\`config/backlog.json\`), content (\`content/\`), and the data the daily run
writes (\`data/\`, gitignored). The engine — the code — lives at:

    ${ROOT}

Run everything from here with the \`n-seo\` CLI (it sets \`N_SEO_INSTANCE\`
to this directory):

\`\`\`sh
n-seo doctor          # is the setup complete?
n-seo demo            # synthetic data to see the dashboard working
n-seo start           # dashboard on the configured port
n-seo daily           # the morning run
n-seo upgrade         # update the engine; your files here are untouched
\`\`\`

Edit \`n-seo.config.json\` for sites, Google access, modules and hooks.
Docs: ${path.join(ROOT, "docs")}

## Or just ask

n-seo is built to be driven by an AI agent. Open this directory in Claude Code
(or any agent that reads \`.claude/skills/\`) and talk to it:

    "set this up for my sites"      → /n-seo-setup
    "what should I work on today?"  → /n-seo-triage
    "do the first one"              → /n-seo-ship
    "how did last month go?"        → /n-seo-review

A read-only MCP server is wired up in \`.mcp.json\`, so the agent reads the
same queue and metrics the dashboard shows. It can propose and implement;
it cannot publish, post, or change your sites behind your back.
`);
  console.log(`
instance ready at ${dir}
  a standalone project — your websites stay in their own repos, untouched

next:
  cd ${dir}
  n-seo demo && n-seo start   see the dashboard working on synthetic data
  edit n-seo.config.json      your sites + google.serviceAccountKey
  n-seo doctor                checks the setup and names what is missing

or hand it to an agent — ${skillsCopied} skills are installed in .claude/skills/:
  cd ${dir} && claude
  "set this up for my sites"  → /n-seo-setup walks the whole thing, including
                                the Google service account and both grants
  later: "what should I work on today?" → /n-seo-triage

setup guide: ${path.join(ROOT, "docs", "SETUP-GOOGLE.md")}
`);
  return 0;
}

/* ---------- upgrade ---------- */

const sha256 = (p) => (fs.existsSync(p) ? createHash("sha256").update(fs.readFileSync(p)).digest("hex") : "");

function upgrade(instance) {
  if (!isGitEngine()) {
    console.log("engine installed from npm — run: npm update n-seo");
    return 0;
  }
  const before = gitCommit();
  const lockBefore = sha256(path.join(ROOT, "package-lock.json"));
  console.log(`engine ${ROOT} at ${before ?? "?"} — pulling`);
  let r = spawnSync("git", ["-C", ROOT, "pull", "--ff-only"], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error("git pull --ff-only failed — the engine has local changes or diverged; resolve in the engine checkout and retry");
    return r.status ?? 1;
  }
  const after = gitCommit();
  if (after === before) {
    console.log("already up to date");
  }
  if (sha256(path.join(ROOT, "package-lock.json")) !== lockBefore || !fs.existsSync(path.join(ROOT, "node_modules"))) {
    console.log("lockfile changed — npm ci");
    r = spawnSync(npmBin(), ["ci"], { cwd: ROOT, stdio: "inherit" });
    if (r.status !== 0) {
      console.error(`npm ci failed. Roll back with:\n  git -C ${ROOT} reset --hard ${before}`);
      return r.status ?? 1;
    }
  }
  console.log("running the engine's checks");
  r = spawnSync(npmBin(), ["run", "check"], { cwd: ROOT, stdio: "inherit", env: { ...process.env, N_SEO_INSTANCE: instance } });
  if (r.status !== 0) {
    console.error(`\nengine checks FAILED at ${after ?? "?"}. Previous commit: ${before ?? "?"}. Roll back with:\n  git -C ${ROOT} reset --hard ${before}\n  (then npm ci in ${ROOT} if the lockfile moved)`);
    return 1;
  }
  console.log(`\nengine ${before ?? "?"} → ${after ?? "?"}: checks pass. Restart the dashboard to pick it up.`);
  return 0;
}

/* ---------- main ---------- */

const { cmd, instance: flag, rest } = parseArgs(process.argv.slice(2));
const instance = resolveInstance(flag);
const py = pythonBin();
let code = 0;

switch (cmd) {
  case "init":
    code = init(rest.find((a) => !a.startsWith("-")) ?? flag ?? process.cwd(), rest.includes("--force"));
    break;
  case "start":
  case "dev":
  case "mcp": {
    // Spawn tsx directly rather than through `npm run`, so the command does
    // not depend on npm resolving a bin from inside node_modules/n-seo.
    const bin = tsxBin();
    if (!bin) {
      code = missingDeps(cmd, "the engine's dependencies");
      break;
    }
    const entry = cmd === "mcp" ? "src/mcp-stdio.ts" : "src/server.tsx";
    const args = cmd === "dev" ? ["watch", entry] : [entry];
    code = run(process.execPath, [bin, ...args, ...rest], instance);
    break;
  }
  case "check":
    // The self-test needs devDependencies, which an npm install omits.
    code = resolvePkgDir("typescript")
      ? run(npmBin(), ["run", "check", "--silent", "--", ...rest], instance)
      : missingDeps(cmd, "the engine's dev dependencies (it is the engine's own test suite)");
    break;
  case "daily":
    code = run(py, [path.join(ROOT, "ops", "daily.py"), ...rest], instance);
    break;
  case "doctor":
    code = run(py, [path.join(ROOT, "ops", "doctor.py"), ...rest], instance);
    break;
  case "demo":
    code = run(py, [path.join(ROOT, "ops", "demo_data.py"), ...rest], instance);
    break;
  case "export":
    code = run(py, [path.join(ROOT, "ops", "export_static.py"), ...rest], instance);
    break;
  case "upgrade":
    code = upgrade(instance);
    break;
  case "version": {
    const mode = instance === ROOT ? "in-place" : "instance";
    console.log(`n-seo ${PKG.version}${gitCommit() ? ` (${gitCommit()})` : ""}\nengine:   ${ROOT}\ninstance: ${instance}\nmode:     ${mode}`);
    break;
  }
  case "help":
  case "--help":
  case "-h":
    process.stdout.write(USAGE);
    break;
  default:
    console.error(`unknown command: ${cmd}\n`);
    process.stdout.write(USAGE);
    code = 2;
}
process.exit(code);
