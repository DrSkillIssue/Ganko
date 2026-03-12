import type { BaseRule } from "../graph"
import type { SolidGraph } from "../solid/impl"
import type { CSSGraph } from "../css/impl"
import type { LayoutGraph } from "./layout"
import type { Logger } from "@drskillissue/ganko-shared"

export interface CrossRuleContext {
  readonly solids: readonly SolidGraph[]
  readonly css: CSSGraph
  readonly layout: LayoutGraph
  readonly logger: Logger
}

/**
 * A cross-file lint rule that requires both Solid and CSS graphs.
 */
export type CrossRule = BaseRule<CrossRuleContext>

/**
 * Define a cross-file lint rule.
 * @param def Rule definition
 * @returns The same rule definition
 */
export function defineCrossRule(def: CrossRule): CrossRule {
  return def
}
