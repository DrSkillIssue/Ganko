/**
 * Index Vs For Rule
 *
 * Suggest using `<For>` or `<Index>` based on array element type.
 * - `<For>`: objects - keyed by reference
 * - `<Index>`: primitives - keyed by index
 */

import type { TSESTree as T } from "@typescript-eslint/utils"
import type { SolidGraph } from "../../impl"
import type { JSXElementEntity } from "../../entities/jsx"
import type { FixOperation } from "../../../diagnostic"
import type { Emit } from "../../../graph"
import { createDiagnostic } from "../../../diagnostic"
import { defineSolidRule } from "../../rule"
import { buildSolidImportFix } from "../util"
import {
  getJSXElementsByTag,
  getJSXAttributeValue,
  hasTypeInfo,
  getArrayElementKind,
  getFunctionByNode,
  getVariableByNameInScope,
  getVariableReads,
} from "../../queries"

type LoopTag = "For" | "Index"

const messages = {
  indexWithObjects:
    "<Index> with object arrays causes the item accessor to change on any array mutation. Use <For> for objects to maintain reference stability.",
  forWithPrimitives:
    "<For> with primitive arrays (strings, numbers) keys by value, which may cause unexpected re-renders. Consider <Index> if index stability is preferred.",
} as const

/** Find callback arrow in For/Index children. */
function findCallbackArrow(el: T.JSXElement): T.ArrowFunctionExpression | null {
  const children = el.children
  for (let i = 0, len = children.length; i < len; i++) {
    const child = children[i]
    if (!child) continue;
    if (child.type === "JSXExpressionContainer" && child.expression.type === "ArrowFunctionExpression") {
      return child.expression
    }
  }
  return null
}

/** Extract leading whitespace from line containing position. */
function getIndentAt(text: string, pos: number): string {
  let start = pos
  while (start > 0 && text[start - 1] !== "\n") start--
  let end = start
  while (end < pos && (text[end] === " " || text[end] === "\t")) end++
  return text.slice(start, end)
}

/** Create fix ops for tag replacement and callback transformation. */
function createFix(el: JSXElementEntity, newTag: string, fromTag: LoopTag, graph: SolidGraph): readonly FixOperation[] {
  const node = el.node
  if (node.type !== "JSXElement") return []

  const ops: FixOperation[] = []
  const importFix = buildSolidImportFix(graph, newTag)
  if (importFix) ops.push(importFix)

  const opening = node.openingElement.name
  if (opening.type === "JSXIdentifier") {
    ops.push({ range: [opening.range[0], opening.range[1]], text: newTag })
  }

  const closing = node.closingElement?.name
  if (closing?.type === "JSXIdentifier") {
    ops.push({ range: [closing.range[0], closing.range[1]], text: newTag })
  }

  const arrow = findCallbackArrow(node)
  const param = arrow?.params[0]
  if (!arrow || param?.type !== "Identifier") return ops

  const func = getFunctionByNode(graph, arrow)
  if (!func) return ops

  const variable = getVariableByNameInScope(graph, param.name, func.scope)
  if (!variable) return ops

  const name = param.name

  if (fromTag === "For") {
    const body = arrow.body
    if (body.type === "BlockStatement") {
      ops.push({ range: [body.range[0] + 1, body.range[0] + 1], text: ` const ${name} = ${name}();` })
      ops.push({ range: [param.range[0], param.range[1]], text: `_${name}` })
    } else {
      const indent = getIndentAt(graph.sourceCode.text, body.range[0])
      const bodyText = graph.sourceCode.getText(body)
      ops.push({ range: [body.range[0], body.range[1]], text: `{\n${indent}  const ${name} = _${name}()\n${indent}  return ${bodyText}\n${indent}}` })
      ops.push({ range: [param.range[0], param.range[1]], text: `_${name}` })
    }
  } else {
    const reads = getVariableReads(variable)
    for (let i = 0, len = reads.length; i < len; i++) {
      const read = reads[i]
      if (!read) continue;
      if (read.isProperAccess) {
        ops.push({ range: [read.node.range[1], read.node.range[1] + 2], text: "" })
      }
    }
  }

  return ops
}

/** Check if element misuses For/Index based on array element type. */
function checkElement(
  el: JSXElementEntity,
  tag: LoopTag,
  graph: SolidGraph,
  emit: Emit,
): void {
  const each = getJSXAttributeValue(graph, el, "each")
  if (!each) return

  const kind = getArrayElementKind(graph, each)
  if (kind === "unknown") return

  const isIndex = tag === "Index"
  const mismatch = isIndex ? kind === "object" : kind === "primitive"
  if (!mismatch) return

  const replacement: LoopTag = isIndex ? "For" : "Index"
  const fix = createFix(el, replacement, tag, graph)
  const messageId = isIndex ? "indexWithObjects" : "forWithPrimitives"

  emit(createDiagnostic(graph.file, el.node, "index-vs-for", messageId, messages[messageId], "warn", fix.length > 0 ? fix : undefined))
}

const options = {}

export const indexVsFor = defineSolidRule({
  id: "index-vs-for",
  severity: "warn",
  messages,
  meta: {
    description: "Suggest <For> for object arrays and <Index> for primitive arrays.",
    fixable: true,
    category: "solid",
  },
  options,
  check(graph, emit) {
    if (!hasTypeInfo(graph)) return

    for (const el of getJSXElementsByTag(graph, "For")) checkElement(el, "For", graph, emit)
    for (const el of getJSXElementsByTag(graph, "Index")) checkElement(el, "Index", graph, emit)
  },
})
