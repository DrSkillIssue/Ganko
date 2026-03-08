/**
 * Flags index structures that are built but never queried by key.
 *
 * Typical anti-pattern: construct a Map/object index via writes, then only
 * iterate or copy it without any keyed lookup.
 */

import type { TSESTree as T } from "@typescript-eslint/utils"
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
          graph.file,
          diagNode,
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
  if (variable.assignments.length === 0) return null
  const first = variable.assignments[0]
  if (!first) return null
  if (first.operator !== null) return null

  const value = first.value

  if (value.type === "NewExpression" && value.callee.type === "Identifier") {
    if (value.callee.name === "Map") return "map"
    return null
  }

  if (value.type === "CallExpression" && value.callee.type === "Identifier") {
    if (value.callee.name === "Map") return "map"
    return null
  }

  if (value.type === "ObjectExpression") return "object"

  return null
}

function isExportedAtDeclaration(variable: VariableEntity): boolean {
  for (let i = 0; i < variable.declarations.length; i++) {
    const decl = variable.declarations[i]
    if (!decl) continue;
    if (decl.type !== "Identifier") continue
    const declarator = decl.parent
    if (!declarator || declarator.type !== "VariableDeclarator") continue
    const varDecl = declarator.parent
    if (!varDecl || varDecl.type !== "VariableDeclaration") continue
    if (varDecl.parent?.type === "ExportNamedDeclaration") return true
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

    if (parent.type === "MemberExpression" && parent.object === readNode) {
      const call = parent.parent
      if (call?.type === "CallExpression" && call.callee === parent) {
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
        if (!parent.computed) {
          escapes = true
          continue
        }

        const grand = parent.parent
        if (grand?.type === "AssignmentExpression" && grand.left === parent) {
          writes++
          continue
        }
        if (grand?.type === "UpdateExpression") {
          writes++
          continue
        }

        queries++
        continue
      }

      // Map property reads are only safe for size.
      const propertyName = memberPropertyName(parent)
      if (propertyName === "size") continue
      escapes = true
      continue
    }

    if (parent.type === "ForOfStatement" && parent.right === readNode) {
      continue
    }

    if (parent.type === "ReturnStatement") {
      escapes = true
      continue
    }

    if (parent.type === "ExportSpecifier" || parent.type === "ExportNamedDeclaration") {
      escapes = true
      continue
    }

    if (
      parent.type === "VariableDeclarator" &&
      parent.init === readNode
    ) {
      escapes = true
      continue
    }

    if (
      parent.type === "AssignmentExpression" &&
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

function memberPropertyName(node: T.MemberExpression): string | null {
  const property = node.property
  if (property.type === "Identifier") return property.name
  if (property.type === "Literal" && typeof property.value === "string") return property.value
  return null
}

function isCallArgument(node: T.Node, parent: T.Node): boolean {
  if (parent.type === "CallExpression" || parent.type === "NewExpression") {
    for (let i = 0; i < parent.arguments.length; i++) {
      const argument = parent.arguments[i]
      if (!argument) continue;
      if (argument === node) return true
      if (argument.type === "SpreadElement" && argument.argument === node) return true
    }
  }

  if (parent.type === "SpreadElement") {
    const grand = parent.parent
    if (!grand) return false
    return grand.type === "CallExpression" || grand.type === "NewExpression"
  }

  return false
}
