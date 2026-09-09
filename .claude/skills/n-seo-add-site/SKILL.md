---
name: n-seo-add-site
description: Add one site to an n-seo instance correctly — the Search Console property form, gscHost, the numeric GA4 id, a brand regex, and the two access grants. Use whenever someone wants a new site tracked.
---

# Add a site

One entry in `n-seo.config.json`. There are no per-script site lists, so this
is the only edit. `docs/ADDING-A-SITE.md` is the reference; this is the order
to do it in.

```sh
E=<engine checkout>/bin/n-seo.mjs
I=<instance dir>
```

## 1. Collect four facts

Ask for whatever you cannot see, and do not guess any of them.

**The property, exactly as Search Console shows it.** This is where most
mistakes happen:

| In Search Console | `gscProperty` |
|---|---|
| Domain property `example.com` | `sc-domain:example.com` |
| URL-prefix property | `https://www.example.com/` — scheme and **trailing slash** included |

**Whether the property covers more than this site.** A `sc-domain:` property
covers every subdomain and both protocols. So:

- One site on its own domain property → `gscHost` can be omitted.
- Several sites sharing one domain property → every entry gets the **same**
  `gscProperty` and a **different** `gscHost`. The pull happens once per
  property; each site's rows are filtered by `gscHost` when read.
- The site serves on `www` and the apex redirects → `gscHost` is
  `www.example.com` even though `host` is `example.com`. Getting this wrong
  means the probe and the metadata audit look at the wrong hostname and the
  site silently shows no data.

**The numeric GA4 property id.** GA4 → Admin → Property details → Property
ID, nine or ten digits. It is **not** the `G-XXXXXXX` measurement id. Leave
`ga4Property` empty for a site with no analytics; it will still be probed and
pulled from Search Console.

**A brand regex.** Case-insensitive, matching what people type when they mean
this site by name, used for the branded/generic split on `/insights`. For
`example.com` something like `example|exmpl`. Omit it only if the site has no
brand terms — a site with a `gscProperty` and no `brand` counts **all** of
its traffic as generic, which quietly skews that split.

## 2. Add the entry

Append to `sites` in `$I/n-seo.config.json`:

```json
{
  "host": "docs.example.com",
  "label": "docs",
  "gscProperty": "sc-domain:example.com",
  "gscHost": "docs.example.com",
  "ga4Property": "987654321",
  "brand": "example|exmpl",
  "repo": "../example-docs",
  "hosting": "GitHub Pages"
}
```

`label`, `repo` and `hosting` are display-only. Keep the JSON valid — the
dashboard falls back to the last good config and logs a parse error otherwise.

## 3. Grant access to the service account

Both consoles, using the service-account email (`node $E doctor --instance
"$I"` prints it, or read `client_email` from the key file):

- **Search Console** → the new property → Settings → Users and permissions →
  Add user → **Full**.
- **GA4** → Admin → Property access management → **Viewer**. If the service
  account is already Viewer at the *account* level, a new property under that
  account inherits it and there is nothing to do.

On `metadata` auth the same grants apply to the runtime service account.

If Search Console's Add-user dialog rejects a service-account address on a
domain property, the fallback is the Site Verification API and a DNS TXT
record, described in `docs/SETUP-GOOGLE.md`.

## 4. Verify

```sh
node $E doctor --instance "$I"
```

The new property must appear under `search console` with a permission level,
and its GA4 id must resolve. A missing property means the grant has not
landed yet (give it a few minutes) or the property string does not match.

Then let the next scheduled run pick it up, or run it now:

```sh
node $E daily --instance "$I"
```

## 5. Confirm it landed

- The sites strip on `/` lists it.
- `/site/<host>` exists and the probe pills render.
- `/trends` shows it — a brand-new site gets a flat "no traffic recorded yet"
  row rather than being silently absent, so an empty row is a connected site,
  not a broken one.

Zero rows from Search Console on a new site is correct, not a fault: there is
no search history yet.

## Optional: watch a page

`watchPages` is a flat list of URLs whose numbers appear in every daily-log
entry. Add pages you are about to change so the log tracks them.

## Removing a site

Delete the entry. Its `data/` stays until removed. Backlog items for that host
in `config/backlog.json` still render on `/actions` — retire them with the
Retire button or via `POST /api/backlog/<id>/retire`.
