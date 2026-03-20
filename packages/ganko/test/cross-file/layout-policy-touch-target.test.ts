import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Diagnostic } from "../../src/diagnostic"
import { analyzeCrossFileInput } from "../../src/cross-file"
import { setActivePolicy } from "../../src/css/policy"
import { lazyParseBatch, parseCode } from "../solid/test-utils"

const RULE = "jsx-layout-policy-touch-target"

interface CssFixture {
  readonly path: string
  readonly content: string
}

const batch = lazyParseBatch()

const IDX_SMALL_BTN = batch.add(`
  import "./style.css"
  export function App() { return <button class="small-btn">Click</button> }
`, "/project/touch_small_btn.tsx")

const IDX_OK_BTN = batch.add(`
  import "./style.css"
  export function App() { return <button class="ok-btn">Click</button> }
`, "/project/touch_ok_btn.tsx")

const IDX_SMALL_INPUT = batch.add(`
  import "./style.css"
  export function App() { return <input class="small-input" /> }
`, "/project/touch_small_input.tsx")

const IDX_ICON_BTN = batch.add(`
  import "./style.css"
  export function App() { return <button class="icon-btn">X</button> }
`, "/project/touch_icon_btn.tsx")

const IDX_TIGHT_BTN = batch.add(`
  import "./style.css"
  export function App() { return <button class="tight-btn">OK</button> }
`, "/project/touch_tight_btn.tsx")

const IDX_TEXT_DIV = batch.add(`
  import "./style.css"
  export function App() { return <div class="text">Hello</div> }
`, "/project/touch_text_div.tsx")

const IDX_SMALL_SEL = batch.add(`
  import "./style.css"
  export function App() { return <select class="small-sel"><option>A</option></select> }
`, "/project/touch_small_sel.tsx")

const IDX_SMALL_LINK = batch.add(`
  import "./style.css"
  export function App() { return <a class="small-link" href="/">Go</a> }
`, "/project/touch_small_link.tsx")

const IDX_DIV_BTN = batch.add(`
  import "./style.css"
  export function App() { return <div role="button" class="div-btn">Click</div> }
`, "/project/touch_div_btn.tsx")

const IDX_TW_BTN = batch.add(`
  import "./style.css"
  export function App() { return <button class="h-4 w-4">X</button> }
`, "/project/touch_tw_btn.tsx")

const IDX_SR_ONLY = batch.add(`
  import "./style.css"
  export function App() { return <input class="sr-only opacity-0" type="checkbox" /> }
`, "/project/touch_sr_only.tsx")

const IDX_ABS_INPUT = batch.add(`
  import "./style.css"
  export function App() { return <input class="abs-input" type="checkbox" /> }
`, "/project/touch_abs_input.tsx")

const IDX_TINY = batch.add(`
  import "./style.css"
  export function App() { return <button class="tiny">X</button> }
`, "/project/touch_tiny.tsx")

const IDX_REM_BTN = batch.add(`
  import "./style.css"
  export function App() { return <button class="rem-btn">OK</button> }
`, "/project/touch_rem_btn.tsx")

const IDX_BARE_BTN = batch.add(`
  import "./style.css"
  export function App() { return <button class="bare-btn">Click</button> }
`, "/project/touch_bare_btn.tsx")

const IDX_TALL_BTN = batch.add(`
  import "./style.css"
  export function App() { return <button class="tall-btn">Click</button> }
`, "/project/touch_tall_btn.tsx")

const IDX_WIDE_BTN = batch.add(`
  import "./style.css"
  export function App() { return <button class="wide-btn">Click</button> }
`, "/project/touch_wide_btn.tsx")

const IDX_SIZED_BTN = batch.add(`
  import "./style.css"
  export function App() { return <button class="sized-btn">Click</button> }
`, "/project/touch_sized_btn.tsx")

const IDX_MIN_SIZED_BTN = batch.add(`
  import "./style.css"
  export function App() { return <button class="min-sized-btn">Click</button> }
`, "/project/touch_min_sized_btn.tsx")

const IDX_NO_SIZE_DIV = batch.add(`
  import "./style.css"
  export function App() { return <div class="no-size">Hello</div> }
`, "/project/touch_no_size_div.tsx")

const IDX_VIS_HIDDEN = batch.add(`
  import "./style.css"
  export function App() { return <input class="vis-hidden opacity-0" type="checkbox" /> }
`, "/project/touch_vis_hidden.tsx")

const IDX_BARE_INPUT = batch.add(`
  import "./style.css"
  export function App() { return <input class="bare-input" type="text" /> }
`, "/project/touch_bare_input.tsx")

const IDX_AAA_BARE_BTN = batch.add(`
  import "./style.css"
  export function App() { return <button class="aaa-bare-btn">Click</button> }
`, "/project/touch_aaa_bare_btn.tsx")

function runRule(
  solidIdx: number,
  css: string | readonly CssFixture[] = "",
): readonly Diagnostic[] {
  const solid = batch.result(solidIdx)
  const diagnostics: Diagnostic[] = []
  const files = typeof css === "string"
    ? [{ path: "/project/style.css", content: css }]
    : css

  analyzeCrossFileInput(
    { solid, css: { files } },
    (diagnostic) => diagnostics.push(diagnostic),
  )

  return diagnostics.filter((d) => d.rule === RULE)
}

function byMessageId(diagnostics: readonly Diagnostic[], messageId: string): readonly Diagnostic[] {
  return diagnostics.filter((d) => d.messageId === messageId)
}

function first(arr: readonly Diagnostic[]): Diagnostic {
  const item = arr[0]
  if (!item) throw new Error("Expected at least one diagnostic")
  return item
}

describe("jsx-layout-policy-touch-target", () => {
  beforeAll(() => { setActivePolicy("wcag-aa") })
  afterAll(() => { setActivePolicy(null) })

  // --- Height violations ---

  it("reports button height below minimum (24px for wcag-aa)", () => {
    const ds = runRule(IDX_SMALL_BTN, `.small-btn { height: 20px; }`)
    const heightDiags = byMessageId(ds, "heightTooSmall")
    expect(heightDiags).toHaveLength(1)
    expect(first(heightDiags).message).toContain("20")
    expect(first(heightDiags).message).toContain("24")
  })

  it("does not report button height at minimum", () => {
    const ds = runRule(IDX_OK_BTN, `.ok-btn { height: 24px; }`)
    const heightDiags = byMessageId(ds, "heightTooSmall")
    expect(heightDiags).toHaveLength(0)
  })

  it("reports input min-height below minimum", () => {
    const ds = runRule(IDX_SMALL_INPUT, `.small-input { min-height: 18px; }`)
    const heightDiags = byMessageId(ds, "heightTooSmall")
    expect(heightDiags).toHaveLength(1)
    expect(first(heightDiags).message).toContain("input")
  })

  // --- Width violations ---

  it("reports button width below minimum", () => {
    const ds = runRule(IDX_ICON_BTN, `.icon-btn { width: 16px; }`)
    const widthDiags = byMessageId(ds, "widthTooSmall")
    expect(widthDiags).toHaveLength(1)
    expect(first(widthDiags).message).toContain("width")
  })

  // --- Padding violations ---

  it("reports button horizontal padding below minimum", () => {
    const ds = runRule(IDX_TIGHT_BTN, `.tight-btn { padding-left: 4px; }`)
    const padDiags = byMessageId(ds, "paddingTooSmall")
    expect(padDiags).toHaveLength(1)
    expect(first(padDiags).message).toContain("padding")
    expect(first(padDiags).message).toContain("8")
  })

  it("does not report padding on non-interactive elements", () => {
    const ds = runRule(IDX_TEXT_DIV, `.text { padding-left: 2px; }`)
    expect(ds).toHaveLength(0)
  })

  // --- Element detection ---

  it("detects select as input element", () => {
    const ds = runRule(IDX_SMALL_SEL, `.small-sel { height: 18px; }`)
    const heightDiags = byMessageId(ds, "heightTooSmall")
    expect(heightDiags).toHaveLength(1)
  })

  it("detects anchor as interactive", () => {
    const ds = runRule(IDX_SMALL_LINK, `.small-link { height: 16px; }`)
    const heightDiags = byMessageId(ds, "heightTooSmall")
    expect(heightDiags).toHaveLength(1)
  })

  it("detects role=button as interactive", () => {
    const ds = runRule(IDX_DIV_BTN, `.div-btn { height: 16px; }`)
    const heightDiags = byMessageId(ds, "heightTooSmall")
    expect(heightDiags).toHaveLength(1)
  })

  // --- Class-based sizing (the key improvement over the CSS-only rule) ---

  it("detects undersized button via Tailwind-style utility class", () => {
    const ds = runRule(IDX_TW_BTN, `.h-4 { height: 16px; } .w-4 { width: 16px; }`)
    const heightDiags = byMessageId(ds, "heightTooSmall")
    const widthDiags = byMessageId(ds, "widthTooSmall")
    const noBlockDiags = byMessageId(ds, "noReservedBlockSize")
    const noInlineDiags = byMessageId(ds, "noReservedInlineSize")
    expect(heightDiags.length).toBeGreaterThanOrEqual(1)
    expect(widthDiags.length).toBeGreaterThanOrEqual(1)
    expect(noBlockDiags).toHaveLength(0)
    expect(noInlineDiags).toHaveLength(0)
  })

  // --- Visually hidden elements ---

  it("does not flag visually hidden inputs (position: absolute + opacity-0 class)", () => {
    const ds = runRule(IDX_SR_ONLY, `.sr-only { position: absolute; width: 1px; height: 1px; }`)
    expect(ds).toHaveLength(0)
  })

  it("still flags small inputs without opacity-0", () => {
    const ds = runRule(IDX_ABS_INPUT, `.abs-input { position: absolute; width: 0px; height: 0px; }`)
    expect(ds.length).toBeGreaterThanOrEqual(1)
  })

  // --- No policy active ---

  it("does not report when no policy is active", () => {
    setActivePolicy(null)
    const ds = runRule(IDX_TINY, `.tiny { height: 8px; width: 8px; }`)
    expect(ds).toHaveLength(0)
    setActivePolicy("wcag-aa")
  })

  // --- rem conversion ---

  it("converts rem values for comparison", () => {
    const ds = runRule(IDX_REM_BTN, `.rem-btn { height: 1rem; }`)
    const heightDiags = byMessageId(ds, "heightTooSmall")
    expect(heightDiags).toHaveLength(1)
    expect(first(heightDiags).message).toContain("16")
  })

  // --- Component host element resolution ---

  it("reports height below threshold on component call site whose host resolves to a native interactive element", () => {
    const buttonComponent = parseCode(
      `export function MyButton(props: { class?: string }) {
        return <button class={props.class}>click</button>;
      }`,
      "/project/ui/my-button.tsx",
    )
    const appGraph = parseCode(
      `import { MyButton } from "./ui/my-button";
       import "./style.css";
       export function App() {
         return <MyButton class="small-host" />;
       }`,
      "/project/app.tsx",
    )
    const diagnostics: Diagnostic[] = []
    analyzeCrossFileInput(
      {
        solid: [buttonComponent, appGraph],
        css: { files: [{ path: "/project/style.css", content: `.small-host { height: 16px; }` }] },
      },
      (d) => diagnostics.push(d),
    )
    const hits = diagnostics.filter((d) => d.rule === RULE)
    const heightDiags = byMessageId(hits, "heightTooSmall")
    expect(heightDiags).toHaveLength(1)
  })

  // --- noReservedSize diagnostics ---

  describe("noReservedSize", () => {
    it("flags a button with no declared height or width", () => {
      const ds = runRule(IDX_BARE_BTN, `.bare-btn { padding: 0; }`)
      const noBlock = byMessageId(ds, "noReservedBlockSize")
      const noInline = byMessageId(ds, "noReservedInlineSize")
      expect(noBlock).toHaveLength(1)
      expect(noInline).toHaveLength(1)
      expect(first(noBlock).message).toContain("no declared height")
      expect(first(noBlock).message).toContain("24")
      expect(first(noInline).message).toContain("no declared width")
      expect(first(noInline).message).toContain("24")
    })

    it("flags a button with height but no declared width", () => {
      const ds = runRule(IDX_TALL_BTN, `.tall-btn { height: 44px; }`)
      const noBlock = byMessageId(ds, "noReservedBlockSize")
      const noInline = byMessageId(ds, "noReservedInlineSize")
      expect(noBlock).toHaveLength(0)
      expect(noInline).toHaveLength(1)
    })

    it("flags a button with width but no declared height", () => {
      const ds = runRule(IDX_WIDE_BTN, `.wide-btn { width: 100px; }`)
      const noBlock = byMessageId(ds, "noReservedBlockSize")
      const noInline = byMessageId(ds, "noReservedInlineSize")
      expect(noBlock).toHaveLength(1)
      expect(noInline).toHaveLength(0)
    })

    it("does not flag a button with both height and width declared", () => {
      const ds = runRule(IDX_SIZED_BTN, `.sized-btn { height: 44px; width: 100px; }`)
      const noBlock = byMessageId(ds, "noReservedBlockSize")
      const noInline = byMessageId(ds, "noReservedInlineSize")
      expect(noBlock).toHaveLength(0)
      expect(noInline).toHaveLength(0)
    })

    it("does not flag a button with min-height and min-width declared", () => {
      const ds = runRule(IDX_MIN_SIZED_BTN, `.min-sized-btn { min-height: 44px; min-width: 100px; }`)
      const noBlock = byMessageId(ds, "noReservedBlockSize")
      const noInline = byMessageId(ds, "noReservedInlineSize")
      expect(noBlock).toHaveLength(0)
      expect(noInline).toHaveLength(0)
    })

    it("does not flag non-interactive elements", () => {
      const ds = runRule(IDX_NO_SIZE_DIV, `.no-size { color: red; }`)
      expect(ds).toHaveLength(0)
    })

    it("does not flag visually hidden inputs", () => {
      const ds = runRule(IDX_VIS_HIDDEN, `.vis-hidden { position: absolute; }`)
      expect(ds).toHaveLength(0)
    })

    it("flags an input with no declared dimensions", () => {
      const ds = runRule(IDX_BARE_INPUT, `.bare-input { border: none; }`)
      const noBlock = byMessageId(ds, "noReservedBlockSize")
      const noInline = byMessageId(ds, "noReservedInlineSize")
      expect(noBlock).toHaveLength(1)
      expect(noInline).toHaveLength(1)
    })

    it("uses wcag-aaa thresholds in message when wcag-aaa is active", () => {
      setActivePolicy("wcag-aaa")
      const ds = runRule(IDX_AAA_BARE_BTN, `.aaa-bare-btn { color: black; }`)
      const noBlock = byMessageId(ds, "noReservedBlockSize")
      expect(noBlock).toHaveLength(1)
      expect(first(noBlock).message).toContain("44")
      setActivePolicy("wcag-aa")
    })
  })
})
