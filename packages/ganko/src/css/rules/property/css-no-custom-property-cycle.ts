import { resolveMessage } from "../../../diagnostic"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"

const messages = {
  variableCycle: "Custom property cycle detected involving `{{name}}`.",
} as const

export const cssNoCustomPropertyCycle = defineCSSRule({
  id: "css-no-custom-property-cycle",
  severity: "error",
  messages,
  meta: {
    description: "Disallow cycles in custom property references.",
    fixable: false,
    category: "css-property",
  },
  options: {},
  check(graph, emit) {
    const props = graph.cssCustomProperties
    if (props.length === 0) return

    const vars = new Map<number, (typeof props)[number]>()
    for (let i = 0; i < props.length; i++) {
      const prop = props[i];
      if (!prop) continue;
      vars.set(prop.id, prop)
    }

    const edges = new Map<number, Set<number>>()

    function isSameScope(a: (typeof props)[number], b: (typeof props)[number]): boolean {
      if (a.file.path !== b.file.path) return false
      if (a.scope.type !== b.scope.type) return false
      if (a.scope.condition !== b.scope.condition) return false
      const aSelector = a.scopeSelector?.raw ?? null
      const bSelector = b.scopeSelector?.raw ?? null
      return aSelector === bSelector
    }

    for (const variable of vars.values()) {
      const to = edges.get(variable.id) ?? new Set<number>()
      for (let i = 0; i < variable.declaration.parsedVarRefs.length; i++) {
        const varRef = variable.declaration.parsedVarRefs[i];
        if (!varRef) continue;
        const refName = varRef.name
        if (!refName.startsWith("--")) continue
        const candidates = graph.variablesByName.get(refName)
        if (!candidates || candidates.length === 0) continue

        for (let j = 0; j < candidates.length; j++) {
          const target = candidates[j]
          if (!target) continue
          if (!isSameScope(variable, target)) continue
          to.add(target.id)
        }
      }
      edges.set(variable.id, to)
    }

    const visiting = new Set<number>()
    const visited = new Set<number>()
    const cyclic = new Set<number>()

    const dfs = (n: number): void => {
      if (visited.has(n)) return
      visited.add(n)
      visiting.add(n)
      const to = edges.get(n)
      if (to) {
        for (const next of to) {
          if (!vars.has(next)) continue
          if (visiting.has(next)) {
            cyclic.add(n)
            cyclic.add(next)
            continue
          }
          dfs(next)
          if (cyclic.has(next)) cyclic.add(n)
        }
      }
      visiting.delete(n)
    }

    for (const n of vars.keys()) dfs(n)
    if (cyclic.size === 0) return

    for (const v of vars.values()) {
      if (!cyclic.has(v.id)) continue
      emitCSSDiagnostic(
        emit,
        v.file.path,
        v.declaration.startLine,
        v.declaration.startColumn,
        cssNoCustomPropertyCycle,
        "variableCycle",
        resolveMessage(messages.variableCycle, { name: v.name }),
      )
    }
  },
})
