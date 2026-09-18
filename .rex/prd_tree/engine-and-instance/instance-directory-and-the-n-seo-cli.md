---
id: "3183e0bc-4471-4f29-bf05-86782f9066d5"
level: "feature"
title: "Instance directory and the n-seo CLI"
status: "completed"
source: "manual"
startedAt: "2026-09-08T03:58:58.700Z"
completedAt: "2026-09-08T03:58:58.700Z"
acceptanceCriteria:
  - "`N_SEO_INSTANCE` relocates every instance-owned path; in-place mode is unchanged when it is unset."
  - "`n-seo init|start|dev|daily|doctor|demo|mcp|check|export| upgrade|version` behave as documented in `docs/INSTANCE.md`."
  - "an instance is a standalone project. `n-seo init` exits 2 without writing anything when the target holds an application marker, or when the directory it would create falls inside a git repository that is not an instance; `--force` overrides, re-running on an existing instance succeeds, and in-place mode in the engine checkout is unaffected."
  - "`init` installs the seven instance-facing skills and a `CLAUDE.md` with the operating rules, substituting the real engine and instance paths, and leaves the contributor (`ndx-*`) skills behind."
  - "`n-seo upgrade` refuses to leave the engine on a commit that fails `npm run check` without printing the rollback command."
description: "N_SEO_INSTANCE relocates every instance-owned path; the CLI scaffolds and drives an instance and upgrades the engine."
---
