/**
 * CSS ESLint Plugin Adapter
 */
import type { CSSInput } from "./input"
import { buildCSSResult } from "./impl"
import { rules } from "./rules"
import { createCachedPluginAdapter } from "../eslint-adapter"

export { rules }

export const { eslintRules } = createCachedPluginAdapter(rules, (context) => {
  const input: CSSInput = {
    files: [{ path: context.filename, content: context.sourceCode.getText() }],
  }
  return buildCSSResult(input).workspace
})
