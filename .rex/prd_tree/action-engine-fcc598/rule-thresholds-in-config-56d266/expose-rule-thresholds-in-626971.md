---
id: "6269715c-25d8-46f2-a87c-00ff29482cf8"
level: "task"
title: "Expose rule thresholds in n-seo.config.json"
status: "pending"
priority: "medium"
tags:
  - "engine"
  - "config"
source: "manual"
acceptanceCriteria:
  - "Every threshold (min impressions, position band, engagement floor, drop percentage, effort weights) has a documented default and a config override"
  - "A test covers an override changing a rule's output"
  - "The Settings page shows the effective values read-only"
description: "Users hone their own principles by adjusting thresholds without forking; defaults stay the shipped behaviour."
---
