/**
 * CSSInput - Input type for building CSSGraph from CSS/SCSS source files.
 *
 * This defines the contract for what data is needed to build a CSS
 * program graph. Unlike SolidInput which handles single files via ESLint,
 * CSSInput supports multi-file graphs with explicit file content.
 */

import { noopLogger, type Logger } from "@drskillissue/ganko-shared"
import type { TailwindValidator } from "./tailwind"

/**
 * A single CSS/SCSS file to be processed.
 */
export interface CSSFile {
  /** File path (used for error reporting and import resolution) */
  readonly path: string
  /** Raw file content */
  readonly content: string
}

/**
 * Input for building a CSSGraph from CSS/SCSS source files.
 */
export interface CSSInput {
  readonly files: readonly CSSFile[]
  readonly options: CSSOptions
  readonly tailwind: TailwindValidator | null
  readonly logger: Logger
  readonly externalCustomProperties: ReadonlySet<string> | null
}

export interface CSSInputBuilder {
  files: readonly CSSFile[]
  options: CSSOptions
  tailwind: TailwindValidator | null
  logger: Logger
  externalCustomProperties: ReadonlySet<string> | null
}

export function createCSSInput(files: readonly CSSFile[]): CSSInputBuilder {
  return { files, options: {}, tailwind: null, logger: noopLogger, externalCustomProperties: null }
}

/**
 * Options for CSS graph building.
 */
export interface CSSOptions {
  /** Enable SCSS parsing (default: auto-detect from extension) */
  readonly scss?: boolean
  /** Enable theme token inference (default: true) */
  readonly inferTokens?: boolean
  /** Enable cascade analysis (default: true) */
  readonly analyzeCascade?: boolean
  /** Enable dead code detection (default: false) */
  readonly detectDeadCode?: boolean
  /** Custom token naming patterns */
  readonly tokenPatterns?: TokenPatternConfig
  /** Maximum parse errors before stopping (default: unlimited) */
  readonly maxParseErrors?: number
  /** Error reporting mode (default: "collect") */
  readonly errorReporting?: "silent" | "collect" | "throw"
}

/**
 * Configuration for token naming pattern detection.
 */
export interface TokenPatternConfig {
  readonly color?: readonly RegExp[]
  readonly spacing?: readonly RegExp[]
  readonly typography?: readonly RegExp[]
  readonly custom?: readonly { category: string; patterns: readonly RegExp[] }[]
}
