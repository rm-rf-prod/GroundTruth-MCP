import { lookupByAlias } from "../../sources/registry.js";
import type { GtToolName, IntentMatch } from "./types.js";
import { extractMigrationVersions } from "./detect.js";
import { resolveName, type DetectedLibrary } from "./library-detect.js";

export interface VerbContext {
  /** Original, un-normalised query — version ranges and casing survive here. */
  raw: string;
  /** Noise-stripped, lowercased query used for token matching. */
  text: string;
  library: DetectedLibrary | null;
  /** Explicit about/for topic, if the query has one. */
  topic: string | undefined;
  /** Query minus library name, hint phrases and filler — the subject otherwise. */
  residual: string | undefined;
  projectPath: string | undefined;
}

/**
 * Map the highest-precision verb hit to a concrete tool call. Every branch whose
 * target tool has a REQUIRED identifier falls back to gt_search when that
 * identifier could not be parsed — recommending a call that fails the target's
 * own Zod schema is worse than a soft route. Returns null when the verb does
 * not apply (compare sides are not libraries, a migration without a version)
 * so the caller falls back to the library default route.
 */
export function routeVerb(
  top: { tool: GtToolName; word: string },
  ctx: VerbContext,
): IntentMatch | null {
  const { raw, text, library, topic, projectPath } = ctx;
  const subject = topic ?? ctx.residual;
  const args: Record<string, unknown> = {};

  const searchFallback = (verb: string): IntentMatch => ({
    tool: "gt_search",
    args: { query: raw },
    reason: `${verb} verb detected ("${top.word}") but required arguments not parseable — fallback to search`,
    confidence: 0.5,
  });

switch (top.tool) {
  case "gt_audit": {
    args["projectPath"] = projectPath ?? ".";
    args["categories"] = ["all"];
    return {
      tool: "gt_audit",
      args,
      reason: `detected audit/scan verb ("${top.word}")`,
      confidence: 0.9,
    };
  }
  case "gt_migration": {
    if (!library) return searchFallback("migration");
    const versions = extractMigrationVersions(raw);
    if (versions.from === undefined && !/\bv?\d+(?:\.\d+)*\b/.test(raw)) return null;
    args["libraryId"] = library.id;
    if (versions.from !== undefined) args["fromVersion"] = versions.from;
    if (versions.to !== undefined) args["toVersion"] = versions.to;
    return {
      tool: "gt_migration",
      args,
      reason: `detected migration verb ("${top.word}") for ${library.name}`,
      confidence: 0.92,
    };
  }
  case "gt_changelog": {
    if (!library) return searchFallback("changelog/release");
    args["libraryId"] = library.id;
    return {
      tool: "gt_changelog",
      args,
      reason: `detected changelog/release verb ("${top.word}") for ${library.name}`,
      confidence: 0.92,
    };
  }
  case "gt_compare": {
    const libs: string[] = [];
    // crude: "X vs Y", "X or Y", "X and Y", "X with Y" — both sides must resolve below
    const vs = raw.match(/([\w@/.-]+)\s+(?:vs\.?|versus|or|and|with)\s+([\w@/.-]+)/i);
    if (vs && vs[1] && vs[2] && resolveName(vs[1]) && resolveName(vs[2])) libs.push(vs[1], vs[2]);
    if (libs.length < 2) return library ? null : searchFallback("compare");
    args["libraries"] = libs;
    return {
      tool: "gt_compare",
      args,
      reason: `detected compare verb ("${top.word}")`,
      confidence: 0.92,
    };
  }
  case "gt_compat": {
    if (topic) args["feature"] = topic;
    else if (text) args["feature"] = text.replace(/\b(?:does|do|can\s+i\s+use|browsers?|supports?|supported|compatibility|works?|caniuse|which|chrome|firefox|safari|edge|opera|in|on)\b/g, " ").replace(/\s+/g, " ").trim();
    if (!args["feature"]) return searchFallback("compatibility");
    return {
      tool: "gt_compat",
      args,
      reason: `detected compatibility verb ("${top.word}")`,
      confidence: 0.85,
    };
  }
  case "gt_examples": {
    if (!library) return searchFallback("example");
    args["library"] = library.alias;
    if (subject) args["pattern"] = subject;
    return {
      tool: "gt_examples",
      args,
      reason: `detected example verb ("${top.word}") for ${library.name}`,
      confidence: 0.9,
    };
  }
  case "gt_best_practices": {
    if (!library) return searchFallback("best-practices");
    args["libraryId"] = library.id;
    if (subject) args["topic"] = subject;
    return {
      tool: "gt_best_practices",
      args,
      reason: `detected best-practices verb for ${library.name}`,
      confidence: 0.93,
    };
  }
  case "gt_auto_scan": {
    args["projectPath"] = projectPath ?? ".";
    return {
      tool: "gt_auto_scan",
      args,
      reason: `detected project-scan intent ("${top.word}")`,
      confidence: 0.92,
    };
  }
  case "gt_get_docs": {
    if (!library) return searchFallback("docs");
    args["libraryId"] = library.id;
    if (subject) args["topic"] = subject;
    return {
      tool: "gt_get_docs",
      args,
      reason: `detected docs verb for ${library.name}`,
      confidence: 0.95,
    };
  }
  case "gt_resolve_library": {
    if (library) args["libraryName"] = library.alias;
    else args["libraryName"] = text.split(/\s+/)[0] ?? "";
    return {
      tool: "gt_resolve_library",
      args,
      reason: "detected lookup intent",
      confidence: 0.8,
    };
  }
  case "gt_batch_resolve": {
    // text still contains verb tokens ("batch","lookup") but lookupByAlias
    // filters them out since they are not registry aliases — batchTokens
    // ends up holding only genuine library names.
    const batchTokens = text
      .split(/[\s,]+/)
      .map((t) => t.replace(/[^\w@/.-]/g, ""))
      .filter((t) => t.length >= 2 && t.length <= 60 && !!lookupByAlias(t));
    if (batchTokens.length > 0) {
      args["libraryNames"] = batchTokens;
      return {
        tool: "gt_batch_resolve",
        args,
        reason: `detected batch-resolve verb ("${top.word}") with ${batchTokens.length} library name(s)`,
        confidence: 0.82,
      };
    }
    // gt_batch_resolve requires a non-empty libraryNames array (Zod .min(1)).
    return searchFallback("batch-resolve");
  }
  case "gt_search":
  case "gt_snippets":
  default: {
    // gt_snippets requires libraryId — without one the recommendation
    // would fail the target schema.
    if (top.tool === "gt_snippets" && !library) return searchFallback("snippets");
    if (top.tool === "gt_search") args["query"] = topic ?? text;
    if (top.tool === "gt_snippets" && library) {
      args["libraryId"] = library.id;
      if (subject) args["topic"] = subject;
    }
    return {
      tool: top.tool,
      args,
      reason: `detected verb ("${top.word}")`,
      confidence: 0.75,
    };
  }
}
}
