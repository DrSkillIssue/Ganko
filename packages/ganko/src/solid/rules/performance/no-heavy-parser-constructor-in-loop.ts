import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getNewExpressionsByCallee } from "../../queries"
import { getEnclosingLoop } from "../../util"
import { isLikelyStringParsingContext } from "./string-parsing-context"

const messages = {
  heavyParserConstructor:
    "`new {{ctor}}(...)` inside parsing loops repeatedly allocates heavy parser helpers. Hoist and reuse instances.",
} as const

const options = {}

const HEAVY_CONSTRUCTORS = [
  "RegExp",
  "URL",
  "URLSearchParams",
  "TextEncoder",
  "TextDecoder",
] as const

export const noHeavyParserConstructorInLoop = defineSolidRule({
  id: "no-heavy-parser-constructor-in-loop",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow constructing heavy parsing helpers inside loops.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    for (let i = 0; i < HEAVY_CONSTRUCTORS.length; i++) {
      const ctor = HEAVY_CONSTRUCTORS[i]
      if (!ctor) continue
      const expressions = getNewExpressionsByCallee(graph, ctor)
      for (let j = 0; j < expressions.length; j++) {
        const expression = expressions[j]
        if (!expression) continue
        if (!getEnclosingLoop(expression)) continue
        if (!isLikelyStringParsingContext(graph, expression)) continue

        emit(
          createDiagnostic(
            graph.filePath,
            expression,
            graph.sourceFile,
            "no-heavy-parser-constructor-in-loop",
            "heavyParserConstructor",
            resolveMessage(messages.heavyParserConstructor, { ctor }),
            "warn",
          ),
        )
      }
    }
  },
})
