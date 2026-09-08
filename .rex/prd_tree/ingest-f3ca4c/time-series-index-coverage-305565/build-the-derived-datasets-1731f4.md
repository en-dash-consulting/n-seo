---
id: "1731f438-d7c1-43d7-885e-3a2f571711bf"
level: "task"
title: "Build the derived datasets"
status: "completed"
priority: "high"
tags:
  - "ingest"
  - "analysis"
source: "manual"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "date × page series for 180 days from both sources"
  - "URL Inspection verdict for every sitemap URL (sitemap indexes followed one level, ≤400 URLs per host) with sitemap submission state"
  - "Metadata audit flags title/query mismatch, CTR below position expectation, missing/short/duplicate descriptions and long titles"
  - "Trend file with branded/generic split, rising/falling queries (84d vs prior 84d), monthly trajectory and AI-referral sessions by month"
description: "ingest/pull_timeseries.py, pull_index_status.py, analyze_metadata.py, analyze_trends.py."
---
