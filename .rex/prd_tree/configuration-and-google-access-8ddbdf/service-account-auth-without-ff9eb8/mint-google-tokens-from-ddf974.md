---
id: "ddf97419-49d7-4d65-aee9-a6c51738ac15"
level: "task"
title: "Mint Google tokens from a service-account key with openssl"
status: "completed"
priority: "high"
tags:
  - "auth"
  - "python"
source: "manual"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "python3 ingest/google_auth.py mints a token and lists accessible properties with only a key file and openssl on PATH"
  - "gcloud-impersonate and gcloud-user modes remain selectable"
  - "ops/doctor.py reports the exact email to add in Search Console and GA4 and which configured properties are not yet accessible"
description: "ingest/google_auth.py builds the OAuth JWT, signs it via openssl dgst, exchanges it at token_uri, caches per scope."
---
