---
id: "a922288c-30cf-490e-a654-45568a2a5194"
level: "feature"
title: "Six evidence-backed rules merged with a curated queue"
status: "completed"
source: "manual"
startedAt: "2026-09-08T03:58:58.700Z"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "six rules over the 90-day window (metadata findings, CTR gaps, striking distance, probe hygiene, engagement mismatch, traffic drop) produce actions with id, host, title, kind, why, how, spec[], impact, effort, tag, source."
  - "ranking is impact / effort weight (S=1, M=2.5, L=5)."
  - "metadata findings suppress CTR-gap cards on the same page."
  - "pages in `shippedWatch` render as *watching*."
  - "`config/backlog.json` is merged and hot-reloaded without a restart, and a syntax error keeps the last good queue."
description: "Rules over the 90-day window produce ranked actions; config/backlog.json is merged and hot-reloaded."
---
