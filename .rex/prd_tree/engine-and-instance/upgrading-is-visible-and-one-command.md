---
id: "477522cd-5587-44f2-a162-9bff64daa488"
level: "feature"
title: "Upgrading is visible and one command"
status: "completed"
priority: "high"
startedAt: "2026-09-17T16:32:07.467Z"
completedAt: "2026-09-17T16:32:07.467Z"
endedAt: "2026-09-17T16:32:07.467Z"
acceptanceCriteria: []
description: "n-seo upgrade detects how the engine was installed — git checkout, npm global including a custom prefix, npm local — and performs the upgrade itself rather than printing advice. It prints the old and new versions, the new CHANGELOG section, the rollback command and a restart reminder. 'upgrade --check' reports and changes nothing. A newer published version shows on Settings and in doctor, both read from data/update-check.json rather than the network. Shipped 0.4.0."
lastModified: "2026-09-17T16:32:07.479Z"
---
