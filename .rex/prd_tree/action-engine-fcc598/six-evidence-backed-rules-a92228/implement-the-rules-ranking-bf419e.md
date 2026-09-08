---
id: "bf419e15-fcc7-4983-b0fa-9384e6f1a6b7"
level: "task"
title: "Implement the rules, ranking and backlog merge"
status: "completed"
priority: "high"
tags:
  - "engine"
  - "typescript"
source: "manual"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "Metadata findings, CTR gaps, striking distance, probe hygiene, engagement mismatch and traffic drop produce actions with id, host, title, kind, why, how, spec[], impact, effort, tag, source"
  - "Ranking is impact / effort weight (S=1, M=2.5, L=5)"
  - "Metadata findings suppress CTR-gap cards on the same page"
  - "Pages in shippedWatch render as watching"
  - "config/backlog.json is hot-reloaded without a restart and a syntax error keeps the last good queue"
description: "src/actions.ts and src/backlog.ts."
---
