# Running n-seo in a container

The image is the **engine only**. Everything of yours — config, curated queue,
content, snapshots, the daily log — lives in the **instance** directory mounted
at `/instance`. Upgrading is pulling a new image; nothing of yours is inside it.

## Security, first

The dashboard is not a read-only report. It writes `n-seo.config.json`, and the
config names the command the daily run executes. **Anyone who can reach the
dashboard can run code on this host at the next daily run.**

So: the container publishes nothing by itself, `docker/compose.yml` binds the
port to `127.0.0.1`, and the moment you want it reachable from elsewhere you put
an authenticating proxy in front (`docker/compose.caddy.yml`) or an identity
proxy you already run — Cloudflare Access, Tailscale, oauth2-proxy, Google IAP.
Do not publish `4600:4600`.

The engine also refuses cross-origin `POST`s by comparing `Origin` against
`Host`, so keep your proxy forwarding the original `Host` header. Caddy does by
default.

## Quick start

```sh
docker build -t n-seo:latest .                      # from the repo root
docker volume create n-seo-instance

# scaffold the instance once, with the volume mounted
docker run --rm -v n-seo-instance:/instance n-seo:latest init

# edit the config (sites + Google access) — see "editing the config" below
docker run --rm -v n-seo-instance:/instance n-seo:latest doctor

# synthetic data, so you can see it work before wiring Google up
docker run --rm -v n-seo-instance:/instance n-seo:latest demo

docker run -d --name n-seo \
  -p 127.0.0.1:4600:4600 \
  -v n-seo-instance:/instance \
  n-seo:latest
```

Then open <http://127.0.0.1:4600>.

## With compose (dashboard + scheduler)

```sh
docker compose -f docker/compose.yml run --rm dashboard init
docker compose -f docker/compose.yml up -d
```

Two services share one volume: `dashboard` serves the UI, `scheduler` runs the
daily job at `N_SEO_DAILY_AT` (default `07:00`) in `TZ`. Set both in a `.env`
beside the compose file or in your shell:

```sh
TZ=America/New_York
N_SEO_DAILY_AT=07:00
```

To expose it properly, add the Caddy overlay — TLS and a password, and the
dashboard stops publishing a host port entirely:

```sh
export N_SEO_SITE_ADDRESS=seo.example.com
export N_SEO_BASIC_USER=you
export N_SEO_BASIC_HASH="$(docker run --rm caddy:2 caddy hash-password --plaintext 'your-password')"
docker compose -f docker/compose.yml -f docker/compose.caddy.yml up -d
```

(The `!reset` in the overlay needs Compose v2.24 or newer. On older versions,
delete the `ports:` block from `compose.yml` by hand instead.)

## Commands

The entrypoint takes a verb and passes anything else through to the CLI:

| Command | What it does |
|---|---|
| `serve` (default) | the dashboard; binds `0.0.0.0` in the container, honours `PORT` |
| `daily` | one full run; extra args pass through (`daily --only probe`) |
| `cron` | sleep until `N_SEO_DAILY_AT`, run `daily`, repeat |
| `init` | scaffold the instance into the mounted volume |
| `doctor` | setup checker (`doctor --offline` skips network checks) |
| `demo` | synthetic dataset for the configured sites |
| `export`, `mcp`, `version`, … | passed straight to `n-seo` |

`serve`, `daily` and `cron` refuse to start with exit code 78 when
`/instance/n-seo.config.json` is missing, rather than quietly running against
the example config.

For a shell in the image, bypass the entrypoint:

```sh
docker run --rm -it --entrypoint bash n-seo:latest
```

## Google access

Two options.

**On GCP** (Cloud Run, GCE, GKE): set `google.auth` to `metadata` and mount no
key at all. The runtime service account is the identity.

**Anywhere else**: mount a service-account JSON key read-only and point
`google.serviceAccountKey` at the container path.

```yaml
volumes:
  - /host/path/service-account.json:/run/secrets/google-sa.json:ro
```

```json
"google": { "auth": "service-account-key", "serviceAccountKey": "/run/secrets/google-sa.json" }
```

Never bake a key into the image and never commit one. `.dockerignore` already
excludes `.env` and `n-seo.config.json` from the build context.

## Editing the config

The config lives in the volume, not the repo. Either mount the instance as a
host directory instead of a named volume:

```sh
docker run -d -p 127.0.0.1:4600:4600 -v "$HOME/n-seo-instance:/instance" n-seo:latest
```

…and edit it with your normal editor, or edit it in place:

```sh
docker run --rm -it -v n-seo-instance:/instance --entrypoint bash n-seo:latest
```

The dashboard's Settings page can also toggle modules and edit the free-text
fields for you.

## Backups

Everything that matters is the instance volume, and `data/` inside it is
regenerable by the next run. What you actually want to keep is
`n-seo.config.json`, `config/`, `content/` and `docs/daily-log.md`:

```sh
docker run --rm -v n-seo-instance:/instance -v "$PWD:/backup" \
  --entrypoint tar n-seo:latest \
  -czf /backup/n-seo-instance.tgz -C /instance \
  n-seo.config.json config content docs
```

The instance is a good candidate for its own git repo — see `docs/INSTANCE.md`.

## Upgrading

Rebuild or pull a new image and recreate the containers. The volume is
untouched.

```sh
git -C <engine checkout> pull --ff-only
docker compose -f docker/compose.yml build
docker compose -f docker/compose.yml up -d
```

`n-seo upgrade` is for a git checkout on a host, not for the container — inside
the image there is no `.git`, so it will tell you to update the package instead.
In a container the image *is* the version.

## Image contents

`node:22-bookworm-slim` plus `python3`, `curl`, `openssl`, `ca-certificates` and
`tini`. No pip installs: the pipeline is stdlib-only Python. Runs as the
unprivileged `node` user (uid 1000), which owns `/instance`. Roughly 330 MB.
