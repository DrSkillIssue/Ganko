const WHITESPACE_RE = /\s+/

export function splitTopLevelComma(value: string): readonly string[] {
  const out: string[] = []
  let start = 0
  let depth = 0
  let quote: "'" | '"' | null = null

  for (let i = 0; i < value.length; i++) {
    const ch = value[i]

    if (quote !== null) {
      if (ch === quote) quote = null
      continue
    }

    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }

    if (ch === "(") {
      depth++
      continue
    }

    if (ch === ")") {
      if (depth > 0) depth--
      continue
    }

    if (ch !== "," || depth !== 0) continue

    const token = value.slice(start, i).trim()
    if (token.length > 0) out.push(token)
    start = i + 1
  }

  const tail = value.slice(start).trim()
  if (tail.length > 0) out.push(tail)
  return out
}

export function splitTopLevelWhitespace(value: string): readonly string[] {
  const out: string[] = []
  let start = -1
  let depth = 0
  let quote: "'" | '"' | null = null

  for (let i = 0; i < value.length; i++) {
    const ch = value[i]

    if (quote !== null) {
      if (ch === quote) quote = null
      continue
    }

    if (ch === "'" || ch === '"') {
      quote = ch
      if (start === -1) start = i
      continue
    }

    if (ch === "(") {
      depth++
      if (start === -1) start = i
      continue
    }

    if (ch === ")") {
      if (depth > 0) depth--
      continue
    }

    if (ch && isWhitespace(ch) && depth === 0) {
      if (start !== -1) {
        const token = value.slice(start, i).trim()
        if (token.length > 0) out.push(token)
        start = -1
      }
      continue
    }

    if (start === -1) start = i
  }

  if (start !== -1) {
    const token = value.slice(start).trim()
    if (token.length > 0) out.push(token)
  }

  return out
}

export function splitWhitespaceTokens(value: string): readonly string[] {
  const parts = value.trim().split(WHITESPACE_RE)
  const out: string[] = []

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part || part.length === 0) continue
    out.push(part)
  }

  return out
}

export function parseQuadShorthand(
  raw: string,
): { top: string; right: string; bottom: string; left: string } | null {
  const parts = splitTopLevelWhitespace(raw)
  if (parts.length === 1) {
    const p0 = parts[0]
    if (!p0) return null
    return { top: p0, right: p0, bottom: p0, left: p0 }
  }

  if (parts.length === 2) {
    const p0 = parts[0], p1 = parts[1]
    if (!p0 || !p1) return null
    return { top: p0, right: p1, bottom: p0, left: p1 }
  }

  if (parts.length === 3) {
    const p0 = parts[0], p1 = parts[1], p2 = parts[2]
    if (!p0 || !p1 || !p2) return null
    return { top: p0, right: p1, bottom: p2, left: p1 }
  }

  if (parts.length === 4) {
    const p0 = parts[0], p1 = parts[1], p2 = parts[2], p3 = parts[3]
    if (!p0 || !p1 || !p2 || !p3) return null
    return { top: p0, right: p1, bottom: p2, left: p3 }
  }

  return null
}

export function parseBlockShorthand(raw: string): { start: string; end: string } | null {
  const parts = splitTopLevelWhitespace(raw)
  if (parts.length === 1) {
    const p0 = parts[0]
    if (!p0) return null
    return { start: p0, end: p0 }
  }

  if (parts.length === 2) {
    const p0 = parts[0], p1 = parts[1]
    if (!p0 || !p1) return null
    return { start: p0, end: p1 }
  }

  return null
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f"
}
