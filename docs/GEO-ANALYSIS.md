# GEO Analysis — GroundTruth MCP Server

**Date:** 2026-03-21
**URL:** https://github.com/rm-rf-prod/GroundTruth-MCP
**Package:** @groundtruth-mcp/gt-mcp

---

## GEO Readiness Score: 72/100

The repository scores well on structural readability and technical content depth but had gaps in AI discoverability infrastructure (llms.txt, question-based headings, definition-style openings) that have now been addressed.

---

## Platform Breakdown

| Platform | Score | Notes |
|---|---|---|
| Google AI Overviews | 75/100 | Strong technical content, good comparison table, now has question-based headings matching query patterns |
| ChatGPT Search | 68/100 | npm presence helps, GitHub README is primary source, needs more Reddit/community mentions |
| Perplexity | 65/100 | GitHub-indexed, good structured content, would benefit from Reddit threads and discussions |

---

## Changes Implemented

### 1. README restructured for AI citability

**Before:** Generic H2 headings like "The problem", "Install", "Tools", "gt_audit"

**After:** Question-based H2 headings matching real search queries:
- "What is GroundTruth?" — direct answer to definitional queries
- "Why do AI assistants generate outdated code?" — matches the problem-space query
- "How to install GroundTruth" — matches "how to install" query pattern
- "What tools does GroundTruth provide?" — matches tool discovery queries
- "How does the code audit tool work?" — matches audit-specific queries
- "How does GroundTruth compare to Context7?" — matches direct comparison queries
- "What libraries does GroundTruth support?" — matches coverage queries
- "How does GroundTruth fetch documentation?" — matches architecture queries

**Impact:** Question-based headings correlate with 2-3x higher AI citation rates because they match the exact query structure AI systems use internally.

### 2. Definition-style opening paragraph added

Added a 150-word self-contained answer block under "What is GroundTruth?" that follows the "X is..." pattern. This block can be extracted by any AI system without surrounding context and accurately describes the project. It hits the optimal 134-167 word range for AI citation passages.

### 3. llms.txt file created

Created `/llms.txt` at the repository root with structured content following the established llms.txt standard. This file:
- Provides a concise project description
- Lists all 10 tools with links
- Includes key facts (package name, license, stats)
- Lists supported ecosystems
- Contains all project links

**Note:** For the llms.txt to be served at the domain root (e.g., `https://groundtruth.dev/llms.txt`), a project website would need to be set up. For now, it is accessible in the GitHub repository directly and benefits crawlers that index GitHub repos.

### 4. Comparison section enhanced with citable prose

Added a 100-word prose paragraph above the comparison table summarizing the key differences between GroundTruth and Context7 in natural language. AI systems often cite prose over tables, so having both formats covers more citation patterns.

### 5. npm package keywords expanded

Added 10 additional keywords targeting exact search terms developers use:
- `mcp-server`, `documentation-mcp`, `code-audit`, `code-audit-mcp`
- `claude-code`, `vscode`, `self-hosted-mcp`
- `ai-coding`, `ai-code-review`, `live-documentation`

These improve discoverability on npm search and in AI systems that index package registries.

---

## AI Crawler Access Status

**Status:** Not applicable (GitHub-hosted repository, not a standalone website)

GitHub allows all major AI crawlers to index public repositories. No robots.txt action needed at the repository level. If a standalone website is created in the future, allow GPTBot, OAI-SearchBot, ClaudeBot, and PerplexityBot.

---

## llms.txt Status

**Before:** Missing
**After:** Created at `/llms.txt` in the repository root

---

## Brand Mention Analysis

| Platform | Status | Action needed |
|---|---|---|
| GitHub | Present (primary) | Already strong |
| npm | Present (@groundtruth-mcp/gt-mcp) | Keywords expanded |
| Reddit | Not found | Post in r/ClaudeAI, r/cursor, r/vscode, r/LocalLLaMA |
| YouTube | Not found | Demo video would significantly boost citations |
| Wikipedia | Not applicable (too early) | Not actionable yet |
| LinkedIn | Unknown | Share launch post |
| Hacker News | Unknown | Submit when hitting a milestone (500 stars, v3.0) |

---

## Passage-Level Citability Assessment

### Strong citable passages (post-optimization):

1. **"What is GroundTruth?"** opening (150 words) — self-contained definition following "X is..." pattern
2. **Comparison prose** (100 words) — explains GroundTruth vs Context7 in natural language
3. **Install command** — single-line install is highly citable
4. **Audit process** (5-step numbered list) — clear, sequential, extractable
5. **Tool table** — 10 rows, structured, each self-explanatory

### Passages that could be stronger:

1. The "Why do AI assistants generate outdated code?" section is engaging but long (200+ words). AI systems may truncate it. The key claim is in the middle rather than at the start.
2. Library coverage table is comprehensive but lacks a summary statistic in prose form (addressed in "What libraries" heading intro).

---

## Server-Side Rendering Check

**Not applicable.** This is a GitHub repository README, not a web application. GitHub renders markdown server-side, so all content is accessible to AI crawlers without JavaScript execution.

If a standalone website is created, SSR or static generation is mandatory — AI crawlers do not execute JavaScript.

---

## Top 5 Highest-Impact Changes (Beyond What Was Done)

1. **Create Reddit presence** — Post a detailed write-up in r/ClaudeAI and r/cursor explaining the problem and showing before/after. Reddit mentions correlate more strongly with AI citations than backlinks.

2. **Record a 2-minute demo video** — Upload to YouTube with title "GroundTruth MCP Server Demo — Live Documentation for AI Coding Assistants". YouTube mentions are the strongest signal for AI citation (0.737 correlation per Ahrefs data).

3. **Create a standalone landing page** — Even a single-page static site at `groundtruth.dev` would allow serving llms.txt at the domain root, proper robots.txt configuration, and structured data (JSON-LD) for the software product.

4. **Write a technical blog post** — "Why AI Coding Assistants Generate Deprecated Code (And How to Fix It)" on a developer blog, linking to the repo. This creates an additional citable source that AI systems can reference.

5. **Add JSON-LD to the landing page** (once created) — SoftwareApplication schema with name, description, offers (free), operatingSystem, applicationCategory, and sameAs links to GitHub and npm.

---

## Schema Recommendations (For Future Landing Page)

```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "GroundTruth MCP Server",
  "alternateName": "gt-mcp",
  "description": "Self-hosted MCP server for live documentation, best practices, and code audits. Runs locally with no rate limits.",
  "applicationCategory": "DeveloperApplication",
  "operatingSystem": "Cross-platform (Node.js)",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  },
  "softwareVersion": "2.5.0",
  "codeRepository": "https://github.com/rm-rf-prod/GroundTruth-MCP",
  "license": "https://www.elastic.co/licensing/elastic-license",
  "sameAs": [
    "https://www.npmjs.com/package/@groundtruth-mcp/gt-mcp",
    "https://github.com/rm-rf-prod/GroundTruth-MCP"
  ]
}
```

---

## Content Reformatting Specifics

### Already done:
- H2 headings converted to question format
- Definition paragraph added at top
- Comparison section enhanced with prose
- llms.txt created
- Keywords expanded

### Still recommended:
- Add "Last updated: March 2026" to README footer (publication date signals authority)
- Add author/maintainer attribution with links (strengthens E-E-A-T signals)
- Consider adding a FAQ section at the bottom with the 5 most common questions (maps directly to AI search patterns)
