---
id: "fc2e277f-0a30-440a-86bc-4e7f7a840383"
level: "task"
title: "Template a weekly upgrade check as a scheduler job"
status: "pending"
priority: "medium"
acceptanceCriteria:
  - "ops/templates/ gains a launchd plist and a cron line running `n-seo upgrade --check` weekly, matching the daily-run templates already there."
  - "The scheduled job only reports; it never installs an upgrade unattended."
description: "Follow the daily-run pattern in ops/templates/ — a launchd plist and a cron line — running 'n-seo upgrade --check' weekly. The check reports; it never installs unattended."
lastModified: "2026-09-17T16:22:50.220Z"
---
