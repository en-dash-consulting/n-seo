---
id: "a727f329-3c51-4765-91c0-3ce0296d686f"
level: "task"
title: "Add a bingWebmaster module gate and config block"
status: "pending"
priority: "low"
acceptanceCriteria:
  - "modules.bingWebmaster.enabled gates the step, registered in the MODULES list in src/config.ts like every other optional module."
  - "The Bing API key resolves from the environment, not from the config file."
description: "Register the module in the MODULES list in src/config.ts so it is gated by modules.bingWebmaster.enabled like every other optional step, with the API key resolved from .env rather than the config file."
lastModified: "2026-09-17T16:23:01.001Z"
---
