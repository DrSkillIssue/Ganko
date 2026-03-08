import { buildCSSGraph } from "../../src/css/plugin"
import type { CSSGraph } from "../../src"
import type { CSSInput } from "../../src/css"

type CSSOptions = CSSInput["options"];

/**
 * Build a CSSGraph from CSS source string.
 */
export function buildGraph(
  css: string,
  filePath = "test.css",
  options: CSSOptions = {},
): CSSGraph {
  return buildCSSGraph({
    files: [{ path: filePath, content: css }],
    options,
  })
}

/**
 * Build a CSSGraph from multiple CSS files.
 */
export function buildGraphMultiple(
  files: Array<{ path: string; content: string }>,
  options: CSSOptions = {},
): CSSGraph {
  return buildCSSGraph({
    files,
    options,
  })
}

/**
 * Safely index into a readonly array, throwing if the element is missing.
 * Use in tests where the element is expected to exist.
 */
export function at<T>(arr: readonly T[], index: number): T {
  const value = arr[index]
  if (value === undefined) throw new Error(`Expected element at index ${index}, but array length is ${arr.length}`)
  return value
}
