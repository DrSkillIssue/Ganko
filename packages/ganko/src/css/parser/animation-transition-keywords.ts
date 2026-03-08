import { CSS_WIDE_KEYWORDS } from "./css-keywords"

const TIME_RE = /^\d*\.?\d+(ms|s)$/

export const ANIMATION_TIMING_KEYWORDS = new Set([
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "linear",
  "step-start",
  "step-end",
])

export const ANIMATION_DIRECTION_KEYWORDS = new Set([
  "normal",
  "reverse",
  "alternate",
  "alternate-reverse",
])

export const ANIMATION_FILL_MODE_KEYWORDS = new Set(["none", "forwards", "backwards", "both"])
export const ANIMATION_PLAY_STATE_KEYWORDS = new Set(["running", "paused"])
export const ANIMATION_ITERATION_KEYWORDS = new Set(["infinite"])
export const TRANSITION_BEHAVIOR_KEYWORDS = new Set(["normal", "allow-discrete"])

export function isTimeToken(token: string): boolean {
  return TIME_RE.test(token)
}

export function isTimingFunctionToken(token: string): boolean {
  if (ANIMATION_TIMING_KEYWORDS.has(token)) return true
  if (token.startsWith("steps(")) return true
  if (token.startsWith("cubic-bezier(")) return true
  if (token.startsWith("linear(")) return true
  return false
}

export function isAnimationKeywordToken(token: string): boolean {
  if (isTimeToken(token)) return true
  if (isTimingFunctionToken(token)) return true
  if (ANIMATION_DIRECTION_KEYWORDS.has(token)) return true
  if (ANIMATION_FILL_MODE_KEYWORDS.has(token)) return true
  if (ANIMATION_PLAY_STATE_KEYWORDS.has(token)) return true
  if (ANIMATION_ITERATION_KEYWORDS.has(token)) return true
  if (CSS_WIDE_KEYWORDS.has(token)) return true

  const numberValue = Number(token)
  if (Number.isFinite(numberValue)) return true
  return false
}

export function isTransitionKeywordToken(token: string): boolean {
  if (CSS_WIDE_KEYWORDS.has(token)) return true
  if (isTimeToken(token)) return true
  if (isTimingFunctionToken(token)) return true
  if (TRANSITION_BEHAVIOR_KEYWORDS.has(token)) return true
  if (token === "none") return true
  if (token.startsWith("--")) return true
  return false
}
