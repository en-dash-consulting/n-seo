---
id: "305565de-3c4f-482f-b5d3-ac8e8deb5028"
level: "feature"
title: "Time series, index coverage, metadata audit and trend analysis"
status: "completed"
source: "manual"
startedAt: "2026-09-08T03:58:58.700Z"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "date × page series for 180 days from both sources."
  - "URL Inspection verdict for every sitemap URL (sitemap indexes followed one level, ≤400 URLs/host), with sitemap submission state."
  - "each coverage state renders with what it means, what to do about it, and whether Request Indexing helps — true only where Google has formed no judgement on the content (unknown, discovered-never-crawled), false where it fetched and declined (soft 404, crawled-not-indexed)."
  - "metadata audit flags title/query mismatch, CTR below position expectation, missing/short/duplicate descriptions, long titles."
  - "trend file with branded/generic split, rising/falling queries (84d vs prior 84d), monthly trajectory and AI-referral sessions by month."
description: "The derived datasets the dashboard and the action engine read."
---
