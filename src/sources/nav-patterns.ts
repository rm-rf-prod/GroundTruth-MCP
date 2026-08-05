/**
 * Boilerplate blocks stripped from fetched documentation: nav chrome, footers,
 * cookie banners, and other non-content furniture.
 *
 * Data table, not logic — exempt from the 200-line source convention.
 */
export const NAV_FOOTER_PATTERNS: RegExp[] = [
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

  // Sidebar-like sections: heading followed by only links
  /^#{2,4}\s*(Related|See [Aa]lso|Resources|Quick [Ll]inks|Useful [Ll]inks|More|Other|Popular)\s*\n(\[.+\]\(.+\)\s*\n?){2,}/gm,

  // Author bio sections
  /^#{2,4}\s*(About the [Aa]uthor|Written by|Author)\s*\n.{0,500}$/gm,

  // Newsletter signup / CTA blocks
  /^#{2,4}\s*(Subscribe|Newsletter|Stay [Uu]pdated|Join|Sign [Uu]p)\s*\n.{0,300}$/gm,

  // Changelog-style dates without content
  /^#{2,4}\s*v?\d+\.\d+[\.\d]*\s*[-\u2014]\s*\d{4}-\d{2}-\d{2}\s*$/gm,

  // Cloudflare cdn-cgi internal links (email-protection, etc.) \u2014 never legitimate
  // documentation content. decodeCloudflareEmails() recovers real addresses first;
  // this clears any remaining wrapper link (incl. the Jina "[[email protected]](...)" form).
  /\[[^\]]*\]\(\s*(?:https?:\/\/[^)]*)?\/cdn-cgi\/l\/[^)]+\)/gi,

  // Orphan HTML comment markers left after the balanced <!-- --> strip in
  // INJECTION_PATTERNS \u2014 a line that is ONLY a closing/opening marker is noise.
  /^[ \t]*-->[ \t]*$/gm,
  /^[ \t]*<!--[^\n]*$/gm,

  // Classic / versioned-docs navigation chrome (PostgreSQL, Read the Docs, devdocs):
  // version switcher bars and "Prev Up Home Next" pager rows on their own line.
  /^\[Current\][^\n]*(?:\/[^\n]*)+$/gm,
  /^[ \t]*(?:Prev(?:ious)?|Next|Up|Home)(?:[ \t]+(?:Prev(?:ious)?|Next|Up|Home)){2,}[ \t]*$/gim,
  /^[ \t]*v?\d+(?:\.\d+)*[ \t]*(?:\|[ \t]*v?\d+(?:\.\d+)*[ \t]*){2,}$/gm,

  // Event/conference nav headings (heading line only \u2014 never eats following prose,
  // so a legitimate "## Community" section with real content is untouched).
  /^#{2,4}[ \t]*(?:Upcoming(?:[ \t]+\w+){0,3}[ \t]+Events?|Global[ \t]+Events?|Upcoming[ \t]+Conferences?|Webinars?)[ \t]*$/gim,
];
