import { Hono } from "hono";
import { serve, type HttpBindings } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ROOT, PORT, siteByHost, dotEnv } from "./config.js";
import { draftBySlug, campaignBySlug } from "./data.js";
import { allActions } from "./actions.js";
import { acceptProposal, setWatching, retire } from "./backlog.js";
import { createMcpServer } from "./mcp.js";
import { applySettingsForm, SettingsPage } from "./settings.js";
import {
  ActionsPage, CampaignPage, ContentPage, DraftPage, IndexingPage, InsightsPage, Layout, LogsPage,
  Overview, Probes, SiteDetail, TrendsPage, TREND_RANGES,
} from "./views.js";

const app = new Hono<{ Bindings: HttpBindings }>();

/* The dashboard has write endpoints (settings, backlog). Two guards keep them
   local: the server binds 127.0.0.1 unless SEO_HOST says otherwise, and any
   POST must come from this origin — a form on some other web page can reach
   http://localhost:PORT without a CORS preflight, and settings include the
   LLM command that ops/llm.py later executes. curl (no Origin) is allowed. */
app.use("*", async (c, next) => {
  if (c.req.method !== "POST" || c.req.path === "/mcp") return next();
  const origin = c.req.header("origin") ?? c.req.header("referer");
  if (origin) {
    let host = "";
    try { host = new URL(origin).host; } catch { /* malformed → reject below */ }
    if (host !== c.req.header("host")) return c.text("cross-origin POST rejected", 403);
  }
  return next();
});

app.get("/api/actions", (c) => c.json(allActions()));

/* ---- MCP over streamable HTTP ----
   The stdio transport (src/mcp-stdio.ts) is the default and needs no secret.
   This endpoint exists for clients that can't spawn a local process, so it
   has to carry its own auth: a bearer token from SEO_MCP_TOKEN (or the file
   ~/.config/n-seo/mcp-token). The dashboard binds every interface, so
   with no token set this refuses to serve rather than exposing your search
   data to the LAN. Stateless — a fresh server and transport per request. */
const MCP_TOKEN_FILE = path.join(process.env.HOME ?? "", ".config", "n-seo", "mcp-token");

function resolveMcpToken(): string | undefined {
  const fromEnv = process.env.SEO_MCP_TOKEN?.trim() || dotEnv("SEO_MCP_TOKEN");
  if (fromEnv) return fromEnv;
  try {
    const fromFile = fs.readFileSync(MCP_TOKEN_FILE, "utf8").trim();
    return fromFile || undefined;
  } catch {
    return undefined;
  }
}

const MCP_TOKEN = resolveMcpToken();

const mcpAuthorized = (c: { req: { header: (k: string) => string | undefined } }) => {
  const header = c.req.header("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!presented || !MCP_TOKEN) return false;
  // Constant-time compare so a wrong token can't be recovered by timing.
  const a = Buffer.from(presented);
  const b = Buffer.from(MCP_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

app.all("/mcp", async (c) => {
  if (!MCP_TOKEN) {
    return c.json({ error: "MCP endpoint disabled: set SEO_MCP_TOKEN (or ~/.config/n-seo/mcp-token) to enable it." }, 503);
  }
  if (!mcpAuthorized(c)) {
    return c.json({ error: "unauthorized" }, 401, { "WWW-Authenticate": 'Bearer realm="n-seo"' });
  }
  const body = c.req.method === "POST" ? await c.req.json().catch(() => undefined) : undefined;
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  c.env.outgoing.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(c.env.incoming, c.env.outgoing, body);
  return RESPONSE_ALREADY_SENT;
});

/* ---- static ---- */

app.get("/styles.css", (c) => {
  const css = fs.readFileSync(path.join(ROOT, "public", "styles.css"), "utf8");
  return c.text(css, 200, { "Content-Type": "text/css; charset=utf-8" });
});

app.get("/favicon.svg", (c) => {
  const svg = fs.readFileSync(path.join(ROOT, "public", "favicon.svg"), "utf8");
  return c.text(svg, 200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" });
});

/* ---- pages ---- */

app.get("/", (c) =>
  c.html(
    <Layout title="Overview · n-seo" active="overview">
      <Overview />
    </Layout>
  )
);

app.get("/actions", (c) =>
  c.html(
    <Layout title="Actions · n-seo" active="actions">
      <ActionsPage flash={c.req.query("flash")} />
    </Layout>
  )
);

app.get("/content", (c) =>
  c.html(
    <Layout title="Content · n-seo" active="content">
      <ContentPage />
    </Layout>
  )
);

app.get("/drafts/:slug", (c) => {
  const d = draftBySlug(c.req.param("slug"));
  if (!d) return c.notFound();
  return c.html(
    <Layout title={`Draft · ${d.channel} · n-seo`} active="content">
      <DraftPage d={d} />
    </Layout>
  );
});

app.get("/campaigns/:slug", (c) => {
  const camp = campaignBySlug(c.req.param("slug"));
  if (!camp) return c.notFound();
  return c.html(
    <Layout title={`${camp.name} · n-seo`} active="content">
      <CampaignPage c={camp} />
    </Layout>
  );
});

app.get("/insights", (c) =>
  c.html(
    <Layout title="Insights · n-seo" active="insights">
      <InsightsPage />
    </Layout>
  )
);

app.get("/site/:host", (c) => {
  const site = siteByHost(c.req.param("host"));
  if (!site) return c.notFound();
  return c.html(
    <Layout title={`${site.host} · n-seo`} active={site.host}>
      <SiteDetail site={site} />
    </Layout>
  );
});

/* The same window picker /trends has, scoped to one site. */
app.get("/site/:host/:days", (c) => {
  const site = siteByHost(c.req.param("host"));
  const days = Number(c.req.param("days"));
  if (!site || !TREND_RANGES.includes(days)) return c.notFound();
  return c.html(
    <Layout title={`${site.host} · n-seo`} active={site.host}>
      <SiteDetail site={site} days={days} />
    </Layout>
  );
});

app.get("/indexing", (c) =>
  c.html(
    <Layout title="Indexing · n-seo" active="indexing">
      <IndexingPage />
    </Layout>
  )
);

app.get("/probes", (c) =>
  c.html(
    <Layout title="Probes · n-seo" active="probes">
      <Probes />
    </Layout>
  )
);

app.get("/trends", (c) =>
  c.html(
    <Layout title="Trends · n-seo" active="trends">
      <TrendsPage days={90} />
    </Layout>
  )
);
app.get("/trends/:days", (c) => {
  const days = Number(c.req.param("days"));
  if (!TREND_RANGES.includes(days)) return c.notFound();
  return c.html(
    <Layout title="Trends · n-seo" active="trends">
      <TrendsPage days={days} />
    </Layout>
  );
});

app.get("/logs", (c) =>
  c.html(
    <Layout title="Logs · n-seo" active="logs">
      <LogsPage />
    </Layout>
  )
);

app.get("/settings", (c) =>
  c.html(
    <Layout title="Settings · n-seo" active="settings">
      <SettingsPage saved={c.req.query("saved") === "1"} error={c.req.query("error")} />
    </Layout>
  )
);

/* ---- writes: the only things that change files on disk ---- */

app.post("/settings", async (c) => {
  try {
    applySettingsForm(await c.req.parseBody({ all: true }));
    return c.redirect("/settings?saved=1", 303);
  } catch (err) {
    return c.redirect(`/settings?error=${encodeURIComponent((err as Error).message.slice(0, 80))}`, 303);
  }
});

app.post("/api/backlog/accept", async (c) => {
  const body = await c.req.parseBody();
  const index = Number(body.index);
  const a = Number.isInteger(index) ? acceptProposal(index) : null;
  const flash = a ? `Accepted “${a.title}” into config/backlog.json` : "Proposal not found (the scan file may have changed)";
  return c.redirect(`/actions?flash=${encodeURIComponent(flash)}#active`, 303);
});

app.post("/api/backlog/:id/watch", async (c) => {
  const body = await c.req.parseBody();
  const ok = setWatching(c.req.param("id"), typeof body.note === "string" ? body.note : "");
  return c.redirect(`/actions?flash=${encodeURIComponent(ok ? "Marked watching" : "Item not found in the backlog")}#watching`, 303);
});

app.post("/api/backlog/:id/retire", (c) => {
  const ok = retire(c.req.param("id"));
  return c.redirect(`/actions?flash=${encodeURIComponent(ok ? "Retired from the backlog" : "Item not found in the backlog")}`, 303);
});

const HOST = process.env.SEO_HOST ?? "127.0.0.1";
serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`n-seo → http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${info.port}`);
});
