/**
 * stdio entrypoint for the n-seo MCP server.
 *
 * A local MCP client (Claude Code, Claude Desktop, any MCP host) spawns this
 * as a child process and talks over stdin/stdout. There is no network
 * listener and no token: the OS process boundary is the authentication, and
 * the server can only read what this user can already read. The HTTP
 * transport in src/server.tsx exists for the cases stdio can't cover
 * (another device, a tunnel).
 *
 * Nothing may be written to stdout except protocol frames, so diagnostics
 * go to stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp.js";

const server = createMcpServer();
const transport = new StdioServerTransport();

await server.connect(transport);
console.error("n-seo MCP server ready on stdio");
