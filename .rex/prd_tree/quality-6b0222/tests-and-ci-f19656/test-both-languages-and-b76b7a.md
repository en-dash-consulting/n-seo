---
id: "b76b7a9d-a521-4d36-af72-4598e3aea59a"
level: "task"
title: "Test both languages and run CI on every push"
status: "completed"
priority: "high"
tags:
  - "tests"
  - "ci"
source: "manual"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "npm run check runs typecheck, TypeScript tests (sandboxed copy) and Python tests"
  - "CI runs both suites, a demo-data dashboard smoke, doctor --offline, and a grep that fails on any private name"
description: "tests/ts, tests/py, .github/workflows/ci.yml."
---
