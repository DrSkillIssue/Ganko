/**
 * no-banner-comments
 *
 * Flags banner-style comments that use repeated characters as visual separators.
 * These comments are often AI-generated and add visual noise without value.
 */

import type { Fix } from "../../../diagnostic"
import { createDiagnosticFromComment } from "../../../diagnostic";
import { defineSolidRule } from "../../rule"
import {
  CHAR_NEWLINE,
  CHAR_SPACE,
  CHAR_TAB,
  CHAR_CR,
  CHAR_ASTERISK,
  CHAR_SLASH,
} from "@drskillissue/ganko-shared"

/** Lookup table for banner characters (=-*#/~_+.) */
const BANNER_CHARS = new Uint8Array(128)
for (const char of "=-*#/~_+.") {
  BANNER_CHARS[char.charCodeAt(0)] = 1
}

function isBannerChar(code: number): boolean {
  return code < 128 && BANNER_CHARS[code] === 1
}

function isHorizontalWhitespace(code: number): boolean {
  return code === CHAR_SPACE || code === CHAR_TAB || code === CHAR_CR
}

function isBannerLineRange(
  str: string,
  start: number,
  end: number,
  minLength: number,
): boolean {
  while (start < end && isHorizontalWhitespace(str.charCodeAt(start))) {
    start++
  }

  while (end > start && isHorizontalWhitespace(str.charCodeAt(end - 1))) {
    end--
  }

  if (start < end && str.charCodeAt(start) === CHAR_ASTERISK) {
    start++
    while (start < end && isHorizontalWhitespace(str.charCodeAt(start))) {
      start++
    }
  }

  if (
    end > start + 1 &&
    str.charCodeAt(end - 1) === CHAR_SLASH &&
    str.charCodeAt(end - 2) === CHAR_ASTERISK
  ) {
    end -= 2
    while (end > start && isHorizontalWhitespace(str.charCodeAt(end - 1))) {
      end--
    }
  }

  const len = end - start
  if (len < minLength) return false

  const firstCode = str.charCodeAt(start)
  if (!isBannerChar(firstCode)) return false

  for (let i = start + 1; i < end; i++) {
    if (str.charCodeAt(i) !== firstCode) {
      return false
    }
  }

  return true
}

function hasBannerPattern(value: string, minLength: number): boolean {
  const len = value.length
  if (len < minLength) return false

  let lineStart = 0
  for (let i = 0; i <= len; i++) {
    if (i === len || value.charCodeAt(i) === CHAR_NEWLINE) {
      if (isBannerLineRange(value, lineStart, i, minLength)) return true
      lineStart = i + 1
    }
  }
  return false
}

const messages = {
  banner: "Avoid banner-style comments with repeated separator characters. Use simple comments instead.",
} as const

const options = { minLength: 10 }

export const noBannerComments = defineSolidRule({
  id: "no-banner-comments",
  severity: "error",
  messages,
  meta: {
    description: "Disallow banner-style comments with repeated separator characters.",
    fixable: true,
    category: "correctness",
  },
  options,
  check(graph, emit) {
    if (options.minLength <= 0) return

    const comments = graph.comments
    if (comments.length === 0) return

    for (const comment of comments) {
      if (comment.value.length < options.minLength) continue
      if (!hasBannerPattern(comment.value, options.minLength)) continue

      const fix: Fix = [{
        range: [comment.pos, comment.end],
        text: "",
      }]
      emit(
        createDiagnosticFromComment(
          graph.file,
          comment,
          "no-banner-comments",
          "banner",
          messages.banner,
          "error",
          fix,
        ),
      )
    }
  },
})
