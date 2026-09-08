---
id: "ca784a55-4bbc-42f1-b51f-78577ee3af15"
level: "task"
title: "Gate every optional step and degrade without an LLM"
status: "completed"
priority: "high"
tags:
  - "modules"
source: "manual"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "Each of indexStatus, metadataAudit, opportunityScan, llm, hackerNews, reddit, indexNow, staticExport, gitAutoCommit, notifications is gated by modules.<key>.enabled; a disabled digest exits 0 with a message"
  - "The LLM module runs any command that reads a prompt on stdin; when unavailable the scan records candidates only and digests skip briefings"
  - "Briefing prompts forbid generating comment text"
description: "ops/llm.py, ops/hn_digest.py, ops/reddit_digest.py, ops/opportunity_scan.py."
---
