---
id: "a57d470f-33d7-486f-94c4-ee7fa45d999f"
level: "task"
title: "Pull Bing Webmaster query and page rows"
status: "pending"
priority: "low"
acceptanceCriteria:
  - "A pull writes Bing query and page rows per configured site over the 90-day window, following the shape of ingest/pull_gsc.py."
  - "The step exits 0 with a message when the module is disabled."
description: "An ingest/pull_bing.py following the shape of pull_gsc.py: per configured site, 90-day window, written to data/ as the other pulls are, and skipped cleanly when the module is off."
lastModified: "2026-09-17T16:23:01.354Z"
---
