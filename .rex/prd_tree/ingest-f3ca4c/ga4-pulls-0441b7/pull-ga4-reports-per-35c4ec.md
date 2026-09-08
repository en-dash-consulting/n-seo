---
id: "35c4ec84-ebba-4691-990f-45812a15e18e"
level: "task"
title: "Pull GA4 reports per configured property"
status: "completed"
priority: "high"
tags:
  - "ingest"
  - "ga4"
source: "manual"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "daily, sources, landing per configured property id"
  - "funnel only for conversions.site, falling back when the custom dimension is unregistered"
description: "ingest/pull_ga4.py uses numeric ids from the config; no measurement-id discovery."
---
