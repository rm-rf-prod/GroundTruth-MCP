import { INJECTION_PATTERNS } from "../constants.js";

/**
 * Remove prompt injection attempts from fetched documentation content.
 * Protects against ContextCrush-style attacks where library docs contain
 * malicious LLM instructions embedded in content.
 */
export function sanitizeContent(content: string): string {
  let sanitized = content;

  for (const pattern of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[content removed]");
  }

  // Remove HTML script/style tags that could confuse the LLM
  sanitized = sanitized.replace(/<script[\s\S]*?<\/script>/gi, "");
  sanitized = sanitized.replace(/<style[\s\S]*?<\/style>/gi, "");

  // Collapse excessive whitespace
  sanitized = sanitized.replace(/\n{4,}/g, "\n\n\n");

  return sanitized;
}
