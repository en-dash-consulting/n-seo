---
id: "17569c72-a15d-46d2-aed7-aba45afc684b"
level: "task"
title: "Surface indexing problems on the individual site page"
status: "pending"
priority: "medium"
acceptanceCriteria: []
description: "/site/:host shows nothing about indexing today; someone looking at one site has to leave for /indexing and find their host in a list. The data already exists in the right shape — indexStatus() keys sites by host with problems, neverCrawled, indexed and checked, which is what IndexingPage already groups over — so this is surfacing, not a new pull. Acceptance: the site page shows that host's indexed/checked counts, its problems grouped by coverage state, and its never-crawled count; each problem keeps its coverage-state explanation and whether Request Indexing helps (true only where Google has formed no judgement, false where it fetched and declined); a host that is all clear or has no sitemap coverage says so explicitly rather than rendering an empty panel; it links through to /indexing for the cross-site view; and it renders from demo data with no server error, in both themes."
lastModified: "2026-09-17T16:50:16.966Z"
---
