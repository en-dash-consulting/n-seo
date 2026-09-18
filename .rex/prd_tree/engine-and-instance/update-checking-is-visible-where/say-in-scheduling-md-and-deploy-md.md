---
id: "437e0f82-d09c-4a05-aa6f-fbb8b828c613"
level: "task"
title: "Say in SCHEDULING.md and DEPLOY.md that the daily run already checks"
status: "completed"
priority: "low"
startedAt: "2026-09-18T02:55:30.364Z"
completedAt: "2026-09-18T02:55:30.364Z"
endedAt: "2026-09-18T02:55:30.364Z"
acceptanceCriteria:
  - "docs/SCHEDULING.md names the update-check step, that modules.updateCheck is on by default, and that the result appears on Settings and in doctor."
  - "docs/DEPLOY.md's Upgrades section says the same for a deployed instance, where nobody is watching a terminal."
  - "Neither document suggests scheduling `n-seo upgrade --check` separately; both say why that would duplicate the daily step."
description: "A reader scheduling the daily run should not have to infer that update checking comes with it, and should not conclude a second scheduled job is needed. A weekly 'n-seo upgrade --check' job would make a duplicate registry request and write to a log nobody reads."
lastModified: "2026-09-18T02:55:30.375Z"
---
