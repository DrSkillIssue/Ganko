import { buildCSSResult } from "../../src/css/impl"
import type { CSSWorkspaceView } from "../../src/css/workspace-view"
import type { CSSSyntaxTree } from "../../src/compilation/core/css-syntax-tree"
import type { CSSInput } from "../../src/css"

type CSSOptions = CSSInput["options"]

export function buildGraph(
  css: string,
  filePath = "test.css",
  options: CSSOptions = {},
): CSSWorkspaceView {
  return buildCSSResult({
    files: [{ path: filePath, content: css }],
    options,
  }).workspace
}

export function buildGraphMultiple(
  files: Array<{ path: string; content: string }>,
  options: CSSOptions = {},
): CSSWorkspaceView {
  return buildCSSResult({
    files,
    options,
  }).workspace
}

export function buildTrees(
  css: string,
  filePath = "test.css",
  options: CSSOptions = {},
): readonly CSSSyntaxTree[] {
  return buildCSSResult({
    files: [{ path: filePath, content: css }],
    options,
  }).trees
}

export function buildTreesMultiple(
  files: Array<{ path: string; content: string }>,
  options: CSSOptions = {},
): readonly CSSSyntaxTree[] {
  return buildCSSResult({
    files,
    options,
  }).trees
}

export function at<T>(arr: readonly T[], index: number): T {
  const value = arr[index]
  if (value === undefined) throw new Error(`Expected element at index ${index}, but array length is ${arr.length}`)
  return value
}
