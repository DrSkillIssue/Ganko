import ts from "typescript"
import type { SolidSyntaxTree as SolidGraph } from "../../../compilation/core/solid-syntax-tree"
import type { VariableEntity } from "../../entities"
import { getContainingFunction, getScopeFor, getVariableByNameInScope, typeIncludesString } from "../../queries"
import { isStringExpression } from "../../util"

const STRING_FLAGS = 402653316

const PARSE_NAME_HINTS = [
  "parse",
  "scan",
  "token",
  "lex",
  "decode",
  "delimiter",
  "csv",
  "tsv",
  "header",
] as const

const PARSE_PATH_HINTS = [
  "/parser/",
  "/tokenizer/",
  "/lexer/",
  "/parsing/",
  "-parser.",
  "-lexer.",
] as const

const ASCII_HINTS = ["ascii", "latin1"] as const

export function isLikelyStringParsingContext(graph: SolidGraph, node: ts.Node): boolean {
  if (hasAnyHint(graph.filePath.toLowerCase(), PARSE_PATH_HINTS)) return true

  const fn = getContainingFunction(graph, node)
  if (!fn) return false
  const name = `${fn.name ?? ""} ${fn.variableName ?? ""}`.toLowerCase()
  return hasAnyHint(name, PARSE_NAME_HINTS)
}

export function isAsciiParsingContext(graph: SolidGraph, node: ts.Node): boolean {
  const path = graph.filePath.toLowerCase()
  if (hasAnyHint(path, ASCII_HINTS)) return true

  const fn = getContainingFunction(graph, node)
  if (!fn) return false
  const name = `${fn.name ?? ""} ${fn.variableName ?? ""}`.toLowerCase()
  return hasAnyHint(name, ASCII_HINTS)
}

export function isStringLikeVariable(_graph: SolidGraph, variable: VariableEntity): boolean {
  if (variable.type && (variable.type.flags & STRING_FLAGS) !== 0) return true

  for (let i = 0; i < variable.declarations.length; i++) {
    const declaration = variable.declarations[i]
    if (!declaration) continue;
    if (!ts.isIdentifier(declaration)) continue

    if (hasStringAnnotation(declaration)) return true

    const parent = declaration.parent
    if (!parent) continue

    if (ts.isVariableDeclaration(parent) && parent.initializer && isStringExpression(parent.initializer)) {
      return true
    }

    if (ts.isParameter(parent) && parent.initializer && isStringExpression(parent.initializer)) {
      return true
    }
  }

  for (let i = 0; i < variable.assignments.length; i++) {
    const assignment = variable.assignments[i]
    if (!assignment) continue;
    if (assignment.operator !== null) continue
    if (isStringExpression(assignment.value)) return true
  }

  return false
}

export function isStringLikeReceiver(
  graph: SolidGraph,
  node: ts.Node,
  variable: VariableEntity | null,
): boolean {
  if (variable && isStringLikeVariable(graph, variable)) return true
  if (ts.isIdentifier(node)) {
    const resolved = resolveVariableForIdentifier(graph, node)
    if (resolved && isStringLikeVariable(graph, resolved)) return true
  }
  if (typeIncludesString(graph, node)) return true
  if (ts.isStringLiteral(node)) return true
  if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true

  return false
}

export function resolveVariableForIdentifier(
  graph: SolidGraph,
  node: ts.Identifier,
): VariableEntity | null {
  const scope = getScopeFor(graph, node)
  return getVariableByNameInScope(graph, node.text, scope)
}

function hasStringAnnotation(node: ts.Identifier): boolean {
  const parent = node.parent
  if (!parent) return false

  // Check for type annotation on variable declaration or parameter
  let typeNode: ts.TypeNode | undefined
  if (ts.isVariableDeclaration(parent) || ts.isParameter(parent)) {
    typeNode = parent.type
  }
  if (!typeNode) return false

  if (typeNode.kind === ts.SyntaxKind.StringKeyword) return true
  if (!ts.isUnionTypeNode(typeNode)) return false

  for (let i = 0; i < typeNode.types.length; i++) {
    const t = typeNode.types[i];
    if (!t) continue;
    if (t.kind === ts.SyntaxKind.StringKeyword) return true
  }
  return false
}

function hasAnyHint(text: string, hints: readonly string[]): boolean {
  for (let i = 0; i < hints.length; i++) {
    const hint = hints[i];
    if (!hint) continue;
    if (text.includes(hint)) return true
  }
  return false
}
