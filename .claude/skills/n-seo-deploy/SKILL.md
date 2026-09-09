---
name: n-seo-deploy
description: Deploy n-seo to a host that is always on — a VPS, a NAS, or a GCE VM — with the dashboard reachable only through a tunnel and the static mirror behind sign-in. Use when someone wants n-seo off their laptop, running on a schedule, or asks how to host it.
---

# Deploy n-seo to an always-on host

Read `docs/DEPLOY.md` for the reasoning. This is the procedure.

## Rules you may not break

1. **Never publish the dashboard's port to the internet, and never suggest
   it.** It has write endpoints, and its Settings page sets the LLM command
   the daily run executes — reaching it is running code on the host. Access
   is a tunnel (IAP, `ssh -L`, Tailscale) or a proxy that authenticates
   first. If the operator asks for a public dashboard, say what it exposes
   and offer the mirror or the Caddy overlay instead.
2. **Never print, echo, cat or commit a secret** — API keys, service-account
   JSON, `.env` contents. Reference paths, not values.
3. **Do not create paid cloud resources without explicit confirmation.** Run
   `./setup.sh --dry-run` first and show the operator what it would create.
4. **Do not invent gcloud flags.** If unsure, `gcloud <group> <cmd> --help`.

## 1. Establish what they have

Ask only what you cannot detect. Detect what you can:

```sh
command -v docker gcloud git node python3
gcloud config get-value project 2>/dev/null
uname -s
```

You need to know, in this order:

- **Where should it run?** An existing Linux box they can SSH to, a new GCE
  VM, or something else with Docker.
- **Is this a fresh instance, or an existing one to move?** If moving, the
  instance directory comes with them and step 4 becomes a copy, not an
  `init`.
- **Is the mirror wanted?** A read-only static copy others can see. Needs a
  bucket plus something to serve it.
- **On GCP already?** Decides `auth: "metadata"` (no key file) versus a
  mounted key.

## 2. Pick the shape

| They said | Do |
|---|---|
| "I have a VPS / NAS / server" | `deploy/vm/startup.sh` on that box |
| "We're on GCP" | `deploy/gcp/setup.sh`, then the VM steps |
| "Cloud Run" | Explain why the engine cannot: `export_static.py` finishes with an atomic directory rename and GCS FUSE has none. Offer the VM, and Cloud Run for the mirror only. |
| "Kubernetes" | Not scaffolded. The image and the volume contract are in `docker/README.md`; one Deployment plus one CronJob sharing a PVC is the shape. |

## 3. Run the scaffolding

**Any Linux box** (as root on that box):

```sh
curl -fsSLO https://raw.githubusercontent.com/en-dash-consulting/n-seo/main/deploy/vm/startup.sh
sudo bash startup.sh
```

**GCP** (from a checkout, on their workstation):

```sh
gcloud config set project THEIR_PROJECT
cd deploy/gcp
./setup.sh --dry-run          # show them this output, get a yes
./setup.sh
```

`setup.sh` creates the service account with Token Creator on itself, the
private mirror bucket, a data disk, a VM with no external IP, an IAP-only
firewall, and the Cloud Run mirror. It prints the manual steps at the end —
keep them for step 6.

## 4. The instance

Fresh:

```sh
sudo -u n-seo /opt/n-seo/manage init
sudo -u n-seo vi /srv/n-seo/instance/n-seo.config.json
```

Moving an existing one: copy the directory to `/srv/n-seo/instance`
(excluding `data/`, which regenerates), keep ownership as the `n-seo` user,
and confirm `n-seo.config.json`, `config/`, `content/` arrived.

Config points to settle, in order of how often they are wrong:

- `sites[]` — `gscProperty` is `sc-domain:example.com` for a domain property
  or `https://example.com/` for a url-prefix one. `ga4Property` is the
  numeric id from GA4 Admin → Property details, not the `G-` tag.
- `google.auth` — `"metadata"` on GCP (no key). Anywhere else,
  `"service-account-key"` with the key mounted read-only.
- `modules.llm` — on a headless host the `claude -p` CLI usually is not
  there. Use the HTTP path with `apiKeyEnv` and put the key in the
  instance's `.env`, or leave the module off and accept no proposals or
  briefings.
- `modules.staticExport` plus an `afterRun` hook if they want the mirror.
- `port` — leave it. The container publishes to loopback only.

## 5. Verify, in this order

```sh
sudo -u n-seo /opt/n-seo/manage doctor
sudo -u n-seo /opt/n-seo/manage daily --only probe    # no credentials needed
sudo -u n-seo /opt/n-seo/manage daily                 # the real run
sudo cat /srv/n-seo/instance/data/last-run.json       # failures should be ""
```

`doctor` failing on Search Console or GA4 before step 6 is expected — the
console grants have not happened yet. Everything else should pass.

Then confirm the dashboard, through a tunnel and never otherwise:

```sh
# GCP
gcloud compute start-iap-tunnel n-seo 4600 --local-host-port=localhost:4600 --zone ZONE
# anywhere
ssh -N -L 4600:localhost:4600 user@host
```

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4600/
curl -s http://localhost:4600/api/actions | head -c 200
```

## 6. Hand over what only they can do

These are console steps. List them explicitly; do not pretend they are done.

1. **Search Console** → Settings → Users and permissions → add the service
   account address with **Full**. If the UI rejects it on a domain property,
   point them at `docs/SETUP-GOOGLE.md` for the DNS-verification route.
2. **GA4** → Admin → Property access management → add the same address as
   **Viewer**.
3. **IAP members**, if the mirror is deployed:
   ```sh
   gcloud beta iap web add-iam-policy-binding \
     --resource-type=cloud-run --service=n-seo-mirror --region=REGION \
     --member='user:someone@example.com' \
     --role='roles/iap.httpsResourceAccessor'
   ```
4. **Re-run `manage doctor`** once those land. It should be all green.

## 7. Leave it healthy

- Confirm the scheduler service is up: `sudo -u n-seo /opt/n-seo/manage ps`.
  The daily time is `N_SEO_DAILY_AT` in `/srv/n-seo/.env` (default 07:00 in
  the host's `TZ`).
- Tell them where to look when it breaks: `/logs` on the dashboard,
  `data/last-run.json`, `manage logs`.
- Tell them the upgrade command: `sudo -u n-seo /opt/n-seo/manage upgrade`.
- Recommend the instance live in its own git repo (`docs/INSTANCE.md`) —
  that is the backup, and `gitAutoCommit` keeps it current.
- If they want failure alerts on a server, `modules.notifications` is
  macOS-only; offer the `afterRun` webhook hook in `docs/DEPLOY.md`.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `doctor` says the metadata token was rejected | the SA lacks `roles/iam.serviceAccountTokenCreator` **on itself**; `setup.sh` grants it, re-run that binding |
| Search Console 403 on every property | the SA was never added as a user in the console (step 6.1) |
| GA4 returns no rows | `ga4Property` is the `G-` tag instead of the numeric property id |
| Dashboard unreachable through the tunnel | container not up (`manage ps`), or the tunnel points at the wrong port |
| Scan and digests produce nothing | `modules.llm` is off, or the CLI is missing on a headless host — use the HTTP path |
| Mirror is empty | `staticExport` off, or the `afterRun` rsync hook missing or failing (check `data/last-run.json`) |
