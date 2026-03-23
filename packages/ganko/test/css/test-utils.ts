import { buildCSSResult } from "../../src/css/impl"
import { createCSSInput } from "../../src/css/input"
import type { CSSWorkspaceView } from "../../src/css/workspace-view"
import type { CSSSyntaxTree } from "../../src/compilation/core/css-syntax-tree"
import type { CSSOptions } from "../../src/css/input"

export function buildGraph(
  css: string,
  filePath = "test.css",
  options: CSSOptions = {},
): CSSWorkspaceView {
  const input = createCSSInput([{ path: filePath, content: css }])
  input.options = options
  return buildCSSResult(input).workspace
}

export function buildGraphMultiple(
  files: Array<{ path: string; content: string }>,
  options: CSSOptions = {},
): CSSWorkspaceView {
  const input = createCSSInput(files)
  input.options = options
  return buildCSSResult(input).workspace
}

export function buildTrees(
  css: string,
  filePath = "test.css",
  options: CSSOptions = {},
): readonly CSSSyntaxTree[] {
  const input = createCSSInput([{ path: filePath, content: css }])
  input.options = options
  return buildCSSResult(input).trees
}

export function buildTreesMultiple(
  files: Array<{ path: string; content: string }>,
  options: CSSOptions = {},
): readonly CSSSyntaxTree[] {
  const input = createCSSInput(files)
  input.options = options
  return buildCSSResult(input).trees
}

export function at<T>(arr: readonly T[], index: number): T {
  const value = arr[index]
  if (value === undefined) throw new Error(`Expected element at index ${index}, but array length is ${arr.length}`)
  return value
}
