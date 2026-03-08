import { createDiagnosticFromLoc, resolveMessage } from "../../diagnostic"
import { defineCrossRule } from "../rule"

const messages = {
  unstableFontSwap:
    "`@font-face` for '{{family}}' uses `font-display: {{display}}` without metric overrides (for example `size-adjust`), which can cause CLS when the webfont swaps in.",
} as const

const SWAP_DISPLAYS = new Set(["swap", "fallback"])

export const cssLayoutFontSwapInstability = defineCrossRule({
  id: "css-layout-font-swap-instability",
  severity: "warn",
  messages,
  meta: {
    description: "Require metric overrides for swapping webfonts to reduce layout shifts during font load.",
    fixable: false,
    category: "css-layout",
  },
  check(context, emit) {
    const usedFamilies = context.css.usedFontFamilies
    if (usedFamilies.size === 0) return

    for (const family of usedFamilies) {
      const descriptors = context.css.fontFaceDescriptorsByFamily.get(family)
      if (!descriptors) continue

      let hasAnyMetricsAdjustedCandidate = false
      const pendingReports: {
        declaration: NonNullable<(typeof descriptors)[number]["displayDeclaration"]>
        display: string
      }[] = []

      for (let i = 0; i < descriptors.length; i++) {
        const descriptor = descriptors[i]
        if (!descriptor) continue
        if (!descriptor.displayDeclaration) continue
        if (!descriptor.display) continue
        if (!SWAP_DISPLAYS.has(descriptor.display)) continue
        if (!descriptor.hasWebFontSource) continue

        if (descriptor.hasEffectiveMetricOverrides) {
          hasAnyMetricsAdjustedCandidate = true
          continue
        }

        pendingReports.push({
          declaration: descriptor.displayDeclaration,
          display: descriptor.display,
        })
      }

      if (pendingReports.length === 0) continue
      if (hasAnyMetricsAdjustedCandidate) continue

      for (let i = 0; i < pendingReports.length; i++) {
        const report = pendingReports[i]
        if (!report) continue
        emit(
          createDiagnosticFromLoc(
            report.declaration.file.path,
            {
              start: { line: report.declaration.startLine, column: report.declaration.startColumn },
              end: {
                line: report.declaration.startLine,
                column: report.declaration.startColumn + report.declaration.property.length,
              },
            },
            cssLayoutFontSwapInstability.id,
            "unstableFontSwap",
            resolveMessage(messages.unstableFontSwap, {
              family,
              display: report.display,
            }),
            "warn",
          ),
        )
      }
    }
  },
})
