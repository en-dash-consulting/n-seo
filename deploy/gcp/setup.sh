#!/usr/bin/env bash
# Provision the GCP side of an n-seo deployment.
#
# What this creates (all idempotent — safe to re-run):
#   1. a service account for the engine, with Token Creator on itself so
#      `google.auth: "metadata"` can mint scoped Search Console / GA4 tokens
#   2. a GCS bucket for the exported static mirror, private
#   3. a persistent data disk and a GCE VM with the SA attached and NO
#      external IP — the engine host
#   4. a firewall posture that allows IAP SSH only, nothing else inbound
#   5. optionally, the Cloud Run service that serves the mirror behind IAP
#
# It does NOT: grant the SA access in Search Console or GA4, or add IAP
# members. Those are console steps and are printed at the end.
#
#   ./setup.sh --dry-run     print every command, change nothing
#   ./setup.sh               do it
#
set -euo pipefail

# ---------------------------------------------------------------- settings --
PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${REGION:-us-east1}"
ZONE="${ZONE:-${REGION}-b}"

SA_NAME="${SA_NAME:-n-seo-engine}"
SA_EMAIL="${SA_EMAIL:-${SA_NAME}@${PROJECT}.iam.gserviceaccount.com}"

VM_NAME="${VM_NAME:-n-seo}"
VM_TYPE="${VM_TYPE:-e2-small}"
VM_IMAGE_FAMILY="${VM_IMAGE_FAMILY:-debian-12}"
VM_IMAGE_PROJECT="${VM_IMAGE_PROJECT:-debian-cloud}"
VM_TAG="${VM_TAG:-n-seo}"

DATA_DISK="${DATA_DISK:-${VM_NAME}-data}"
DATA_DISK_SIZE="${DATA_DISK_SIZE:-20GB}"
DATA_DISK_TYPE="${DATA_DISK_TYPE:-pd-balanced}"

MIRROR_BUCKET="${MIRROR_BUCKET:-${PROJECT}-n-seo-mirror}"
MIRROR_SERVICE="${MIRROR_SERVICE:-n-seo-mirror}"
DEPLOY_MIRROR="${DEPLOY_MIRROR:-yes}"   # "no" to skip the Cloud Run mirror

# The engine repo the VM startup script clones. Point at your fork if you
# have one; point at your instance repo separately (see deploy/vm/README.md).
ENGINE_REPO="${ENGINE_REPO:-https://github.com/en-dash-consulting/n-seo}"

DRY_RUN="no"
[ "${1:-}" = "--dry-run" ] && DRY_RUN="yes"

# ------------------------------------------------------------------ helpers --
say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }

# Print the command, shell-quoted so a dry run can be pasted verbatim, then
# run it unless --dry-run. Used for everything that writes.
run() {
  printf '  $'
  printf ' %q' "$@"
  printf '\n'
  [ "$DRY_RUN" = "yes" ] && return 0
  "$@"
}

# True if a read-only lookup succeeds. Never fails the script.
exists() { "$@" >/dev/null 2>&1; }

[ -n "$PROJECT" ] || { echo "Set PROJECT= or run: gcloud config set project <id>" >&2; exit 2; }

say "n-seo GCP setup"
note "project        $PROJECT"
note "region/zone    $REGION / $ZONE"
note "service acct   $SA_EMAIL"
note "VM             $VM_NAME ($VM_TYPE, $VM_IMAGE_FAMILY, no external IP)"
note "data disk      $DATA_DISK ($DATA_DISK_SIZE $DATA_DISK_TYPE)"
note "mirror bucket  gs://$MIRROR_BUCKET"
note "mirror service $([ "$DEPLOY_MIRROR" = yes ] && echo "$MIRROR_SERVICE (Cloud Run, IAP)" || echo "(skipped)")"
[ "$DRY_RUN" = "yes" ] && note "DRY RUN — nothing will be created"

# ------------------------------------------------------------------- APIs ---
say "1. Enabling APIs"
run gcloud services enable \
  compute.googleapis.com \
  iamcredentials.googleapis.com \
  storage.googleapis.com \
  searchconsole.googleapis.com \
  analyticsdata.googleapis.com \
  analyticsadmin.googleapis.com \
  iap.googleapis.com \
  --project "$PROJECT"

# --------------------------------------------------------- service account ---
say "2. Service account"
if exists gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT"; then
  note "$SA_EMAIL already exists"
else
  run gcloud iam service-accounts create "$SA_NAME" \
    --display-name="n-seo engine" \
    --description="Reads Search Console and GA4 for n-seo; writes the static mirror" \
    --project "$PROJECT"
fi

# The engine authenticates as this SA from the VM metadata server, but that
# token is cloud-platform scoped and Search Console rejects it. The engine
# therefore asks IAM Credentials for a *scoped* token for this same SA, which
# requires the SA to be able to impersonate itself.
note "granting Token Creator on itself (required by google.auth: \"metadata\")"
run gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project "$PROJECT"

# ----------------------------------------------------------------- bucket ---
say "3. Mirror bucket"
if exists gcloud storage buckets describe "gs://$MIRROR_BUCKET" --project "$PROJECT"; then
  note "gs://$MIRROR_BUCKET already exists"
else
  run gcloud storage buckets create "gs://$MIRROR_BUCKET" \
    --location="$REGION" \
    --uniform-bucket-level-access \
    --public-access-prevention \
    --project "$PROJECT"
fi
note "letting the engine write the exported mirror"
run gcloud storage buckets add-iam-policy-binding "gs://$MIRROR_BUCKET" \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/storage.objectAdmin" \
  --project "$PROJECT"

# ------------------------------------------------------------------- disk ---
say "4. Data disk"
if exists gcloud compute disks describe "$DATA_DISK" --zone "$ZONE" --project "$PROJECT"; then
  note "$DATA_DISK already exists"
else
  run gcloud compute disks create "$DATA_DISK" \
    --size="$DATA_DISK_SIZE" --type="$DATA_DISK_TYPE" \
    --zone "$ZONE" --project "$PROJECT"
fi

# --------------------------------------------------------------- firewall ---
say "5. Firewall (IAP SSH only, no other ingress)"
if exists gcloud compute firewall-rules describe "allow-iap-ssh-$VM_TAG" --project "$PROJECT"; then
  note "allow-iap-ssh-$VM_TAG already exists"
else
  # 35.235.240.0/20 is Google's IAP TCP forwarding range.
  run gcloud compute firewall-rules create "allow-iap-ssh-$VM_TAG" \
    --direction=INGRESS --action=ALLOW --rules=tcp:22 \
    --source-ranges=35.235.240.0/20 --target-tags="$VM_TAG" \
    --project "$PROJECT"
fi
note "the dashboard port is deliberately NOT opened — reach it over the IAP tunnel"

# --------------------------------------------------------------------- VM ---
say "6. VM"
STARTUP="$(cd "$(dirname "$0")/../vm" && pwd)/startup.sh"
[ -f "$STARTUP" ] || { echo "missing $STARTUP" >&2; exit 1; }

if exists gcloud compute instances describe "$VM_NAME" --zone "$ZONE" --project "$PROJECT"; then
  note "$VM_NAME already exists — not recreating."
  note "to re-run the startup script on it:"
  note "  gcloud compute ssh $VM_NAME --zone $ZONE --tunnel-through-iap --project $PROJECT \\"
  note "    --command 'sudo google_metadata_script_runner startup'"
else
  run gcloud compute instances create "$VM_NAME" \
    --machine-type="$VM_TYPE" \
    --image-family="$VM_IMAGE_FAMILY" --image-project="$VM_IMAGE_PROJECT" \
    --boot-disk-size=20GB --boot-disk-type=pd-balanced \
    --disk="name=$DATA_DISK,device-name=n-seo-data,mode=rw,auto-delete=no" \
    --service-account="$SA_EMAIL" \
    --scopes=https://www.googleapis.com/auth/cloud-platform \
    --no-address \
    --tags="$VM_TAG" \
    --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
    --metadata="engine-repo=$ENGINE_REPO,mirror-bucket=$MIRROR_BUCKET" \
    --metadata-from-file="startup-script=$STARTUP" \
    --zone "$ZONE" --project "$PROJECT"
fi

# ----------------------------------------------------------- mirror service --
if [ "$DEPLOY_MIRROR" = "yes" ]; then
  say "7. Mirror service (Cloud Run, IAP, reads the bucket read-only)"
  MIRROR_DIR="$(cd "$(dirname "$0")/cloud-run-mirror" && pwd)"
  run gcloud beta run deploy "$MIRROR_SERVICE" \
    --source="$MIRROR_DIR" \
    --region="$REGION" \
    --no-allow-unauthenticated \
    --iap \
    --service-account="$SA_EMAIL" \
    --add-volume="name=mirror,type=cloud-storage,bucket=$MIRROR_BUCKET,readonly=true" \
    --add-volume-mount="volume=mirror,mount-path=/usr/share/nginx/html" \
    --project "$PROJECT"
else
  say "7. Mirror service — skipped (DEPLOY_MIRROR=no)"
fi

# ------------------------------------------------------------ what is left --
say "Done. Four things remain that cannot be scripted:"
cat <<EOF

  1. Search Console — give the service account access to every property.
     https://search.google.com/search-console → Settings → Users and
     permissions → Add user:

         $SA_EMAIL      (permission: Full)

     Domain properties sometimes refuse a service-account address in that UI.
     If yours does, verify the SA as an owner instead via the Site
     Verification API (DNS TXT). docs/SETUP-GOOGLE.md walks through it.

  2. GA4 — Admin → Property access management → add, with role Viewer:

         $SA_EMAIL

  3. IAP members — who may open the mirror. For each person or group:

         gcloud beta iap web add-iam-policy-binding \\
           --resource-type=cloud-run --service=$MIRROR_SERVICE \\
           --region=$REGION \\
           --member='user:someone@example.com' \\
           --role='roles/iap.httpsResourceAccessor' \\
           --project $PROJECT

  4. The instance itself — the VM has the engine and Docker, but your config,
     queue and content are yours. See deploy/vm/README.md. In short:

         gcloud compute ssh $VM_NAME --zone $ZONE --tunnel-through-iap --project $PROJECT
         sudo -u n-seo /opt/n-seo/manage init      # scaffold /srv/n-seo/instance
         sudo -u n-seo vi /srv/n-seo/instance/n-seo.config.json
         sudo -u n-seo /opt/n-seo/manage doctor

     Set "google": { "auth": "metadata" } in that config — no key file.

  Reaching the dashboard (it is never exposed; tunnel to it):

         gcloud compute start-iap-tunnel $VM_NAME 4600 \\
           --local-host-port=localhost:4600 --zone $ZONE --project $PROJECT
         open http://localhost:4600

EOF
