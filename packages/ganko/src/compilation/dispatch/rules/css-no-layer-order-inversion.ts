import { createDiagnosticFromLoc, resolveMessage } from "../../../diagnostic"
import { hasFlag, DECL_IS_IMPORTANT } from "../../../css/entities"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = {
  layerOrderInversion: "Declaration for `{{property}}` in selector `{{selector}}` appears later but is overridden by an earlier declaration due to @layer precedence.",
} as const

export const cssNoLayerOrderInversion = defineAnalysisRule({
  id: "no-layer-order-inversion",
  severity: "warn",
  messages,
  meta: { description: "Disallow source-order assumptions that are inverted by layer precedence.", fixable: false, category: "css-cascade" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCompilationAction((compilation, _symbolTable, emit) => {
      // Build workspace-wide layer order + multi-declaration index
      const layerOrder = new Map<string, number>()
      const multiDeclarationProperties = new Map<string, import("../../../css/entities/declaration").DeclarationEntity[]>()
      const declarationsByProperty = new Map<string, import("../../../css/entities/declaration").DeclarationEntity[]>()

      for (const [, tree] of compilation.cssTrees) {
        // Collect layer order from at-rules
        const layers = tree.atRulesByKind.get("layer")
        if (layers) {
          for (let i = 0; i < layers.length; i++) {
            const l = layers[i]
            if (!l) continue
            const name = l.parsedParams.layerName
            if (name && !layerOrder.has(name)) layerOrder.set(name, layerOrder.size)
          }
        }
        // Collect all declarations by property
        for (const [property, decls] of tree.declarationsByProperty) {
          const existing = declarationsByProperty.get(property)
          if (existing) { for (let i = 0; i < decls.length; i++) { const d = decls[i]; if (d) existing.push(d) } }
          else { const arr: import("../../../css/entities/declaration").DeclarationEntity[] = []; for (let i = 0; i < decls.length; i++) { const d = decls[i]; if (d) arr.push(d) }; declarationsByProperty.set(property, arr) }
        }
      }

      // Sort and find multi-declaration properties
      for (const [property, decls] of declarationsByProperty) {
        decls.sort((a, b) => a.sourceOrder - b.sourceOrder)
        if (decls.length >= 2) multiDeclarationProperties.set(property, decls)
      }

      const layerOrderFor = (name: string | null): number => {
        if (name === null) return -1
        return layerOrder.get(name) ?? -1
      }

      const seen = new Set<number>()

      for (const [property, declarations] of multiDeclarationProperties) {
        for (let i = 1; i < declarations.length; i++) {
          const later = declarations[i]
          if (!later) continue
          const laterRule = later.rule
          if (!laterRule) continue

          for (let j = 0; j < i; j++) {
            const earlier = declarations[j]
            if (!earlier) continue
            const earlierRule = earlier.rule
            if (!earlierRule) continue
            if (earlier.file.path !== later.file.path) continue
            if (earlierRule.selectorText !== laterRule.selectorText) continue
            if (hasFlag(earlier._flags, DECL_IS_IMPORTANT) !== hasFlag(later._flags, DECL_IS_IMPORTANT)) continue
            if (earlier.value === later.value) continue

            const earlierMedia = earlierRule.containingMedia?.params ?? null
            const laterMedia = laterRule.containingMedia?.params ?? null
            if (earlierMedia !== laterMedia) continue

            const earlierLayer = layerOrderFor(earlierRule.containingLayer?.parsedParams.layerName ?? null)
            const laterLayer = layerOrderFor(laterRule.containingLayer?.parsedParams.layerName ?? null)
            if (earlierLayer <= laterLayer) continue
            if (seen.has(later.id)) continue

            seen.add(later.id)
            emit(createDiagnosticFromLoc(later.file.path, { start: { line: later.startLine, column: later.startColumn }, end: { line: later.startLine, column: later.startColumn + 1 } }, cssNoLayerOrderInversion.id, "layerOrderInversion", resolveMessage(messages.layerOrderInversion, { property, selector: laterRule.selectorText }), "warn"))
          }
        }
      }
    })
  },
})
