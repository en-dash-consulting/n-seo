---
id: "b7387750-db8f-493f-9cca-de6cd602ad62"
level: "feature"
title: "No-auth health probe with regression alerts"
status: "completed"
source: "manual"
startedAt: "2026-09-08T03:58:58.700Z"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "robots.txt (incl. AI-crawler disallows), sitemap.xml, llms.txt and llms-full.txt, homepage metadata/JSON-LD/visible-text bytes, and a real 404 check, per configured host, written as a timestamped snapshot."
  - "the daily diff raises an ALERT line on any regression versus the previous snapshot."
description: "robots, sitemap, llms.txt, homepage metadata, soft-404 check per host; the daily diff alerts on regressions."
---
