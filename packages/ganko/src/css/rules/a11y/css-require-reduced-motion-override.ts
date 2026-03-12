import { resolveMessage } from "../../../diagnostic"
import type { RuleEntity } from "../../entities/rule"
import { defineCSSRule } from "../../rule"
import { emitCSSDiagnostic } from "../util"

const ZERO_MS = /(^|\s|,)0ms($|\s|,)/
const ZERO_S = /(^|\s|,)0s($|\s|,)/
const TIME_VALUE_G = /([0-9]*\.?[0-9]+)(ms|s)/g
const AMPERSAND_G = /&/g
const WHITESPACE_G = /\s+/g

const messages = {
  missingReducedMotion: "Animated selector `{{selector}}` lacks prefers-reduced-motion override.",
} as const

function isAnimationDecl(p: string): boolean {
  return p === "animation" || p === "animation-duration"
}

function isTransitionDecl(p: string): boolean {
  return p === "transition" || p === "transition-duration"
}

function isDisabledMotionValue(v: string): boolean {
  const s = v.toLowerCase()
  if (s.includes("none")) return true
  if (ZERO_MS.test(s)) return true
  if (ZERO_S.test(s)) return true
  return false
}

function hasPositiveTime(value: string): boolean {
  const m = value.toLowerCase().match(TIME_VALUE_G)
  if (!m) return false
  for (let i = 0; i < m.length; i++) {
    const token = m[i]
    if (!token) continue
    const unit = token.endsWith("ms") ? "ms" : "s"
    const raw = token.slice(0, unit === "ms" ? -2 : -1)
    const n = Number(raw)
    if (Number.isNaN(n)) continue
    if (n > 0) return true
  }
  return false
}

function isReducedMotionRule(rule: { containingMedia: { params: string } | null }): boolean {
  const m = rule.containingMedia
  if (!m) return false
  const p = m.params.toLowerCase()
  return p.includes("prefers-reduced-motion") && p.includes("reduce")
}

/**
 * Resolve a rule's selectorText to its fully expanded form by walking the
 * parent chain and substituting `&` nesting references.
 *
 * For a rule with `selectorText` of `&[data-animate]` nested under a parent
 * with `selectorText` of `[data-component="action-card"]`, this returns
 * `[data-component="action-card"][data-animate]`.
 *
 * If the selector doesn't contain `&` but has a parent rule, it is treated as
 * a descendant: `parent child`.
 *
 * Comma-separated selectors in the parent produce the cartesian product with
 * the child selector.  Each result is added to the output array.
 */
function resolveFullSelectors(rule: RuleEntity): string[] {
  // Collect the chain of rule ancestors bottom-up (excluding at-rules which
  // don't contribute to selector nesting).
  const chain: RuleEntity[] = [rule]
  let cur: RuleEntity["parent"] = rule.parent
  while (cur !== null) {
    if (cur.kind === "rule") {
      chain.push(cur)
    }
    cur = cur.parent
  }

  // Start from the outermost ancestor and fold inward.
  // `resolved` holds the set of fully-expanded selectors at each level.
  const outermost = chain[chain.length - 1]
  if (!outermost) return []
  let resolved: string[] = splitSelectors(outermost.selectorText)

  for (let i = chain.length - 2; i >= 0; i--) {
    const chainEntry = chain[i]
    if (!chainEntry) continue
    const childText = chainEntry.selectorText
    const childParts = splitSelectors(childText)
    const next: string[] = []

    for (let p = 0; p < resolved.length; p++) {
      const parent = resolved[p]
      if (!parent) continue
      for (let c = 0; c < childParts.length; c++) {
        const child = childParts[c]
        if (!child) continue
        if (child.includes("&")) {
          next.push(child.replace(AMPERSAND_G, parent))
        } else {
          // Implicit descendant combinator
          next.push(parent + " " + child)
        }
      }
    }
    resolved = next
  }

  return resolved
}

/**
 * Lightweight top-level comma split that respects parentheses and brackets.
 */
function splitSelectors(text: string): string[] {
  const len = text.length
  if (len === 0) return []
  if (text.indexOf(",") === -1) {
    const t = text.trim()
    return t ? [t] : []
  }
  const out: string[] = []
  let start = 0
  let parenD = 0
  let brackD = 0
  for (let i = 0; i < len; i++) {
    const ch = text.charCodeAt(i)
    if (ch === 0x28 /* ( */) parenD++
    else if (ch === 0x29 /* ) */) parenD--
    else if (ch === 0x5b /* [ */) brackD++
    else if (ch === 0x5d /* ] */) brackD--
    else if (ch === 0x2c /* , */ && parenD === 0 && brackD === 0) {
      const t = text.substring(start, i).trim()
      if (t) out.push(t)
      start = i + 1
    }
  }
  const t = text.substring(start).trim()
  if (t) out.push(t)
  return out
}

/** Normalize whitespace for comparison: collapse runs, trim. */
function normalizeSelector(s: string): string {
  return s.replace(WHITESPACE_G, " ").trim()
}

export const cssRequireReducedMotionOverride = defineCSSRule({
  id: "css-require-reduced-motion-override",
  severity: "warn",
  messages,
  meta: {
    description: "Require reduced-motion override for animated selectors.",
    fixable: false,
    category: "css-a11y",
  },
  options: {},
  check(graph, emit) {
    const motionDecls = graph.declarationsForProperties(
      "animation", "animation-duration", "transition", "transition-duration",
    )
    if (motionDecls.length === 0) return

    // Build a set of resolved selectors that have reduced-motion overrides.
    const reduced = new Set<string>()

    for (let i = 0; i < motionDecls.length; i++) {
      const d = motionDecls[i]
      if (!d) continue
      const r = d.rule
      if (!r) continue
      if (!isReducedMotionRule(r)) continue
      const property = d.property.toLowerCase()
      const group = isAnimationDecl(property) ? "animation" : isTransitionDecl(property) ? "transition" : null
      if (!group) continue
      // Any explicit declaration of animation/transition properties inside a
      // prefers-reduced-motion block counts as an acknowledgement — the author
      // may disable motion entirely (none/0ms) or intentionally keep essential
      // feedback with reduced parameters (e.g. spinner duration: 1s).
      const resolved = resolveFullSelectors(r)
      for (let j = 0; j < resolved.length; j++) {
        const sel = resolved[j]
        if (!sel) continue
        const key = `${normalizeSelector(sel)}|${group}`
        reduced.add(key)
      }
    }

    for (let i = 0; i < motionDecls.length; i++) {
      const d = motionDecls[i]
      if (!d) continue
      const r = d.rule
      if (!r) continue
      if (isReducedMotionRule(r)) continue
      const p = d.property.toLowerCase()
      const group = isAnimationDecl(p) ? "animation" : isTransitionDecl(p) ? "transition" : null
      if (!group) continue
      if (isDisabledMotionValue(d.value)) continue
      if (!hasPositiveTime(d.value)) continue

      // Check if any of the resolved selectors for this rule have an override.
      const resolved = resolveFullSelectors(r)
      let covered = false
      for (let j = 0; j < resolved.length; j++) {
        const sel = resolved[j]
        if (!sel) continue
        const key = `${normalizeSelector(sel)}|${group}`
        if (reduced.has(key)) {
          covered = true
          break
        }
      }
      if (covered) continue

      emitCSSDiagnostic(
        emit,
        d.file.path,
        d.startLine,
        d.startColumn,
        cssRequireReducedMotionOverride,
        "missingReducedMotion",
        resolveMessage(messages.missingReducedMotion, { selector: r.selectorText }),
      )
    }
  },
})
