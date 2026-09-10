# Skills in this repo

Two audiences share this directory. If you are **using** n-seo to run your
sites, only the first group applies to you.

## Operating an n-seo instance

These seven ship in the npm package and `n-seo init` copies them into every
new instance, with `<engine checkout>` and `<instance dir>` replaced by that
install's real paths. Nobody has to find this directory to use them. They
drive the CLI, the dashboard's API and the read-only MCP server, and they
follow `docs/OPERATING-RULES.md`.

| Skill | Use it when |
|---|---|
| `orient` | First thing in a fresh session — get current in a few reads |
| `n-seo-setup` | Fresh install to first real daily run, including Google access |
| `n-seo-add-site` | Adding a site: property form, `gscHost`, GA4 id, brand regex, grants |
| `n-seo-triage` | "What should I work on today" from the queue and the last run |
| `n-seo-ship` | Implement one queue card in the site's repo, then record it as watching |
| `n-seo-review` | The weekly pass: judge watching items, retire what is done, refresh insights |
| `n-seo-deploy` | Moving n-seo off the laptop onto an always-on host, on a schedule |

If you change one of these, keep the placeholders literal — `init` rewrites
them per install, and a hardcoded path would ship someone else's directory
to every user. `package.json`'s `files` list names each one; a new operating
skill has to be added there or it will not reach an npm install.

Two rules they all obey, because the tool's credibility rests on them: the
queue changes only through accept / watch / retire, and community
participation is never drafted for you — the digests brief, a human writes.

## Developing n-seo itself

These came from [n-dx](https://n-dx.dev), the toolkit used to build this
project. They call the `rex` and `sourcevision` MCP servers and read the PRD
tree in `.rex/`. **Without n-dx installed they will not work**, so ignore them
unless you are contributing to the engine:

`ndx-capture`, `ndx-config`, `ndx-feedback`, `ndx-plan`, `ndx-reshape`,
`ndx-status`, `ndx-work`, `ndx-zone`, `no-plan-mode`

`docs/PRD.md` is the product definition they operate on; `CONTRIBUTING.md`
explains how it and the `.rex/` tree stay in step.
