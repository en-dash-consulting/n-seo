---
id: "f1965649-2cd4-46da-8e24-3a79b08819f4"
level: "feature"
title: "Tests and CI"
status: "completed"
source: "manual"
startedAt: "2026-09-08T03:58:58.700Z"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "`npm run check` runs typecheck, TypeScript tests (sandboxed copy) and Python tests; CI runs both suites, a demo-data dashboard smoke, `doctor --offline`, and a grep that fails on any private name."
description: "npm run check gates every change."
---
