// End-to-end check of the stdio MCP server against whatever is in data/.
// Run from the repo root: `npm run mcp:smoke`
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "src/mcp-stdio.ts"],
  cwd: process.cwd(),
  env: process.env,
});
const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`TOOLS (${tools.length}):`);
for (const t of tools) console.log(`  ${t.name.padEnd(24)} ${(t.description ?? "").slice(0, 62)}…`);

const { resources } = await client.listResources();
console.log(`\nRESOURCES (${resources.length}): ${resources.map((r) => r.uri).join(", ")}`);

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? "";
  return { isError: !!r.isError, text };
};

console.log("\n--- settings ---");
let r = await call("settings");
const settings = JSON.parse(r.text);
console.log(`  name=${settings.name} sites=${settings.sites.map((s) => s.host).join(",") || "(none)"} modules on: ${Object.entries(settings.modules).filter(([, v]) => v).map(([k]) => k).join(", ") || "(none)"}`);
const firstHost = settings.sites[0]?.host;

console.log("\n--- list_actions {status:active, limit:3} ---");
r = await call("list_actions", { status: "active", limit: 3 });
const acts = JSON.parse(r.text);
console.log(`  matched=${acts.matched} returned=${acts.returned}`);
acts.actions.forEach((a) => console.log(`  #${a.rank} +${a.impact} ${a.effort} ${a.host} — ${a.title.slice(0, 54)}`));

console.log("\n--- ops_status ---");
r = await call("ops_status");
const ops = JSON.parse(r.text);
console.log(`  lastRun=${ops.lastRun?.ts ?? "none"} failures="${ops.lastRun?.failures ?? ""}" probe=${ops.probe ? `${ops.probe.healthy}/${ops.probe.total} healthy` : "none"}`);
(ops.probe?.sites ?? []).filter((s) => s.findings.length).forEach((s) => console.log(`  ${s.host}: ${s.findings.join("; ")}`));

if (firstHost) {
  console.log(`\n--- top_queries ${firstHost} 90d limit 3 ---`);
  r = await call("top_queries", { host: firstHost, window: "90d", limit: 3 });
  JSON.parse(r.text).queries.forEach((q) => console.log(`  "${q.query}" clicks=${q.clicks} imps=${q.impressions} pos=${(q.position ?? 0).toFixed(1)}`));
}

console.log("\n--- error path: unknown host ---");
r = await call("site_report", { host: "nope.example.invalid" });
console.log(`  isError=${r.isError} :: ${r.text.slice(0, 70)}`);

console.log("\n--- conversions_status ---");
r = await call("conversions_status");
console.log("  " + r.text.replace(/\s+/g, " ").slice(0, 130));

await client.close();
console.log("\nstdio transport OK");
