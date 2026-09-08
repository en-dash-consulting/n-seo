---
id: "c6fbf8ab-a0dd-46e5-91af-d6e511201a8e"
level: "task"
title: "Share one JSON config between TypeScript and Python"
status: "completed"
priority: "high"
tags:
  - "config"
source: "manual"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "Adding a site to sites[] makes it appear in every pull, probe, audit, page and export with no other edit"
  - "Both loaders derive the same data/gsc directory from a property (sc-domain and url-prefix forms)"
  - "Unknown keys are preserved when the Settings page saves"
description: "src/config.ts and ingest/seo_config.py normalize the same file; gscSlug parity is unit-tested in both languages."
---
