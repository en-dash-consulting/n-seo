---
id: "08ee3b81-1eca-4376-b226-5dd110138387"
level: "task"
title: "Settle the trust boundary: an instance may run its own code, a profile may not"
status: "pending"
priority: "low"
acceptanceCriteria:
  - "A written decision states why a profile stays data-only while an instance may load its own code, naming the credential exposure that motivates the split."
  - "The decision is recorded in docs/PRD.md and docs/PROFILES.md so the constraint survives the next contributor."
description: "0.5.0 and 0.6.0 both decided a profile is data only — installing someone's method must not mean running their code on the machine holding your Search Console credentials. An instance's own extensions are a different case: it is the owner's own code on the owner's own machine. State that difference before designing the hook."
lastModified: "2026-09-17T16:23:03.143Z"
---
