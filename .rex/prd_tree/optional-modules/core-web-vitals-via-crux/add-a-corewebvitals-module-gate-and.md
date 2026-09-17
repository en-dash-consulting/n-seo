---
id: "836f0f20-eb66-41dd-b7be-da5225c3100b"
level: "task"
title: "Add a coreWebVitals module gate and CrUX API key config"
status: "pending"
priority: "low"
acceptanceCriteria:
  - "modules.coreWebVitals.enabled gates the step, registered in the MODULES list in src/config.ts."
  - "The CrUX API key resolves from the environment, not from the config file."
description: "Gated by modules.coreWebVitals.enabled, key from .env, consistent with the other optional modules."
lastModified: "2026-09-17T16:23:02.067Z"
---
