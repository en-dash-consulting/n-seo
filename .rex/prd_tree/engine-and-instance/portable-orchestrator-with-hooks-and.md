---
id: "72938d55-c5be-429c-b25f-cac81e2cc146"
level: "feature"
title: "Portable orchestrator with hooks and scheduler templates"
status: "completed"
source: "manual"
startedAt: "2026-09-08T03:58:58.700Z"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "`ops/daily.py` waits for the network, runs the enabled steps in order, retries a failed step once, tees output to `data/daily-ops.log`, writes `data/last-run.json` with per-step timing, honours `--only`, `--skip`, `--list`, `--no-network-wait`, and exits 1 on any failure."
  - "hooks (`beforeRun`, `afterRun`, `afterStep`) run in the instance directory and are logged like steps without aborting the run."
  - "launchd, cron and systemd templates plus an installer script."
description: "ops/daily.py replaces a shell script; hooks let an instance add its own steps."
---
