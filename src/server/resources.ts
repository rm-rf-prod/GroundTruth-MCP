import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LIBRARY_REGISTRY, lookupById, lookupByAlias } from "../sources/registry.js";
import { fetchDocs } from "../services/fetcher.js";
import { extractRelevantContent } from "../utils/extract.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { withNotice } from "../utils/guard.js";
import { DEFAULT_TOKEN_LIMIT } from "../constants.js";

/** Browsable documentation and registry data exposed as MCP resources. */
export function registerResources(server: McpServer): void {
  server.registerResource(
    "library-registry",
    "gt://registry",
    { description: "List of all supported libraries with IDs and docs URLs" },
    async () => ({
      contents: [{
        uri: "gt://registry",
        mimeType: "application/json",
        text: JSON.stringify(
          LIBRARY_REGISTRY.map((e) => ({ id: e.id, name: e.name, docsUrl: e.docsUrl })),
          null,
          2,
        ),
      }],
    }),
  );

  server.registerResource(
    "library-docs",
    // Reserved expansion ({+var}) — every registry ID is "owner/name", and a
    // plain {var} stops at the slash, so gt://docs/facebook/react never matched
    // the template and every registry ID was unreadable through this resource.
    new ResourceTemplate("gt://docs/{+libraryId}", { list: undefined }),
    { description: "Fetch documentation for a library by its registry ID or alias" },
    async (uri, { libraryId }) => {
      const id = Array.isArray(libraryId) ? libraryId[0] ?? "" : libraryId ?? "";
      const entry = lookupById(id) ?? lookupByAlias(id);
      if (!entry) {
        return { contents: [{ uri: uri.href, mimeType: "text/plain", text: `Library not found: ${id}` }] };
      }
      try {
        const result = await fetchDocs(entry.docsUrl, entry.llmsTxtUrl, entry.llmsFullTxtUrl);
        const safe = sanitizeContent(result.content);
        const { text } = extractRelevantContent(safe, "", DEFAULT_TOKEN_LIMIT);
        return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: withNotice(text) }] };
      } catch {
        return { contents: [{ uri: uri.href, mimeType: "text/plain", text: `Failed to fetch docs for ${entry.name}` }] };
      }
    },
  );
}
