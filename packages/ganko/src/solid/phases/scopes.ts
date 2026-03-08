import type { TSESTree as T, TSESLint } from "@typescript-eslint/utils"
import type { SolidGraph } from "../impl"
import type { SolidInput } from "../input"
import type { ScopeEntity } from "../entities/scope"
import type { VariableEntity, ReadEntity, AssignmentEntity } from "../entities/variable"
import type { FileEntity } from "../entities/file"
import { UNKNOWN_CONTEXT, createScope, buildScopeChain } from "../entities/scope"
import { createVariable } from "../entities/variable"
import { isInLoop, isInConditional } from "../util/expression"

export function runScopesPhase(graph: SolidGraph, input: SolidInput): void {
  const scopeManager = input.sourceCode.scopeManager
  if (!scopeManager) return

  const file = graph.fileEntity
  const eslintScopes = scopeManager.scopes
  const scopeCount = eslintScopes.length
  if (scopeCount === 0) return;

  // First pass: create all scopes
  for (let i = 0; i < scopeCount; i++) {
    const eslintScope = eslintScopes[i]
    if (!eslintScope) continue
    const parent = eslintScope.upper
      ? graph.eslintScopeMap.get(eslintScope.upper) ?? null
      : null
    const resolvedContext = parent?._resolvedContext ?? UNKNOWN_CONTEXT
    const kind = getScopeKind(eslintScope)
    const scope = createScope({
      id: graph.nextScopeId(),
      node: eslintScope.block,
      file,
      kind,
      parent,
      trackingContext: null,
      resolvedContext,
    })
    buildScopeChain(scope)
    graph.addScope(scope, eslintScope)
    if (parent) {
      parent.children.push(scope)
    }
  }

  // Second pass: create variables for each scope
  for (let i = 0; i < scopeCount; i++) {
    const eslintScope = eslintScopes[i]
    if (!eslintScope) continue
    const scopeEntity = graph.eslintScopeMap.get(eslintScope)
    if (!scopeEntity) continue
    const scopeVars: VariableEntity[] = []
    let varsByName: Map<string, VariableEntity> | null = null
    const eslintVars = eslintScope.variables
    for (let vi = 0, vlen = eslintVars.length; vi < vlen; vi++) {
      const eslintVar = eslintVars[vi]
      if (!eslintVar) continue
      if (eslintVar.name === "arguments") continue
      const variable = buildVariable(graph, file, eslintVar, scopeEntity)
      graph.addVariable(variable)
      scopeVars.push(variable)
      if (varsByName === null) varsByName = new Map()
      varsByName.set(variable.name, variable)
    }
    if (scopeVars.length > 0) {
      scopeEntity.variables = scopeVars
    }
    scopeEntity._variablesByName = varsByName
  }
}

function getScopeKind(scope: TSESLint.Scope.Scope): "program" | "function" | "block" {
  switch (scope.type) {
    case "global":
    case "module":
      return "program"
    case "function":
    case "function-expression-name":
      return "function"
    default:
      return "block"
  }
}

function buildVariable(
  graph: SolidGraph,
  file: FileEntity,
  eslintVar: TSESLint.Scope.Variable,
  scope: ScopeEntity,
): VariableEntity {
  const defs = eslintVar.defs
  const defsLen = defs.length
  const declarations: T.Node[] = []
  for (let i = 0; i < defsLen; i++) {
    const def = defs[i]
    if (!def) continue
    declarations.push(def.name)
  }
  const variable = createVariable({
    id: graph.nextVariableId(),
    name: eslintVar.name,
    file,
    scope,
    declarations,
  })
  const refs = eslintVar.references
  const refsLen = refs.length
  if (refsLen === 0) return variable
  const reads: ReadEntity[] = []
  const assignments: AssignmentEntity[] = []
  for (let i = 0; i < refsLen; i++) {
    const ref = refs[i]
    if (!ref) continue
    const identifier = ref.identifier
    const inLoop = isInLoop(identifier)
    const inConditional = isInConditional(identifier)
    if (ref.isRead()) {
      const refScope = graph.eslintScopeMap.get(ref.from) ?? scope
      const parent = identifier.parent
      reads.push({
        id: graph.nextMiscId(),
        node: identifier,
        scope: refScope,
        isProperAccess: parent?.type === "CallExpression" && parent.callee === identifier,
        isInLoop: inLoop,
        isInConditional: inConditional,
      })
    }
    if (ref.isWrite() && identifier.type === "Identifier") {
      assignments.push({
        id: graph.nextMiscId(),
        node: identifier,
        value: getAssignmentValue(identifier),
        operator: getAssignmentOperator(identifier),
        isInLoop: inLoop,
        isInConditional: inConditional,
      })
    }
  }
  if (reads.length > 0) variable.reads = reads
  if (assignments.length > 0) variable.assignments = assignments
  return variable
}

function getAssignmentValue(identifier: T.Identifier): T.Expression {
  const parent = identifier.parent
  if (parent?.type === "VariableDeclarator" && parent.init) return parent.init
  if (parent?.type === "AssignmentExpression" && parent.left === identifier) return parent.right
  return identifier
}

function getAssignmentOperator(identifier: T.Identifier): T.AssignmentExpression["operator"] | null {
  const parent = identifier.parent
  if (parent?.type === "AssignmentExpression" && parent.left === identifier) return parent.operator
  return null
}