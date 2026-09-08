---
id: "d1b29de8-bd0d-4598-9959-05ccf06f38e3"
level: "task"
title: "Pull queries, pages, query×page and dates per property"
status: "completed"
priority: "high"
tags:
  - "ingest"
  - "gsc"
source: "manual"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "Per property: queries, pages, query_page, dates for 16 months and *_90d for the trailing 90 days"
  - "Transient failures are retried; a 4xx fails loudly"
  - "gscExtraProperties are pulled into data/gsc/<slug> without appearing in the UI"
description: "ingest/pull_gsc.py over ingest/http_util.py; inaccessible properties are skipped with the service-account email named."
---
