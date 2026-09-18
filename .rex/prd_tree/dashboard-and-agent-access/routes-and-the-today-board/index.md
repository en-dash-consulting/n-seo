---
id: "c571b617-72ff-4088-b2a1-57e57f1d09af"
level: "feature"
title: "Routes and the Today board"
status: "completed"
source: "manual"
startedAt: "2026-09-08T03:58:58.700Z"
completedAt: "2026-09-18T02:44:59.222Z"
endedAt: "2026-09-18T02:44:59.222Z"
acceptanceCriteria:
  - "routes `/`, `/actions`, `/insights`, `/trends[/N]`, `/content`, `/drafts/:slug`, `/campaigns/:slug`, `/site/:host`, `/indexing`, `/probes`, `/logs`, `/settings`, `/api/actions` all render from demo data with no server error."
  - "Today board groups Fix / Approve / Publish / Comment / Ship; Comment appears only when a participation module is enabled."
  - "proposals can be accepted into the backlog; backlog items can be marked watching or retired; rule-derived items expose no write buttons."
  - "the server binds 127.0.0.1 by default and rejects cross-origin POSTs."
  - "light and dark themes; no external fonts — the one webfont is served from the app's own origin, so the dashboard renders identically on a host with no outbound internet and leaks no request to a font CDN."
description: "Server-rendered pages that lead with what to do next."
lastModified: "2026-09-18T02:44:59.232Z"
---

## Children

| Title | Status |
|-------|--------|
| [Surface indexing problems on the individual site page](./surface-indexing-problems-on-the.md) | completed |
