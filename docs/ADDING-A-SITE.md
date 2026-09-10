# Adding a site

One entry in `n-seo.config.json`. There are no per-script site lists:
every pull, probe, audit, page and export reads the same `sites` array.

> Or say *"add example.com"* in the instance directory: the `n-seo-add-site`
> skill picks the right property form, finds the numeric GA4 id, proposes a
> brand regex, and reminds you about both access grants.

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

| Field | Required | Meaning |
|---|---|---|
| `host` | yes | Canonical hostname. The URL slug in the dashboard (`/site/docs.example.com`) and the directory name under `data/ga4/` |
| `label` | no | Short display name; defaults to `host` |
| `gscProperty` | for GSC data | The Search Console property exactly as the console shows it: `sc-domain:example.com` (domain property) or `https://www.example.com/` (URL-prefix property, trailing slash included). Leave empty for a site without Search Console; it will still be probed |
| `gscHost` | no | Hostname to filter page URLs by when the property covers more than this host (see below). Defaults to `host`. Use the hostname the site actually serves on — `www.example.com` if the apex redirects to www |
| `ga4Property` | for GA4 data | Numeric GA4 property id (Admin → Property details). Not the `G-…` measurement id. Leave empty for no GA4 |
| `brand` | no | Case-insensitive regex matching your branded queries, for the branded/generic split on `/insights`. Several hosts on one property are OR-ed together |
| `repo` | no | Where the site's code lives, shown on the site page so actions can name it |
| `hosting` | no | Free text, shown on the site page |

## Domain properties and subdomains

A `sc-domain:` property covers every subdomain and protocol. If
`example.com` and `docs.example.com` are separate sites for you but one
property in Search Console, give both entries the same `gscProperty` and a
different `gscHost`. The pull happens once per property (into
`data/gsc/example.com/`) and each site's pages are filtered by `gscHost` when
read. URL-prefix properties are per host by nature; each gets its own
directory.

## Access grants

The service account needs to be a user on the new property in Search Console
(Full) and on the GA4 property (Viewer). If it is already Viewer at the GA4
*account* level, new properties under that account inherit it. Details and
the DNS-verification alternative for stubborn domain properties are in
[SETUP-GOOGLE.md](SETUP-GOOGLE.md).

## Check, then wait for the next run

```sh
python3 ops/doctor.py
```

The doctor confirms the service account can see the property and the GA4
id resolves. Then either wait for the next scheduled run or run it now:

```sh
python3 ops/daily.py
```

The site appears on the overview strip, gets its own `/site/<host>` page, is
probed, audited, swept for index coverage, and shows on `/trends` — with a
flat "no traffic recorded yet" row rather than silently missing if the data
is empty, so a brand-new site is visibly connected even before it ranks.

## Removing a site

Delete its entry. Its data under `data/` stays until you remove it (or run
`npm run demo -- --clean`, which clears the whole `data/` tree). Backlog
items for that host in `config/backlog.json` remain and still render on
`/actions`; retire or delete them.

## Adding a site to the watch list

`watchPages` is a flat list of URLs whose GSC numbers appear in every daily
log entry. Add the pages you have just changed there so the log tracks them:

```json
"watchPages": [
  "https://docs.example.com/getting-started"
]
```
