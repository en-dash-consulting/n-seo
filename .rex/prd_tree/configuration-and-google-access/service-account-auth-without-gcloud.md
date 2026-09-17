---
id: "ff9eb879-fdc8-4005-8999-b764287be4b1"
level: "feature"
title: "Service-account auth without gcloud"
status: "completed"
source: "manual"
startedAt: "2026-09-08T03:58:58.700Z"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "with only a service-account JSON key, `n-seo doctor` mints a token and lists accessible properties. No gcloud, no pip install and no openssl binary: the JWT is signed with node's crypto module, which the dashboard already requires."
  - "gcloud impersonation and gcloud user modes remain selectable."
  - "`ops/doctor.py` reports the exact email to add in Search Console and GA4 and which configured properties are not yet accessible."
description: "A service-account JSON key signed locally with the openssl CLI; gcloud modes remain optional."
---
