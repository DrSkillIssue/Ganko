import type { Emit, Plugin } from "../graph"
import { runRules } from "../graph"
import type { CSSFile, CSSInput } from "./input"
import { createCSSInput } from "./input"
import { buildCSSResult } from "./impl"
import { rules } from "./rules"
import { readFileSync } from "node:fs"
import { CSS_EXTENSIONS, matchesExtension } from "@drskillissue/ganko-shared"

export function analyzeCSSInput(input: CSSInput, emit: Emit): void {
  const { workspace } = buildCSSResult(input)
  runRules(rules, workspace, emit)
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
    const { workspace } = buildCSSResult(createCSSInput(cssFiles))
    runRules(rules, workspace, emit)
  },
}
