# Contributing

## Dev setup

```sh
npm install
cp n-seo.config.example.json n-seo.config.json   # or skip: the example is used as a fallback
npm run demo          # synthetic data so every page renders
npm run dev           # dashboard with reload on :4600
```

Before opening a PR:

```sh
npm run typecheck
python3 -m py_compile ingest/*.py probes/*.py ops/*.py
python3 ops/doctor.py --offline
```

## Ground rules for the code

- **Python is stdlib-only.** No pip. HTTP goes through `ingest/http_util.py`
  (curl with retry) so the pipeline works on a stock macOS Python. Every
  script reads the site list from `ingest/seo_config.py`, never its own copy.
- **TypeScript runs under `tsx` with no bundler.** Server-rendered `hono/jsx`,
  a single stylesheet in `public/styles.css`, no client framework. Small
  inline scripts are fine where a `<details>` element is not enough.
- **Read-only by default.** The MCP server and every module produce briefings,
  proposals, and templates. The only writes the app performs are the ones the
  user clicks: Settings, and the backlog accept / watch / retire buttons.
- **Windows is out of scope.** Keep paths and subprocess calls POSIX.
- **No owner-specific data.** Example values use `example.com`. Anything that
  is one person's site list, username, or key belongs in
  `n-seo.config.json` or `.env`, both gitignored.

## Adding a rule to the action engine

Rules live in `src/actions.ts`. Each takes a `SiteCfg`, reads from
`src/data.ts`, and returns `Action[]`:

1. Write a `function myRule(site: SiteCfg): Action[]` that uses the 90-day
   data (`data.queries(site, true)`, `data.rawQueryPage(site, true)`, etc.).
2. Fill every field: `why` must carry the numbers, `how` the concrete move,
   `spec` the full build spec ending with a success criterion, `impact` an
   ordering estimate in clicks/month, `effort` S/M/L, `tag` a short slug.
3. Look up `SHIPPED_WATCH` for the page so a shipped fix shows as watching.
4. Add the rule to the list in `actionsFor()`.
5. Run `npm run demo && npm run dev` and check the card and its modal.

## Adding a module

A module is an opt-in step with a switch. Four places:

1. `n-seo.config.example.json` — add `"myModule": { "enabled": false, ...options }`
   under `modules`, with every option it reads.
2. `src/config.ts` — add an entry to `MODULE_INFO` (key, title, blurb, needs).
   That is what the Settings page renders; the config loader picks up the
   key automatically.
3. `ops/daily.py` — add the step, gated on `seo_config.enabled("myModule")`.
4. `docs/ARCHITECTURE.md` modules table, and any data file it writes.

If the module reads a secret, take it from `.env` via `seo_config.env()` and
document the variable in `.env.example`.

## Adding a data source

Write a `pull_*.py` under `ingest/` that writes under `data/`, document the
file shape in `docs/ARCHITECTURE.md`, add a reader in `src/data.ts`, and add
a step to `ops/daily.py`. Keep the raw API response where practical so a
future reader is not blocked on a re-pull.

## Scope and the PRD

`docs/PRD.md` states what n-seo is for and what it deliberately is not; the
`.rex/` tree mirrors it item by item. A change that adds or removes a
capability should update both — edit `docs/PRD.md`, then reflect it in the
tree (`ndx add`, `ndx update <id>`, or edit the markdown under
`.rex/prd_tree/` directly; `ndx validate .` must pass).

## Releasing

Maintainers only, and the full procedure is in
[docs/RELEASING.md](docs/RELEASING.md). The short version: write the changelog
section, bump the version, push a `v<version>` tag, and
`.github/workflows/release.yml` does the rest — it refuses to publish if the
tag disagrees with `package.json` or the changelog has nothing for that
version.

Two things are worth knowing even if you never cut a release:

- **The public contract is bigger than the code.** `n-seo.config.json`, the
  instance directory layout, the CLI verbs, the data-file shapes in
  `docs/ARCHITECTURE.md`, and the MCP tool names are all things people depend
  on. Breaking any of them is a major version.
- **`.github/scripts/pack-smoke.sh` is the packaging regression net.** It
  packs the tarball, installs it into an empty project and drives it. Run it
  before you touch `package.json`'s `files`, `dependencies` or `scripts`. A
  git checkout has devDependencies installed and every file present regardless
  of `files`, so it hides exactly the bugs that break `npm i n-seo`.

## Pull requests

- One change per PR, with the reasoning in the description — what you
  observed, what you changed, how you checked it.
- Screenshots for any UI change (light and dark).
- Typecheck and py_compile clean.
- No new runtime dependencies without a sentence on why the stdlib or the
  existing deps could not do it.
