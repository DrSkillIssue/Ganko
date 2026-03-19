import { describe, it, expect, beforeAll, afterAll } from "vitest"
import type { Diagnostic } from "../../src/diagnostic"
import { analyzeCSSInput, buildCSSGraph } from "../../src/css/plugin"
import { selectorMaxAttributeAndUniversal } from "../../src/css/rules/selector"
import { setActivePolicy } from "../../src/css/policy"

function first(arr: readonly Diagnostic[]): Diagnostic {
  const item = arr[0]
  if (!item) throw new Error("Expected at least one diagnostic")
  return item
}

function lint(css: string): readonly Diagnostic[] {
  const ds: Diagnostic[] = []

  analyzeCSSInput(
    {
      files: [{ path: "test.css", content: css }],
    },
    (d) => ds.push(d),
  )

  return ds
}

function lintFiles(files: readonly { path: string; content: string }[]): readonly Diagnostic[] {
  const ds: Diagnostic[] = []

  analyzeCSSInput(
    { files },
    (d) => ds.push(d),
  )

  return ds
}

describe("CSS rules", () => {
  it("reports !important declarations", () => {
    const ds = lint(`
      .btn {
        color: red !important;
      }
    `)

    const noImportant = ds.filter((d) => d.rule === "no-important")
    expect(noImportant).toHaveLength(1)
    expect(first(noImportant).severity).toBe("warn")
  })

  it("reports ID selectors", () => {
    const ds = lint(`
      #header .btn {
        color: red;
      }
    `)

    const noIdSelectors = ds.filter((d) => d.rule === "no-id-selectors")
    expect(noIdSelectors).toHaveLength(1)
    expect(first(noIdSelectors).message).toContain("Avoid ID selector")
  })

  it("reports deep selectors", () => {
    const ds = lint(`
      .a .b .c .d .e {
        color: red;
      }
    `)

    const noComplexSelectors = ds.filter((d) => d.rule === "no-complex-selectors")
    expect(noComplexSelectors).toHaveLength(1)
    expect(first(noComplexSelectors).message).toContain("depth")
  })

  it("reports duplicate selectors", () => {
    const ds = lint(`
      .card { color: red; }
      .card { background: white; }
    `)

    const noDuplicateSelectors = ds.filter((d) => d.rule === "no-duplicate-selectors")
    expect(noDuplicateSelectors).toHaveLength(2)
    expect(first(noDuplicateSelectors).message).toContain("duplicated")
  })

  it("does not report clean component-scoped CSS", () => {
    const ds = lint(`
      :root {
        --surface: #fff;
        --text: #111;
      }

      .card {
        background: var(--surface);
      }

      .card__title {
        color: var(--text);
      }
    `)

    const cssRuleIds = new Set([
      "css-no-discrete-transition",
      "css-no-custom-property-cycle",
      "css-no-empty-keyframes",
      "css-no-empty-rule",
      "css-no-hardcoded-z-index",
      "css-no-legacy-vh-100",
      "css-no-outline-none-without-focus-visible",
      "css-no-unknown-container-name",
      "css-no-unused-container-name",
      "css-prefer-logical-properties",
      "css-require-reduced-motion-override",
      "css-z-index-requires-positioned-context",
      "declaration-no-overridden-within-rule",
      "layer-requirement-for-component-rules",
      "media-query-overlap-conflict",
      "no-important",
      "no-id-selectors",
      "no-complex-selectors",
      "no-descending-specificity-conflict",
      "no-duplicate-selectors",
      "no-layout-property-animation",
      "no-layer-order-inversion",
      "no-redundant-override-pairs",
      "no-unresolved-custom-properties",
      "no-unused-custom-properties",
      "no-unused-keyframes",
      "selector-max-attribute-and-universal",
      "no-unknown-animation-name",
      "no-transition-all",
      "selector-max-specificity",
    ])

    const relevant = ds.filter((d) => cssRuleIds.has(d.rule))
    expect(relevant).toHaveLength(0)
  })

  it("reports unresolved custom property references", () => {
    const ds = lint(`
      .btn {
        color: var(--brand-color);
      }
    `)

    const unresolved = ds.filter((d) => d.rule === "no-unresolved-custom-properties")
    expect(unresolved).toHaveLength(1)
    expect(first(unresolved).severity).toBe("error")
  })

  it("does not report unresolved var with fallback", () => {
    const ds = lint(`
      .btn {
        color: var(--brand-color, #06f);
      }
    `)

    const unresolved = ds.filter((d) => d.rule === "no-unresolved-custom-properties")
    expect(unresolved).toHaveLength(0)
  })

  it("resolves custom property in same selector scope", () => {
    const ds = lint(`
      .card {
        --accent: #06f;
        color: var(--accent);
      }
    `)
    const unresolved = ds.filter((d) => d.rule === "no-unresolved-custom-properties")
    expect(unresolved).toHaveLength(0)
  })

  it("reports unresolved custom property from different selector scope", () => {
    const ds = lint(`
      .a { --accent: #06f; }
      .b { color: var(--accent); }
    `)
    const unresolved = ds.filter((d) => d.rule === "no-unresolved-custom-properties")
    expect(unresolved).toHaveLength(1)
  })

  it("reports unused keyframes", () => {
    const ds = lint(`
      @keyframes pulse {
        from { opacity: 0.5; }
        to { opacity: 1; }
      }

      .btn {
        color: red;
      }
    `)

    const unused = ds.filter((d) => d.rule === "no-unused-keyframes")
    expect(unused).toHaveLength(1)
    expect(first(unused).message).toContain("pulse")
  })

  it("does not report keyframes used in animation-name list", () => {
    const ds = lint(`
      @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
      @keyframes slide { from { transform: translateX(0); } to { transform: translateX(10px); } }
      .x { animation-name: fade, slide; }
    `)

    const unused = ds.filter((d) => d.rule === "no-unused-keyframes")
    expect(unused).toHaveLength(0)
  })

  it("does not report keyframes referenced inside non-indexed at-rules", () => {
    const ds = lint(`
      @keyframes fadeUp {
        from { opacity: 0; transform: translateY(5px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @utility fade-up-text {
        animation: fadeUp 0.4s ease-out forwards;
        opacity: 0;
      }
    `)

    const unused = ds.filter((d) => d.rule === "no-unused-keyframes")
    expect(unused).toHaveLength(0)
  })

  it("reports selectors over specificity limit", () => {
    const ds = lint(`
      .a.b.c.d.e.f.g.h.i {
        color: red;
      }
    `)

    const maxSpecificity = ds.filter((d) => d.rule === "selector-max-specificity")
    expect(maxSpecificity).toHaveLength(1)
    expect(first(maxSpecificity).message).toContain("specificity")
  })

  it("reports unused custom properties", () => {
    const ds = lint(`
      .card {
        --used: #fff;
        --unused: #111;
        color: var(--used);
      }
    `)

    const unusedCustomProperty = ds.filter((d) => d.rule === "no-unused-custom-properties")
    expect(unusedCustomProperty).toHaveLength(1)
    expect(first(unusedCustomProperty).message).toContain("--unused")
  })

  it("reports unknown animation names", () => {
    const ds = lint(`
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .card {
        animation: fdaeIn 200ms ease;
      }
    `)

    const unknownAnimationName = ds.filter((d) => d.rule === "no-unknown-animation-name")
    expect(unknownAnimationName).toHaveLength(1)
    expect(first(unknownAnimationName).severity).toBe("error")
  })

  it("reports transition all", () => {
    const ds = lint(`
      .card {
        transition: all 200ms ease;
      }
    `)

    const transitionAll = ds.filter((d) => d.rule === "no-transition-all")
    expect(transitionAll).toHaveLength(1)
    expect(first(transitionAll).message).toContain("transition: all")
  })

  it("reports overridden declarations within the same rule", () => {
    const ds = lint(`
      .card {
        color: red;
        color: blue;
      }
    `)

    const overridden = ds.filter((d) => d.rule === "declaration-no-overridden-within-rule")
    expect(overridden).toHaveLength(1)
    expect(first(overridden).message).toContain("overridden later")
  })

  it("reports descending specificity conflicts", () => {
    const ds = lint(`
      .card .title.primary {
        color: red;
      }

      .card .title {
        color: blue;
      }
    `)

    const descending = ds.filter((d) => d.rule === "no-descending-specificity-conflict")
    expect(descending).toHaveLength(1)
    expect(first(descending).message).toContain("Lower-specificity selector")
  })

  it("reports layout property animations", () => {
    const ds = lint(`
      .card {
        transition: width 200ms ease;
      }
    `)

    const layoutAnimation = ds.filter((d) => d.rule === "no-layout-property-animation")
    expect(layoutAnimation).toHaveLength(1)
    expect(first(layoutAnimation).message).toContain("width")
  })

  it("reports redundant override pairs in same selector context", () => {
    const ds = lint(`
      .card {
        color: red;
      }

      .card {
        color: blue;
      }
    `)

    const redundantPairs = ds.filter((d) => d.rule === "no-redundant-override-pairs")
    expect(redundantPairs).toHaveLength(1)
    expect(first(redundantPairs).message).toContain("always overridden")
  })

  it("reports attribute and universal selector threshold violations", () => {
    const ds: Diagnostic[] = []
    const graph = buildCSSGraph({
      files: [{
        path: "test.css",
        content: `
          [data-state="open"] .item {
            color: red;
          }

          * .card {
            color: blue;
          }
        `,
      }],
    })
    selectorMaxAttributeAndUniversal.check(graph, (d) => ds.push(d))

    const selectorThresholds = ds.filter((d) => d.rule === "selector-max-attribute-and-universal")
    expect(selectorThresholds).toHaveLength(2)
  })

  it("reports rules outside @layer when layers are used", () => {
    const ds = lint(`
      @layer components {
        .card {
          color: red;
        }
      }

      .button {
        color: blue;
      }
    `)

    const missingLayer = ds.filter((d) => d.rule === "layer-requirement-for-component-rules")
    expect(missingLayer).toHaveLength(1)
    expect(first(missingLayer).message).toContain("not inside any @layer")
  })

  it("does not report when all rules are inside @layer", () => {
    const ds = lint(`
      @layer base {
        .app {
          color: red;
        }
      }

      @layer components {
        .button {
          color: blue;
        }
      }
    `)

    const missingLayer = ds.filter((d) => d.rule === "layer-requirement-for-component-rules")
    expect(missingLayer).toHaveLength(0)
  })

  it("enforces layer requirement only in files that declare layers", () => {
    const ds = lintFiles([
      {
        path: "a.css",
        content: `
          @layer components {
            .a { color: red; }
          }

          .a2 { color: blue; }
        `,
      },
      {
        path: "b.css",
        content: `
          .b { color: red; }
        `,
      },
    ])

    const missingLayer = ds.filter((d) => d.rule === "layer-requirement-for-component-rules")
    expect(missingLayer).toHaveLength(1)
    expect(first(missingLayer).file).toBe("a.css")
  })

  it("reports layer order inversion conflicts", () => {
    const ds = lint(`
      @layer low, high;

      @layer high {
        .card {
          color: red;
        }
      }

      @layer low {
        .card {
          color: blue;
        }
      }
    `)

    const inversions = ds.filter((d) => d.rule === "no-layer-order-inversion")
    expect(inversions).toHaveLength(1)
    expect(first(inversions).message).toContain("overridden by an earlier declaration")
  })

  it("reports partial overlapping media query conflicts", () => {
    const ds = lint(`
      @media (min-width: 400px) and (max-width: 900px) {
        .card {
          color: red;
        }
      }

      @media (min-width: 700px) and (max-width: 1100px) {
        .card {
          color: blue;
        }
      }
    `)

    const overlaps = ds.filter((d) => d.rule === "media-query-overlap-conflict")
    expect(overlaps).toHaveLength(2)
  })

  it("does not report descending specificity for unsupported selector syntax", () => {
    const ds = lint(`
      .card:has(.title) {
        color: red;
      }

      .card {
        color: blue;
      }
    `)

    const descending = ds.filter((d) => d.rule === "no-descending-specificity-conflict")
    expect(descending).toHaveLength(0)
  })

  it("does not report media overlap when one range fully contains the other", () => {
    const ds = lint(`
      @media (min-width: 400px) and (max-width: 1200px) {
        .card {
          color: red;
        }
      }

      @media (min-width: 700px) and (max-width: 900px) {
        .card {
          color: blue;
        }
      }
    `)

    const overlaps = ds.filter((d) => d.rule === "media-query-overlap-conflict")
    expect(overlaps).toHaveLength(0)
  })

  it("does not report media overlap when ranges are disjoint", () => {
    const ds = lint(`
      @media (min-width: 400px) and (max-width: 600px) {
        .card {
          color: red;
        }
      }

      @media (min-width: 700px) and (max-width: 900px) {
        .card {
          color: blue;
        }
      }
    `)

    const overlaps = ds.filter((d) => d.rule === "media-query-overlap-conflict")
    expect(overlaps).toHaveLength(0)
  })

  it("does not report layer inversion when declarations share the same layer", () => {
    const ds = lint(`
      @layer low {
        .card {
          color: red;
        }

        .card {
          color: blue;
        }
      }
    `)

    const inversions = ds.filter((d) => d.rule === "no-layer-order-inversion")
    expect(inversions).toHaveLength(0)
  })

  it("does not report layer inversion when values are identical", () => {
    const ds = lint(`
      @layer low, high;

      @layer high { .card { color: red; } }
      @layer low { .card { color: red; } }
    `)

    const inversions = ds.filter((d) => d.rule === "no-layer-order-inversion")
    expect(inversions).toHaveLength(0)
  })

  it("reports discrete transition properties", () => {
    const ds = lint(`.card { transition: display 200ms ease; }`)
    const diagnostics = ds.filter((d) => d.rule === "css-no-discrete-transition")
    expect(diagnostics).toHaveLength(1)
  })

  it("reports empty rules", () => {
    const ds = lint(`.empty {}`)
    const diagnostics = ds.filter((d) => d.rule === "css-no-empty-rule")
    expect(diagnostics).toHaveLength(1)
  })

  it("reports empty keyframes", () => {
    const ds = lint(`@keyframes spin {}`)
    const diagnostics = ds.filter((d) => d.rule === "css-no-empty-keyframes")
    expect(diagnostics).toHaveLength(1)
  })

  it("reports hardcoded z-index literals", () => {
    const ds = lint(`.card { z-index: 999; }`)
    const diagnostics = ds.filter((d) => d.rule === "css-no-hardcoded-z-index")
    expect(diagnostics).toHaveLength(1)
  })

  it("reports legacy 100vh usage", () => {
    const ds = lint(`.screen { min-height: 100vh; }`)
    const diagnostics = ds.filter((d) => d.rule === "css-no-legacy-vh-100")
    expect(diagnostics).toHaveLength(1)
  })

  it("reports z-index without positioned context", () => {
    const ds = lint(`.card { position: static; z-index: 2; }`)
    const diagnostics = ds.filter((d) => d.rule === "css-z-index-requires-positioned-context")
    expect(diagnostics).toHaveLength(1)
  })

  it("does not report z-index when context is not provable", () => {
    const ds = lint(`.card { z-index: 2; }`)
    const diagnostics = ds.filter((d) => d.rule === "css-z-index-requires-positioned-context")
    expect(diagnostics).toHaveLength(0)
  })

  it("reports outline-none without focus-visible", () => {
    const ds = lint(`
      .btn:focus { outline: none; }
    `)
    const diagnostics = ds.filter((d) => d.rule === "css-no-outline-none-without-focus-visible")
    expect(diagnostics).toHaveLength(1)
  })

  it("does not report when focus-visible has visible indicator", () => {
    const ds = lint(`
      .btn:focus { outline: none; }
      .btn:focus-visible { outline: 2px solid currentColor; }
    `)
    const diagnostics = ds.filter((d) => d.rule === "css-no-outline-none-without-focus-visible")
    expect(diagnostics).toHaveLength(0)
  })

  it("reports unknown container query names", () => {
    const ds = lint(`
      @container card-shell (min-width: 400px) {
        .x { color: red; }
      }
    `)
    const diagnostics = ds.filter((d) => d.rule === "css-no-unknown-container-name")
    expect(diagnostics).toHaveLength(1)
  })

  it("does not treat style() container query as named container", () => {
    const ds = lint(`
      @container style(--theme: dark) {
        .x { color: red; }
      }
    `)
    const diagnostics = ds.filter((d) => d.rule === "css-no-unknown-container-name")
    expect(diagnostics).toHaveLength(0)
  })

  it("treats STYLE() container query as unnamed", () => {
    const ds = lint(`
      @container STYLE(--theme: dark) {
        .x { color: red; }
      }
    `)

    const diagnostics = ds.filter((d) => d.rule === "css-no-unknown-container-name")
    expect(diagnostics).toHaveLength(0)
  })

  it("supports space-separated container-name declarations", () => {
    const ds = lint(`
      .panel { container-name: layout sidebar; }
      @container sidebar (min-width: 400px) { .x { color: red; } }
    `)
    const unknown = ds.filter((d) => d.rule === "css-no-unknown-container-name")
    expect(unknown).toHaveLength(0)
  })

  it("reports unused container names", () => {
    const ds = lint(`
      .panel { container-name: shell; }
    `)
    const diagnostics = ds.filter((d) => d.rule === "css-no-unused-container-name")
    expect(diagnostics).toHaveLength(1)
  })

  it("supports container shorthand name declarations", () => {
    const ds = lint(`
      .panel { container: shell / inline-size; }
      @container shell (min-width: 400px) { .x { color: red; } }
    `)
    const unknown = ds.filter((d) => d.rule === "css-no-unknown-container-name")
    const unused = ds.filter((d) => d.rule === "css-no-unused-container-name")
    expect(unknown).toHaveLength(0)
    expect(unused).toHaveLength(0)
  })

  it("supports multi-name container shorthand declarations", () => {
    const ds = lint(`
      .panel { container: shell sidebar / inline-size; }
      @container sidebar (min-width: 400px) { .x { color: red; } }
    `)

    const unknown = ds.filter((d) => d.rule === "css-no-unknown-container-name")
    const unused = ds.filter((d) => d.rule === "css-no-unused-container-name")
    expect(unknown).toHaveLength(0)
    expect(unused).toHaveLength(1)
    expect(first(unused).message).toContain("shell")
  })

  it("does not treat type-only container shorthand as container name", () => {
    const ds = lint(`
      .panel { container: inline-size; }
    `)

    const unused = ds.filter((d) => d.rule === "css-no-unused-container-name")
    expect(unused).toHaveLength(0)
  })

  it("still reports unknown query name when only type shorthand exists", () => {
    const ds = lint(`
      .panel { container: inline-size; }
      @container card (min-width: 400px) { .x { color: red; } }
    `)

    const unknown = ds.filter((d) => d.rule === "css-no-unknown-container-name")
    expect(unknown).toHaveLength(1)
    expect(first(unknown).message).toContain("card")
  })

  it("deduplicates repeated container names in one declaration", () => {
    const ds = lint(`
      .panel { container-name: shell shell; }
    `)

    const unused = ds.filter((d) => d.rule === "css-no-unused-container-name")
    expect(unused).toHaveLength(1)
  })

  it("does not report media overlap for range operators", () => {
    const ds = lint(`
      @media (width > 600px) { .a { color: red; } }
      @media (max-width: 600px) { .a { color: blue; } }
    `)
    const overlaps = ds.filter((d) => d.rule === "media-query-overlap-conflict")
    expect(overlaps).toHaveLength(0)
  })

  it("does not report media overlap when orientation differs", () => {
    const ds = lint(`
      @media (min-width: 700px) and (orientation: portrait) {
        .a { color: red; }
      }
      @media (min-width: 700px) and (orientation: landscape) {
        .a { color: blue; }
      }
    `)

    const overlaps = ds.filter((d) => d.rule === "media-query-overlap-conflict")
    expect(overlaps).toHaveLength(0)
  })

  it("does not report media overlap across media types", () => {
    const ds = lint(`
      @media screen and (min-width: 700px) {
        .a { color: red; }
      }
      @media print and (min-width: 700px) {
        .a { color: blue; }
      }
    `)

    const overlaps = ds.filter((d) => d.rule === "media-query-overlap-conflict")
    expect(overlaps).toHaveLength(0)
  })

  it("does not report media overlap for disjoint nested media constraints", () => {
    const ds = lint(`
      @media (min-width: 500px) {
        @media (max-width: 600px) {
          .a { color: red; }
        }
      }

      @media (min-width: 700px) {
        .a { color: blue; }
      }
    `)

    const overlaps = ds.filter((d) => d.rule === "media-query-overlap-conflict")
    expect(overlaps).toHaveLength(0)
  })

  it("reports custom property cycles", () => {
    const ds = lint(`
      :root {
        --a: var(--b);
        --b: var(--a);
      }
    `)
    const diagnostics = ds.filter((d) => d.rule === "css-no-custom-property-cycle")
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  it("does not report custom property cycle across unrelated scopes", () => {
    const ds = lint(`
      :root { --a: var(--b); }
      .local { --b: var(--a); }
    `)
    const diagnostics = ds.filter((d) => d.rule === "css-no-custom-property-cycle")
    expect(diagnostics).toHaveLength(0)
  })

   it("reports missing reduced motion overrides", () => {
    const ds = lint(`
      .card { transition: opacity 200ms ease; }
    `)
    const diagnostics = ds.filter((d) => d.rule === "css-require-reduced-motion-override")
    expect(diagnostics).toHaveLength(1)
  })

  it("accepts override with matching resolved selector for nested & syntax", () => {
    const ds = lint(`
      [data-component="action-card"] {
        transition: transform 0.15s ease;
        &[data-animate] {
          animation: fade-in 0.2s ease-out forwards;
        }
      }
      @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
      @media (prefers-reduced-motion: reduce) {
        [data-component="action-card"] {
          transition: none;
        }
        [data-component="action-card"][data-animate] {
          animation: none;
        }
      }
    `)
    const diagnostics = ds.filter((d) => d.rule === "css-require-reduced-motion-override")
    expect(diagnostics).toHaveLength(0)
  })

  it("accepts override for deeply nested selector resolved through multiple ancestors", () => {
    const ds = lint(`
      [data-component="select"] {
        [data-slot="select-trigger"] {
          [data-slot="select-icon"] {
            transition: transform 0.1s ease-in-out;
          }
        }
      }
      @media (prefers-reduced-motion: reduce) {
        [data-component="select"] [data-slot="select-trigger"] [data-slot="select-icon"] {
          transition: none;
        }
      }
    `)
    const diagnostics = ds.filter((d) => d.rule === "css-require-reduced-motion-override")
    expect(diagnostics).toHaveLength(0)
  })

  it("accepts override inside @media nested within a parent rule", () => {
    const ds = lint(`
      [data-component="page"] {
        [data-slot="tabs-trigger"] {
          transition: background-color 120ms ease;
        }
        @media (prefers-reduced-motion: reduce) {
          [data-slot="tabs-trigger"] {
            transition: none;
          }
        }
      }
    `)
    const diagnostics = ds.filter((d) => d.rule === "css-require-reduced-motion-override")
    expect(diagnostics).toHaveLength(0)
  })

  it("accepts reduced-duration override as valid (e.g. spinner kept spinning)", () => {
    const ds = lint(`
      .animate-spin {
        animation: spin 700ms linear infinite;
      }
      @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        .animate-spin {
          animation-duration: 1s;
        }
      }
    `)
    const diagnostics = ds.filter((d) => d.rule === "css-require-reduced-motion-override")
    expect(diagnostics).toHaveLength(0)
  })

  it("still reports when deeply nested selector has no override at all", () => {
    const ds = lint(`
      [data-component="select"] {
        [data-slot="trigger"] {
          [data-slot="icon"] {
            transition: transform 0.1s ease;
          }
        }
      }
    `)
    const diagnostics = ds.filter((d) => d.rule === "css-require-reduced-motion-override")
    expect(diagnostics).toHaveLength(1)
  })

  it("still reports when override selector does not match resolved ancestry", () => {
    const ds = lint(`
      [data-component="widget"] {
        [data-slot="inner"] {
          [data-slot="icon"] {
            transition: transform 0.1s ease;
          }
        }
      }
      @media (prefers-reduced-motion: reduce) {
        [data-component="widget"] [data-slot="icon"] {
          transition: none;
        }
      }
    `)
    const diagnostics = ds.filter((d) => d.rule === "css-require-reduced-motion-override")
    expect(diagnostics).toHaveLength(1)
  })
})

describe("CSS policy rules", () => {
  beforeAll(() => { setActivePolicy("wcag-aa") })
  afterAll(() => { setActivePolicy(null) })

  describe("css-policy-typography", () => {
    it("reports body font-size below wcag-aa minimum (16px) for paragraph elements", () => {
      const ds = lint(`p { font-size: 12px; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-typography")
      expect(hits).toHaveLength(1)
      expect(first(hits).message).toContain("12px")
      expect(first(hits).message).toContain("16px")
      expect(first(hits).message).toContain("body")
    })

    it("does not report body font-size at or above minimum", () => {
      const ds = lint(`p { font-size: 16px; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-typography")
      expect(hits).toHaveLength(0)
    })

    it("uses caption threshold for unclassified selectors", () => {
      const ds = lint(`.text { font-size: 12px; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-typography")
      /* 12px = caption minimum — should not warn */
      expect(hits).toHaveLength(0)
    })

    it("warns for unclassified selectors below caption minimum", () => {
      const ds = lint(`.text { font-size: 10px; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-typography")
      expect(hits).toHaveLength(1)
      expect(first(hits).message).toContain("10px")
      expect(first(hits).message).toContain("12px")
      expect(first(hits).message).toContain("unclassified")
    })

    it("reports heading font-size below minimum", () => {
      const ds = lint(`h3 { font-size: 14px; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-typography")
      expect(hits).toHaveLength(1)
      expect(first(hits).message).toContain("heading")
      expect(first(hits).message).toContain("16px")
    })

    it("does not report heading at minimum", () => {
      const ds = lint(`h1 { font-size: 32px; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-typography")
      expect(hits).toHaveLength(0)
    })

    it("reports button font-size below minimum", () => {
      const ds = lint(`button { font-size: 10px; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-typography")
      expect(hits).toHaveLength(1)
      expect(first(hits).message).toContain("button")
      expect(first(hits).message).toContain("14px")
    })

    it("reports caption font-size below minimum", () => {
      const ds = lint(`small { font-size: 10px; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-typography")
      expect(hits).toHaveLength(1)
      expect(first(hits).message).toContain("caption")
      expect(first(hits).message).toContain("12px")
    })

    it("converts rem values to px for comparison", () => {
      const ds = lint(`.text { font-size: 0.5rem; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-typography")
      expect(hits).toHaveLength(1)
      expect(first(hits).message).toContain("8px")
    })

    it("skips var() and calc() values", () => {
      const ds = lint(`.text { font-size: var(--fs); }`)
      const hits = ds.filter((d) => d.rule === "css-policy-typography")
      expect(hits).toHaveLength(0)
    })

    it("reports line-height below body minimum (1.5)", () => {
      const ds = lint(`.text { line-height: 1.2; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-typography")
      expect(hits).toHaveLength(1)
      expect(first(hits).message).toContain("1.2")
      expect(first(hits).message).toContain("body")
      expect(first(hits).message).toContain("1.5")
    })

    it("does not report line-height at minimum", () => {
      const ds = lint(`.text { line-height: 1.5; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-typography")
      expect(hits).toHaveLength(0)
    })

    it("reports heading line-height below heading minimum (1.2)", () => {
      const ds = lint(`h1 { line-height: 1.0; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-typography")
      expect(hits).toHaveLength(1)
      expect(first(hits).message).toContain("heading")
      expect(first(hits).message).toContain("1.2")
    })

    it("detects button class selectors", () => {
      const ds = lint(`.btn { font-size: 10px; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-typography")
      expect(hits).toHaveLength(1)
      expect(first(hits).message).toContain("button")
    })

    it("detects caption class selectors", () => {
      const ds = lint(`.caption { font-size: 8px; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-typography")
      expect(hits).toHaveLength(1)
      expect(first(hits).message).toContain("caption")
    })

    it("exempts inline-formatting elements (sub) from line-height checks", () => {
      const ds = lint(`sub { line-height: 0; font-size: 75%; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-typography")
      expect(hits).toHaveLength(0)
    })

    it("exempts inline-formatting elements (kbd) from line-height checks", () => {
      const ds = lint(`kbd { line-height: 1; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-typography")
      expect(hits).toHaveLength(0)
    })

    it("exempts pseudo-elements from line-height checks", () => {
      const ds = lint(`::-webkit-calendar-picker-indicator { line-height: 1; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-typography")
      expect(hits).toHaveLength(0)
    })

    it("still warns on paragraph elements with low line-height", () => {
      const ds = lint(`p { line-height: 1.2; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-typography")
      expect(hits).toHaveLength(1)
      expect(first(hits).message).toContain("body")
    })
  })

  describe("css-policy-spacing", () => {
    it("reports letter-spacing below minimum (0.12em for wcag-aa)", () => {
      const ds = lint(`.text { letter-spacing: 0.05em; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-spacing")
      expect(hits).toHaveLength(1)
      expect(first(hits).message).toContain("0.05")
      expect(first(hits).message).toContain("0.12")
    })

    it("does not report letter-spacing at minimum", () => {
      const ds = lint(`.text { letter-spacing: 0.12em; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-spacing")
      expect(hits).toHaveLength(0)
    })

    it("reports word-spacing below minimum (0.16em for wcag-aa)", () => {
      const ds = lint(`.text { word-spacing: 0.08em; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-spacing")
      expect(hits).toHaveLength(1)
      expect(first(hits).message).toContain("0.08")
      expect(first(hits).message).toContain("0.16")
    })

    it("does not report word-spacing at minimum", () => {
      const ds = lint(`.text { word-spacing: 0.16em; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-spacing")
      expect(hits).toHaveLength(0)
    })

    it("skips px-only letter-spacing (not em)", () => {
      const ds = lint(`.text { letter-spacing: 1px; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-spacing")
      expect(hits).toHaveLength(0)
    })

    it("skips rem letter-spacing", () => {
      const ds = lint(`.text { letter-spacing: 0.01rem; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-spacing")
      expect(hits).toHaveLength(0)
    })

    it("reports paragraph margin-bottom below minimum (2.0em for wcag-aa)", () => {
      const ds = lint(`p { margin-bottom: 1em; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-spacing")
      expect(hits).toHaveLength(1)
      expect(first(hits).message).toContain("1")
      expect(first(hits).message).toContain("2")
      expect(first(hits).message).toContain("font-size")
    })

    it("does not report paragraph margin-bottom at minimum", () => {
      const ds = lint(`p { margin-bottom: 2em; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-spacing")
      expect(hits).toHaveLength(0)
    })

    it("reports margin-block-end on paragraph elements", () => {
      const ds = lint(`article { margin-block-end: 0.5em; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-spacing")
      expect(hits).toHaveLength(1)
      expect(first(hits).message).toContain("0.5")
    })

    it("does not report paragraph spacing on non-paragraph elements", () => {
      const ds = lint(`.header { margin-bottom: 0.5em; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-spacing" && d.message.includes("Paragraph"))
      expect(hits).toHaveLength(0)
    })

    it("detects paragraph class selectors", () => {
      const ds = lint(`.prose { margin-bottom: 0.5em; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-spacing" && d.message.includes("Paragraph"))
      expect(hits).toHaveLength(1)
    })

    it("skips px paragraph spacing (not em-based)", () => {
      const ds = lint(`p { margin-bottom: 8px; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-spacing" && d.message.includes("Paragraph"))
      expect(hits).toHaveLength(0)
    })
  })

  describe("css-policy-contrast", () => {
    it("reports insufficient contrast between black text on dark gray", () => {
      const ds = lint(`.dark { color: #333; background-color: #555; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-contrast")
      expect(hits).toHaveLength(1)
      expect(first(hits).message).toContain("4.5")
    })

    it("does not report sufficient contrast (black on white)", () => {
      const ds = lint(`.good { color: black; background-color: white; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-contrast")
      expect(hits).toHaveLength(0)
    })

    it("does not report when only color is set (no background)", () => {
      const ds = lint(`.text { color: #333; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-contrast")
      expect(hits).toHaveLength(0)
    })

    it("handles rgb() color values", () => {
      const ds = lint(`.bad { color: rgb(150, 150, 150); background-color: rgb(180, 180, 180); }`)
      const hits = ds.filter((d) => d.rule === "css-policy-contrast")
      expect(hits).toHaveLength(1)
    })

    it("handles hsl() color values", () => {
      const ds = lint(`.good { color: hsl(0, 0%, 0%); background-color: hsl(0, 0%, 100%); }`)
      const hits = ds.filter((d) => d.rule === "css-policy-contrast")
      expect(hits).toHaveLength(0)
    })

    it("handles named colors", () => {
      const ds = lint(`.ok { color: navy; background-color: white; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-contrast")
      expect(hits).toHaveLength(0)
    })

    it("applies large text threshold for big fonts (3:1 sufficient)", () => {
      const ds = lint(`.large { font-size: 24px; color: #888; background-color: #fff; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-contrast")
      expect(hits).toHaveLength(0)
    })

    it("flags normal text at contrast below 4.5:1", () => {
      const ds = lint(`.small { font-size: 12px; color: #888; background-color: #fff; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-contrast")
      expect(hits).toHaveLength(1)
    })

    it("skips dynamic color values (var)", () => {
      const ds = lint(`.dynamic { color: var(--fg); background-color: white; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-contrast")
      expect(hits).toHaveLength(0)
    })

    it("skips transparent colors", () => {
      const ds = lint(`.transparent { color: black; background-color: transparent; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-contrast")
      expect(hits).toHaveLength(0)
    })

    it("handles rgba foreground on opaque background with alpha compositing", () => {
      /* rgba(0,0,0,0.85) on white = dark gray on white — high contrast */
      const ds = lint(`.alpha { color: rgba(0, 0, 0, 0.85); background-color: white; }`)
      const hits = ds.filter((d) => d.rule === "css-policy-contrast")
      expect(hits).toHaveLength(0)
    })

    it("does not warn for dark-theme white-on-white-alpha (passes on black backdrop)", () => {
      /* White text on rgba(255,255,255,0.12) is dark-theme pattern.
         On white: both are white → 1:1.  On black: white on near-black → high contrast.
         Dual-backdrop takes max → passes. */
      const ds = lint(`.dark-theme { color: #fff; background-color: rgba(255, 255, 255, 0.12); }`)
      const hits = ds.filter((d) => d.rule === "css-policy-contrast")
      expect(hits).toHaveLength(0)
    })

    it("warns when contrast fails on BOTH backdrops", () => {
      /* Same-hue fg/bg: blue text on blue-tinted bg with high alpha.
         On white: low contrast.  On black: also low contrast. */
      const ds = lint(`.bad-alpha { color: #3c82f7; background-color: rgba(60, 130, 247, 0.50); }`)
      const hits = ds.filter((d) => d.rule === "css-policy-contrast")
      expect(hits).toHaveLength(1)
    })
  })

  describe("extractKeyframeNames regression", () => {
    it("does not report var as an animation name", () => {
      const ds = lint(`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .card {
          animation: var(--anim-name, fadeIn) 200ms ease;
        }
      `)
      const unknownAnimation = ds.filter((d) => d.rule === "no-unknown-animation-name")
      expect(unknownAnimation).toHaveLength(0)
    })

    it("skips entire var() expression including fallback values", () => {
      const ds = lint(`
        .card {
          animation: var(--anim-name, fadeIn) 200ms ease;
        }
      `)
      // var() is dynamic — the linter correctly skips the entire expression
      // since the resolved value depends on runtime custom property resolution
      const unknownAnimation = ds.filter((d) => d.rule === "no-unknown-animation-name")
      expect(unknownAnimation).toHaveLength(0)
    })
  })

  describe("descendant selector scope resolution", () => {
    it("resolves custom properties defined on component selector when used by descendant selector", () => {
      const ds = lintFiles([
        {
          path: "component.css",
          content: `
            [data-component="sidebar"] {
              --sidebar-width: 200px;
            }
            [data-component="sidebar"] [data-slot="content"] {
              width: var(--sidebar-width);
            }
          `,
        },
      ])
      const unresolved = ds.filter((d) => d.rule === "no-unresolved-custom-properties")
      expect(unresolved).toHaveLength(0)
    })

    it("resolves custom properties when compound selector refines the defining selector", () => {
      const ds = lintFiles([
        {
          path: "component.css",
          content: `
            [data-component="sidebar"] {
              --sidebar-collapsed-width: 56px;
            }
            [data-component="sidebar"][data-collapsed] {
              width: var(--sidebar-collapsed-width);
            }
          `,
        },
      ])
      const unresolved = ds.filter((d) => d.rule === "no-unresolved-custom-properties")
      expect(unresolved).toHaveLength(0)
    })

    it("still reports unresolved properties when selectors are unrelated", () => {
      const ds = lintFiles([
        {
          path: "component.css",
          content: `
            [data-component="sidebar"] {
              --sidebar-width: 200px;
            }
            [data-component="other"] {
              width: var(--sidebar-width);
            }
          `,
        },
      ])
      const unresolved = ds.filter((d) => d.rule === "no-unresolved-custom-properties")
      expect(unresolved).toHaveLength(1)
    })
  })

  describe("library analysis (external custom properties)", () => {
    it("resolves external custom properties provided via externalCustomProperties", () => {
      const ds: Diagnostic[] = []
      analyzeCSSInput(
        {
          files: [
            {
              path: "component.css",
              content: `
                .accordion-content {
                  height: var(--kb-accordion-content-height);
                }
              `,
            },
          ],
          externalCustomProperties: new Set(["--kb-accordion-content-height"]),
        },
        (d) => ds.push(d),
      )
      const unresolved = ds.filter((d) => d.rule === "no-unresolved-custom-properties")
      expect(unresolved).toHaveLength(0)
    })

    it("still reports unresolved properties not in external set", () => {
      const ds: Diagnostic[] = []
      analyzeCSSInput(
        {
          files: [
            {
              path: "component.css",
              content: `
                .accordion-content {
                  height: var(--kb-accordion-content-height);
                  width: var(--kb-nonexistent);
                }
              `,
            },
          ],
          externalCustomProperties: new Set(["--kb-accordion-content-height"]),
        },
        (d) => ds.push(d),
      )
      const unresolved = ds.filter((d) => d.rule === "no-unresolved-custom-properties")
      expect(unresolved).toHaveLength(1)
      expect(first(unresolved).message).toContain("--kb-nonexistent")
    })
  })
})
