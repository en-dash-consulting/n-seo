# Connecting Search Console and GA4

The pipeline reads two Google APIs: Search Console (queries, pages, index
coverage) and Google Analytics 4 (sessions, sources, landing pages). Both are
free within generous quotas. The recommended way to authorize is a **service
account with a JSON key** — a machine identity you add as a read-only user in
each console. No gcloud install, no browser login, no token that expires when
your session does.

## 1. Pick a Google Cloud project

Any project works; a dedicated one keeps it tidy. In the
[Cloud Console](https://console.cloud.google.com/), create a project (or open
an existing one). Billing is not required for these APIs.

## 2. Enable the APIs

APIs & Services → Library. Enable all three:

- **Google Search Console API**
- **Google Analytics Data API**
- **Google Analytics Admin API** (used only to list properties; harmless to
  skip if you already know your property id, but the doctor check uses it)

## 3. Create a service account and key

IAM & Admin → Service Accounts → Create service account. Name it something like
`n-seo-reader`. **Grant it no project roles** — it needs none. Access to
your Search Console and GA4 data comes from the consoles themselves in step 4.

Open the account → Keys → Add key → Create new key → JSON. Store the download
outside the repo, readable only by you:

```sh
mkdir -p ~/.config/n-seo
mv ~/Downloads/<project>-<hash>.json ~/.config/n-seo/service-account.json
chmod 600 ~/.config/n-seo/service-account.json
```

Note the account's email (`n-seo-reader@<project>.iam.gserviceaccount.com`).
You will paste it into two places next.

## 4. Grant access in the consoles

### Search Console

Open the property → Settings → Users and permissions → Add user. Paste the
service account email, permission **Full**. (Restricted is enough for reading
performance data; Full also allows the sitemaps endpoint, which the indexing
sweep uses to report sitemap state.)

If the "Add user" dialog rejects the service-account address — this happens
on some domain properties — make the service account a verified owner instead:
enable the **Site Verification API** in the same Cloud project, call it with
the service account to request a DNS TXT token for the domain, add that TXT
record at your DNS provider, then call the API's verify method. The service
account then appears in Search Console as an owner and no UI step is needed.
Google documents the flow under "Site Verification API — Getting started."

### GA4

Admin → Property → Property access management → Add users. Paste the same
email, role **Viewer**. Adding it at the account level instead gives it every
property under the account, which is handy if you run several sites.

While you are in Admin, open **Property details** and note the numeric
**Property ID** (nine or ten digits). That goes in the config.

## 5. Fill in the config

```sh
cp n-seo.config.example.json n-seo.config.json
```

```json
{
  "google": {
    "auth": "service-account-key",
    "serviceAccountKey": "~/.config/n-seo/service-account.json"
  },
  "sites": [
    {
      "host": "example.com",
      "label": "example",
      "gscProperty": "sc-domain:example.com",
      "gscHost": "example.com",
      "ga4Property": "123456789",
      "brand": "example"
    }
  ]
}
```

`gscProperty` must match the property exactly as Search Console has it:
`sc-domain:example.com` for a domain property, or the full URL prefix
(`https://www.example.com/`, trailing slash included) for a URL-prefix
property. `$GOOGLE_APPLICATION_CREDENTIALS` is honored if you prefer that to
`serviceAccountKey`. See [ADDING-A-SITE.md](ADDING-A-SITE.md) for every field.

## 6. Verify

```sh
python3 ingest/google_auth.py     # mints a token, lists the properties the account can see
python3 ops/doctor.py             # full setup check: config, key, APIs, each site's access
```

The first command should print `token OK` followed by your properties and the
permission level on each. If a site you configured is missing from that list,
step 4 has not taken effect yet (it can take a few minutes).

Then run the pipeline once:

```sh
python3 ops/daily.py
```

## Alternative auth modes

Set `google.auth` to one of:

| Mode | How it gets a token | When to use |
|---|---|---|
| `service-account-key` | Signs an OAuth JWT with the key file, using node's crypto module | Default. No extra tools, on any platform |
| `gcloud-impersonate` | `gcloud auth print-access-token --impersonate-service-account=<google.impersonate>` | You already use gcloud and would rather grant your user *Service Account Token Creator* on the SA than keep a key file. Still add the SA to the consoles as above |
| `gcloud-user` | `gcloud auth print-access-token` for your own login | Rarely works: gcloud's default client does not carry the Search Console or Analytics scopes for user credentials, and Google blocks `application-default login` with those scopes. Kept for completeness |
| `metadata` | The runtime service account from the GCE / Cloud Run / GKE metadata server, exchanged for a scoped token | Running on Google Cloud. No key file exists, so none can leak |

## Running it somewhere other than your laptop

A key file is a secret you have to mount, rotate and keep out of the image.
On Google Cloud you can skip it: give the workload a service account and set

```json
"google": { "auth": "metadata" }
```

There is one wrinkle worth knowing, because the failure is otherwise
baffling. The metadata server hands out a token scoped to `cloud-platform`,
and the Search Console API checks for its own scope, so it rejects that
token. n-seo therefore does what the `gcloud-impersonate` mode does, without
gcloud: it takes the metadata token and asks IAM Credentials for a properly
scoped one **for the same account**. That self-impersonation needs the
account to hold Token Creator *on itself*:

```sh
SA=n-seo-runtime@PROJECT.iam.gserviceaccount.com
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --member="serviceAccount:$SA" \
  --role=roles/iam.serviceAccountTokenCreator
```

Without it the first pull fails with a 403, and the error prints that exact
command. Everything else is unchanged: the same service account still has to
be added as a **Full** user in Search Console and a **Viewer** in GA4.

Set `google.impersonate` as well if the workload should borrow a *different*
account than the one it runs as; then that account needs Token Creator for
the runtime account.

`python3 ops/doctor.py` reports the detected account and whether the
exchange works, so run it once on the box before trusting a schedule.

### The LLM module on a server

`modules.llm.command` shells out to a CLI, and a container has none signed
in — so the opportunity scan produces no proposals and the digests no
briefings. Point it at an HTTP endpoint instead:

```json
"llm": {
  "enabled": true,
  "http": {
    "provider": "anthropic",
    "model": "claude-sonnet-5",
    "fastModel": "claude-haiku-4-5-20251001",
    "apiKeyEnv": "ANTHROPIC_API_KEY"
  }
}
```

The key is read from the environment or the instance's `.env` under the name
you give in `apiKeyEnv`; it never goes in the config file. `provider` may
also be `openai`, which speaks the chat-completions shape and therefore also
covers gateways and local servers that emulate it — add `baseUrl` to point
somewhere other than the vendor. When `http` is set and its key resolves it
wins; otherwise the `command` path still runs, so a laptop and a server can
share one config file.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `403 … insufficient permission` / `User does not have sufficient permissions for this site` | The service account is not (yet) a user on that property. Re-check step 4; wait a few minutes |
| `404` on a Search Console property | `gscProperty` does not match the console: `sc-domain:` vs URL prefix, missing trailing slash, `www` vs apex |
| `invalid_grant` / `Invalid JWT` when minting a token | System clock off by more than a few minutes, or a corrupted key file. Check `date`; re-download the key |
| `no key file was found` | The path in `serviceAccountKey` does not exist. `~` is expanded; relative paths resolve from the repo root |
| GA4 returns `PERMISSION_DENIED` | Viewer not granted on that property, or the property id is the *measurement id* (`G-…`) instead of the numeric property id |
| Every step fails at once | Offline. The daily run waits up to five minutes for the network before starting |

Why not `gcloud auth application-default login --scopes=…`? Google rejects
those scopes for gcloud's built-in OAuth client, so it fails regardless of what
you do. The service-account key avoids the problem entirely.

## Data windows and quotas

- **Search Console** keeps 16 months of performance data and finalizes each
  day about three days late. The pipeline pulls the full 16 months (for totals
  and history) and the trailing 90 days (the decision window) and uses
  `dataState: final`, so the most recent three days are always missing by
  design.
- **URL Inspection** allows 2,000 inspections per day and 600 per minute per
  property. The indexing sweep caps itself at 400 URLs per host per run.
- **GA4 Data API** has a daily token budget per property that ordinary use
  never approaches; the four reports the pipeline runs are small.
- Nothing here costs money.
