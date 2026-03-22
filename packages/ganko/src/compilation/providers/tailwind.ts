import type { ClassNameSymbol } from "../symbols/class-name"
import type { TailwindSymbolContribution } from "../symbols/declaration-table"

export interface TailwindParsedCandidate {
  readonly raw: string
  readonly variants: readonly TailwindParsedVariant[]
  readonly utility: string
  readonly value: TailwindCandidateValue | null
  readonly modifier: TailwindCandidateModifier | null
  readonly important: boolean
  readonly negative: boolean
}

export interface TailwindParsedVariant {
  readonly name: string
  readonly kind: "static" | "functional" | "compound" | "arbitrary"
  readonly value: string | null
  readonly modifier: string | null
}

export interface TailwindCandidateValue {
  readonly kind: "named" | "arbitrary" | "fraction"
  readonly value: string
  readonly dashedIdent: string | null
}

export interface TailwindCandidateModifier {
  readonly kind: "named" | "arbitrary"
  readonly value: string
}

export interface TailwindResolvedDeclaration {
  readonly property: string
  readonly value: string
}

export type TailwindCandidateDiagnostic =
  | { readonly kind: "unknown-utility"; readonly utility: string }
  | { readonly kind: "invalid-variant"; readonly variant: string }
  | { readonly kind: "theme-token-not-found"; readonly token: string }
  | { readonly kind: "invalid-arbitrary-value"; readonly value: string }
  | { readonly kind: "incompatible-compound-variant"; readonly variant: string; readonly parent: string }

export type TailwindCandidateResult =
  | { readonly valid: true; readonly candidate: TailwindParsedCandidate; readonly symbol: ClassNameSymbol }
  | { readonly valid: false; readonly diagnostics: readonly TailwindCandidateDiagnostic[] }

export interface TailwindResolution {
  readonly candidate: TailwindParsedCandidate
  readonly css: string
  readonly declarations: readonly TailwindResolvedDeclaration[]
}

export interface TailwindVariantInfo {
  readonly name: string
  readonly kind: "static" | "functional" | "compound" | "arbitrary"
  readonly values: readonly string[]
  readonly hasDash: boolean
  readonly isArbitrary: boolean
  readonly order: number
}

export interface TailwindDesignSystem {
  candidatesToCss(classes: string[]): (string | null)[]
  getClassList(): [string, { modifiers: string[] }][]
  getVariants(): { name: string; values: string[]; hasDash: boolean; isArbitrary: boolean }[]
}

export { TailwindSymbolContribution }

export interface TailwindProvider {
  readonly kind: "tailwind"
  readonly designSystem: TailwindDesignSystem
  parseCandidate(candidate: string): TailwindCandidateResult
  has(className: string): boolean
  resolve(className: string): TailwindResolution | null
  getUtilitySymbols(): TailwindSymbolContribution
  getVariants(): readonly TailwindVariantInfo[]
}

const DECL_RE = /^\s*([\w-]+)\s*:\s*(.+?)\s*;?\s*$/

function parseCssDeclarations(css: string): TailwindResolvedDeclaration[] {
  const out: TailwindResolvedDeclaration[] = []
  const lines = css.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const match = DECL_RE.exec(line)
    if (match && match[1] && match[2]) {
      out.push({ property: match[1], value: match[2] })
    }
  }
  return out
}

function parseBasicCandidate(raw: string): TailwindParsedCandidate {
  let working = raw
  let important = false
  let negative = false

  if (working.charCodeAt(0) === 33) {
    important = true
    working = working.substring(1)
  } else if (working.charCodeAt(working.length - 1) === 33) {
    important = true
    working = working.substring(0, working.length - 1)
  }

  const segments = splitByColon(working)
  const base = segments[segments.length - 1]!
  const variantSegments = segments.length > 1 ? segments.slice(0, segments.length - 1) : []

  const variants: TailwindParsedVariant[] = []
  for (let i = 0; i < variantSegments.length; i++) {
    const seg = variantSegments[i]
    if (!seg) continue
    let kind: TailwindParsedVariant["kind"] = "static"
    let value: string | null = null
    const modifier: string | null = null

    if (seg.charCodeAt(0) === 91 && seg.charCodeAt(seg.length - 1) === 93) {
      kind = "arbitrary"
      value = seg.substring(1, seg.length - 1)
    } else {
      const dashIdx = seg.indexOf("-")
      if (dashIdx !== -1) {
        const afterDash = seg.substring(dashIdx + 1)
        if (afterDash.charCodeAt(0) === 91 && afterDash.charCodeAt(afterDash.length - 1) === 93) {
          kind = "functional"
          value = afterDash.substring(1, afterDash.length - 1)
        }
      }
    }

    variants.push({ name: seg, kind, value, modifier })
  }

  let utility = base
  let candidateModifier: TailwindCandidateModifier | null = null
  let candidateValue: TailwindCandidateValue | null = null

  if (utility.charCodeAt(0) === 45) {
    negative = true
    utility = utility.substring(1)
  }

  const slashIdx = findUnbracketedSlash(utility)
  if (slashIdx !== -1) {
    const modStr = utility.substring(slashIdx + 1)
    utility = utility.substring(0, slashIdx)
    if (modStr.charCodeAt(0) === 91 && modStr.charCodeAt(modStr.length - 1) === 93) {
      candidateModifier = { kind: "arbitrary", value: modStr.substring(1, modStr.length - 1) }
    } else {
      candidateModifier = { kind: "named", value: modStr }
    }
  }

  const bracketStart = utility.indexOf("[")
  if (bracketStart !== -1 && utility.charCodeAt(utility.length - 1) === 93) {
    const arb = utility.substring(bracketStart + 1, utility.length - 1)
    utility = utility.substring(0, bracketStart > 0 && utility.charCodeAt(bracketStart - 1) === 45 ? bracketStart - 1 : bracketStart)
    candidateValue = { kind: "arbitrary", value: arb, dashedIdent: null }
  }

  return {
    raw,
    variants,
    utility,
    value: candidateValue,
    modifier: candidateModifier,
    important,
    negative,
  }
}

function splitByColon(input: string): string[] {
  const segments: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    if (ch === 91) depth++
    else if (ch === 93) depth--
    else if (ch === 58 && depth === 0) {
      segments.push(input.substring(start, i))
      start = i + 1
    }
  }
  segments.push(input.substring(start))
  return segments
}

function findUnbracketedSlash(input: string): number {
  let depth = 0
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    if (ch === 91) depth++
    else if (ch === 93) depth--
    else if (ch === 47 && depth === 0) return i
  }
  return -1
}

export function createTailwindProvider(designSystem: TailwindDesignSystem): TailwindProvider {
  const cssCache = new Map<string, string | null>()

  function resolveCss(className: string): string | null {
    const cached = cssCache.get(className)
    if (cached !== undefined) return cached
    const result = designSystem.candidatesToCss([className])
    const css = result[0] ?? null
    cssCache.set(className, css)
    return css
  }

  return {
    kind: "tailwind",
    designSystem,

    has(className: string): boolean {
      return resolveCss(className) !== null
    },

    resolve(className: string): TailwindResolution | null {
      const css = resolveCss(className)
      if (css === null) return null
      const candidate = parseBasicCandidate(className)
      const declarations = parseCssDeclarations(css)
      return { candidate, css, declarations }
    },

    parseCandidate(candidate: string): TailwindCandidateResult {
      const css = resolveCss(candidate)
      if (css === null) {
        return {
          valid: false,
          diagnostics: [{ kind: "unknown-utility", utility: candidate }],
        }
      }
      const parsed = parseBasicCandidate(candidate)
      const declarations = parseCssDeclarations(css)
      const symbol: ClassNameSymbol = {
        symbolKind: "className",
        name: candidate,
        filePath: null,
        source: {
          kind: "tailwind",
          candidate: parsed,
          resolvedCSS: css,
          declarations,
          diagnostics: [],
        },
      }
      return { valid: true, candidate: parsed, symbol }
    },

    getUtilitySymbols(): TailwindSymbolContribution {
      const classList = designSystem.getClassList()
      const classNames = new Map<string, ClassNameSymbol>()
      for (let i = 0; i < classList.length; i++) {
        const entry = classList[i]!
        const name = entry[0]
        const css = resolveCss(name)
        const parsed = parseBasicCandidate(name)
        const declarations = css !== null ? parseCssDeclarations(css) : []
        classNames.set(name, {
          symbolKind: "className",
          name,
          filePath: null,
          source: {
            kind: "tailwind",
            candidate: parsed,
            resolvedCSS: css,
            declarations,
            diagnostics: [],
          },
        })
      }
      return { classNames }
    },

    getVariants(): readonly TailwindVariantInfo[] {
      const raw = designSystem.getVariants()
      const out: TailwindVariantInfo[] = []
      for (let i = 0; i < raw.length; i++) {
        const v = raw[i]!
        let kind: TailwindVariantInfo["kind"] = "static"
        if (v.isArbitrary) kind = "arbitrary"
        else if (v.values.length > 0) kind = "functional"

        out.push({
          name: v.name,
          kind,
          values: v.values,
          hasDash: v.hasDash,
          isArbitrary: v.isArbitrary,
          order: i,
        })
      }
      return out
    },
  }
}
