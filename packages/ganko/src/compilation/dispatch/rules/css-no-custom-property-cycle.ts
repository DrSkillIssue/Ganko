import { createCSSDiagnostic, resolveMessage } from "../../../diagnostic"
import { defineAnalysisRule, ComputationTier } from "../rule"

const messages = { variableCycle: "Custom property cycle detected involving `{{name}}`." } as const

export const cssNoCustomPropertyCycle = defineAnalysisRule({
  id: "css-no-custom-property-cycle",
  severity: "error",
  messages,
  meta: { description: "Disallow cycles in custom property references.", fixable: false, category: "css-property" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCompilationAction((compilation, _symbolTable, emit) => {
      // Collect all CSS custom properties across all trees
      type VarEntry = { id: number; name: string; filePath: string; startLine: number; startColumn: number; scopeType: string; scopeCondition: string | null; scopeSelector: string | null; parsedVarRefs: readonly { name: string }[]; variablesByName: ReadonlyMap<string, readonly VarEntry[]> }
      const allVars: VarEntry[] = []
      const allVarsByName = new Map<string, VarEntry[]>()

      for (const [, tree] of compilation.cssTrees) {
        for (let i = 0; i < tree.variables.length; i++) {
          const v = tree.variables[i]; if (!v || v.name.startsWith("$")) continue
          const entry: VarEntry = { id: v.id, name: v.name, filePath: v.file.path, startLine: v.declaration.startLine, startColumn: v.declaration.startColumn, scopeType: v.scope.type, scopeCondition: v.scope.condition, scopeSelector: v.scopeSelector?.raw ?? null, parsedVarRefs: v.declaration.parsedVarRefs, variablesByName: allVarsByName }
          allVars.push(entry)
          const existing = allVarsByName.get(v.name); if (existing) existing.push(entry); else allVarsByName.set(v.name, [entry])
        }
      }

      if (allVars.length === 0) return

      const edges = new Map<number, Set<number>>()
      for (const variable of allVars) {
        const to = edges.get(variable.id) ?? new Set<number>(); edges.set(variable.id, to)
        for (let i = 0; i < variable.parsedVarRefs.length; i++) {
          const ref = variable.parsedVarRefs[i]; if (!ref || !ref.name.startsWith("--")) continue
          const candidates = allVarsByName.get(ref.name); if (!candidates) continue
          for (let j = 0; j < candidates.length; j++) {
            const target = candidates[j]; if (!target) continue
            if (variable.filePath !== target.filePath || variable.scopeType !== target.scopeType || variable.scopeCondition !== target.scopeCondition || variable.scopeSelector !== target.scopeSelector) continue
            to.add(target.id)
          }
        }
      }

      const visiting = new Set<number>(); const visited = new Set<number>(); const cyclic = new Set<number>()
      const varById = new Map<number, VarEntry>(); for (const v of allVars) varById.set(v.id, v)
      const dfs = (n: number): void => {
        if (visited.has(n)) return; visited.add(n); visiting.add(n)
        const to = edges.get(n)
        if (to) { for (const next of to) { if (!varById.has(next)) continue; if (visiting.has(next)) { cyclic.add(n); cyclic.add(next); continue }; dfs(next); if (cyclic.has(next)) cyclic.add(n) } }
        visiting.delete(n)
      }
      for (const n of varById.keys()) dfs(n)
      if (cyclic.size === 0) return
      for (const v of allVars) {
        if (!cyclic.has(v.id)) continue
        emit(createCSSDiagnostic(
  v.filePath, v.startLine, v.startColumn,
  cssNoCustomPropertyCycle.id, "variableCycle",
  resolveMessage(messages.variableCycle, { name: v.name }), "error",
))
      }
    })
  },
})
