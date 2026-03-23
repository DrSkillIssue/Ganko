/**
 * Flags index structures that are built but never queried by key.
 *
 * Typical anti-pattern: construct a Map/object index via writes, then only
 * iterate or copy it without any keyed lookup.
 */

import ts from "typescript"
import type { VariableEntity } from "../../entities"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { iterateVariables } from "../../queries"

const messages = {
  writeOnlyIndex:
    "Index '{{name}}' is built via writes but never queried by key. Remove it or use direct collection flow.",
} as const

const options = {}

const MAP_WRITE_METHODS = new Set(["set"])
const MAP_QUERY_METHODS = new Set(["get", "has"])
const MAP_ITERATION_METHODS = new Set(["entries", "values", "keys", "forEach"])

type IndexKind = "map" | "object"

interface IndexUsage {
  writes: number
  queries: number
  escapes: boolean
}

export const noWriteOnlyIndex = defineSolidRule({
  id: "no-write-only-index",
  severity: "warn",
  messages,
  meta: {
    description: "Detect index structures that are written but never queried by key.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    for (const variable of iterateVariables(graph)) {
      if (!looksLikeIndexName(variable.name)) continue

      const kind = resolveIndexKind(variable)
      if (!kind) continue
      if (isExportedAtDeclaration(variable)) continue

      const usage = collectIndexUsage(variable, kind)
      if (usage.escapes) continue
      if (usage.writes === 0) continue
      if (usage.queries > 0) continue

      const diagNode = variable.declarations[0] ?? variable.assignments[0]?.node ?? variable.reads[0]?.node
      if (!diagNode) continue

      emit(
        createDiagnostic(
          graph.filePath,
          diagNode,
          graph.sourceFile,
          "no-write-only-index",
          "writeOnlyIndex",
          resolveMessage(messages.writeOnlyIndex, { name: variable.name }),
          "warn",
        ),
      )
    }
  },
})

function resolveIndexKind(variable: VariableEntity): IndexKind | null {
  const value = variable.initializer
  if (!value) return null

  if (ts.isNewExpression(value) && ts.isIdentifier(value.expression)) {
    if (value.expression.text === "Map") return "map"
    return null
  }

  if (ts.isCallExpression(value) && ts.isIdentifier(value.expression)) {
    if (value.expression.text === "Map") return "map"
    return null
  }

  if (ts.isObjectLiteralExpression(value)) return "object"

  return null
}

function isExportedAtDeclaration(variable: VariableEntity): boolean {
  for (let i = 0; i < variable.declarations.length; i++) {
    const decl = variable.declarations[i]
    if (!decl) continue;
    if (!ts.isIdentifier(decl)) continue
    const declarator = decl.parent
    if (!declarator || !ts.isVariableDeclaration(declarator)) continue
    const varDecl = declarator.parent
    if (!varDecl || !ts.isVariableDeclarationList(varDecl)) continue
    const varStmt = varDecl.parent
    if (!varStmt || !ts.isVariableStatement(varStmt)) continue
    if (varStmt.parent && ts.isExportDeclaration(varStmt.parent)) return true
    // Check for export modifier on the variable statement
    if (varStmt.modifiers) {
      for (const mod of varStmt.modifiers) {
        if (mod.kind === ts.SyntaxKind.ExportKeyword) return true
      }
    }
  }
  return false
}

function collectIndexUsage(variable: VariableEntity, kind: IndexKind): IndexUsage {
  let writes = 0
  let queries = 0
  let escapes = false

  for (let i = 0; i < variable.reads.length; i++) {
    const read = variable.reads[i]
    if (!read) continue
    const readNode = read.node
    const parent = readNode.parent
    if (!parent) continue

    if (ts.isPropertyAccessExpression(parent) && parent.expression === readNode) {
      const call = parent.parent
      if (call && ts.isCallExpression(call) && call.expression === parent) {
        const method = memberPropertyName(parent)
        if (!method) {
          escapes = true
          continue
        }

        if (kind === "map") {
          if (MAP_WRITE_METHODS.has(method)) {
            writes++
            continue
          }
          if (MAP_QUERY_METHODS.has(method)) {
            queries++
            continue
          }
          if (MAP_ITERATION_METHODS.has(method)) continue
          escapes = true
          continue
        }

        // Object dictionary with method calls is ambiguous.
        escapes = true
        continue
      }

      if (kind === "object") {
        escapes = true
        continue
      }

      // Map property reads are only safe for size.
      const propertyName = memberPropertyName(parent)
      if (propertyName === "size") continue
      escapes = true
      continue
    }

    if (ts.isElementAccessExpression(parent) && parent.expression === readNode) {
      if (kind === "object") {
        const grand = parent.parent
        if (grand && ts.isBinaryExpression(grand) && grand.operatorToken.kind === ts.SyntaxKind.EqualsToken && grand.left === parent) {
          writes++
          continue
        }
        if (grand && (ts.isPrefixUnaryExpression(grand) || ts.isPostfixUnaryExpression(grand))) {
          writes++
          continue
        }

        queries++
        continue
      }

      // Element access on Map always counts as an escape
      escapes = true
      continue
    }

    if (ts.isForOfStatement(parent) && parent.expression === readNode) {
      continue
    }

    if (ts.isReturnStatement(parent)) {
      escapes = true
      continue
    }

    if (ts.isExportSpecifier(parent) || ts.isExportDeclaration(parent)) {
      escapes = true
      continue
    }

    if (
      ts.isVariableDeclaration(parent) &&
      parent.initializer === readNode
    ) {
      escapes = true
      continue
    }

    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      parent.right === readNode
    ) {
      escapes = true
      continue
    }

    if (isCallArgument(readNode, parent)) {
      escapes = true
      continue
    }

    // Unknown use-site: treat as escaping to remain conservative.
    escapes = true
  }

  return { writes, queries, escapes }
}

function looksLikeIndexName(name: string): boolean {
  if (name.length === 0) return false
  if (name.startsWith("by")) return true
  if (name.includes("Index") || name.includes("index")) return true
  if (name.includes("Lookup") || name.includes("lookup")) return true
  if (name.includes("Dict") || name.includes("dict")) return true
  return false
}

function memberPropertyName(node: ts.PropertyAccessExpression): string | null {
  const property = node.name
  if (ts.isIdentifier(property)) return property.text
  return null
}

function isCallArgument(node: ts.Node, parent: ts.Node): boolean {
  if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
    const args = parent.arguments
    if (args) {
      for (let i = 0; i < args.length; i++) {
        const argument = args[i]
        if (!argument) continue;
        if (argument === node) return true
        if (ts.isSpreadElement(argument) && argument.expression === node) return true
      }
    }
  }

  if (ts.isSpreadElement(parent)) {
    const grand = parent.parent
    if (!grand) return false
    return ts.isCallExpression(grand) || ts.isNewExpression(grand)
  }

  return false
}
