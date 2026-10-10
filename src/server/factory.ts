import { McpServer, type CacheHint } from "@modelcontextprotocol/server";
import { SERVER_NAME, SERVER_VERSION, TOOL_COUNT } from "../constants.js";
import { buildServerInstructions } from "../services/server-instructions.js";
import { registerAllTools } from "./register-tools.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

// Tool, prompt and resource lists are fixed for the life of the process and
// identical for every caller, so 2026-07-28 clients and shared caches may
// reuse them. 2025-era responses never carry these fields.
const STATIC_LIST_HINT: CacheHint = { ttlMs: 3_600_000, cacheScope: "public" };

/** Build a fully registered GroundTruth server. One instance per connection or HTTP exchange. */
export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      title: "GroundTruth",
      version: SERVER_VERSION,
      websiteUrl: "https://github.com/rm-rf-prod/GroundTruth-MCP",
    },
    {
      instructions: buildServerInstructions(TOOL_COUNT),
      cacheHints: {
        "tools/list": STATIC_LIST_HINT,
        "prompts/list": STATIC_LIST_HINT,
        "resources/list": STATIC_LIST_HINT,
        "resources/templates/list": STATIC_LIST_HINT,
      },
    },
  );
  registerAllTools(server);
  registerResources(server);
  registerPrompts(server);
  return server;
}
