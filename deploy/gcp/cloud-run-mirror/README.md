# The static mirror

`modules.staticExport` writes `<instance>/site/` after each daily run, an
`afterRun` hook copies it to a bucket, and this serves the bucket behind IAP.
Read-only HTML: no application, no data, nothing to attack.

Deployed for you by `deploy/gcp/setup.sh`. By hand:

```sh
gcloud beta run deploy n-seo-mirror \
  --source=. \
  --region=us-east1 \
  --no-allow-unauthenticated \
  --iap \
  --service-account=n-seo-engine@PROJECT.iam.gserviceaccount.com \
  --add-volume=name=mirror,type=cloud-storage,bucket=PROJECT-n-seo-mirror,readonly=true \
  --add-volume-mount=volume=mirror,mount-path=/usr/share/nginx/html
```

Then grant people access:

```sh
gcloud beta iap web add-iam-policy-binding \
  --resource-type=cloud-run --service=n-seo-mirror --region=us-east1 \
  --member='domain:example.com' \
  --role='roles/iap.httpsResourceAccessor'
```

The hook that fills the bucket, in the instance's `n-seo.config.json`:

```json
"modules": { "staticExport": { "enabled": true } },
"hooks": {
  "afterRun": [
    "gcloud storage rsync site gs://PROJECT-n-seo-mirror --recursive --delete-unmatched-destination-objects"
  ]
}
```

The VM's attached service account already has `roles/storage.objectAdmin` on
that bucket, so the hook needs no credentials of its own.

## Why not just a bucket website

You can, but a bucket configured as a website has to be public, and this
content is your search data. Cloud Run in front of a read-only mounted bucket
keeps IAP as the gate. If you would rather not run the service, an
alternative is to leave the bucket private and read it with
`gcloud storage cp` when you want it, skipping the mirror entirely
(`DEPLOY_MIRROR=no ./setup.sh`).

## Redeploys

Only when this nginx config changes. Content updates land in the bucket and
appear within seconds; the container never rebuilds for them.
