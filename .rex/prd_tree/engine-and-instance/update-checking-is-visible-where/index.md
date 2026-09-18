---
id: "a8265c4b-7271-4d3e-abd8-045534dbbdea"
level: "feature"
title: "Update checking is visible where people schedule things"
status: "completed"
source: "manual"
startedAt: "2026-09-18T02:55:30.427Z"
completedAt: "2026-09-18T02:55:30.427Z"
endedAt: "2026-09-18T02:55:30.427Z"
acceptanceCriteria:
  - "docs/SCHEDULING.md says the daily run already carries the update check, so a reader setting up scheduling does not add a second job for it."
  - "The Upgrades section of docs/DEPLOY.md points at data/update-check.json and the Settings page rather than implying the only way to learn about a release is to go and look."
description: "The capability already shipped: modules.updateCheck runs as a step in ops/daily.py, is the only module enabled by default, queries the registry once a day and writes data/update-check.json, which the Settings page and doctor both read. What was missing was saying so where someone goes to set up scheduling — docs/SCHEDULING.md and the Upgrades section of docs/DEPLOY.md described the daily run and the manual upgrade command without mentioning that update checking is already part of the former."
lastModified: "2026-09-18T02:55:30.437Z"
---

## Children

| Title | Status |
|-------|--------|
| [Say in SCHEDULING.md and DEPLOY.md that the daily run already checks](./say-in-scheduling-md-and-deploy-md.md) | completed |
