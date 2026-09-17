---
id: "11b67178-7350-44ec-b56e-21e57fada306"
level: "feature"
title: "Module gating and the local LLM command"
status: "completed"
source: "manual"
startedAt: "2026-09-08T03:58:58.700Z"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "each of indexStatus, metadataAudit, opportunityScan, llm, hackerNews, reddit, indexNow, staticExport, gitAutoCommit, notifications, updateCheck is gated by `modules.<key>.enabled`; a disabled digest exits 0 with a message."
  - "`updateCheck` is the only module enabled by default. It writes `data/update-check.json`, exits 0 when the registry is unreachable without disturbing the previous result, and makes no request at all when disabled."
  - "the LLM module runs any command that reads a prompt on stdin; when unavailable, the scan records candidates only and digests skip briefings."
  - "briefing prompts forbid generating comment text."
description: "Every optional capability is off until enabled; the LLM is any stdin CLI."
---
