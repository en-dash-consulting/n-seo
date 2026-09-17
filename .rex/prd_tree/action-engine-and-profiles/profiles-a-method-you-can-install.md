---
id: "0f647d2c-ffc4-4e07-90ba-ad685a52fa99"
level: "feature"
title: "Profiles — a method you can install"
status: "completed"
priority: "high"
startedAt: "2026-09-17T16:21:58.328Z"
completedAt: "2026-09-17T16:21:58.328Z"
endedAt: "2026-09-17T16:21:58.328Z"
acceptanceCriteria:
  - "`\"profile\": \"<built-in | path | package>\"` resolves in that order, and every value remains overridable by the instance."
  - "a profile that cannot be resolved fails the load with a message naming each location tried, rather than falling back to the defaults."
  - "`n-seo profile` prints the active profile and every value this instance overrides; the Settings page shows the same, and `doctor` reports an unresolvable profile before the daily run reaches it."
  - "the TypeScript and Python loaders resolve every shipped profile to identical numbers, asserted by a test that runs both."
  - "`default`, `patient` and `aggressive` ship with the engine, and `default` restates the engine defaults exactly — asserted, so the two cannot drift."
description: "One config key, \"profile\", swaps every threshold and policy the engine uses for someone else's. Resolves a built-in name, a path, or an installed package, in that order. Three layers — engine defaults, profile, instance — and the instance always wins. An unresolvable profile fails the load naming every location tried. default, patient and aggressive ship with the engine. Shipped 0.5.0; see docs/PROFILES.md."
lastModified: "2026-09-17T16:21:58.338Z"
---
