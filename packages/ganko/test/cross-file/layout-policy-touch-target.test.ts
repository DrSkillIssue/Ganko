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

const IDX_SR_INPUT = batch.add(`
  import "./style.css"
  export function App() { return <input class="sr-input" type="checkbox" /> }
`, "/project/touch_sr_input.tsx")

const IDX_CALC_BTN = batch.add(`
  import "./style.css"
  export function App() { return <button class="calc-btn">Click</button> }
`, "/project/touch_calc_btn.tsx")

const IDX_INITIAL_BTN = batch.add(`
  import "./style.css"
  export function App() { return <button class="initial-btn">Click</button> }
`, "/project/touch_initial_btn.tsx")

const IDX_MIN_FN_BTN = batch.add(`
  import "./style.css"
  export function App() { return <button class="min-fn-btn">Click</button> }
`, "/project/touch_min_fn_btn.tsx")

const IDX_CLAMP_BTN = batch.add(`
  import "./style.css"
  export function App() { return <button class="clamp-btn">Click</button> }
`, "/project/touch_clamp_btn.tsx")

const IDX_MAX_CONSTRAINED = batch.add(`
  import "./style.css"
  export function App() { return <button class="max-constrained">Click</button> }
`, "/project/touch_max_constrained.tsx")

const IDX_FLEX_BASIS_BTN = batch.add(`
  import "./style.css"
  export function App() { return <button class="flex-basis-btn">Click</button> }
`, "/project/touch_flex_basis_btn.tsx")

const IDX_CALC_SHORTHAND_BTN = batch.add(`
  import "./style.css"
  export function App() { return <button class="calc-sh-btn">Click</button> }
`, "/project/touch_calc_sh_btn.tsx")

const IDX_COND_SHADOW_BTN = batch.add(`
  import "./style.css"
  export function App() { return <button class="cond-shadow" data-size="md">Click</button> }
`, "/project/touch_cond_shadow.tsx")

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

  // --- Cross-component CSS scope propagation (Gap 1) ---

  describe("cross-component CSS scope", () => {
    it("resolves CSS co-located with imported component file into call-site cascade", () => {
      const buttonComponent = parseCode(
        `export function Button(props: any) {
          return <button class="btn" data-component="button">{props.children}</button>;
        }`,
        "/project/ui/button.tsx",
      )
      const appGraph = parseCode(
        `import { Button } from "./ui/button";
         export function App() {
           return <Button class="my-btn">Click</Button>;
         }`,
        "/project/app.tsx",
      )
      const diagnostics: Diagnostic[] = []
      analyzeCrossFileInput(
        {
          solid: [buttonComponent, appGraph],
          css: {
            files: [
              // Component's co-located CSS — should be in scope for app.tsx
              { path: "/project/ui/button.css", content: `[data-component="button"] { height: 16px; padding: 0 4px; }` },
            ],
          },
        },
        (d) => diagnostics.push(d),
      )
      const hits = diagnostics.filter((d) => d.rule === RULE)
      const heightDiags = byMessageId(hits, "heightTooSmall")
      const padDiags = byMessageId(hits, "paddingTooSmall")
      // Component CSS should be in scope and matched — report actual values from component CSS.
      // Both the component definition's <button> and the call-site element produce diagnostics.
      expect(heightDiags.length).toBeGreaterThanOrEqual(1)
      expect(first(heightDiags).message).toContain("16")
      expect(padDiags.length).toBeGreaterThanOrEqual(1)
      expect(first(padDiags).message).toContain("4")
    })

    it("does not report false 0px when component CSS provides padding", () => {
      const buttonComponent = parseCode(
        `export function Button(props: any) {
          return <button class="btn" data-component="button">{props.children}</button>;
        }`,
        "/project/ui/button.tsx",
      )
      const appGraph = parseCode(
        `import { Button } from "./ui/button";
         export function App() {
           return <Button class="my-btn">Click</Button>;
         }`,
        "/project/app.tsx",
      )
      const diagnostics: Diagnostic[] = []
      analyzeCrossFileInput(
        {
          solid: [buttonComponent, appGraph],
          css: {
            files: [
              { path: "/project/ui/button.css", content: `[data-component="button"] { height: 44px; padding: 0 12px; }` },
            ],
          },
        },
        (d) => diagnostics.push(d),
      )
      const hits = diagnostics.filter((d) => d.rule === RULE)
      const padDiags = byMessageId(hits, "paddingTooSmall")
      const heightDiags = byMessageId(hits, "heightTooSmall")
      // With sufficient padding and height, no warnings
      expect(padDiags).toHaveLength(0)
      expect(heightDiags).toHaveLength(0)
    })
  })

  // --- Cross-component attribute value propagation (Gap 2) ---

  describe("cross-component attribute prop bindings", () => {
    it("resolves dynamic data-* attribute from call-site prop for CSS selector matching", () => {
      setActivePolicy("wcag-aaa")
      const buttonComponent = parseCode(
        `export function Button(props: any) {
          return <button data-component="button" data-size={props.size ?? "sm"}>{props.children}</button>;
        }`,
        "/project/ui/button.tsx",
      )
      const appGraph = parseCode(
        `import { Button } from "./ui/button";
         export function App() {
           return <Button size="md">Click</Button>;
         }`,
        "/project/app.tsx",
      )
      const diagnostics: Diagnostic[] = []
      analyzeCrossFileInput(
        {
          solid: [buttonComponent, appGraph],
          css: {
            files: [
              {
                path: "/project/ui/button.css",
                content: `
                  [data-component="button"] { display: inline-flex; }
                  [data-component="button"][data-size="md"] { height: 32px; padding: 0 8px; }
                `,
              },
            ],
          },
        },
        (d) => diagnostics.push(d),
      )
      const hits = diagnostics.filter((d) => d.rule === RULE)
      const heightDiags = byMessageId(hits, "heightTooSmall")
      const padDiags = byMessageId(hits, "paddingTooSmall")
      // Should resolve data-size="md" from call-site prop, match the CSS selector,
      // and report the actual 32px height and 8px padding — not 0px
      expect(heightDiags).toHaveLength(1)
      expect(first(heightDiags).message).toContain("32")
      expect(padDiags.length).toBeGreaterThanOrEqual(1)
      expect(first(padDiags).message).toContain("8")
      setActivePolicy("wcag-aa")
    })

    it("uses fallback value when call-site does not pass the prop", () => {
      setActivePolicy("wcag-aaa")
      const buttonComponent = parseCode(
        `export function Button(props: any) {
          return <button data-component="button" data-size={props.size ?? "sm"}>{props.children}</button>;
        }`,
        "/project/ui/button.tsx",
      )
      const appGraph = parseCode(
        `import { Button } from "./ui/button";
         export function App() {
           return <Button>Click</Button>;
         }`,
        "/project/app.tsx",
      )
      const diagnostics: Diagnostic[] = []
      analyzeCrossFileInput(
        {
          solid: [buttonComponent, appGraph],
          css: {
            files: [
              {
                path: "/project/ui/button.css",
                content: `
                  [data-component="button"][data-size="sm"] { height: 28px; padding: 0 6px; }
                `,
              },
            ],
          },
        },
        (d) => diagnostics.push(d),
      )
      const hits = diagnostics.filter((d) => d.rule === RULE)
      const heightDiags = byMessageId(hits, "heightTooSmall")
      // Should use fallback "sm" from ?? operator, match [data-size="sm"], report 28px.
      // Both component definition and call-site may produce diagnostics.
      expect(heightDiags.length).toBeGreaterThanOrEqual(1)
      expect(heightDiags.some((d: Diagnostic) => d.message.includes("28"))).toBe(true)
      setActivePolicy("wcag-aa")
    })
  })

  // --- Polymorphic as={Component} resolution (E2) ---

  describe("polymorphic as={Component}", () => {
    it("resolves as={Button} to Button's host element with its CSS", () => {
      setActivePolicy("wcag-aaa")
      const buttonComponent = parseCode(
        `export function Button(props: any) {
          return <button data-component="button" data-size={props.size ?? "sm"}>{props.children}</button>;
        }`,
        "/project/ui/button.tsx",
      )
      const triggerComponent = parseCode(
        `export function Trigger(props: any) {
          return <button>{props.children}</button>;
        }`,
        "/project/ui/trigger.tsx",
      )
      const appGraph = parseCode(
        `import { Button } from "./ui/button";
         import { Trigger } from "./ui/trigger";
         export function App() {
           return <Trigger as={Button} size="md">Click</Trigger>;
         }`,
        "/project/app.tsx",
      )
      const diagnostics: Diagnostic[] = []
      analyzeCrossFileInput(
        {
          solid: [buttonComponent, triggerComponent, appGraph],
          css: {
            files: [
              {
                path: "/project/ui/button.css",
                content: `
                  [data-component="button"][data-size="md"] { height: 32px; padding: 0 8px; }
                `,
              },
            ],
          },
        },
        (d) => diagnostics.push(d),
      )
      const hits = diagnostics.filter((d) => d.rule === RULE && d.file?.includes("app.tsx"))
      const heightDiags = byMessageId(hits, "heightTooSmall")
      const padDiags = byMessageId(hits, "paddingTooSmall")
      // as={Button} should resolve through Button's host to <button> with its CSS
      expect(heightDiags.length).toBeGreaterThanOrEqual(1)
      expect(heightDiags.some((d: Diagnostic) => d.message.includes("32"))).toBe(true)
      expect(padDiags.length).toBeGreaterThanOrEqual(1)
      expect(padDiags.some((d: Diagnostic) => d.message.includes("8"))).toBe(true)
      setActivePolicy("wcag-aa")
    })

    it("does not emit false 0px padding when as={Component} provides sizing", () => {
      const buttonComponent = parseCode(
        `export function Button(props: any) {
          return <button data-component="button">{props.children}</button>;
        }`,
        "/project/ui/button.tsx",
      )
      const triggerComponent = parseCode(
        `export function Trigger(props: any) {
          return <button>{props.children}</button>;
        }`,
        "/project/ui/trigger.tsx",
      )
      const appGraph = parseCode(
        `import { Button } from "./ui/button";
         import { Trigger } from "./ui/trigger";
         export function App() {
           return <Trigger as={Button}>Click</Trigger>;
         }`,
        "/project/app.tsx",
      )
      const diagnostics: Diagnostic[] = []
      analyzeCrossFileInput(
        {
          solid: [buttonComponent, triggerComponent, appGraph],
          css: {
            files: [
              {
                path: "/project/ui/button.css",
                content: `[data-component="button"] { height: 44px; padding: 0 16px; }`,
              },
            ],
          },
        },
        (d) => diagnostics.push(d),
      )
      const hits = diagnostics.filter((d) => d.rule === RULE && d.file?.includes("app.tsx"))
      const padDiags = byMessageId(hits, "paddingTooSmall")
      const heightDiags = byMessageId(hits, "heightTooSmall")
      // Sufficient sizing from Button CSS — no false 0px warnings
      expect(padDiags).toHaveLength(0)
      expect(heightDiags).toHaveLength(0)
    })
  })

  // --- CSS custom property var() resolution (Gap 3) ---

  describe("CSS var() resolution", () => {
    it("resolves var() references to concrete values from custom property definitions", () => {
      setActivePolicy("wcag-aaa")
      const appGraph = parseCode(
        `import "./style.css";
         export function App() {
           return <button class="themed-btn">Click</button>;
         }`,
        "/project/app.tsx",
      )
      const diagnostics: Diagnostic[] = []
      analyzeCrossFileInput(
        {
          solid: [appGraph],
          css: {
            files: [
              {
                path: "/project/style.css",
                content: `
                  :root { --btn-height: 32px; --btn-padding-x: 8px; }
                  .themed-btn { height: var(--btn-height); padding: 0 var(--btn-padding-x); }
                `,
              },
            ],
          },
        },
        (d) => diagnostics.push(d),
      )
      const hits = diagnostics.filter((d) => d.rule === RULE)
      const heightDiags = byMessageId(hits, "heightTooSmall")
      const padDiags = byMessageId(hits, "paddingTooSmall")
      // Should resolve var(--btn-height) → 32px, var(--btn-padding-x) → 8px
      expect(heightDiags).toHaveLength(1)
      expect(first(heightDiags).message).toContain("32")
      expect(padDiags.length).toBeGreaterThanOrEqual(1)
      expect(first(padDiags).message).toContain("8")
      setActivePolicy("wcag-aa")
    })

    it("does not warn when var() resolves to values meeting thresholds", () => {
      const appGraph = parseCode(
        `import "./style.css";
         export function App() {
           return <button class="ok-themed-btn">Click</button>;
         }`,
        "/project/app.tsx",
      )
      const diagnostics: Diagnostic[] = []
      analyzeCrossFileInput(
        {
          solid: [appGraph],
          css: {
            files: [
              {
                path: "/project/style.css",
                content: `
                  :root { --btn-h: 44px; --btn-px: 12px; }
                  .ok-themed-btn { height: var(--btn-h); padding: 0 var(--btn-px); }
                `,
              },
            ],
          },
        },
        (d) => diagnostics.push(d),
      )
      const hits = diagnostics.filter((d) => d.rule === RULE)
      const heightDiags = byMessageId(hits, "heightTooSmall")
      const padDiags = byMessageId(hits, "paddingTooSmall")
      expect(heightDiags).toHaveLength(0)
      expect(padDiags).toHaveLength(0)
    })

    it("resolves nested var() references (var referencing another var)", () => {
      setActivePolicy("wcag-aaa")
      const appGraph = parseCode(
        `import "./style.css";
         export function App() {
           return <button class="nested-var-btn">Click</button>;
         }`,
        "/project/app.tsx",
      )
      const diagnostics: Diagnostic[] = []
      analyzeCrossFileInput(
        {
          solid: [appGraph],
          css: {
            files: [
              {
                path: "/project/style.css",
                content: `
                  :root { --spacing-sm: 6px; --btn-pad: var(--spacing-sm); }
                  .nested-var-btn { height: 32px; padding: 0 var(--btn-pad); }
                `,
              },
            ],
          },
        },
        (d) => diagnostics.push(d),
      )
      const hits = diagnostics.filter((d) => d.rule === RULE)
      const padDiags = byMessageId(hits, "paddingTooSmall")
      // Should resolve var(--btn-pad) → var(--spacing-sm) → 6px
      expect(padDiags.length).toBeGreaterThanOrEqual(1)
      expect(first(padDiags).message).toContain("6")
      setActivePolicy("wcag-aa")
    })

    it("uses fallback value when var() references undefined custom property", () => {
      const appGraph = parseCode(
        `import "./style.css";
         export function App() {
           return <button class="fallback-btn">Click</button>;
         }`,
        "/project/app.tsx",
      )
      const diagnostics: Diagnostic[] = []
      analyzeCrossFileInput(
        {
          solid: [appGraph],
          css: {
            files: [
              {
                path: "/project/style.css",
                content: `.fallback-btn { height: var(--undefined-var, 20px); }`,
              },
            ],
          },
        },
        (d) => diagnostics.push(d),
      )
      const hits = diagnostics.filter((d) => d.rule === RULE)
      const heightDiags = byMessageId(hits, "heightTooSmall")
      // Should use fallback 20px when --undefined-var doesn't exist
      expect(heightDiags).toHaveLength(1)
      expect(first(heightDiags).message).toContain("20")
    })
  })

  // --- Combined: all three gaps together (real-world component pattern) ---

  describe("full component pipeline", () => {
    it("resolves component with data-* prop bindings, co-located CSS, and var() values", () => {
      setActivePolicy("wcag-aaa")
      const buttonComponent = parseCode(
        `export function Button(props: any) {
          return <button data-component="button" data-size={props.size ?? "sm"}>{props.children}</button>;
        }`,
        "/project/ui/button.tsx",
      )
      const appGraph = parseCode(
        `import { Button } from "./ui/button";
         export function App() {
           return <Button size="md">Click</Button>;
         }`,
        "/project/app.tsx",
      )
      const diagnostics: Diagnostic[] = []
      analyzeCrossFileInput(
        {
          solid: [buttonComponent, appGraph],
          css: {
            files: [
              {
                path: "/project/ui/button.css",
                content: `
                  :root { --size-height-md: 32px; --size-padding-x-md: 8px; }
                  [data-component="button"][data-size="md"] {
                    height: var(--size-height-md);
                    padding: 0 var(--size-padding-x-md);
                  }
                `,
              },
            ],
          },
        },
        (d) => diagnostics.push(d),
      )
      const hits = diagnostics.filter((d) => d.rule === RULE)
      const heightDiags = byMessageId(hits, "heightTooSmall")
      const padDiags = byMessageId(hits, "paddingTooSmall")
      // Full pipeline: Gap 1 (CSS scope) + Gap 2 (prop binding) + Gap 3 (var() resolution)
      // Should report 32px height and 8px padding — not 0px, not Unknown
      expect(heightDiags).toHaveLength(1)
      expect(first(heightDiags).message).toContain("32")
      expect(padDiags.length).toBeGreaterThanOrEqual(1)
      expect(first(padDiags).message).toContain("8")
      setActivePolicy("wcag-aa")
    })
  })

  // --- Additional false-positive coverage ---

  describe("false-positive prevention", () => {
    it("resolves padding-inline shorthand to padding-left and padding-right", () => {
      const ds = runRule(IDX_TIGHT_BTN, `.tight-btn { padding-inline: 4px; }`)
      const padDiags = byMessageId(ds, "paddingTooSmall")
      // padding-inline: 4px should expand to padding-left: 4px, padding-right: 4px
      expect(padDiags.length).toBeGreaterThanOrEqual(1)
      expect(first(padDiags).message).toContain("4")
    })

    it("does not flag padding-inline that meets the threshold", () => {
      const ds = runRule(IDX_TIGHT_BTN, `.tight-btn { padding-inline: 12px; height: 44px; width: 44px; }`)
      const padDiags = byMessageId(ds, "paddingTooSmall")
      expect(padDiags).toHaveLength(0)
    })

    it("skips sr-only inputs with position:absolute + 1px dimensions", () => {
      const ds = runRule(IDX_SR_INPUT, `.sr-input { position: absolute; width: 1px; height: 1px; overflow: hidden; }`)
      expect(ds).toHaveLength(0)
    })

    it("resolves static calc() expressions to concrete px values", () => {
      const ds = runRule(IDX_CALC_BTN, `.calc-btn { height: calc(20px + 4px); padding-left: calc(2px + 2px); padding-right: calc(2px + 2px); }`)
      const heightDiags = byMessageId(ds, "heightTooSmall")
      const padDiags = byMessageId(ds, "paddingTooSmall")
      // calc(20px + 4px) = 24px, calc(2px + 2px) = 4px
      expect(heightDiags).toHaveLength(0) // 24px meets wcag-aa minimum
      expect(padDiags.length).toBeGreaterThanOrEqual(1)
      expect(first(padDiags).message).toContain("4")
    })

    it("does not treat width:initial as reserving space", () => {
      const ds = runRule(IDX_INITIAL_BTN, `.initial-btn { width: initial; height: initial; }`)
      const noBlock = byMessageId(ds, "noReservedBlockSize")
      const noInline = byMessageId(ds, "noReservedInlineSize")
      // initial resets to auto which is non-reserving
      expect(noBlock).toHaveLength(1)
      expect(noInline).toHaveLength(1)
    })

    it("evaluates min() with all-static arguments", () => {
      const ds = runRule(IDX_MIN_FN_BTN, `.min-fn-btn { height: min(20px, 30px); }`)
      const heightDiags = byMessageId(ds, "heightTooSmall")
      // min(20px, 30px) = 20px < 24px threshold
      expect(heightDiags).toHaveLength(1)
      expect(first(heightDiags).message).toContain("20")
    })

    it("evaluates clamp() with all-static arguments", () => {
      const ds = runRule(IDX_CLAMP_BTN, `.clamp-btn { height: clamp(16px, 20px, 28px); }`)
      const heightDiags = byMessageId(ds, "heightTooSmall")
      // clamp(16px, 20px, 28px) = 20px < 24px threshold
      expect(heightDiags).toHaveLength(1)
      expect(first(heightDiags).message).toContain("20")
    })

    it("flags max-width below minimum as constraining touch target", () => {
      const ds = runRule(IDX_MAX_CONSTRAINED, `.max-constrained { width: 100px; max-width: 16px; height: 44px; }`)
      const widthDiags = byMessageId(ds, "widthTooSmall")
      // max-width: 16px constrains width below 24px threshold
      expect(widthDiags.length).toBeGreaterThanOrEqual(1)
      expect(widthDiags.some((d: Diagnostic) => d.message.includes("16"))).toBe(true)
    })

    it("counts flex-basis as declared inline dimension", () => {
      const ds = runRule(IDX_FLEX_BASIS_BTN, `.flex-basis-btn { flex-basis: 100px; height: 44px; }`)
      const noInline = byMessageId(ds, "noReservedInlineSize")
      // flex-basis reserves inline space — no false "no declared width"
      expect(noInline).toHaveLength(0)
    })

    it("expands padding shorthand with calc() inside parenthesized groups", () => {
      const ds = runRule(IDX_CALC_SHORTHAND_BTN, `.calc-sh-btn { padding: 0 calc(2px + 2px); height: 44px; width: 44px; }`)
      const padDiags = byMessageId(ds, "paddingTooSmall")
      // padding: 0 calc(2px + 2px) should expand correctly with parenthesis-aware tokenizer
      expect(padDiags.length).toBeGreaterThanOrEqual(1)
      expect(first(padDiags).message).toContain("4")
    })

    it("preserves unconditional padding when conditional selector shadows it", () => {
      setActivePolicy("wcag-aaa")
      // Simulates the real-world pattern:
      // * { padding: 0; } — global reset (unconditional, low specificity)
      // .btn[data-size="md"] { padding: 0 8px; } — component sizing (unconditional, medium specificity)
      // .btn[data-size="md"][data-icon] { padding: 0 10px 0 6px; } — icon variant (conditional, high specificity)
      //
      // data-icon is dynamic (null) so [data-icon] matches conditionally.
      // Without the fix: conditional icon variant wins cascade → readKnownPx rejects → 0px from reset.
      // With the fix: unconditional 8px from [data-size="md"] is preserved as fallback.
      const ds = runRule(IDX_COND_SHADOW_BTN, `
        * { padding: 0; }
        .cond-shadow[data-size="md"] { padding: 0 8px; height: 32px; width: 44px; }
        .cond-shadow[data-size="md"][data-icon] { padding: 0 10px 0 6px; }
      `)
      const padDiags = byMessageId(ds, "paddingTooSmall")
      // Both padding-left and padding-right should report 8px from the unconditional rule,
      // NOT 0px from global reset, and NOT the conditional 10px/6px from [data-icon].
      expect(padDiags.length).toBeGreaterThanOrEqual(1)
      for (const d of padDiags) {
        expect(d.message).not.toContain("`0px`")
        expect(d.message).toContain("8")
      }
      setActivePolicy("wcag-aa")
    })
  })
})
