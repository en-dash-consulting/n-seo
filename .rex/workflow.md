# n-seo workflow rules (appended to the base n-dx workflow)

- Read docs/PRD.md and docs/ARCHITECTURE.md before changing behaviour; the PRD tree in .rex/ mirrors docs/PRD.md — update both when scope changes.
- Validation after every change: `npm run check` (typecheck + TypeScript tests + Python tests). A change is not done until it passes.
- Python stays stdlib-only with HTTP through ingest/http_util.py; TypeScript stays bundler-free (tsx runtime, hono/jsx).
- Engine/instance ownership (docs/ARCHITECTURE.md "Engine and instance"): code paths resolve instance-owned files under INSTANCE, never ROOT.
- Never introduce the original owner's hosts, IDs or names; CI greps for them. Use example.com.
- Nothing may post, send, publish, or edit a user's site; briefings only, proposals only. Every MCP tool stays read-only.
- Encoded operating rules are product behaviour, not defaults to relax: 28-day metadata freeze, ≈8 metadata changes/week, 90-day decision window, impact orders not forecasts, shipped → watching.
