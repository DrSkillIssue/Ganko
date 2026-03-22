import type { Emit, Plugin } from "../graph"
import { runRules } from "../graph"
import type { CSSInput, CSSFile } from "./input"
import type { CSSBuildContext } from "./build-context"
import { createCSSBuildContext } from "./build-context"
import { runPhases } from "./phases"
import { rules } from "./rules"
import { generateExternalPropertiesCSS } from "./library-analysis"
import { readFileSync } from "node:fs"
import { CSS_EXTENSIONS, matchesExtension } from "@drskillissue/ganko-shared"

const EXTERNAL_PROPERTIES_PATH = "<external-library-properties>"

/**
 * Build a CSSBuildContext from input.
 */
export function buildCSSGraph(input: CSSInput): CSSBuildContext {
  const effectiveInput = injectExternalPropertiesFile(input)
  const ctx = createCSSBuildContext(effectiveInput)
  runPhases(ctx, effectiveInput)
  return ctx
}

function injectExternalPropertiesFile(input: CSSInput): CSSInput {
  const externalProps = input.externalCustomProperties
  if (!externalProps || externalProps.size === 0) return input

  const syntheticCSS = generateExternalPropertiesCSS(externalProps)
  if (syntheticCSS === null) return input

  const syntheticFile: CSSFile = {
    path: EXTERNAL_PROPERTIES_PATH,
    content: syntheticCSS,
  }

  return {
    ...input,
    files: [syntheticFile, ...input.files],
  }
}

export function analyzeCSSInput(input: CSSInput, emit: Emit): void {
  const graph = buildCSSGraph(input)
  runRules(rules, graph, emit)
}

export const CSSPlugin: Plugin<"css"> = {
  kind: "css",
  extensions: CSS_EXTENSIONS,

  analyze(files: readonly string[], emit: Emit): void {
    const cssFiles: CSSFile[] = []
    for (const file of files) {
      if (!matchesExtension(file, CSS_EXTENSIONS)) continue
      const content = readFileSync(file, "utf-8")
      cssFiles.push({ path: file, content })
    }
    if (cssFiles.length === 0) return
    const input: CSSInput = { files: cssFiles }
    const graph = buildCSSGraph(input)
    runRules(rules, graph, emit)
  },
}
