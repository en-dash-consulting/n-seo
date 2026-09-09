---
name: n-seo-setup
description: Take an n-seo install from a fresh clone to its first real daily run — config, Google service account, both console grants, doctor, first pull. Use when the dashboard is empty, doctor reports problems, or someone says they just cloned this.
---

# Setup — clone to first real run

Goal: a green `doctor` and one completed `daily` run. Work top to bottom and
stop at each **ASK** — those are the owner's decisions, not yours.

Throughout, `E` is the engine and `I` is the instance:

```sh
E=<engine checkout>/bin/n-seo.mjs      # the directory holding src/ and bin/
I=<instance dir>                        # in-place mode: the same directory
node $E version --instance "$I"         # prints engine, instance, and mode
```

If `n-seo` is on PATH (`npm link` in the engine), `n-seo <cmd>` works instead.

## 1. Establish the layout

Run `node $E version --instance "$I"`. It prints `mode: in-place` or
`mode: instance`.

- **in-place** — the checkout is the instance. Config lives beside `src/`.
- **instance** — config lives in a separate directory. If that directory is
  empty, scaffold it: `node $E init "$I"`, which never overwrites.

`docs/INSTANCE.md` in the engine explains the split if the owner asks.

## 2. Offer the demo first when there is no Google access yet

If the owner does not have a service account (or does not want to make one
right now), do this before anything else so they see the tool working:

```sh
node $E demo  --instance "$I"      # synthetic dataset for the configured sites
node $E start --instance "$I"      # dashboard on the configured port
```

Every page populates. Say plainly that this is synthetic data, that
`node $E demo --instance "$I" -- --clean` removes it, and that the real setup
resumes at step 3. **ASK** whether to continue to real data now.

## 3. Write the config

```sh
cp <engine>/n-seo.config.example.json "$I/n-seo.config.json"
```

Fill in `sites` first. For each site the owner names, collect:

| Field | Where it comes from |
|---|---|
| `host` | the canonical hostname |
| `gscProperty` | Search Console, **exactly** as shown: `sc-domain:example.com` or `https://www.example.com/` with the trailing slash |
| `gscHost` | only when the property covers more hosts than this site, or the site serves on `www` |
| `ga4Property` | GA4 Admin → Property details → the numeric Property ID, not the `G-…` measurement id |
| `brand` | a case-insensitive regex matching their branded queries |

Use `/n-seo-add-site` for each site if there are several — it covers the
domain-vs-URL-prefix and shared-property cases properly. Set `port` if 4600
is taken.

## 4. Service account and the two grants

Full detail is `docs/SETUP-GOOGLE.md`; the shape is:

1. A Google Cloud project with the Search Console API, Google Analytics Data
   API and Google Analytics Admin API enabled.
2. A service account with **no project roles**. Create a JSON key and store
   it outside the repo:
   ```sh
   mkdir -p ~/.config/n-seo
   mv ~/Downloads/<downloaded>.json ~/.config/n-seo/service-account.json
   chmod 600 ~/.config/n-seo/service-account.json
   ```
   Point `google.serviceAccountKey` at that path.
3. **Search Console** → property → Settings → Users and permissions → Add
   user → the service-account email → **Full**.
4. **GA4** → Admin → Property access management → Add users → the same email
   → **Viewer**. Account-level Viewer covers every property under it.

**ASK** before creating cloud resources or a key on the owner's behalf, and
never paste a key's contents into the transcript. If the install runs on GCP,
`google.auth: "metadata"` avoids the key file entirely — see
`docs/SETUP-GOOGLE.md`.

## 5. Doctor, and fix what it says

```sh
node $E doctor --instance "$I"
```

Work its output item by item; it names the fix for each. The common ones:

- *key file not found* — wrong path in `serviceAccountKey`, or the file is
  not readable by this user.
- *a configured property is missing from the accessible list* — the grant in
  step 4 has not landed. It can take a few minutes; if it never lands, the
  property string does not match Search Console exactly.
- *`no ga4Property`* — expected for sites you deliberately left without GA4.
- *dashboard not running* — expected until step 7.

Do not continue while a FAIL remains.

## 6. First run

Start narrow, then go wide:

```sh
node $E daily --instance "$I" --only probe        # no auth, proves the config's hosts
node $E daily --instance "$I"                     # the full run
cat "$I/data/last-run.json"                        # failures should be ""
tail -20 "$I/docs/daily-log.md"                    # today's entry
```

The index-coverage sweep dominates the wall time; several minutes is normal.

## 7. Dashboard, then scheduling

```sh
node $E start --instance "$I"
```

Open the configured port. Confirm the sites strip lists every configured site
and the queue has cards.

Then hand off scheduling. On this machine that is `docs/SCHEDULING.md` —
launchd, cron, systemd, and the installer script under `ops/templates/`. If it
should run on a server instead of a laptop, use `/n-seo-deploy`.

## Rules

- Never print or commit a key, a token, or a `.env` value.
- Do not enable publishing modules (`indexNow`, `staticExport`,
  `gitAutoCommit`) during setup. They belong to a deliberate decision later.
- Read `docs/OPERATING-RULES.md` before recommending any change to a site.
