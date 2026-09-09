# The engine host

One Linux box with Docker. A GCE VM, a VPS, a NAS, a spare machine in a
cupboard — `startup.sh` does not care which.

```
/opt/n-seo/engine     the checkout (code)        — replaceable, upgraded by git
/opt/n-seo/manage     the wrapper you type
/srv/n-seo/instance   your config, queue, content, data  — THIS is what matters
/srv/n-seo/.env       host settings (TZ, N_SEO_DAILY_AT)
```

On GCE, `/srv/n-seo` is a separate persistent disk, so the box is disposable
and the disk is the thing you snapshot.

## Install

```sh
curl -fsSLO https://raw.githubusercontent.com/en-dash-consulting/n-seo/main/deploy/vm/startup.sh
sudo bash startup.sh
```

Or, from a checkout, `sudo ./deploy/vm/startup.sh`. On GCE it runs itself as
the startup script — `deploy/gcp/setup.sh` passes it in.

It is idempotent. Re-run it to update the engine and restart the stack.

Environment it honours: `ENGINE_REPO` (default upstream; set it to your
fork), `ENGINE_DIR`, `STATE_DIR`, `INSTANCE_DIR`, `RUN_USER`, `DATA_DEVICE`,
`TZ`. On GCE it also reads `engine-repo` and `mirror-bucket` from instance
metadata.

## First run

```sh
sudo -u n-seo /opt/n-seo/manage init          # scaffold /srv/n-seo/instance
sudo -u n-seo vi /srv/n-seo/instance/n-seo.config.json
sudo -u n-seo /opt/n-seo/manage doctor        # verify Google access
sudo -u n-seo /opt/n-seo/manage daily --only probe   # cheap, no credentials
sudo -u n-seo /opt/n-seo/manage daily         # the real thing
```

On GCP, set the auth mode to use the VM's own service account — no key file
anywhere on the box:

```json
"google": { "auth": "metadata" }
```

Anywhere else, mount a service-account key read-only and point
`google.serviceAccountKey` at it. It never belongs in the image or in git.

## Commands

| | |
|---|---|
| `manage up` / `down` / `restart` / `ps` | the stack |
| `manage logs` | follow both services |
| `manage daily [args]` | run the pipeline now (`--only probe,gsc`, `--list`) |
| `manage doctor` | setup check |
| `manage export` | rebuild `site/` |
| `manage version` | which engine commit is running |
| `manage upgrade` | `git pull`, rebuild, restart, re-check |
| `manage shell` | a shell inside the image |

## Reaching the dashboard

**Never publish its port.** It has write endpoints, and its Settings page
sets a command that the daily run executes. Anyone who can reach it can run
code on this box.

Pick a tunnel:

```sh
# GCP, no external IP needed
gcloud compute start-iap-tunnel n-seo 4600 \
  --local-host-port=localhost:4600 --zone us-east1-b

# any box you can SSH to
ssh -N -L 4600:localhost:4600 you@your-host

# tailscale, if the box is on your tailnet
# (reach it at http://n-seo:4600 with no tunnel at all)
```

Then open <http://localhost:4600>.

If you genuinely need a hostname and a login page instead of a tunnel, the
engine ships a Caddy overlay with basic auth — see `docker/README.md`. Put
something in front of it either way.

## Backups

Everything that matters is `/srv/n-seo/instance`, and most of it is already
in git if you keep the instance in its own repo (recommended:
`docs/INSTANCE.md`). `data/` is regenerable by the next run.

```sh
# GCE: snapshot the disk
gcloud compute disks snapshot n-seo-data --zone us-east1-b

# anywhere: tar the instance minus the regenerable parts
sudo tar czf n-seo-instance-$(date +%F).tgz \
  --exclude=data --exclude=site -C /srv/n-seo instance
```

Restore: put the directory back, `manage up`, then `manage daily` to refill
`data/`.

## Watching it

```sh
sudo -u n-seo /opt/n-seo/manage logs
sudo cat /srv/n-seo/instance/data/last-run.json     # per-step timing, failures
sudo tail -40 /srv/n-seo/instance/docs/daily-log.md # the human-readable entry
```

The dashboard's `/logs` page shows both, and the run-status chip on `/` turns
red when the last run had a failing step.

## Upgrades

```sh
sudo -u n-seo /opt/n-seo/manage upgrade
```

Pulls the engine, rebuilds the image, restarts, runs `doctor --offline`. Your
instance directory is not touched. If a rebuild goes wrong, check out the
previous commit in `/opt/n-seo/engine` and run `manage up` again.
