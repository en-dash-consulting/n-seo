---
id: "3ac4836b-c7d2-461a-a088-316e2ce85047"
level: "feature"
title: "Custom rules via rules.priorities"
status: "completed"
priority: "medium"
startedAt: "2026-09-17T16:21:58.868Z"
completedAt: "2026-09-17T16:21:58.868Z"
endedAt: "2026-09-17T16:21:58.868Z"
acceptanceCriteria:
  - "`rules.priorities` reweights or drops queue cards by host, path, tag or kind; a matched card carries the reason in its spec and a *reweighted* chip; a priority with no `why` or no conditions is ignored; a bad regex or a nonsense multiplier is ignored rather than throwing or corrupting the sort."
  - "a priority can never create a card. Everything in the queue still came from data."
description: "A threshold says what counts as a finding; a priority says what you care about. Match on host, pathMatches, tag or kind, then multiply the impact that orders the queue, or drop the card. A priority may reorder or hide, never invent — it cannot create a card. Every card it touches carries the reason in its spec and a reweighted chip; 'why' is required. Profiles remain data and may not ship executable code. Shipped 0.6.0."
lastModified: "2026-09-17T16:21:58.878Z"
---
