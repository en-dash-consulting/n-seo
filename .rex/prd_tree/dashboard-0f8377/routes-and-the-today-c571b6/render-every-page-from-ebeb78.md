---
id: "ebeb78d4-ec10-4f99-97a2-9789346a003c"
level: "task"
title: "Render every page from demo data with write endpoints for the queue"
status: "completed"
priority: "high"
tags:
  - "dashboard"
  - "ui"
source: "manual"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "Routes /, /actions, /insights, /trends[/N], /content, /drafts/:slug, /campaigns/:slug, /site/:host, /indexing, /probes, /logs, /settings, /api/actions render from demo data with no server error"
  - "Today board groups Fix / Approve / Publish / Comment / Ship; Comment appears only when a participation module is enabled"
  - "Proposals can be accepted into the backlog; backlog items can be marked watching or retired; rule-derived items expose no write buttons"
  - "The server binds 127.0.0.1 by default and rejects cross-origin POSTs"
  - "Light and dark themes; no external fonts"
description: "src/views.tsx, src/server.tsx, public/styles.css."
---
