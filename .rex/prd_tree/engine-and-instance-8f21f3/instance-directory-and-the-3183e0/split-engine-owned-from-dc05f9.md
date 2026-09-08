---
id: "dc05f954-aa1c-406b-bdcb-1b4a3f9d70a1"
level: "task"
title: "Split engine-owned from instance-owned paths and ship the CLI"
status: "completed"
priority: "high"
tags:
  - "instance"
  - "cli"
source: "manual"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "N_SEO_INSTANCE relocates every instance-owned path; in-place mode is unchanged when it is unset"
  - "n-seo init|start|dev|daily|doctor|demo|mcp|check|export|upgrade|version behave as documented in docs/INSTANCE.md"
  - "n-seo upgrade refuses to leave the engine on a commit that fails npm run check without printing the rollback command"
description: "src/config.ts, ingest/seo_config.py, bin/n-seo.mjs, docs/INSTANCE.md."
---
