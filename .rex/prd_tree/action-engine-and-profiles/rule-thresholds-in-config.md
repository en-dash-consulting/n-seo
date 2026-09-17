---
id: "56d266b3-1c88-435a-9d3d-8d1ec4b49962"
level: "feature"
title: "Rule thresholds in config"
status: "completed"
source: "manual"
startedAt: "2026-09-17T16:21:45.225Z"
completedAt: "2026-09-17T16:21:45.225Z"
endedAt: "2026-09-17T16:21:45.225Z"
acceptanceCriteria:
  - "every threshold the action engine ranks by lives in `rules`, with the engine defaults documented in `src/config.ts` and mirrored in `ingest/seo_config.py`; tests cover an override changing a rule's output."
description: "Move the numeric thresholds into an optional rules block with the current values as defaults."
lastModified: "2026-09-17T16:21:45.235Z"
---
