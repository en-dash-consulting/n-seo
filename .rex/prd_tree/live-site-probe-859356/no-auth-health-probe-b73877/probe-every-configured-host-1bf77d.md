---
id: "1bf77dcd-0921-41c4-aa24-2a23c97f8c66"
level: "task"
title: "Probe every configured host and diff against the previous snapshot"
status: "completed"
priority: "high"
tags:
  - "probe"
source: "manual"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "robots.txt (incl. AI-crawler disallows), sitemap.xml, llms.txt and llms-full.txt, homepage metadata/JSON-LD/visible-text bytes and a real-404 check per configured host, written as a timestamped snapshot"
  - "The daily diff raises an ALERT line on any regression versus the previous snapshot"
description: "probes/site_probe.py and ops/daily_diff.py."
---
