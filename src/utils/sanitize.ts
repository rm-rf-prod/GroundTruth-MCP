import { INJECTION_PATTERNS } from "../constants.js";

// Navigation/footer patterns from Jina Reader output — strip these to save 15-25% tokens
const NAV_FOOTER_PATTERNS: RegExp[] = [
  // Skip-links and accessibility nav shortcuts
  /\[Skip to (main )?content\]\([^)]*\)/gi,
  /\[Skip navigation\]\([^)]*\)/gi,

  // Breadcrumb lines — "Home > Docs > Guide" or markdown link chains
  /^.*?\]\s*\/\s*\[.*?\]\s*\/\s*\[.*?$/gm,
  /^(Home|Docs?|Guide|Reference|API)\s*[>\/]\s*.+$/gm,

  // "Edit on GitHub" / "Edit this page" links
  /\[Edit (this page|on GitHub|on GitLab)[^\]]*\]\([^)]*\)/gi,
  /Edit (this page|on GitHub|on GitLab)/gi,

  // "View on GitHub" / "View source"
  /\[View (on GitHub|source)[^\]]*\]\([^)]*\)/gi,

  // "Previous / Next" page navigation
  /\[← ?(Previous|Back)[^\]]*\]\([^)]*\)/gi,
  /\[Next ?→[^\]]*\]\([^)]*\)/gi,
  /^\s*←\s*(Previous|Back)\s*\|\s*Next\s*→\s*$/gm,

  // Table of contents markers
  /^#+\s*(Table of Contents|Contents|On this page|In this (article|section))\s*$/gim,
  /^On this page\s*$/gim,

  // Pagination footer lines
  /^Page \d+ of \d+$/gm,

  // Cookie / privacy banners (commonly injected by Jina)
  /We use cookies.{0,200}(accept|agree|consent|privacy policy)/gi,
  /This site uses cookies.{0,200}(learn more|ok|accept)/gi,
  /By (using|continuing to use) this (site|website).{0,200}(privacy|cookies)/gi,

  // "Was this (page|article) helpful?" feedback widgets
  /Was this (page|article|section|doc) helpful\??[^\n]*/gi,
  /\[Yes\]\([^)]*\)\s*\[No\]\([^)]*\)/gi,
  /Thumbs (up|down)\s*\d*/gi,

  // Social share buttons
  /\[(Share|Tweet|LinkedIn|Facebook)[^\]]*\]\([^)]*\)/gi,

  // Search boxes
  /\[?\s*Search (docs|documentation|\.\.\.)\s*\]?/gi,

  // "Last updated" metadata lines
  /^Last updated:?\s+.+$/gim,
  /^Updated:?\s+[\w\s,]+\d{4}\.?$/gim,

  // Version switcher lines
  /^Version:?\s+v?\d+\.\d+[\.\d]*/gim,

  // Copyright footer lines
  /^Copyright\s+©?\s+\d{4}.+$/gim,
  /^©\s+\d{4}.+All rights reserved\.?$/gim,
  /^Released under the .+ [Ll]icense\.?$/gim,

  // "Made with" / "Powered by" lines
  /^Made with\s+.+$/gim,
  /^Powered by\s+.+$/gim,

  // CTA buttons in nav/header
  /\[(Get started|Sign up|Log in|Download|Try for free|Contact us)[^\]]*\]\([^)]*\)/gi,

  // Long nav link dumps — 5+ consecutive short markdown links on their own lines
  /(\[[\w\s/-]{1,40}\]\([^)]{0,100}\)\s*\n){5,}/g,
];

/**
 * Remove prompt injection attempts from fetched documentation content.
 * Protects against ContextCrush-style attacks where library docs contain
 * malicious LLM instructions embedded in content.
 *
 * Also strips navigation chrome, footers, cookie banners, and other
 * boilerplate from Jina Reader output to reduce token waste by 15-25%.
 */
const MAX_SANITIZE_LENGTH = 512_000; // 500KB cap before regex processing

export function sanitizeContent(content: string): string {
  let sanitized = content.length > MAX_SANITIZE_LENGTH
    ? content.slice(0, MAX_SANITIZE_LENGTH)
    : content;

  // Strip nav/footer boilerplate first (before injection scan to reduce noise)
  for (const pattern of NAV_FOOTER_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }

  // Remove prompt injection attempts
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
