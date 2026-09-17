---
id: "c5ef6df9-de23-4c6b-8399-a04728f02598"
level: "feature"
title: "Search Console pulls"
status: "completed"
source: "manual"
startedAt: "2026-09-08T03:58:58.700Z"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "per property, `queries`, `pages`, `query_page`, `dates` for the 16-month window and `*_90d` for the trailing 90 days; transient failures retried; a 4xx fails loudly."
  - "`gscExtraProperties` are pulled into `data/gsc/<slug>` without appearing in the UI."
description: "16-month and trailing-90-day datasets per property, with retry."
---
