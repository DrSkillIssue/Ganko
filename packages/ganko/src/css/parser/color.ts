/**
 * Color parsing and WCAG contrast ratio utilities.
 *
 * Converts CSS color values to sRGB, computes relative luminance per
 * WCAG 2.0 §1.4.3, and calculates contrast ratios.
 */

/** sRGB color as 0-1 channel values with optional alpha. */
export interface SRGB {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i
const HEX4 = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])$/i
const HEX6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
const HEX8 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
const RGB_FUNC = /^rgba?\(\s*([0-9.]+%?)\s*[,\s]\s*([0-9.]+%?)\s*[,\s]\s*([0-9.]+%?)(?:\s*[,/]\s*([0-9.]+%?))?\s*\)/i
const HSL_FUNC = /^hsla?\(\s*([0-9.]+)\s*[,\s]\s*([0-9.]+)%\s*[,\s]\s*([0-9.]+)%(?:\s*[,/]\s*([0-9.]+%?))?\s*\)/i

/**
 * CSS named colors → pre-computed sRGB.
 * The parser (value.ts NAMED_COLORS) already recognises these as colors
 * and pushes raw name strings into parsedValue.colors. This map converts
 * those strings to sRGB so contrast computation works on named colors.
 */
const NAMED: Readonly<Record<string, SRGB>> = /* @__PURE__ */ buildNamedColors()

function buildNamedColors(): Record<string, SRGB> {
  const hex: Record<string, string> = {
    aliceblue: "f0f8ff", antiquewhite: "faebd7", aqua: "00ffff", aquamarine: "7fffd4",
    azure: "f0ffff", beige: "f5f5dc", bisque: "ffe4c4", black: "000000",
    blanchedalmond: "ffebcd", blue: "0000ff", blueviolet: "8a2be2", brown: "a52a2a",
    burlywood: "deb887", cadetblue: "5f9ea0", chartreuse: "7fff00", chocolate: "d2691e",
    coral: "ff7f50", cornflowerblue: "6495ed", cornsilk: "fff8dc", crimson: "dc143c",
    cyan: "00ffff", darkblue: "00008b", darkcyan: "008b8b", darkgoldenrod: "b8860b",
    darkgray: "a9a9a9", darkgreen: "006400", darkgrey: "a9a9a9", darkkhaki: "bdb76b",
    darkmagenta: "8b008b", darkolivegreen: "556b2f", darkorange: "ff8c00",
    darkorchid: "9932cc", darkred: "8b0000", darksalmon: "e9967a", darkseagreen: "8fbc8f",
    darkslateblue: "483d8b", darkslategray: "2f4f4f", darkslategrey: "2f4f4f",
    darkturquoise: "00ced1", darkviolet: "9400d3", deeppink: "ff1493",
    deepskyblue: "00bfff", dimgray: "696969", dimgrey: "696969", dodgerblue: "1e90ff",
    firebrick: "b22222", floralwhite: "fffaf0", forestgreen: "228b22", fuchsia: "ff00ff",
    gainsboro: "dcdcdc", ghostwhite: "f8f8ff", gold: "ffd700", goldenrod: "daa520",
    gray: "808080", green: "008000", greenyellow: "adff2f", grey: "808080",
    honeydew: "f0fff0", hotpink: "ff69b4", indianred: "cd5c5c", indigo: "4b0082",
    ivory: "fffff0", khaki: "f0e68c", lavender: "e6e6fa", lavenderblush: "fff0f5",
    lawngreen: "7cfc00", lemonchiffon: "fffacd", lightblue: "add8e6", lightcoral: "f08080",
    lightcyan: "e0ffff", lightgoldenrodyellow: "fafad2", lightgray: "d3d3d3",
    lightgreen: "90ee90", lightgrey: "d3d3d3", lightpink: "ffb6c1", lightsalmon: "ffa07a",
    lightseagreen: "20b2aa", lightskyblue: "87cefa", lightslategray: "778899",
    lightslategrey: "778899", lightsteelblue: "b0c4de", lightyellow: "ffffe0",
    lime: "00ff00", limegreen: "32cd32", linen: "faf0e6", magenta: "ff00ff",
    maroon: "800000", mediumaquamarine: "66cdaa", mediumblue: "0000cd",
    mediumorchid: "ba55d3", mediumpurple: "9370db", mediumseagreen: "3cb371",
    mediumslateblue: "7b68ee", mediumspringgreen: "00fa9a", mediumturquoise: "48d1cc",
    mediumvioletred: "c71585", midnightblue: "191970", mintcream: "f5fffa",
    mistyrose: "ffe4e1", moccasin: "ffe4b5", navajowhite: "ffdead", navy: "000080",
    oldlace: "fdf5e6", olive: "808000", olivedrab: "6b8e23", orange: "ffa500",
    orangered: "ff4500", orchid: "da70d6", palegoldenrod: "eee8aa", palegreen: "98fb98",
    paleturquoise: "afeeee", palevioletred: "db7093", papayawhip: "ffefd5",
    peachpuff: "ffdab9", peru: "cd853f", pink: "ffc0cb", plum: "dda0dd",
    powderblue: "b0e0e6", purple: "800080", rebeccapurple: "663399", red: "ff0000",
    rosybrown: "bc8f8f", royalblue: "4169e1", saddlebrown: "8b4513", salmon: "fa8072",
    sandybrown: "f4a460", seagreen: "2e8b57", seashell: "fff5ee", sienna: "a0522d",
    silver: "c0c0c0", skyblue: "87ceeb", slateblue: "6a5acd", slategray: "708090",
    slategrey: "708090", snow: "fffafa", springgreen: "00ff7f", steelblue: "4682b4",
    tan: "d2b48c", teal: "008080", thistle: "d8bfd8", tomato: "ff6347",
    turquoise: "40e0d0", violet: "ee82ee", wheat: "f5deb3", white: "ffffff",
    whitesmoke: "f5f5f5", yellow: "ffff00", yellowgreen: "9acd32",
  }
  const out: Record<string, SRGB> = {}
  for (const name in hex) {
    const h = hex[name]
    if (!h) continue
    out[name] = {
      r: parseInt(h.slice(0, 2), 16) / 255,
      g: parseInt(h.slice(2, 4), 16) / 255,
      b: parseInt(h.slice(4, 6), 16) / 255,
      a: 1,
    }
  }
  return out
}

function parseHex(h: string): number {
  return parseInt(h, 16) / 255
}

function parseHexDigit(h: string): number {
  return parseInt(h + h, 16) / 255
}

/** Parse a CSS color string to sRGB. Returns null for dynamic/unsupported values. */
export function parseColor(raw: string): SRGB | null {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0) return null
  if (trimmed === "transparent" || trimmed === "currentcolor") return null
  if (trimmed === "inherit" || trimmed === "initial" || trimmed === "unset" || trimmed === "revert") return null

  const named = NAMED[trimmed]
  if (named) return named

  let m = HEX6.exec(trimmed)
  if (m) {
    const c1 = m[1], c2 = m[2], c3 = m[3]
    if (!c1 || !c2 || !c3) return null
    return { r: parseHex(c1), g: parseHex(c2), b: parseHex(c3), a: 1 }
  }

  m = HEX3.exec(trimmed)
  if (m) {
    const c1 = m[1], c2 = m[2], c3 = m[3]
    if (!c1 || !c2 || !c3) return null
    return { r: parseHexDigit(c1), g: parseHexDigit(c2), b: parseHexDigit(c3), a: 1 }
  }

  m = HEX8.exec(trimmed)
  if (m) {
    const c1 = m[1], c2 = m[2], c3 = m[3], c4 = m[4]
    if (!c1 || !c2 || !c3 || !c4) return null
    return { r: parseHex(c1), g: parseHex(c2), b: parseHex(c3), a: parseHex(c4) }
  }

  m = HEX4.exec(trimmed)
  if (m) {
    const c1 = m[1], c2 = m[2], c3 = m[3], c4 = m[4]
    if (!c1 || !c2 || !c3 || !c4) return null
    return { r: parseHexDigit(c1), g: parseHexDigit(c2), b: parseHexDigit(c3), a: parseHexDigit(c4) }
  }

  m = RGB_FUNC.exec(trimmed)
  if (m) {
    const rc = m[1], gc = m[2], bc = m[3]
    if (!rc || !gc || !bc) return null
    const r = rc.endsWith("%") ? parseFloat(rc) / 100 : parseFloat(rc) / 255
    const g = gc.endsWith("%") ? parseFloat(gc) / 100 : parseFloat(gc) / 255
    const b = bc.endsWith("%") ? parseFloat(bc) / 100 : parseFloat(bc) / 255
    const a = m[4] ? (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1
    return { r, g, b, a }
  }

  m = HSL_FUNC.exec(trimmed)
  if (m) {
    const hc = m[1], sc = m[2], lc = m[3]
    if (!hc || !sc || !lc) return null
    const h = (parseFloat(hc) % 360 + 360) % 360
    const s = parseFloat(sc) / 100
    const l = parseFloat(lc) / 100
    const a = m[4] ? (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1
    const rgb = hslToRgb(h, s, l)
    return { r: rgb.r, g: rgb.g, b: rgb.b, a }
  }

  return null
}

/** Internal RGB result without alpha (alpha is added by parseColor). */
interface RGB3 { readonly r: number; readonly g: number; readonly b: number }

function hslToRgb(h: number, s: number, l: number): RGB3 {
  if (s === 0) return { r: l, g: l, b: l }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return {
    r: hueToChannel(p, q, h + 120),
    g: hueToChannel(p, q, h),
    b: hueToChannel(p, q, h - 120),
  }
}

function hueToChannel(p: number, q: number, t: number): number {
  const n = ((t % 360) + 360) % 360
  if (n < 60) return p + (q - p) * n / 60
  if (n < 180) return q
  if (n < 240) return p + (q - p) * (240 - n) / 60
  return p
}

/**
 * Alpha-composite a semi-transparent color over an opaque backdrop.
 * Uses the standard "source over" formula: out = src × α + dst × (1 − α).
 * Returns a fully opaque SRGB.
 */
export function compositeOver(fg: SRGB, bg: SRGB): SRGB {
  const a = fg.a
  if (a >= 1) return fg
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  }
}

/**
 * WCAG 2.0 relative luminance.
 * https://www.w3.org/TR/WCAG20/#relativeluminancedef
 */
export function relativeLuminance(c: SRGB): number {
  const rl = linearize(c.r)
  const gl = linearize(c.g)
  const bl = linearize(c.b)
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl
}

function linearize(channel: number): number {
  if (channel <= 0.03928) return channel / 12.92
  return Math.pow((channel + 0.055) / 1.055, 2.4)
}

/**
 * WCAG 2.0 contrast ratio between two sRGB colors.
 * Returns a value between 1 and 21.
 *
 * This is a pure luminance-based computation.  Callers are responsible
 * for alpha compositing before invoking this function.
 */
export function contrastRatio(a: SRGB, b: SRGB): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}
