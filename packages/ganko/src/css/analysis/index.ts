/**
 * Analysis Utilities
 *
 * Higher-level analysis functions for CSS graph inspection.
 */

// Specificity analysis (canonical implementation in parser/specificity.ts)
export {
  calculateSpecificity,
  compareSpecificity,
  specificityToScore,
  formatSpecificity,
  isHigherSpecificity,
  sortBySpecificity,
} from "../parser/specificity";

// Cascade resolution
export {
  getCascadePosition,
  compareCascadePositions,
  compareCascade,
  resolveCascade,
  sortByCascade,
  doesOverride,
} from "./cascade";

// Complexity metrics
export {
  buildComplexity,
  complexityToScore,
  isOverlyComplex,
  getComplexityReasons,
  sortByComplexity,
} from "./complexity";
export type {
  SelectorComplexity,
  ComplexityThresholds,
} from "./complexity";

// Dead code detection
export {
  findUnusedCode,
  findUnusedVariables,
  findUnusedMixins,
  findUnusedFunctions,
  findUnusedPlaceholders,
  findUnusedKeyframes,
} from "./dead-code";
export type { UnusedCodeReport } from "./dead-code";
