---
id: "b54a95e4-d798-4b71-b530-dc2c6afc555c"
level: "feature"
title: "Read-only MCP over stdio and authenticated HTTP"
status: "completed"
source: "manual"
startedAt: "2026-09-08T03:58:58.700Z"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "stdio transport with no secret; HTTP transport that returns 503 with no token configured and compares tokens in constant time."
  - "every tool is annotated read-only; tools cover the queue, a single action, sites, per-site report, top queries, striking distance, CTR gaps, metadata audit, time series, ops status, daily log, proposals, conversions, campaigns, settings and engine info; docs exposed as resources."
description: "The same data for agents, without a way around the owner's gates."
---
