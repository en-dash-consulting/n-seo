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
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

const USAGE = `n-seo ${PKG.version} — an SEO on your machine

usage: n-seo <command> [--instance <dir>] [args...]

  init [dir]      scaffold an instance directory (default: cwd); never overwrites
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

function missingDeps(cmd, what) {
  const installed = ROOT.includes(`${path.sep}node_modules${path.sep}`);
  console.error(`${cmd} needs ${what}.`);
  console.error(installed
    ? `  the package looks incomplete — reinstall it: npm i n-seo`
    : `  run: npm ci   (in ${ROOT})`);
  return 1;
}

/* ---------- init ---------- */

function init(dirArg) {
  const dir = path.resolve(dirArg ?? process.cwd());
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
`);
  console.log(`
instance ready at ${dir}

next:
  cd ${dir}
  edit n-seo.config.json      (sites, google.serviceAccountKey — see ${path.join(ROOT, "docs", "SETUP-GOOGLE.md")})
  n-seo doctor
  n-seo demo && n-seo start   (or n-seo daily once the key is in place)
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
    r = spawnSync("npm", ["ci"], { cwd: ROOT, stdio: "inherit" });
    if (r.status !== 0) {
      console.error(`npm ci failed. Roll back with:\n  git -C ${ROOT} reset --hard ${before}`);
      return r.status ?? 1;
    }
  }
  console.log("running the engine's checks");
  r = spawnSync("npm", ["run", "check"], { cwd: ROOT, stdio: "inherit", env: { ...process.env, N_SEO_INSTANCE: instance } });
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
const py = process.env.PYTHON ?? "python3";
let code = 0;

switch (cmd) {
  case "init":
    code = init(rest[0] ?? flag ?? process.cwd());
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
      ? run("npm", ["run", "check", "--silent", "--", ...rest], instance)
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
