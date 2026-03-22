/**
 * Index Vs For Rule
 *
 * Suggest using `<For>` or `<Index>` based on array element type.
 * - `<For>`: objects - keyed by reference
 * - `<Index>`: primitives - keyed by index
 */

import ts from "typescript";
import type { SolidSyntaxTree as SolidGraph } from "../../../compilation/core/solid-syntax-tree"
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
function findCallbackArrow(el: ts.JsxElement): ts.ArrowFunction | null {
  const children = el.children
  for (let i = 0, len = children.length; i < len; i++) {
    const child = children[i]
    if (!child) continue;
    if (ts.isJsxExpression(child) && child.expression && ts.isArrowFunction(child.expression)) {
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
  if (!ts.isJsxElement(node)) return []

  const ops: FixOperation[] = []
  const importFix = buildSolidImportFix(graph, newTag)
  if (importFix) ops.push(importFix)

  const opening = node.openingElement.tagName
  if (ts.isIdentifier(opening)) {
    ops.push({ range: [opening.getStart(graph.sourceFile), opening.end], text: newTag })
  }

  const closing = node.closingElement.tagName
  if (ts.isIdentifier(closing)) {
    ops.push({ range: [closing.getStart(graph.sourceFile), closing.end], text: newTag })
  }

  const arrow = findCallbackArrow(node)
  const param = arrow?.parameters[0]
  if (!arrow || !param || !ts.isIdentifier(param.name)) return ops

  const func = getFunctionByNode(graph, arrow)
  if (!func) return ops

  const paramName = param.name.text
  const variable = getVariableByNameInScope(graph, paramName, func.scope)
  if (!variable) return ops

  if (fromTag === "For") {
    const body = arrow.body
    if (ts.isBlock(body)) {
      ops.push({ range: [body.getStart(graph.sourceFile) + 1, body.getStart(graph.sourceFile) + 1], text: ` const ${paramName} = ${paramName}();` })
      ops.push({ range: [param.name.getStart(graph.sourceFile), param.name.end], text: `_${paramName}` })
    } else {
      const indent = getIndentAt(graph.sourceFile.text, body.getStart(graph.sourceFile))
      const bodyText = body.getText(graph.sourceFile)
      ops.push({ range: [body.getStart(graph.sourceFile), body.end], text: `{\n${indent}  const ${paramName} = _${paramName}()\n${indent}  return ${bodyText}\n${indent}}` })
      ops.push({ range: [param.name.getStart(graph.sourceFile), param.name.end], text: `_${paramName}` })
    }
  } else {
    const reads = getVariableReads(variable)
    for (let i = 0, len = reads.length; i < len; i++) {
      const read = reads[i]
      if (!read) continue;
      if (read.isProperAccess) {
        ops.push({ range: [read.node.end, read.node.end + 2], text: "" })
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

  emit(createDiagnostic(graph.filePath, el.node, graph.sourceFile, "index-vs-for", messageId, messages[messageId], "warn", fix.length > 0 ? fix : undefined))
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
