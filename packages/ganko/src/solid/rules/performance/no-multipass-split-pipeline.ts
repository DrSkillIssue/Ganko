import type { CallEntity } from "../../entities/call"
import type { TSESTree as T } from "@typescript-eslint/utils"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getCallsByMethodName, getMethodChain } from "../../queries"

const messages = {
  multipassSplit:
    "`split()` followed by multiple array passes allocates heavily on parsing paths. Prefer single-pass parsing.",
} as const

const options = {}

const TERMINAL_METHODS = ["join", "reduce", "forEach", "map", "filter", "flatMap"] as const
const PASS_METHODS = new Set(["map", "filter", "flatMap", "slice"])

export const noMultipassSplitPipeline = defineSolidRule({
  id: "no-multipass-split-pipeline",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow multipass split/map/filter pipelines in parsing code.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    const reported = new Set<CallEntity>()

    for (let i = 0; i < TERMINAL_METHODS.length; i++) {
      const terminalMethod = TERMINAL_METHODS[i]
      if (!terminalMethod) continue
      const calls = getCallsByMethodName(graph, terminalMethod)
      for (let j = 0; j < calls.length; j++) {
        const call = calls[j]
        if (!call) continue
        if (reported.has(call)) continue

        const { calls: chainCalls, methods, root } = getMethodChain(graph, call)
        if (methods.length < 3) continue

        const splitIndex = methods.indexOf("split")
        if (splitIndex === -1) continue

        const passCount = countPassesAfterSplit(methods, splitIndex)
        if (passCount < 2) continue
        if (isSmallLiteralRoot(root)) continue

        for (let k = 0; k < chainCalls.length; k++) {
          const chainCall = chainCalls[k]
          if (!chainCall) continue
          reported.add(chainCall)
        }

        emit(
          createDiagnostic(
            graph.file,
            call.node,
            "no-multipass-split-pipeline",
            "multipassSplit",
            resolveMessage(messages.multipassSplit, {}),
            "warn",
          ),
        )
      }
    }
  },
})

function countPassesAfterSplit(methods: readonly string[], splitIndex: number): number {
  let count = 0
  for (let i = splitIndex + 1; i < methods.length; i++) {
    const method = methods[i]
    if (!method) continue
    if (PASS_METHODS.has(method)) count++
  }
  return count
}

function isSmallLiteralRoot(root: T.Node | null): boolean {
  if (!root) return false
  if (root.type !== "Literal") return false
  return typeof root.value === "string" && root.value.length <= 16
}
