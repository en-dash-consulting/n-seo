# Security

## Model

n-seo is a **local-only** tool. It runs on your machine, reads your Google
data with credentials you control, and writes JSON files under `data/`. There
is no hosted service, no telemetry, and no outbound traffic other than:

- the Google APIs you authorize (Search Console, GA4),
- plain HTTP fetches of your own sites (the probe and the metadata audit),
- the public Hacker News / Reddit / IndexNow APIs, only when you enable those
  modules,
- a local LLM command you configure, only when you enable that module.

Nothing posts, sends, or publishes on your behalf.

## Credentials

- The service-account key belongs outside the repo (default
  `~/.config/n-seo/service-account.json`, `chmod 600`). `.gitignore`
  excludes `*.key.json`, `service-account*.json`, `.env` and your live config,
  but review `git status` before your first push anyway.
- Grant the service account the **least** access that works: *Full* on the
  Search Console property (needed for the URL Inspection API), *Viewer* on the
  GA4 property. It needs no IAM roles in the Google Cloud project.
- Reddit credentials live in `.env`; the dashboard never displays them.

## The dashboard and the MCP endpoint

- The dashboard binds `127.0.0.1` unless `SEO_HOST` says otherwise, and every
  `POST` (settings, backlog writes) must carry a same-origin `Origin`/`Referer`
  header or none at all. A web page you happen to visit cannot submit a form
  to `http://localhost:4600/settings`, and a machine on your LAN cannot reach
  it. Settings include the LLM command that `ops/llm.py` executes, so treat
  `SEO_HOST=0.0.0.0` as opening that command to everyone who can reach the port.

- The dashboard binds every interface on its port (default 4600) and has no
  authentication of its own. Run it on a trusted machine or behind your own
  auth; do not expose the port to the internet. For access from another device
  use a tunnel (Tailscale, cloudflared).
- `POST /mcp` requires a bearer token (`SEO_MCP_TOKEN` in the environment or
  `.env`, or `~/.config/n-seo/mcp-token`). With no token configured the
  endpoint returns **503** rather than serving. The comparison is
  constant-time. The stdio MCP transport needs no token: the OS process
  boundary is the authentication.
- The static export (`site/`) contains your search data and is written with
  `noindex` and a deny-all `robots.txt`; host it behind authentication.

## Reporting a vulnerability

Please use GitHub's private **Security advisories** for this repository
("Report a vulnerability") rather than a public issue. Include the version or
commit, what you found, and how to reproduce it. You should hear back within a
week.
