import { createCSSDiagnostic, resolveMessage } from "../../../diagnostic"
import { findTransitionProperty, findPropertyInList } from "../../../css/parser/value-util"
import { isLayoutAnimationExempt } from "../../../css/rules/animation/layout-animation-exempt"
import { defineAnalysisRule, ComputationTier } from "../rule"

const layoutProperties = new Set([
  "top", "left", "right", "bottom", "width", "height", "min-width", "max-width", "min-height", "max-height",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border-width", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "font-size", "line-height", "letter-spacing", "word-spacing",
  "grid-template-columns", "grid-template-rows", "grid-column", "grid-row", "flex-basis",
])

const messages = { avoidLayoutAnimation: "Avoid animating layout property `{{property}}`. Prefer transform or opacity to reduce layout thrashing." } as const

export const cssNoLayoutPropertyAnimation = defineAnalysisRule({
  id: "no-layout-property-animation",
  severity: "warn",
  messages,
  meta: { description: "Disallow animating layout-affecting properties.", fixable: false, category: "css-animation" },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCSSSyntaxAction((tree, _symbolTable, emit) => {
      const tDecls = tree.declarationsByProperty.get("transition") ?? []
      const tpDecls = tree.declarationsByProperty.get("transition-property") ?? []
      for (let i = 0; i < tDecls.length; i++) {
        const d = tDecls[i]; if (!d) continue
        const lp = findTransitionProperty(d.value, layoutProperties); if (!lp || isLayoutAnimationExempt(d, lp)) continue
        emit(createCSSDiagnostic(
  d.file.path, d.startLine, d.startColumn,
  cssNoLayoutPropertyAnimation.id, "avoidLayoutAnimation",
  resolveMessage(messages.avoidLayoutAnimation, { property: lp }), "warn",
))
      }
      for (let i = 0; i < tpDecls.length; i++) {
        const d = tpDecls[i]; if (!d) continue
        const lp = findPropertyInList(d.value, layoutProperties); if (!lp || isLayoutAnimationExempt(d, lp)) continue
        emit(createCSSDiagnostic(
  d.file.path, d.startLine, d.startColumn,
  cssNoLayoutPropertyAnimation.id, "avoidLayoutAnimation",
  resolveMessage(messages.avoidLayoutAnimation, { property: lp }), "warn",
))
      }
      // Keyframe declarations
      for (let i = 0; i < tree.declarations.length; i++) {
        const d = tree.declarations[i]; if (!d) continue; const rule = d.rule; if (!rule) continue
        const parent = rule.parent; if (!parent || parent.kind === "rule" || parent.kind !== "keyframes") continue
        const property = d.property.toLowerCase(); if (!layoutProperties.has(property)) continue
        emit(createCSSDiagnostic(
  d.file.path, d.startLine, d.startColumn,
  cssNoLayoutPropertyAnimation.id, "avoidLayoutAnimation",
  resolveMessage(messages.avoidLayoutAnimation, { property }), "warn",
))
      }
    })
  },
})
