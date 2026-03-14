import { collectSignalSnapshot, readElementsByKnownSignalValue, readReservedSpaceFact } from "../layout"
import { defineCrossRule } from "../rule"
import { emitLayoutDiagnostic, isDeferredContainerLike } from "./rule-runtime"

const messages = {
  missingIntrinsicSize:
    "`content-visibility: auto` on '{{tag}}' lacks intrinsic size reservation (`contain-intrinsic-size`/min-height/height/aspect-ratio), which can cause CLS.",
} as const

export const cssLayoutContentVisibilityNoIntrinsicSize = defineCrossRule({
  id: "css-layout-content-visibility-no-intrinsic-size",
  severity: "warn",
  messages,
  meta: {
    description: "Require intrinsic size reservation when using content-visibility auto to avoid late layout shifts.",
    fixable: false,
    category: "css-layout",
  },
  check(context, emit) {
    const candidates = readElementsByKnownSignalValue(context.layout, "content-visibility", "auto")
    for (let i = 0; i < candidates.length; i++) {
      const node = candidates[i]
      if (!node) continue
      const snapshot = collectSignalSnapshot(context, node)
      if (!isDeferredContainerLike(node, snapshot.node.textualContent)) continue
      const reservedSpace = readReservedSpaceFact(context.layout, node)
      if (reservedSpace.hasReservedSpace) continue

      if (!emitLayoutDiagnostic(context.layout, node, emit, cssLayoutContentVisibilityNoIntrinsicSize.id, "missingIntrinsicSize", messages.missingIntrinsicSize, cssLayoutContentVisibilityNoIntrinsicSize.severity)) continue
    }
  },
})
