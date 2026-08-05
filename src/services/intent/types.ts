export type GtToolName =
  | "gt_resolve_library"
  | "gt_get_docs"
  | "gt_best_practices"
  | "gt_auto_scan"
  | "gt_search"
  | "gt_audit"
  | "gt_changelog"
  | "gt_compat"
  | "gt_compare"
  | "gt_examples"
  | "gt_migration"
  | "gt_batch_resolve"
  | "gt_snippets";

export interface IntentMatch {
  tool: GtToolName;
  args: Record<string, unknown>;
  reason: string;
  /** 0.0–1.0 confidence score */
  confidence: number;
}

export interface IntentInput {
  query: string;
  projectPath?: string;
}
