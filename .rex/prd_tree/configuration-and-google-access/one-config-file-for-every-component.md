---
id: "32b69e1c-c81f-44a2-91bd-bfacb0f7cffb"
level: "feature"
title: "One config file for every component"
status: "completed"
source: "manual"
startedAt: "2026-09-08T03:58:58.700Z"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "adding a site to `sites[]` makes it appear in every pull, probe, audit, page and export with no other edit."
  - "both loaders derive the same `data/gsc/<slug>` from a property (`sc-domain:` and url-prefix forms)."
  - "unknown keys are preserved when the Settings page saves."
description: "n-seo.config.json (N_SEO_CONFIG override) is read by the TypeScript app and every Python script; the example is the fallback."
---
