---
id: "d57db8d4-d4b1-4ff3-9b68-c577f0b7cdcc"
level: "task"
title: "Register extra dashboard routes from an instance"
status: "pending"
priority: "low"
acceptanceCriteria:
  - "An instance can add routes beside the engine's own without editing the engine's router in src/server.tsx."
  - "An instance route cannot silently shadow an engine route; a collision is reported rather than resolved by load order."
description: "Extra pages beside the engine's own routes, without editing the engine's router."
lastModified: "2026-09-17T16:23:03.895Z"
---
