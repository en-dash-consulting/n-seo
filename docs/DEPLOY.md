# Deploying n-seo somewhere other than your laptop

n-seo is local-first, not laptop-first. "Local" means the data lives on
infrastructure you control rather than in someone's SaaS; it does not have to
mean the machine you are typing on. A laptop is a poor host for a daily job:
it sleeps, it travels, and the run silently skips a day.

This document is about moving it to a box that is always on.

## The shape

One host runs two long-lived things — the dashboard and a scheduler that
fires the daily run — against one instance directory. That directory is the
only state.

```
    ┌─────────────────────── your host ────────────────────────┐
    │  docker compose                                          │
    │    dashboard   ──┐                                       │
    │    scheduler   ──┴──►  /instance   config, queue,        │
    │      (daily at 07:00)              content, data, logs   │
    └──────────────────────────────────────────────────────────┘
              │ tunnel (IAP / SSH / Tailscale)     │ afterRun hook
              ▼                                    ▼
        you, on :4600                     a bucket, served read-only
                                          behind IAP — the mirror
```

Two audiences, two doors. **You** get the live dashboard, always through a
tunnel, never over the open internet. **Everyone else** — colleagues, a
client — gets the static mirror: yesterday's HTML with no application behind
it, behind whatever sign-in you already have.

## Rules, not suggestions

- **Never publish the dashboard's port.** It has write endpoints, and the
  Settings page sets the LLM command that the daily run executes. Reaching
  the dashboard is equivalent to running code on the host. It binds
  `127.0.0.1` by default and the container publishes to loopback only; keep
  it that way and tunnel in.
- **If you must have a hostname, put auth in front.** The Caddy overlay in
  `docker/` does basic auth and TLS. IAP or Cloudflare Access are better.
  Nothing goes in front of it means nothing is protecting it.
- **No secret in the image or in git.** Mount the service-account key
  read-only, or on GCP use no key at all (see below). `.env` stays out of
  version control; `n-seo init` already gitignores it.
- **The mirror is the thing you share.** It is static and read-only by
  construction. Share that, not the dashboard.

## Pick a host

| | Good when | Notes |
|---|---|---|
| **Any Linux box with Docker** | you already have a VPS, a NAS, a home server | `deploy/vm/startup.sh` sets it up. Cheapest path. |
| **A small GCE VM** | you are already on GCP, want IAP and disk snapshots | `deploy/gcp/setup.sh` builds the whole thing. `e2-small` is plenty. |
| **Cloud Run for the engine** | — | Don't. See below. |

### Why not Cloud Run for the engine

It is the obvious idea and it does not work, for a specific reason:
`ops/export_static.py` builds the site into a staging directory and finishes
with an atomic `Path.rename()`, so a failed export can never publish an empty
mirror. GCS FUSE — the only way to give Cloud Run persistent storage — has no
atomic directory rename. You would trade a real guarantee for a scale-to-zero
you do not need for a job that runs once a day.

Cloud Run is still the right tool for *serving the mirror*, where the bucket
is mounted read-only and nothing renames anything. That is what
`deploy/gcp/cloud-run-mirror/` is.

## Any Linux box

```sh
curl -fsSLO https://raw.githubusercontent.com/en-dash-consulting/n-seo/main/deploy/vm/startup.sh
sudo bash startup.sh

sudo -u n-seo /opt/n-seo/manage init
sudo -u n-seo vi /srv/n-seo/instance/n-seo.config.json
sudo -u n-seo /opt/n-seo/manage doctor
sudo -u n-seo /opt/n-seo/manage daily
```

Then tunnel to the dashboard:

```sh
ssh -N -L 4600:localhost:4600 you@your-host
```

Details, commands and backup instructions: `deploy/vm/README.md`.

## GCP, end to end

```sh
gcloud config set project YOUR_PROJECT
cd deploy/gcp

./setup.sh --dry-run        # read what it will do
./setup.sh                  # do it
```

That creates a service account with Token Creator on itself, a private bucket
for the mirror, a persistent data disk, a VM with the SA attached and **no
external IP**, a firewall that allows only IAP's SSH range, and the Cloud Run
mirror behind IAP. Every value at the top of the script is overridable
(`REGION=europe-west1 ./setup.sh`).

It cannot do four things, and prints them when it finishes:

1. **Search Console** — add the service account as a **Full** user on every
   property. Domain properties sometimes reject a service-account address in
   that UI; `docs/SETUP-GOOGLE.md` covers verifying it as an owner instead.
2. **GA4** — add the same address with the **Viewer** role.
3. **IAP members** — who may open the mirror.
4. **Your instance** — the config, the queue, the content. Yours to write.

### Auth with no key file

On GCP, set:

```json
"google": { "auth": "metadata" }
```

The engine takes the VM's own identity from the metadata server and exchanges
it, through IAM Credentials, for a token scoped to Search Console or GA4 —
the metadata server's default token is `cloud-platform` scoped, which the
Search Console API rejects. That exchange is why the service account needs
`roles/iam.serviceAccountTokenCreator` **on itself**, which `setup.sh`
grants. No key is created, downloaded or stored.

Off GCP, keep a key file mounted read-only and point
`google.serviceAccountKey` at it.

### Publishing the mirror

In the instance config:

```json
"modules": { "staticExport": { "enabled": true } },
"hooks": {
  "afterRun": [
    "gcloud storage rsync site gs://YOUR_PROJECT-n-seo-mirror --recursive --delete-unmatched-destination-objects"
  ]
}
```

The VM's service account already has write access to that bucket, so the hook
carries no credentials. `deploy/gcp/cloud-run-mirror/README.md` has the
serving side.

### Reaching the dashboard on GCP

```sh
gcloud compute start-iap-tunnel n-seo 4600 \
  --local-host-port=localhost:4600 --zone us-east1-b
open http://localhost:4600
```

No public IP, no open port, no password to leak.

## The LLM module on a headless host

`modules.llm` shells out to a local CLI by default (`claude -p`). On a server
that binary usually is not there and is not signed in, and the opportunity
scan and the digests quietly fall back to no proposals and no briefings.

Either install and authenticate the CLI in the image, or configure the HTTP
path so no CLI is needed:

```json
"modules": {
  "llm": {
    "enabled": true,
    "http": {
      "provider": "anthropic",
      "model": "claude-sonnet-5",
      "fastModel": "claude-haiku-4-5-20251001",
      "apiKeyEnv": "ANTHROPIC_API_KEY"
    }
  }
}
```

with `ANTHROPIC_API_KEY` in the instance's `.env` (never in the image).
`doctor` reports which path it will use.

## Backups

The instance directory is the whole story, and if you keep it in its own git
repo — which `docs/INSTANCE.md` recommends — most of it is already backed up
on every daily run when `gitAutoCommit` is on. `data/` is regenerable; the
next run rewrites it.

```sh
gcloud compute disks snapshot n-seo-data --zone us-east1-b     # GCE

sudo tar czf n-seo-instance-$(date +%F).tgz \
  --exclude=data --exclude=site -C /srv/n-seo instance          # anywhere
```

Restoring is putting the directory back and running `manage daily` once.

## Upgrades

```sh
sudo -u n-seo /opt/n-seo/manage upgrade
```

Pulls the engine, rebuilds the image, restarts the stack, re-runs the offline
checks. The instance directory is never touched by an upgrade — that
separation is the point of `docs/INSTANCE.md`. Roll back by checking out the
previous engine commit and running `manage up`.

## Watching it

| Where | What |
|---|---|
| `/` (run chip) | green or red for the last run |
| `/logs` | the daily entries and raw run output |
| `data/last-run.json` | per-step timing and the names of failed steps |
| `docs/daily-log.md` | the human-readable entry, one section a day |
| `manage logs` | container stdout, both services |

`modules.notifications` is macOS-only. On a server, notice failures by
watching the run chip, or add an `afterRun` hook that posts `last-run.json`
somewhere you look — Slack, email, a health-check ping. A hook that fires on
failure is three lines:

```json
"hooks": {
  "afterRun": [
    "grep -q '\"failures\": \"\"' data/last-run.json || curl -fsS -X POST -d @data/last-run.json \"$ALERT_WEBHOOK\""
  ]
}
```

## An agent can do all of this

`.claude/skills/n-seo-deploy/SKILL.md` walks an agent through choosing a
shape, running the scaffolding, verifying it, and handing you the console
steps it cannot do. It will not expose the dashboard for you, and it will not
print a secret.
