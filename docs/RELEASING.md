# Releasing

n-seo publishes to npm as **`n-seo`**, unscoped. The package name and the
binary name match, which is why `npm i n-seo` gives you `npx n-seo` and not
something longer.

Releases are driven by tags. Pushing `v<version>` runs
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which
refuses rather than guesses at every step: a tag that disagrees with
`package.json`, or a version with no changelog section, stops the run before
anything reaches the registry.

## What counts as a breaking change

The public contract is larger than the exported functions, because most people
never import this package — they run it. Treat these as **major**:

- **`n-seo.config.json`** — removing a key, renaming one, or changing what a
  value means. Adding an optional key with a safe default is minor.
- **The instance layout** — where `config/`, `content/`, `data/` and
  `docs/daily-log.md` live, and which of them an upgrade may touch. Someone's
  instance is a directory they back up; moving it silently is a breaking
  change even though no code signature moved.
- **The CLI verbs** and their arguments (`init`, `start`, `daily`, `doctor`,
  `demo`, `mcp`, `export`, `check`, `upgrade`, `version`).
- **The data-file shapes** in `docs/ARCHITECTURE.md`, since instances and
  outside scripts read them.
- **The MCP tool names and their inputs**, which agents call.

Minor: new modules, new rules in the action engine, new pages, new data files.
Patch: fixes that leave all of the above alone.

The engine and an instance are versioned together — an instance pins an engine
version, so a major bump is the signal to read the changelog before upgrading.

## Pre-flight

```sh
git switch main && git pull
git status --porcelain          # must be empty
npm ci
npm run check                   # typecheck + TypeScript tests + Python tests
.github/scripts/pack-smoke.sh   # packs, installs, and drives the tarball
```

CI must be green on `main`. The `package` job is the one that matters most
here: it installs the tarball into an empty project and drives the result,
which is the only place packaging bugs are visible. Two shipped undetected
before it existed — `tsx` sitting in `devDependencies`, and `tsconfig.json`
missing from `files` — and a git checkout hides both.

## Cut the release

1. **Write the changelog.** Rename `## [Unreleased]` to
   `## [<version>] - <YYYY-MM-DD>`, add a fresh empty `## [Unreleased]` above
   it, and update the link definitions at the bottom of the file.

2. **Bump the version.** `npm version` writes `package.json`, commits, and
   tags in one step:

   ```sh
   npm version patch      # or minor, or major
   ```

   To keep the changelog commit and the version commit together, stage the
   changelog first and use `npm version --no-git-tag-version`, then commit and
   tag by hand:

   ```sh
   npm version 0.2.0 --no-git-tag-version
   git add package.json package-lock.json CHANGELOG.md
   git commit -m "Release 0.2.0"
   git tag v0.2.0
   ```

3. **Push the tag.**

   ```sh
   git push origin main
   git push origin v0.2.0
   ```

The workflow then checks the tag against `package.json`, checks the changelog
has that section, runs the full suite, packs and drives the tarball,
publishes with provenance, and opens a GitHub Release whose body is that
changelog section.

## The first release is different

Two things are only true once.

**Provenance needs a public repository.** `npm publish --provenance` attaches a
signed attestation linking the tarball to the workflow run that built it.
GitHub will not issue the OIDC token for that on a private repo, so the repo
must be public before the first tag is pushed.

**Trusted publishing cannot be configured until the package exists.** npm's
trusted publishing binds a package to a specific repository and workflow, and
the settings page for it lives on the package — which does not exist yet. So
the first release uses a token, and you switch afterwards:

1. Make the repository public.
2. Create an npm **automation** token (npmjs.com → your avatar → Access
   Tokens → Generate New Token → Automation). Automation tokens bypass 2FA,
   which is what a CI publish needs.
3. Add it as a repository secret named `NPM_TOKEN`
   (`gh secret set NPM_TOKEN`).
4. Tag and push as above. The workflow publishes `n-seo@<version>`.
5. On npmjs.com, open the package → Settings → Trusted Publisher, and point it
   at `en-dash-consulting/n-seo` and `.github/workflows/release.yml`.
6. Delete the `NPM_TOKEN` secret and remove the `NODE_AUTH_TOKEN` env line
   from the publish step. Later releases authenticate with OIDC and no
   long-lived credential exists anywhere.

## Verify what was published

Do not trust the workflow's own output. Install from the registry, into an
empty directory, as a stranger would:

```sh
cd "$(mktemp -d)"
npm init -y >/dev/null
npm i n-seo
npx n-seo version
npx n-seo init ./inst
npx n-seo demo --instance ./inst
npx n-seo start --instance ./inst      # then open the port it prints
```

Check the npm page shows the provenance badge, the README renders, and
`repository` and `homepage` resolve.

## When a release is wrong

**Prefer publishing a fix.** A new patch version is almost always better than
removing one, because anything that already installed the bad version keeps
working.

Mark a bad version so nobody new installs it:

```sh
npm deprecate n-seo@0.2.0 "Broken packaging; use 0.2.1 or later."
```

If `latest` is pointing at the wrong version, move it:

```sh
npm dist-tag add n-seo@0.1.0 latest
```

Unpublishing is a last resort and npm's policy limits it to a 72-hour window
for a version that nothing depends on:

```sh
npm unpublish n-seo@0.2.0
```

A version number is never reusable once published, even after unpublishing.
Bump and move on.

If a secret ever reaches the registry, treat the secret as compromised and
rotate it first. Removing the tarball does not un-leak it.
