import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Diagnostic } from "../../src/diagnostic"
import { analyzeCrossFileInput } from "../../src/cross-file"
import { setActivePolicy } from "../../src/css/policy"
import { parseCode } from "../solid/test-utils"

const RULE = "jsx-layout-policy-touch-target"

interface CssFixture {
  readonly path: string
  readonly content: string
}

const tsxToSolidInput = new Map<string, ReturnType<typeof parseCode>>()
afterAll(() => tsxToSolidInput.clear())
let batchFileCounter = 0

function getOrCreateSolidInput(tsx: string): ReturnType<typeof parseCode> {
  const existing = tsxToSolidInput.get(tsx)
  if (existing) return existing
  const filePath = `/project/touch_${batchFileCounter++}.tsx`
  const solid = parseCode(tsx, filePath)
  tsxToSolidInput.set(tsx, solid)
  return solid
}

function runRule(
  tsx: string,
  css: string | readonly CssFixture[] = "",
): readonly Diagnostic[] {
  const solid = getOrCreateSolidInput(tsx)
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
    const ds = runRule(
      `
        import "./style.css"
        export function App() { return <button class="small-btn">Click</button> }
      `,
      `.small-btn { height: 20px; }`,
    )
    const heightDiags = byMessageId(ds, "heightTooSmall")
    expect(heightDiags).toHaveLength(1)
    expect(first(heightDiags).message).toContain("20")
    expect(first(heightDiags).message).toContain("24")
  })

  it("does not report button height at minimum", () => {
    const ds = runRule(
      `
        import "./style.css"
        export function App() { return <button class="ok-btn">Click</button> }
      `,
      `.ok-btn { height: 24px; }`,
    )
    const heightDiags = byMessageId(ds, "heightTooSmall")
    expect(heightDiags).toHaveLength(0)
  })

  it("reports input min-height below minimum", () => {
    const ds = runRule(
      `
        import "./style.css"
        export function App() { return <input class="small-input" /> }
      `,
      `.small-input { min-height: 18px; }`,
    )
    const heightDiags = byMessageId(ds, "heightTooSmall")
    expect(heightDiags).toHaveLength(1)
    expect(first(heightDiags).message).toContain("input")
  })

  // --- Width violations ---

  it("reports button width below minimum", () => {
    const ds = runRule(
      `
        import "./style.css"
        export function App() { return <button class="icon-btn">X</button> }
      `,
      `.icon-btn { width: 16px; }`,
    )
    const widthDiags = byMessageId(ds, "widthTooSmall")
    expect(widthDiags).toHaveLength(1)
    expect(first(widthDiags).message).toContain("width")
  })

  // --- Padding violations ---

  it("reports button horizontal padding below minimum", () => {
    const ds = runRule(
      `
        import "./style.css"
        export function App() { return <button class="tight-btn">OK</button> }
      `,
      `.tight-btn { padding-left: 4px; }`,
    )
    const padDiags = byMessageId(ds, "paddingTooSmall")
    expect(padDiags).toHaveLength(1)
    expect(first(padDiags).message).toContain("padding")
    expect(first(padDiags).message).toContain("8")
  })

  it("does not report padding on non-interactive elements", () => {
    const ds = runRule(
      `
        import "./style.css"
        export function App() { return <div class="text">Hello</div> }
      `,
      `.text { padding-left: 2px; }`,
    )
    expect(ds).toHaveLength(0)
  })

  // --- Element detection ---

  it("detects select as input element", () => {
    const ds = runRule(
      `
        import "./style.css"
        export function App() { return <select class="small-sel"><option>A</option></select> }
      `,
      `.small-sel { height: 18px; }`,
    )
    const heightDiags = byMessageId(ds, "heightTooSmall")
    expect(heightDiags).toHaveLength(1)
  })

  it("detects anchor as interactive", () => {
    const ds = runRule(
      `
        import "./style.css"
        export function App() { return <a class="small-link" href="/">Go</a> }
      `,
      `.small-link { height: 16px; }`,
    )
    const heightDiags = byMessageId(ds, "heightTooSmall")
    expect(heightDiags).toHaveLength(1)
  })

  it("detects role=button as interactive", () => {
    const ds = runRule(
      `
        import "./style.css"
        export function App() { return <div role="button" class="div-btn">Click</div> }
      `,
      `.div-btn { height: 16px; }`,
    )
    const heightDiags = byMessageId(ds, "heightTooSmall")
    expect(heightDiags).toHaveLength(1)
  })

  // --- Class-based sizing (the key improvement over the CSS-only rule) ---

  it("detects undersized button via Tailwind-style utility class", () => {
    const ds = runRule(
      `
        import "./style.css"
        export function App() { return <button class="h-4 w-4">X</button> }
      `,
      `.h-4 { height: 16px; } .w-4 { width: 16px; }`,
    )
    // Both height and width should be flagged; no noReserved since both are declared
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
    const ds = runRule(
      `
        import "./style.css"
        export function App() { return <input class="sr-only opacity-0" type="checkbox" /> }
      `,
      `.sr-only { position: absolute; width: 1px; height: 1px; }`,
    )
    expect(ds).toHaveLength(0)
  })

  it("still flags small inputs without opacity-0", () => {
    const ds = runRule(
      `
        import "./style.css"
        export function App() { return <input class="abs-input" type="checkbox" /> }
      `,
      `.abs-input { position: absolute; width: 0px; height: 0px; }`,
    )
    // width: 0px and height: 0px are not usable dimensions, so noReserved diagnostics fire
    expect(ds.length).toBeGreaterThanOrEqual(1)
  })

  // --- No policy active ---

  it("does not report when no policy is active", () => {
    setActivePolicy(null)
    const ds = runRule(
      `
        import "./style.css"
        export function App() { return <button class="tiny">X</button> }
      `,
      `.tiny { height: 8px; width: 8px; }`,
    )
    expect(ds).toHaveLength(0)
    setActivePolicy("wcag-aa")
  })

  // --- rem conversion ---

  it("converts rem values for comparison", () => {
    const ds = runRule(
      `
        import "./style.css"
        export function App() { return <button class="rem-btn">OK</button> }
      `,
      `.rem-btn { height: 1rem; }`,
    )
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
      const ds = runRule(
        `
          import "./style.css"
          export function App() { return <button class="bare-btn">Click</button> }
        `,
        `.bare-btn { padding: 0; }`,
      )
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
      const ds = runRule(
        `
          import "./style.css"
          export function App() { return <button class="tall-btn">Click</button> }
        `,
        `.tall-btn { height: 44px; }`,
      )
      const noBlock = byMessageId(ds, "noReservedBlockSize")
      const noInline = byMessageId(ds, "noReservedInlineSize")
      expect(noBlock).toHaveLength(0)
      expect(noInline).toHaveLength(1)
    })

    it("flags a button with width but no declared height", () => {
      const ds = runRule(
        `
          import "./style.css"
          export function App() { return <button class="wide-btn">Click</button> }
        `,
        `.wide-btn { width: 100px; }`,
      )
      const noBlock = byMessageId(ds, "noReservedBlockSize")
      const noInline = byMessageId(ds, "noReservedInlineSize")
      expect(noBlock).toHaveLength(1)
      expect(noInline).toHaveLength(0)
    })

    it("does not flag a button with both height and width declared", () => {
      const ds = runRule(
        `
          import "./style.css"
          export function App() { return <button class="sized-btn">Click</button> }
        `,
        `.sized-btn { height: 44px; width: 100px; }`,
      )
      const noBlock = byMessageId(ds, "noReservedBlockSize")
      const noInline = byMessageId(ds, "noReservedInlineSize")
      expect(noBlock).toHaveLength(0)
      expect(noInline).toHaveLength(0)
    })

    it("does not flag a button with min-height and min-width declared", () => {
      const ds = runRule(
        `
          import "./style.css"
          export function App() { return <button class="min-sized-btn">Click</button> }
        `,
        `.min-sized-btn { min-height: 44px; min-width: 100px; }`,
      )
      const noBlock = byMessageId(ds, "noReservedBlockSize")
      const noInline = byMessageId(ds, "noReservedInlineSize")
      expect(noBlock).toHaveLength(0)
      expect(noInline).toHaveLength(0)
    })

    it("does not flag non-interactive elements", () => {
      const ds = runRule(
        `
          import "./style.css"
          export function App() { return <div class="no-size">Hello</div> }
        `,
        `.no-size { color: red; }`,
      )
      expect(ds).toHaveLength(0)
    })

    it("does not flag visually hidden inputs", () => {
      const ds = runRule(
        `
          import "./style.css"
          export function App() { return <input class="vis-hidden opacity-0" type="checkbox" /> }
        `,
        `.vis-hidden { position: absolute; }`,
      )
      expect(ds).toHaveLength(0)
    })

    it("flags an input with no declared dimensions", () => {
      const ds = runRule(
        `
          import "./style.css"
          export function App() { return <input class="bare-input" type="text" /> }
        `,
        `.bare-input { border: none; }`,
      )
      const noBlock = byMessageId(ds, "noReservedBlockSize")
      const noInline = byMessageId(ds, "noReservedInlineSize")
      expect(noBlock).toHaveLength(1)
      expect(noInline).toHaveLength(1)
    })

    it("uses wcag-aaa thresholds in message when wcag-aaa is active", () => {
      setActivePolicy("wcag-aaa")
      const ds = runRule(
        `
          import "./style.css"
          export function App() { return <button class="aaa-bare-btn">Click</button> }
        `,
        `.aaa-bare-btn { color: black; }`,
      )
      const noBlock = byMessageId(ds, "noReservedBlockSize")
      expect(noBlock).toHaveLength(1)
      expect(first(noBlock).message).toContain("44")
      setActivePolicy("wcag-aa")
    })
  })
})
