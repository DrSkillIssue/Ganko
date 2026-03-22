/**
 * CSS ESLint Plugin Adapter
 */
import { createCSSInput } from "./input"
import { buildCSSResult } from "./impl"
import { rules } from "./rules"
import { createCachedPluginAdapter } from "../eslint-adapter"

export { rules }

export const { eslintRules } = createCachedPluginAdapter(rules, (context) => {
  return buildCSSResult(createCSSInput([{ path: context.filename, content: context.sourceCode.getText() }])).workspace
})
