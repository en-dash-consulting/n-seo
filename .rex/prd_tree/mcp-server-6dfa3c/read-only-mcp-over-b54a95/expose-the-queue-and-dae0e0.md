---
id: "dae0e01e-89fc-4c33-b95e-c6f5b0c887ba"
level: "task"
title: "Expose the queue and metrics as read-only tools"
status: "completed"
priority: "high"
tags:
  - "mcp"
  - "security"
source: "manual"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "stdio transport with no secret; HTTP transport returns 503 with no token configured and compares tokens in constant time"
  - "Every tool is annotated read-only; tools cover the queue, a single action, sites, per-site report, top queries, striking distance, CTR gaps, metadata audit, time series, ops status, daily log, proposals, conversions, campaigns, settings and engine info"
  - "Docs are exposed as resources"
description: "src/mcp.ts, src/mcp-stdio.ts, POST /mcp in src/server.tsx."
---
