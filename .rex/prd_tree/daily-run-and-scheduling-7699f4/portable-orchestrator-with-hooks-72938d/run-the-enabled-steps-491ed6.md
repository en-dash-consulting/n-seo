---
id: "491ed634-1ed5-42f6-bec5-a228475e317e"
level: "task"
title: "Run the enabled steps with retry, logging and hooks"
status: "completed"
priority: "high"
tags:
  - "ops"
source: "manual"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "ops/daily.py waits for the network, runs the enabled steps in order, retries a failed step once, tees output to data/daily-ops.log, writes data/last-run.json with per-step timing, honours --only, --skip, --list, --no-network-wait, and exits 1 on any failure"
  - "Hooks (beforeRun, afterRun, afterStep) run in the instance directory and are logged like steps without aborting the run"
  - "launchd, cron and systemd templates plus an installer script exist"
description: "ops/daily.py, ops/templates/, ops/install-launchd.sh."
---
