---
name: orient
description: Fast, cheap orientation for a fresh session on this n-seo install. Use FIRST in any new session here — reads current state from the running system instead of re-deriving it from raw data.
---

# Orient — get current in ~4 reads, not 40

The system is self-updating; your job is to read its outputs, never to rebuild
its conclusions. Procedure, in order — stop when you have what the task needs:

1. **The queue is the truth for "what's next"**:
   `curl -s http://localhost:4600/api/actions` (the port is `port` in
   `n-seo.config.json`; the MCP `list_actions` tool returns the same).
   Every active and watching action with evidence and spec.
2. **What happened lately**: the last entry of `docs/daily-log.md` (probe
   health, watched-page numbers, conversions line) and `data/last-run.json`
   (did the last daily run succeed, which steps failed).
3. **Machine-proposed work awaiting the owner**:
   `data/opportunity-proposals.json` — proposals and verdicts from the scan.
4. **Recent human decisions**: `git log --oneline -10` in this repo.

## Do NOT (wastes tokens, re-derives what the batch already did)

- Do not re-run pulls, audits, or trend analysis to answer status questions —
  `ops/daily.py` refreshes everything on its schedule; its outputs are in
  `data/` and `docs/daily-log.md`.
- Do not re-audit sites or re-crawl pages the probe already covers.
- Do not summarize the architecture from source — `docs/ARCHITECTURE.md` has it.
- Do not restate history — `docs/daily-log.md` and `git log` hold it.

## Rules live in CLAUDE.md — the ones people forget

Queue edits only through accept/watch/retire or explicit approval · never
generate comment text · 28-day title freeze + ≤8 metadata changes/week ·
decisions ride the 90-day window · proposals never self-promote.

## Then hand off to the right skill

`n-seo-triage` for "what should I do today", `n-seo-ship` to implement one
card, `n-seo-review` for the weekly pass, `n-seo-setup` and `n-seo-add-site`
for configuration. `.claude/skills/README.md` says which skills are for
operating an instance and which are for developing the engine.

## If something is broken

- Dashboard down: `npm start` in-place, or
  `node <engine>/bin/n-seo.mjs start --instance <dir>` in engine+instance
  mode, or if it runs as a service,
  `launchctl kickstart -k gui/$(id -u)/n-seo.dashboard`.
- Daily run failing: the Logs page (`/logs`) or `data/daily-ops.log`, then
  `python3 ops/doctor.py`. 401/403 from Google means the service account
  lost access or the key file moved — see `docs/SETUP-GOOGLE.md`.
- Nothing on the dashboard: no run has happened yet — `python3 ops/daily.py`
  (or `python3 ops/demo_data.py` to see it populated with synthetic data).
