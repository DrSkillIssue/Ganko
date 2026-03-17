import { afterAll, describe, expect, it } from "vitest"
import type { Diagnostic } from "../../src/diagnostic"
import { analyzeCrossFileInput } from "../../src/cross-file"
import { parseCode } from "../solid/test-utils"

interface CssFixture {
  readonly path: string
  readonly content: string
}

/**
 * Batched parseCode — all unique tsx snippets share ONE ts.Program.
 * Each unique tsx string gets its own virtual file path within the program.
 * The SolidInput is created lazily on first access and cached for reuse.
 */
const tsxToSolidInput = new Map<string, ReturnType<typeof parseCode>>()
afterAll(() => tsxToSolidInput.clear())
let batchFileCounter = 0

function getOrCreateSolidInput(tsx: string): ReturnType<typeof parseCode> {
  const existing = tsxToSolidInput.get(tsx)
  if (existing) return existing

  // Each unique tsx gets its own file path so they coexist in one program
  const filePath = `/project/cls_${batchFileCounter++}.tsx`
  const solid = parseCode(tsx, filePath)
  tsxToSolidInput.set(tsx, solid)
  return solid
}

function runRule(
  rule: string,
  tsx: string,
  css: string | readonly CssFixture[] = "",
): readonly Diagnostic[] {
  const solid = getOrCreateSolidInput(tsx)
  const diagnostics: Diagnostic[] = []
  const files = typeof css === "string"
    ? [{ path: "/project/layout.css", content: css }]
    : css

  analyzeCrossFileInput(
    {
      solid,
      css: { files },
    },
    (diagnostic) => diagnostics.push(diagnostic),
  )

  return diagnostics.filter((diagnostic) => diagnostic.rule === rule)
}

describe("CLS rule suite", () => {
  it("flags transition on layout properties", () => {
    const diagnostics = runRule(
      "css-layout-transition-layout-property",
      `
        import "./layout.css"
        export function App() {
          return <div class="box">x</div>
        }
      `,
      `.box { transition: width 200ms ease; }`,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("flags layout-affecting keyframe animations", () => {
    const diagnostics = runRule(
      "css-layout-animation-layout-property",
      `
        import "./layout.css"
        export function App() {
          return <div class="box">x</div>
        }
      `,
      `
        @keyframes expand { from { height: 0px; } to { height: 120px; } }
        .box { animation: expand 240ms ease; }
      `,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("flags keyframe animations with quoted names containing spaces", () => {
    const diagnostics = runRule(
      "css-layout-animation-layout-property",
      `
        import "./layout.css"
        export function App() {
          return <div class="box">x</div>
        }
      `,
      `
        @keyframes "hero expand" { from { height: 0px; } to { height: 120px; } }
        .box { animation-name: "hero expand"; animation-duration: 240ms; }
      `,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag transform-only keyframe animations", () => {
    const diagnostics = runRule(
      "css-layout-animation-layout-property",
      `
        import "./layout.css"
        export function App() {
          return <div class="box">x</div>
        }
      `,
      `
        @keyframes fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0px); } }
        .box { animation-name: fade-in; }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag transition on opacity", () => {
    const diagnostics = runRule(
      "css-layout-transition-layout-property",
      `
        import "./layout.css"
        export function App() {
          return <div class="box">x</div>
        }
      `,
      `.box { transition: opacity 200ms ease; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("flags transition-property list with layout property", () => {
    const diagnostics = runRule(
      "css-layout-transition-layout-property",
      `
        import "./layout.css"
        export function App() {
          return <div class="box">x</div>
        }
      `,
      `.box { transition-property: opacity, width; }`,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("flags transition shorthand when duration comes first", () => {
    const diagnostics = runRule(
      "css-layout-transition-layout-property",
      `
        import "./layout.css"
        export function App() {
          return <div class="box">x</div>
        }
      `,
      `.box { transition: 200ms width ease; }`,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("flags transition shorthand in mixed multi-layer order", () => {
    const diagnostics = runRule(
      "css-layout-transition-layout-property",
      `
        import "./layout.css"
        export function App() {
          return <div class="box">x</div>
        }
      `,
      `.box { transition: opacity 120ms ease, 200ms width linear; }`,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("flags transition-property list with none and layout property", () => {
    const diagnostics = runRule(
      "css-layout-transition-layout-property",
      `
        import "./layout.css"
        export function App() {
          return <div class="box">x</div>
        }
      `,
      `.box { transition-property: none, width; }`,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("flags state selectors that change box geometry", () => {
    const diagnostics = runRule(
      "css-layout-stateful-box-model-shift",
      `
        import "./layout.css"
        export function App() {
          return <button class="btn">save</button>
        }
      `,
      `.btn:hover { padding-top: 8px; }`,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("flags classList toggles that switch geometry classes", () => {
    const diagnostics = runRule(
      "jsx-layout-classlist-geometry-toggle",
      `
        import "./layout.css"
        export function App(props: { open: boolean }) {
          return <div classList={{ expanded: props.open }}>x</div>
        }
      `,
      `.expanded { height: 240px; }`,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag classList toggles for non-geometry classes", () => {
    const diagnostics = runRule(
      "jsx-layout-classlist-geometry-toggle",
      `
        import "./layout.css"
        export function App(props: { active: boolean }) {
          return <div classList={{ accent: props.active }}>x</div>
        }
      `,
      `.accent { color: red; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag state selectors that keep same geometry", () => {
    const diagnostics = runRule(
      "css-layout-stateful-box-model-shift",
      `
        import "./layout.css"
        export function App() {
          return <button class="btn">save</button>
        }
      `,
      `.btn { padding-top: 8px; } .btn:hover { padding-top: 8px; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag when base shorthand equals state longhand", () => {
    const diagnostics = runRule(
      "css-layout-stateful-box-model-shift",
      `
        import "./layout.css"
        export function App() {
          return <button class="btn">save</button>
        }
      `,
      `.btn { padding: 8px; } .btn:hover { padding-top: 8px; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag equivalent class-order selectors", () => {
    const diagnostics = runRule(
      "css-layout-stateful-box-model-shift",
      `
        import "./layout.css"
        export function App() {
          return <button class="btn primary">save</button>
        }
      `,
      `.btn.primary { padding-top: 8px; } .primary.btn:hover { padding-top: 8px; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag positioned-only state shifts when position remains static", () => {
    const diagnostics = runRule(
      "css-layout-stateful-box-model-shift",
      `
        import "./layout.css"
        export function App() {
          return <button class="btn">save</button>
        }
      `,
      `.btn:hover { top: 8px; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag pseudo-function state selectors with equivalent geometry", () => {
    const diagnostics = runRule(
      "css-layout-stateful-box-model-shift",
      `
        import "./layout.css"
        export function App() {
          return <button class="btn">save</button>
        }
      `,
      `.btn { padding-top: 8px; } .btn:is(:hover, :focus) { padding-top: 8px; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("flags unsized replaced elements", () => {
    const diagnostics = runRule(
      "css-layout-unsized-replaced-element",
      `
        export function App() {
          return <img src="/hero.png" alt="hero" />
        }
      `,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag replaced elements with explicit width and height", () => {
    const diagnostics = runRule(
      "css-layout-unsized-replaced-element",
      `
        export function App() {
          return <img src="/hero.png" alt="hero" width="1200" height="630" />
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag replaced elements with numeric JSX width and height", () => {
    const diagnostics = runRule(
      "css-layout-unsized-replaced-element",
      `
        export function App() {
          return <img src="/hero.png" alt="hero" width={1200} height={630} />
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag replaced elements with aspect-ratio and a CSS dimension", () => {
    const diagnostics = runRule(
      "css-layout-unsized-replaced-element",
      `
        import "./layout.css"
        export function App() {
          return <img class="hero" src="/hero.png" alt="hero" />
        }
      `,
      `.hero { width: 100%; aspect-ratio: 16 / 9; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("flags replaced elements with fit-content and auto dimensions", () => {
    const diagnostics = runRule(
      "css-layout-unsized-replaced-element",
      `
        import "./layout.css"
        export function App() {
          return <img class="hero" src="/hero.png" alt="hero" />
        }
      `,
      `.hero { width: fit-content; height: auto; }`,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag replaced elements with numeric inline style dimensions", () => {
    const diagnostics = runRule(
      "css-layout-unsized-replaced-element",
      `
        export function App() {
          return <img src="/hero.png" alt="hero" style={{ width: 1200, height: 630 }} />
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("flags dynamic slots without reserved space", () => {
    const diagnostics = runRule(
      "css-layout-dynamic-slot-no-reserved-space",
      `
        import { Show } from "solid-js"
        import "./layout.css"
        export function App(props: { content: string }) {
          return (
            <section>
              <div class="slot"><Show when={props.content}><span>{props.content}</span></Show></div>
              <div class="peer">peer</div>
            </section>
          )
        }
      `,
      `.slot { display: block; }`,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("flags conditional display collapse without reserve", () => {
    const diagnostics = runRule(
      "css-layout-conditional-display-collapse",
      `
        import "./layout.css"
        export function App() {
          return (
            <section>
              <div class="item">one</div>
              <div>two</div>
            </section>
          )
        }
      `,
      `
        .item { display: block; }
        @media (min-width: 900px) {
          .item { display: none; }
        }
      `,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag conditional display collapse with reserved space", () => {
    const diagnostics = runRule(
      "css-layout-conditional-display-collapse",
      `
        import "./layout.css"
        export function App() {
          return (
            <section>
              <div class="item">one</div>
              <div>two</div>
            </section>
          )
        }
      `,
      `
        .item { display: block; min-height: 80px; }
        @media (min-width: 900px) {
          .item { display: none; }
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag conditional display collapse for out-of-flow elements", () => {
    const diagnostics = runRule(
      "css-layout-conditional-display-collapse",
      `
        import "./layout.css"
        export function App() {
          return (
            <section>
              <div class="item">one</div>
              <div>two</div>
            </section>
          )
        }
      `,
      `
        .item { position: absolute; display: block; }
        @media (min-width: 900px) {
          .item { display: none; }
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("flags conditional white-space wrap shifts", () => {
    const diagnostics = runRule(
      "css-layout-conditional-white-space-wrap-shift",
      `
        import "./layout.css"
        export function App() {
          return (
            <section>
              <p class="title">long headline</p>
              <p>peer</p>
            </section>
          )
        }
      `,
      `
        .title { white-space: normal; }
        @media (min-width: 900px) {
          .title { white-space: nowrap; }
        }
      `,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag conditional white-space when shell size is fixed", () => {
    const diagnostics = runRule(
      "css-layout-conditional-white-space-wrap-shift",
      `
        import "./layout.css"
        export function App() {
          return (
            <section>
              <p class="title">long headline</p>
              <p>peer</p>
            </section>
          )
        }
      `,
      `
        .title { width: 320px; min-height: 48px; white-space: normal; }
        @media (min-width: 900px) {
          .title { white-space: nowrap; }
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag conditional white-space shifts for out-of-flow text", () => {
    const diagnostics = runRule(
      "css-layout-conditional-white-space-wrap-shift",
      `
        import "./layout.css"
        export function App() {
          return (
            <section>
              <p class="title">long headline</p>
              <p>peer</p>
            </section>
          )
        }
      `,
      `
        .title { position: absolute; white-space: normal; }
        @media (min-width: 900px) {
          .title { white-space: nowrap; }
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag dynamic slots with min-height reserve", () => {
    const diagnostics = runRule(
      "css-layout-dynamic-slot-no-reserved-space",
      `
        import { Show } from "solid-js"
        import "./layout.css"
        export function App(props: { content: string }) {
          return (
            <section>
              <div class="slot"><Show when={props.content}><span>{props.content}</span></Show></div>
              <div class="peer">peer</div>
            </section>
          )
        }
      `,
      `.slot { display: block; min-height: 80px; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag dynamic slots with aspect-ratio and percentage width", () => {
    const diagnostics = runRule(
      "css-layout-dynamic-slot-no-reserved-space",
      `
        import { Show } from "solid-js"
        import "./layout.css"
        export function App(props: { content: string }) {
          return (
            <section>
              <div class="slot"><Show when={props.content}><span>{props.content}</span></Show></div>
              <div class="peer">peer</div>
            </section>
          )
        }
      `,
      `.slot { width: 100%; aspect-ratio: 16 / 9; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("flags dynamic slots with non-reserving fit-content dimension", () => {
    const diagnostics = runRule(
      "css-layout-dynamic-slot-no-reserved-space",
      `
        import { Show } from "solid-js"
        import "./layout.css"
        export function App(props: { content: string }) {
          return (
            <section>
              <div class="slot"><Show when={props.content}><span>{props.content}</span></Show></div>
              <div class="peer">peer</div>
            </section>
          )
        }
      `,
      `.slot { width: fit-content; }`,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag dynamic slots with text-only expression content", () => {
    const diagnostics = runRule(
      "css-layout-dynamic-slot-no-reserved-space",
      `
        import "./layout.css"
        export function App(props: { title: string }) {
          return (
            <section>
              <h2 class="slot">{props.title}</h2>
              <div class="peer">peer</div>
            </section>
          )
        }
      `,
      `.slot { display: block; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag dynamic slots on control elements", () => {
    const diagnostics = runRule(
      "css-layout-dynamic-slot-no-reserved-space",
      `
        import { Show } from "solid-js"
        import "./layout.css"
        export function App(props: { label: string; active: boolean }) {
          return (
            <div>
              <button class="btn"><Show when={props.active}><span>{props.label}</span></Show></button>
              <div class="peer">peer</div>
            </div>
          )
        }
      `,
      `.btn { display: block; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag dynamic slots on heading elements", () => {
    const diagnostics = runRule(
      "css-layout-dynamic-slot-no-reserved-space",
      `
        import { Show } from "solid-js"
        import "./layout.css"
        export function App(props: { title: string }) {
          return (
            <section>
              <h1 class="slot"><Show when={props.title}><span>{props.title}</span></Show></h1>
              <div class="peer">peer</div>
            </section>
          )
        }
      `,
      `.slot { display: block; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag dynamic slots with block-axis padding", () => {
    const diagnostics = runRule(
      "css-layout-dynamic-slot-no-reserved-space",
      `
        import { Show } from "solid-js"
        import "./layout.css"
        export function App(props: { content: string }) {
          return (
            <section>
              <div class="slot"><Show when={props.content}><span>{props.content}</span></Show></div>
              <div class="peer">peer</div>
            </section>
          )
        }
      `,
      `.slot { display: block; padding-top: 8px; padding-bottom: 8px; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("flags scroll containers without stable scrollbar gutter", () => {
    const diagnostics = runRule(
      "css-layout-scrollbar-gutter-instability",
      `
        import "./layout.css"
        export function App() {
          return <div class="list">x</div>
        }
      `,
      `.list { overflow-y: auto; }`,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("flags overflow-y scroll without stable gutter", () => {
    const diagnostics = runRule(
      "css-layout-scrollbar-gutter-instability",
      `
        import "./layout.css"
        export function App() {
          return <div class="list">x</div>
        }
      `,
      `.list { overflow-y: scroll; }`,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("flags conditional overflow mode toggles without stable gutter", () => {
    const diagnostics = runRule(
      "css-layout-overflow-mode-toggle-instability",
      `
        import "./layout.css"
        export function App() {
          return <main class="shell">x</main>
        }
      `,
      `
        .shell { overflow-y: hidden; }
        @media (min-width: 900px) {
          .shell { overflow-y: auto; }
        }
      `,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag conditional overflow mode toggles with stable gutter", () => {
    const diagnostics = runRule(
      "css-layout-overflow-mode-toggle-instability",
      `
        import "./layout.css"
        export function App() {
          return <main class="shell">x</main>
        }
      `,
      `
        .shell { overflow-y: hidden; }
        @media (min-width: 900px) {
          .shell { overflow-y: auto; scrollbar-gutter: stable; }
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag scroll containers with stable gutter", () => {
    const diagnostics = runRule(
      "css-layout-scrollbar-gutter-instability",
      `
        import "./layout.css"
        export function App() {
          return <div class="list">x</div>
        }
      `,
      `.list { overflow-y: auto; scrollbar-gutter: stable; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("flags scroll containers with two-value overflow shorthand", () => {
    const diagnostics = runRule(
      "css-layout-scrollbar-gutter-instability",
      `
        import "./layout.css"
        export function App() {
          return <div class="list">x</div>
        }
      `,
      `.list { overflow: hidden auto; }`,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("flags conditional overflow auto without stable gutter", () => {
    const diagnostics = runRule(
      "css-layout-scrollbar-gutter-instability",
      `
        import "./layout.css"
        export function App() {
          return <div class="list">x</div>
        }
      `,
      `
        @media (min-width: 900px) {
          .list { overflow-y: auto; }
        }
      `,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("flags overflow-anchor none on scroll containers", () => {
    const diagnostics = runRule(
      "css-layout-overflow-anchor-instability",
      `
        import "./layout.css"
        export function App() {
          return <div class="list">x</div>
        }
      `,
      `.list { overflow-y: auto; overflow-anchor: none; }`,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag overflow-anchor none for fixed overlays", () => {
    const diagnostics = runRule(
      "css-layout-overflow-anchor-instability",
      `
        import "./layout.css"
        export function App() {
          return (
            <section>
              <div class="overlay">x</div>
              <div>peer</div>
            </section>
          )
        }
      `,
      `.overlay { position: fixed; overflow-y: auto; overflow-anchor: none; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("flags conditional box-sizing mode toggles with non-zero chrome", () => {
    const diagnostics = runRule(
      "css-layout-box-sizing-toggle-with-chrome",
      `
        import "./layout.css"
        export function App() {
          return <div class="panel">x</div>
        }
      `,
      `
        .panel { padding-top: 12px; box-sizing: border-box; }
        @media (min-width: 900px) {
          .panel { box-sizing: content-box; }
        }
      `,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("flags conditional box-sizing toggles with horizontal chrome", () => {
    const diagnostics = runRule(
      "css-layout-box-sizing-toggle-with-chrome",
      `
        import "./layout.css"
        export function App() {
          return <div class="panel">x</div>
        }
      `,
      `
        .panel { padding-left: 12px; box-sizing: border-box; }
        @media (min-width: 900px) {
          .panel { box-sizing: content-box; }
        }
      `,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag conditional box-sizing toggles with zero chrome", () => {
    const diagnostics = runRule(
      "css-layout-box-sizing-toggle-with-chrome",
      `
        import "./layout.css"
        export function App() {
          return <div class="panel">x</div>
        }
      `,
      `
        .panel { box-sizing: border-box; }
        @media (min-width: 900px) {
          .panel { box-sizing: content-box; }
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("flags content-visibility auto without intrinsic size reserve", () => {
    const diagnostics = runRule(
      "css-layout-content-visibility-no-intrinsic-size",
      `
        import "./layout.css"
        export function App(props: { content: string }) {
          return (
            <section>
              <div class="feed">{props.content}</div>
              <div>peer</div>
            </section>
          )
        }
      `,
      `.feed { content-visibility: auto; }`,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag content-visibility auto with intrinsic reserve", () => {
    const diagnostics = runRule(
      "css-layout-content-visibility-no-intrinsic-size",
      `
        import "./layout.css"
        export function App(props: { content: string }) {
          return (
            <section>
              <div class="feed">{props.content}</div>
              <div>peer</div>
            </section>
          )
        }
      `,
      `.feed { content-visibility: auto; contain-intrinsic-size: 400px; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("flags picture source ratios that mismatch fallback image", () => {
    const diagnostics = runRule(
      "jsx-layout-picture-source-ratio-consistency",
      `
        export function App() {
          return (
            <picture>
              <source media="(min-width: 800px)" srcset="/hero-wide.jpg" width="1600" height="900" />
              <img src="/hero.jpg" width="600" height="600" alt="hero" />
            </picture>
          )
        }
      `,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag picture sources with equivalent ratios", () => {
    const diagnostics = runRule(
      "jsx-layout-picture-source-ratio-consistency",
      `
        export function App() {
          return (
            <picture>
              <source media="(min-width: 800px)" srcset="/hero-wide.jpg" width="1200" height="630" />
              <img src="/hero.jpg" width="600" height="315" alt="hero" />
            </picture>
          )
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag picture sources with near-equivalent ratios under threshold", () => {
    const diagnostics = runRule(
      "jsx-layout-picture-source-ratio-consistency",
      `
        export function App() {
          return (
            <picture>
              <source media="(min-width: 800px)" srcset="/hero-wide.jpg" width="1760" height="1000" />
              <img src="/hero.jpg" width="1777" height="1000" alt="hero" />
            </picture>
          )
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("flags fill-image components inside unsized parents", () => {
    const diagnostics = runRule(
      "jsx-layout-fill-image-parent-must-be-sized",
      `
        export function App() {
          return (
            <div>
              <Image fill src="/hero.jpg" alt="hero" />
            </div>
          )
        }
      `,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag fill-image components inside sized positioned parents", () => {
    const diagnostics = runRule(
      "jsx-layout-fill-image-parent-must-be-sized",
      `
        export function App() {
          return (
            <div style={{ position: "relative", height: "320px" }}>
              <Image fill src="/hero.jpg" alt="hero" />
            </div>
          )
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag fill-image components using sized positioned containing ancestor", () => {
    const diagnostics = runRule(
      "jsx-layout-fill-image-parent-must-be-sized",
      `
        export function App() {
          return (
            <div style={{ position: "relative", height: "320px" }}>
              <span>
                <Image fill src="/hero.jpg" alt="hero" />
              </span>
            </div>
          )
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag overflow-anchor auto on scroll containers", () => {
    const diagnostics = runRule(
      "css-layout-overflow-anchor-instability",
      `
        import "./layout.css"
        export function App() {
          return <div class="list">x</div>
        }
      `,
      `.list { overflow-y: auto; overflow-anchor: auto; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("flags swapping webfonts without metric overrides", () => {
    const diagnostics = runRule(
      "css-layout-font-swap-instability",
      `
        import "./layout.css"
        export function App() {
          return <h1 class="title">headline</h1>
        }
      `,
      `
        @font-face {
          font-family: "Brand Sans";
          src: url("/fonts/brand.woff2") format("woff2");
          font-display: swap;
        }
        .title { font-family: "Brand Sans", sans-serif; }
      `,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag swapping webfonts with size-adjust", () => {
    const diagnostics = runRule(
      "css-layout-font-swap-instability",
      `
        import "./layout.css"
        export function App() {
          return <h1 class="title">headline</h1>
        }
      `,
      `
        @font-face {
          font-family: "Brand Sans";
          src: url("/fonts/brand.woff2") format("woff2");
          font-display: swap;
          size-adjust: 102%;
        }
        .title { font-family: "Brand Sans", sans-serif; }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag family when one swapping descriptor has metric overrides", () => {
    const diagnostics = runRule(
      "css-layout-font-swap-instability",
      `
        import "./layout.css"
        export function App() {
          return <h1 class="title">headline</h1>
        }
      `,
      `
        @font-face {
          font-family: "Brand Sans";
          src: url("/fonts/brand-400.woff2") format("woff2");
          font-display: swap;
        }
        @font-face {
          font-family: "Brand Sans";
          src: url("/fonts/brand-700.woff2") format("woff2");
          font-display: swap;
          size-adjust: 102%;
        }
        .title { font-family: "Brand Sans", sans-serif; font-weight: 700; }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag unused font-face entries", () => {
    const diagnostics = runRule(
      "css-layout-font-swap-instability",
      `
        import "./layout.css"
        export function App() {
          return <h1 class="title">headline</h1>
        }
      `,
      `
        @font-face {
          font-family: "Brand Sans";
          src: url("/fonts/brand.woff2") format("woff2");
          font-display: swap;
        }
        .title { font-family: system-ui, sans-serif; }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag local-only font-face entries", () => {
    const diagnostics = runRule(
      "css-layout-font-swap-instability",
      `
        import "./layout.css"
        export function App() {
          return <h1 class="title">headline</h1>
        }
      `,
      `
        @font-face {
          font-family: "Brand Sans";
          src: local("Brand Sans");
          font-display: swap;
        }
        .title { font-family: "Brand Sans", sans-serif; }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("flags overflow-anchor none with overflow shorthand", () => {
    const diagnostics = runRule(
      "css-layout-overflow-anchor-instability",
      `
        import "./layout.css"
        export function App() {
          return <div class="list">x</div>
        }
      `,
      `.list { overflow: hidden auto; overflow-anchor: none; }`,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("flags conditional non-zero offset shifts", () => {
    const diagnostics = runRule(
      "css-layout-conditional-offset-shift",
      `
        import "./layout.css"
        export function App() {
          return <div class="item">x</div>
        }
      `,
      `
        .item { position: relative; top: 0px; }
        @media (min-width: 900px) {
          .item { top: 8px; }
        }
      `,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("flags conditional margin shifts even when top offsets are inapplicable", () => {
    const diagnostics = runRule(
      "css-layout-conditional-offset-shift",
      `
        import "./layout.css"
        export function App() {
          return <div class="item">x</div>
        }
      `,
      `
        @media (min-width: 900px) {
          .item { top: 8px; margin-top: 8px; }
        }
      `,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag conditional offsets with matching unconditional baseline", () => {
    const diagnostics = runRule(
      "css-layout-conditional-offset-shift",
      `
        import "./layout.css"
        export function App() {
          return <div class="item">x</div>
        }
      `,
      `
        .item { position: relative; top: 8px; }
        @media (min-width: 900px) {
          .item { top: 8px; }
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag top offsets when position is static", () => {
    const diagnostics = runRule(
      "css-layout-conditional-offset-shift",
      `
        import "./layout.css"
        export function App() {
          return <div class="item">x</div>
        }
      `,
      `
        @media (min-width: 900px) {
          .item { top: 8px; }
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("flags top offsets when matching conditional position is non-static", () => {
    const diagnostics = runRule(
      "css-layout-conditional-offset-shift",
      `
        import "./layout.css"
        export function App() {
          return <div class="item">x</div>
        }
      `,
      `
        @media (min-width: 900px) {
          .item { position: relative; top: 8px; }
        }
      `,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("flags dynamic inline style toggles on layout properties", () => {
    const diagnostics = runRule(
      "jsx-layout-unstable-style-toggle",
      `
        export function App(props: { open: boolean }) {
          return <div style={{ height: props.open ? "120px" : "0px" }} />
        }
      `,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag static inline style values", () => {
    const diagnostics = runRule(
      "jsx-layout-unstable-style-toggle",
      `
        export function App() {
          return <div style={{ height: "120px" }} />
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag dynamic ternary styles with equivalent values", () => {
    const diagnostics = runRule(
      "jsx-layout-unstable-style-toggle",
      `
        export function App(props: { open: boolean }) {
          return <div style={{ height: props.open ? "120px" : "120px" }} />
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag equivalent numeric and px string dynamic values", () => {
    const diagnostics = runRule(
      "jsx-layout-unstable-style-toggle",
      `
        export function App(props: { open: boolean }) {
          return <div style={{ height: props.open ? 120 : "120px" }} />
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag unreachable dynamic style branches", () => {
    const diagnostics = runRule(
      "jsx-layout-unstable-style-toggle",
      `
        export function App() {
          return <div style={{ height: false && "120px" }} />
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag dynamic style on position:absolute elements", () => {
    const diagnostics = runRule(
      "jsx-layout-unstable-style-toggle",
      `
        import "./layout.css"
        export function App(props: { y: number }) {
          return <div class="overlay" style={{ top: \`\${props.y}px\` }}>x</div>
        }
      `,
      `.overlay { position: absolute; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag dynamic style on position:fixed elements", () => {
    const diagnostics = runRule(
      "jsx-layout-unstable-style-toggle",
      `
        import "./layout.css"
        export function App(props: { rect: { top: number; width: number; height: number } }) {
          return (
            <div class="tooltip" style={{
              top: \`\${props.rect.top}px\`,
              width: \`\${props.rect.width}px\`,
              height: \`\${props.rect.height}px\`,
            }}>x</div>
          )
        }
      `,
      `.tooltip { position: fixed; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag dynamic width when parent has contain:layout inline style", () => {
    const diagnostics = runRule(
      "jsx-layout-unstable-style-toggle",
      `
        export function App(props: { pct: number }) {
          return (
            <div style={{ contain: "layout" }}>
              <div style={{ width: \`\${props.pct}%\` }}>x</div>
            </div>
          )
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag dynamic width when element itself has contain:layout", () => {
    const diagnostics = runRule(
      "jsx-layout-unstable-style-toggle",
      `
        export function App(props: { pct: number }) {
          return <div style={{ contain: "layout", width: \`\${props.pct}%\` }}>x</div>
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag dynamic height when parent has contain:strict", () => {
    const diagnostics = runRule(
      "jsx-layout-unstable-style-toggle",
      `
        export function App(props: { h: number }) {
          return (
            <div style={{ contain: "strict" }}>
              <div style={{ height: \`\${props.h}px\` }}>x</div>
            </div>
          )
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag dynamic width when parent has contain:content", () => {
    const diagnostics = runRule(
      "jsx-layout-unstable-style-toggle",
      `
        export function App(props: { w: number }) {
          return (
            <div style={{ contain: "content" }}>
              <div style={{ width: \`\${props.w}%\` }}>x</div>
            </div>
          )
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("still flags dynamic width when contain is paint-only (no layout containment)", () => {
    const diagnostics = runRule(
      "jsx-layout-unstable-style-toggle",
      `
        export function App(props: { w: number }) {
          return (
            <div style={{ contain: "paint" }}>
              <div style={{ width: \`\${props.w}%\` }}>x</div>
            </div>
          )
        }
      `,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("still flags dynamic style on in-flow elements", () => {
    const diagnostics = runRule(
      "jsx-layout-unstable-style-toggle",
      `
        import "./layout.css"
        export function App(props: { w: number }) {
          return <div class="bar" style={{ width: \`\${props.w}%\` }}>x</div>
        }
      `,
      `.bar { display: block; }`,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag classList entries with static truthy values", () => {
    const diagnostics = runRule(
      "jsx-layout-classlist-geometry-toggle",
      `
        import "./layout.css"
        export function App() {
          return <div classList={{ expanded: true }}>x</div>
        }
      `,
      `.expanded { height: 240px; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("flags overflow mode toggles that disable scrolling conditionally", () => {
    const diagnostics = runRule(
      "css-layout-overflow-mode-toggle-instability",
      `
        import "./layout.css"
        export function App() {
          return <main class="shell">x</main>
        }
      `,
      `
        .shell { overflow-y: auto; }
        @media (min-width: 900px) {
          .shell { overflow-y: hidden; }
        }
      `,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("flags stateful top shifts when base establishes positioning", () => {
    const diagnostics = runRule(
      "css-layout-stateful-box-model-shift",
      `
        import "./layout.css"
        export function App() {
          return <button class="btn">save</button>
        }
      `,
      `.btn { position: relative; } .btn:hover { top: 8px; }`,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag replaced elements sized with inline-size and block-size", () => {
    const diagnostics = runRule(
      "css-layout-unsized-replaced-element",
      `
        import "./layout.css"
        export function App() {
          return <img class="hero" src="/hero.png" alt="hero" />
        }
      `,
      `.hero { inline-size: 100%; block-size: 320px; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag out-of-flow dynamic slots without reserved space", () => {
    const diagnostics = runRule(
      "css-layout-dynamic-slot-no-reserved-space",
      `
        import { Show } from "solid-js"
        import "./layout.css"
        export function App(props: { content: string }) {
          return (
            <section>
              <div class="slot"><Show when={props.content}><span>{props.content}</span></Show></div>
              <div class="peer">peer</div>
            </section>
          )
        }
      `,
      `.slot { position: absolute; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("flags reverse white-space wrap toggles", () => {
    const diagnostics = runRule(
      "css-layout-conditional-white-space-wrap-shift",
      `
        import "./layout.css"
        export function App() {
          return (
            <section>
              <p class="title">long headline</p>
              <p>peer</p>
            </section>
          )
        }
      `,
      `
        .title { white-space: nowrap; }
        @media (min-width: 900px) {
          .title { white-space: normal; }
        }
      `,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag white-space wrap shifts from mutually exclusive attribute value selectors", () => {
    const diagnostics = runRule(
      "css-layout-conditional-white-space-wrap-shift",
      `
        import "./layout.css"
        export function App() {
          return (
            <section>
              <p class="cell" data-sizing={props.sizing}>content</p>
              <p>peer</p>
            </section>
          )
        }
      `,
      `
        .cell[data-sizing="intrinsic"] { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cell[data-sizing="flex"] { white-space: normal; word-break: break-word; }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("flags conditional inset-block shorthand offsets", () => {
    const diagnostics = runRule(
      "css-layout-conditional-offset-shift",
      `
        import "./layout.css"
        export function App() {
          return <div class="item">x</div>
        }
      `,
      `
        @media (min-width: 900px) {
          .item { position: relative; inset-block: 8px 0; }
        }
      `,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("flags conditional box-sizing toggles with padding shorthand chrome", () => {
    const diagnostics = runRule(
      "css-layout-box-sizing-toggle-with-chrome",
      `
        import "./layout.css"
        export function App() {
          return <div class="panel">x</div>
        }
      `,
      `
        .panel { padding: 12px; box-sizing: border-box; }
        @media (min-width: 900px) {
          .panel { box-sizing: content-box; }
        }
      `,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("flags conditional display contents collapse", () => {
    const diagnostics = runRule(
      "css-layout-conditional-display-collapse",
      `
        import "./layout.css"
        export function App() {
          return (
            <section>
              <div class="item">one</div>
              <div>two</div>
            </section>
          )
        }
      `,
      `
        .item { display: block; }
        @media (min-width: 900px) {
          .item { display: contents; }
        }
      `,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag horizontal-only scrollbar configurations", () => {
    const diagnostics = runRule(
      "css-layout-scrollbar-gutter-instability",
      `
        import "./layout.css"
        export function App() {
          return <div class="list">x</div>
        }
      `,
      `.list { overflow: auto hidden; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("flags transition shorthand using all", () => {
    const diagnostics = runRule(
      "css-layout-transition-layout-property",
      `
        import "./layout.css"
        export function App() {
          return <div class="box">x</div>
        }
      `,
      `.box { transition: all 200ms ease; }`,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("flags layout animations with keyword-heavy shorthand ordering", () => {
    const diagnostics = runRule(
      "css-layout-animation-layout-property",
      `
        import "./layout.css"
        export function App() {
          return <div class="box">x</div>
        }
      `,
      `
        @keyframes expand { from { height: 0px; } to { height: 120px; } }
        .box { animation: 240ms ease-in both expand; }
      `,
    )

    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag fill-image when nearest positioned ancestor reserves ratio-based size", () => {
    const diagnostics = runRule(
      "jsx-layout-fill-image-parent-must-be-sized",
      `
        export function App() {
          return (
            <div style={{ position: "relative", width: "100%", "aspect-ratio": "16 / 9" }}>
              <span>
                <Image fill src="/hero.jpg" alt="hero" />
              </span>
            </div>
          )
        }
      `,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag dynamic slots when CSS-escaped Tailwind class reserves min-height", () => {
    const diagnostics = runRule(
      "css-layout-dynamic-slot-no-reserved-space",
      `
        import { Show } from "solid-js"
        import "./layout.css"
        export function App(props: { content: string }) {
          return (
            <section>
              <div class="slot min-h-[280px]"><Show when={props.content}><span>{props.content}</span></Show></div>
              <div class="peer">peer</div>
            </section>
          )
        }
      `,
      `.slot { display: block; } .min-h-\\[280px\\] { min-height: 280px; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag dynamic slots when CSS-escaped Tailwind class reserves height", () => {
    const diagnostics = runRule(
      "css-layout-dynamic-slot-no-reserved-space",
      `
        import { Show } from "solid-js"
        import "./layout.css"
        export function App(props: { content: string }) {
          return (
            <section>
              <div class="h-[120px]"><Show when={props.content}><span>{props.content}</span></Show></div>
              <div class="peer">peer</div>
            </section>
          )
        }
      `,
      `.h-\\[120px\\] { height: 120px; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag dynamic slots when component host carries attribute matched by CSS with reserved space", () => {
    const component = parseCode(
      `
        import { Base } from "some-library"
        export function Card(props: { children: any }) {
          return <Base data-component="card">{props.children}</Base>
        }
      `,
      "/project/card.tsx",
    )

    const consumer = parseCode(
      `
        import { Show } from "solid-js"
        import { Card } from "./card"
        import "./layout.css"
        export function App(props: { content: string }) {
          return (
            <section>
              <Card><Show when={props.content}><span>{props.content}</span></Show></Card>
              <div class="peer">peer</div>
            </section>
          )
        }
      `,
      "/project/App.tsx",
    )

    const diagnostics: Diagnostic[] = []
    analyzeCrossFileInput(
      {
        solid: [consumer, component],
        css: { files: [{ path: "/project/layout.css", content: `[data-component="card"] { height: 200px; }` }] },
      },
      (diagnostic) => diagnostics.push(diagnostic),
    )

    const filtered = diagnostics.filter((d) => d.rule === "css-layout-dynamic-slot-no-reserved-space")
    expect(filtered).toHaveLength(0)
  })

  it("still flags dynamic slots when component host has no CSS-matched reserved space", () => {
    const component = parseCode(
      `
        export function Card(props: { children: any }) {
          return <div data-component="card">{props.children}</div>
        }
      `,
      "/project/card.tsx",
    )

    const consumer = parseCode(
      `
        import { Show } from "solid-js"
        import { Card } from "./card"
        import "./layout.css"
        export function App(props: { content: string }) {
          return (
            <section>
              <Card><Show when={props.content}><span>{props.content}</span></Show></Card>
              <div class="peer">peer</div>
            </section>
          )
        }
      `,
      "/project/App.tsx",
    )

    const diagnostics: Diagnostic[] = []
    analyzeCrossFileInput(
      {
        solid: [consumer, component],
        css: { files: [{ path: "/project/layout.css", content: `[data-component="card"] { color: red; }` }] },
      },
      (diagnostic) => diagnostics.push(diagnostic),
    )

    const filtered = diagnostics.filter((d) => d.rule === "css-layout-dynamic-slot-no-reserved-space")
    expect(filtered).toHaveLength(1)
  })

  it("does not flag dynamic slots when component host carries class tokens matched by CSS with reserved space", () => {
    const component = parseCode(
      `
        export function Slot(props: { children: any }) {
          return <div class="reserved-slot">{props.children}</div>
        }
      `,
      "/project/slot.tsx",
    )

    const consumer = parseCode(
      `
        import { Show } from "solid-js"
        import { Slot } from "./slot"
        import "./layout.css"
        export function App(props: { content: string }) {
          return (
            <section>
              <Slot><Show when={props.content}><span>{props.content}</span></Show></Slot>
              <div class="peer">peer</div>
            </section>
          )
        }
      `,
      "/project/App.tsx",
    )

    const diagnostics: Diagnostic[] = []
    analyzeCrossFileInput(
      {
        solid: [consumer, component],
        css: { files: [{ path: "/project/layout.css", content: `.reserved-slot { min-height: 100px; }` }] },
      },
      (diagnostic) => diagnostics.push(diagnostic),
    )

    const filtered = diagnostics.filter((d) => d.rule === "css-layout-dynamic-slot-no-reserved-space")
    expect(filtered).toHaveLength(0)
  })

  it("does not flag dynamic slots when Object.assign compound component host carries attribute matched by CSS", () => {
    const component = parseCode(
      `
        import { Base } from "some-library"

        function TabsRoot(props: any) {
          return <Base data-component="tabs">{props.children}</Base>
        }

        function TabsList(props: any) {
          return <Base data-slot="tabs-list">{props.children}</Base>
        }

        export const Tabs = Object.assign(TabsRoot, { List: TabsList })
      `,
      "/project/tabs.tsx",
    )

    const consumer = parseCode(
      `
        import { Show } from "solid-js"
        import { Tabs } from "./tabs"
        import "./layout.css"
        export function App(props: { items: string[] }) {
          return (
            <section>
              <Tabs><Show when={props.items.length > 0}><span>content</span></Show></Tabs>
              <div class="peer">peer</div>
            </section>
          )
        }
      `,
      "/project/App.tsx",
    )

    const diagnostics: Diagnostic[] = []
    analyzeCrossFileInput(
      {
        solid: [consumer, component],
        css: {
          files: [{
            path: "/project/layout.css",
            content: `[data-component="tabs"] { height: 100%; }`,
          }],
        },
      },
      (diagnostic) => diagnostics.push(diagnostic),
    )

    const filtered = diagnostics.filter((d) => d.rule === "css-layout-dynamic-slot-no-reserved-space")
    expect(filtered).toHaveLength(0)
  })

  it("does not flag dynamic slots when polymorphic as-prop resolves inner component to a control element", () => {
    const polymorphic = parseCode(
      `
        export function Polymorphic(props: any) {
          return <div>{props.children}</div>
        }
      `,
      "/project/polymorphic.tsx",
    )

    const buttonRoot = parseCode(
      `
        import { Polymorphic } from "./polymorphic"
        export function ButtonRoot(props: any) {
          return <Polymorphic as="button">{props.children}</Polymorphic>
        }
      `,
      "/project/button-root.tsx",
    )

    const button = parseCode(
      `
        import { ButtonRoot } from "./button-root"
        export function Button(props: any) {
          return <ButtonRoot>{props.children}</ButtonRoot>
        }
      `,
      "/project/button.tsx",
    )

    const consumer = parseCode(
      `
        import { Show } from "solid-js"
        import { Button } from "./button"
        import "./layout.css"
        export function App(props: { show: boolean }) {
          return (
            <form>
              <Button>Submit</Button>
              <Show when={props.show}><span>Error</span></Show>
            </form>
          )
        }
      `,
      "/project/App.tsx",
    )

    const diagnostics: Diagnostic[] = []
    analyzeCrossFileInput(
      {
        solid: [consumer, button, buttonRoot, polymorphic],
        css: {
          files: [{
            path: "/project/layout.css",
            content: `form { display: flex; }`,
          }],
        },
      },
      (diagnostic) => diagnostics.push(diagnostic),
    )

    const filtered = diagnostics.filter((d) => d.rule === "css-layout-dynamic-slot-no-reserved-space")
    expect(filtered).toHaveLength(0)
  })

  it("does not resolve polymorphic as-prop when value is a non-HTML component name", () => {
    // Use Dynamic (unresolvable) as the inner return to simulate real Polymorphic
    const polymorphic = parseCode(
      `
        import { Dynamic } from "solid-js/web"
        export function Polymorphic(props: any) {
          return <Dynamic component={props.as}>{props.children}</Dynamic>
        }
      `,
      "/project/polymorphic.tsx",
    )

    const wrapper = parseCode(
      `
        import { Polymorphic } from "./polymorphic"
        export function CustomWrapper(props: any) {
          return <Polymorphic as="CustomElement">{props.children}</Polymorphic>
        }
      `,
      "/project/wrapper.tsx",
    )

    const consumer = parseCode(
      `
        import { Show } from "solid-js"
        import { CustomWrapper } from "./wrapper"
        import "./layout.css"
        export function App(props: { show: boolean }) {
          return (
            <div>
              <section>
                <CustomWrapper>Content</CustomWrapper>
                <Show when={props.show}><span>Extra</span></Show>
              </section>
              <div class="peer">peer</div>
            </div>
          )
        }
      `,
      "/project/App.tsx",
    )

    const diagnostics: Diagnostic[] = []
    analyzeCrossFileInput(
      {
        solid: [consumer, wrapper, polymorphic],
        css: {
          files: [{
            path: "/project/layout.css",
            content: `div { display: flex; }`,
          }],
        },
      },
      (diagnostic) => diagnostics.push(diagnostic),
    )

    // CustomElement is not a valid HTML tag, so tagName stays null and the component
    // is NOT recognized as a control — the dynamic-slot diagnostic should still fire
    const filtered = diagnostics.filter((d) => d.rule === "css-layout-dynamic-slot-no-reserved-space")
    expect(filtered.length).toBeGreaterThan(0)
  })

  it("resolves polymorphic as-prop to non-control HTML element and still uses it for CSS matching", () => {
    // Use Dynamic (unresolvable) as the inner return to simulate real Polymorphic
    const polymorphic = parseCode(
      `
        import { Dynamic } from "solid-js/web"
        export function Polymorphic(props: any) {
          return <Dynamic component={props.as}>{props.children}</Dynamic>
        }
      `,
      "/project/polymorphic.tsx",
    )

    const panel = parseCode(
      `
        import { Polymorphic } from "./polymorphic"
        export function Panel(props: any) {
          return <Polymorphic as="section" data-panel="main">{props.children}</Polymorphic>
        }
      `,
      "/project/panel.tsx",
    )

    const consumer = parseCode(
      `
        import { Show } from "solid-js"
        import { Panel } from "./panel"
        import "./layout.css"
        export function App(props: { show: boolean }) {
          return (
            <div>
              <Panel><Show when={props.show}><span>content</span></Show></Panel>
              <div class="peer">peer</div>
            </div>
          )
        }
      `,
      "/project/App.tsx",
    )

    const diagnostics: Diagnostic[] = []
    analyzeCrossFileInput(
      {
        solid: [consumer, panel, polymorphic],
        css: {
          files: [{
            path: "/project/layout.css",
            content: `section[data-panel="main"] { min-height: 200px; }`,
          }],
        },
      },
      (diagnostic) => diagnostics.push(diagnostic),
    )

    // Panel resolves to <section data-panel="main"> via the as-prop fallback,
    // which matches the CSS selector that reserves space, so no diagnostic should fire
    const filtered = diagnostics.filter((d) => d.rule === "css-layout-dynamic-slot-no-reserved-space")
    expect(filtered).toHaveLength(0)
  })

  it("does not flag dynamic slot when compound CSS selector matches across separate functions in same file", () => {
    const diagnostics = runRule(
      "css-layout-dynamic-slot-no-reserved-space",
      `
        import { Show, For, Index } from "solid-js"
        import "./layout.css"

        function DataTableRoot(props: { children: any }) {
          return (
            <div data-component="data-table">
              {props.children}
            </div>
          )
        }

        function DataTablePagination(props: { pages: number[] }) {
          return (
            <div data-slot="data-table-pagination">
              <div data-slot="data-table-pagination-pages">
                <Index each={props.pages}>
                  {(page) => <button>{page()}</button>}
                </Index>
              </div>
            </div>
          )
        }

        export const DataTable = Object.assign(DataTableRoot, {
          Pagination: DataTablePagination,
        })
      `,
      `[data-component="data-table"] [data-slot="data-table-pagination-pages"] { min-height: 2rem; }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag dynamic slot when compound CSS selector matches element in render callback", () => {
    const diagnostics = runRule(
      "css-layout-dynamic-slot-no-reserved-space",
      `
        import { Show, For } from "solid-js"
        import "./layout.css"

        function SelectContent(props: { children: any }) {
          return <div data-component="select-content">{props.children}</div>
        }

        export function SelectStyled(props: { items: string[] }) {
          return (
            <div data-component="select">
              <SelectContent>
                <For each={props.items}>
                  {(item) => (
                    <li data-slot="select-item">
                      <Show when={item}><span>{item}</span></Show>
                    </li>
                  )}
                </For>
              </SelectContent>
            </div>
          )
        }
      `,
      `[data-component="select-content"] [data-slot="select-item"] { min-height: var(--size-height-sm); }`,
    )

    expect(diagnostics).toHaveLength(0)
  })

  // --- resolveEffectiveTag regression tests ---
  // Before the fix, resolveEffectiveTag returned element.tag (e.g. "DropdownMenu.Portal")
  // for unresolved external components, which got lowercased to a non-null tagName,
  // bypassing the tagName === null guard in the dynamic-slot rule.

  it("does not flag unresolved external library component (Portal) as dynamic-slot false positive", () => {
    const component = parseCode(
      `
        import { DropdownMenu as KDropdownMenu } from "@kobalte/core"
        export function DropdownMenuPortal(props: { children: any }) {
          return <KDropdownMenu.Portal>{props.children}</KDropdownMenu.Portal>
        }
      `,
      "/project/dropdown-portal.tsx",
    )

    const consumer = parseCode(
      `
        import { Show } from "solid-js"
        import { DropdownMenuPortal } from "./dropdown-portal"
        import "./layout.css"
        export function App(props: { open: boolean }) {
          return (
            <div>
              <DropdownMenuPortal>
                <Show when={props.open}><span>menu content</span></Show>
              </DropdownMenuPortal>
              <div class="peer">peer</div>
            </div>
          )
        }
      `,
      "/project/App.tsx",
    )

    const diagnostics: Diagnostic[] = []
    analyzeCrossFileInput(
      {
        solid: [consumer, component],
        css: {
          files: [{
            path: "/project/layout.css",
            content: `div { display: flex; }`,
          }],
        },
      },
      (diagnostic) => diagnostics.push(diagnostic),
    )

    // KDropdownMenu.Portal is unresolvable — tagName must be null, no false positive
    const filtered = diagnostics.filter((d) => d.rule === "css-layout-dynamic-slot-no-reserved-space")
    expect(filtered).toHaveLength(0)
  })

  it("does not flag DropdownMenu-style Object.assign pattern with external library sub-components", () => {
    const component = parseCode(
      `
        import { DropdownMenu as KDropdownMenu } from "@kobalte/core"

        function DropdownMenuRoot(props: any) {
          return <KDropdownMenu>{props.children}</KDropdownMenu>
        }

        function DropdownMenuPortal(props: any) {
          return <KDropdownMenu.Portal>{props.children}</KDropdownMenu.Portal>
        }

        function DropdownMenuContent(props: any) {
          return <KDropdownMenu.Content data-slot="dropdown-menu-content">{props.children}</KDropdownMenu.Content>
        }

        function DropdownMenuItem(props: any) {
          return <KDropdownMenu.Item data-slot="dropdown-menu-item">{props.children}</KDropdownMenu.Item>
        }

        export const DropdownMenu = Object.assign(DropdownMenuRoot, {
          Portal: DropdownMenuPortal,
          Content: DropdownMenuContent,
          Item: DropdownMenuItem,
        })
      `,
      "/project/dropdown-menu.tsx",
    )

    const consumer = parseCode(
      `
        import { Show, For } from "solid-js"
        import { DropdownMenu } from "./dropdown-menu"
        import "./layout.css"
        export function App(props: { items: string[]; open: boolean }) {
          return (
            <div>
              <DropdownMenu>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content>
                    <For each={props.items}>
                      {(item) => <DropdownMenu.Item>{item}</DropdownMenu.Item>}
                    </For>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu>
              <div class="peer">peer</div>
            </div>
          )
        }
      `,
      "/project/App.tsx",
    )

    const diagnostics: Diagnostic[] = []
    analyzeCrossFileInput(
      {
        solid: [consumer, component],
        css: {
          files: [{
            path: "/project/layout.css",
            content: `div { display: flex; }`,
          }],
        },
      },
      (diagnostic) => diagnostics.push(diagnostic),
    )

    // All sub-components (Portal, Content, Item) wrap external @kobalte/core components.
    // Their host elements are unresolvable, so tagName must be null — zero false positives.
    const filtered = diagnostics.filter((d) => d.rule === "css-layout-dynamic-slot-no-reserved-space")
    expect(filtered).toHaveLength(0)
  })

  it("still flags dynamic slot when compound CSS selector ancestor does not exist in same file", () => {
    const diagnostics = runRule(
      "css-layout-dynamic-slot-no-reserved-space",
      `
        import { Show, Index } from "solid-js"
        import "./layout.css"

        export function Pagination(props: { pages: number[]; visible: boolean }) {
          return (
            <div data-slot="pagination">
              <div data-slot="pagination-pages">
                <Show when={props.visible}><span>visible</span></Show>
              </div>
              <div data-slot="pagination-info">info</div>
            </div>
          )
        }
      `,
      `[data-component="data-table"] [data-slot="pagination-pages"] { min-height: 2rem; }`,
    )

    expect(diagnostics).toHaveLength(1)
  })
})
