export type { EvidenceCheck } from "./evidence/match.js";
export {
  normalizeForMatching,
  countTokenHits,
  stripUrlNoise,
  checkEvidence,
} from "./evidence/match.js";
export type { EvidenceSource } from "./evidence/render.js";
export { buildEvidenceBlock, extractHeadingOutline, buildHonestMiss } from "./evidence/render.js";
