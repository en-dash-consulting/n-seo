# MCP server — the same data, for agents

`src/mcp.ts` exposes the control plane over the Model Context Protocol so an
AI agent can read the queue and the metrics directly instead of scraping the
dashboard. It is **read-only by design**: the queue is edited through the
dashboard's accept/watch/retire flow, so nothing here writes anything. Every
tool is annotated `readOnlyHint`.

## Two transports

### stdio (default — no secret)

The client spawns the server as a child process and talks over stdin/stdout.
There is no network listener and no token: the OS process boundary is the
authentication, and the server can only read what you can.

`.mcp.json` in the repo root registers it for **Claude Code**, so opening the
repo in Claude Code is all the setup there is.

```sh
npm run mcp          # run it by hand (protocol on stdout, diagnostics on stderr)
npm run mcp:smoke    # list tools and call a few against your data
```

**Claude Desktop** — add to its MCP settings, with `cwd` set to your checkout:

```json
{
  "mcpServers": {
    "seo-agent": {
      "command": "npx",
      "args": ["tsx", "src/mcp-stdio.ts"],
      "cwd": "/path/to/seo-agent"
    }
  }
}
```

### HTTP (for clients that cannot spawn a process)

`POST /mcp` on the dashboard, streamable HTTP, stateless — a fresh server per
request, so no session state crosses callers. It requires a bearer token,
read from `SEO_MCP_TOKEN` (env or `.env`), else from
`~/.config/seo-agent/mcp-token` (chmod 600).

```sh
curl -X POST http://localhost:4600/mcp \
  -H "Authorization: Bearer $(cat ~/.config/seo-agent/mcp-token)" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

**With no token set the endpoint returns 503 rather than serving.** It fails
closed because the dashboard binds every interface, and your search data
should not be readable from the LAN by accident. Rotate by writing a new
value to the token file and restarting the dashboard.

## Why local-only

All the real data lives in `data/` on the machine that runs the daily job. An
MCP server therefore only makes sense next to those files. To reach it from
another device, tunnel to the dashboard port (Tailscale, `cloudflared`,
an SSH tunnel) rather than exposing it — the bearer token is the only thing
in front of it.

## Tools

| Tool | Returns |
|---|---|
| `list_actions` | The queue, ranked by impact per effort. Filter by `status` (active / watching / all), `host`, `tag`; `limit` |
| `get_action` | One action in full (spec and success criteria), matched by title substring |
| `list_sites` | Every configured site with 16-month GSC totals, 90-day session trend, probe status |
| `site_report` | One site: totals, traffic mix (search / AI assistants / other), trend, landing pages, probe findings |
| `top_queries` | GSC queries for a site, `window` 90d or 16mo |
| `striking_distance` | Queries at position 5–15 with meaningful impressions (90d) |
| `ctr_gaps` | Queries whose CTR trails what their position should earn (90d) |
| `metadata_audit` | Per-page title/description findings from the daily crawl |
| `trends_timeseries` | Daily clicks and sessions for a site over the last N days |
| `ops_status` | Did the last run succeed, how stale is each dataset, current probe results — check before trusting numbers |
| `daily_log` | The last N entries of `docs/daily-log.md` |
| `opportunity_proposals` | Rising-query candidates, machine proposals awaiting accept, verdicts on watching items |
| `conversions_status` | Whether conversion events are instrumented and their 28-day counts by source |
| `campaigns` | Outreach campaigns from `content/campaigns/` — targets, plan, template ids |
| `settings` | The effective config: sites, module switches, auth mode (never the key) |

Resources: `seo://docs/playbook`, `seo://docs/daily-log`,
`seo://docs/operating-rules`.

## Example prompts

- "What should I do first this week? Use `list_actions` and explain the top
  three in terms of the evidence."
- "Which pages on example.com have CTR gaps, and what would you retitle them
  to? Respect the 28-day freeze on anything in the watching list."
- "Is the data fresh? Check `ops_status` before answering anything else."
- "Summarize the last five daily-log entries — what regressed, what moved."
- "Read the opportunity proposals and tell me which ones are worth accepting
  and why. Don't add anything to the queue."

The rules in `CLAUDE.md` apply to an agent using these tools: it proposes,
you accept; it never drafts community comments; it reads outputs rather than
re-running pulls.
