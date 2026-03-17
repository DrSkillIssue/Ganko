/**
 * JSX Rules Tests
 */

import { describe, it, expect } from "vitest"
import { checkRule, lazyRuleBatch, applyAllFixes, at } from "../test-utils"
import {
  componentsReturnOnce,
  jsxNoDuplicateProps,
  jsxNoScriptUrl,
  jsxNoUndef,
  noUnknownNamespaces,
  showTruthyConversion,
  suspenseBoundaryMissing,
  validateJsxNesting,
} from "../../../src/solid/rules/jsx"

describe("components-return-once", () => {
  const batch = lazyRuleBatch(componentsReturnOnce)
  const cr0 = batch.add(`function Component() { return <div />; }`)
  const cr1 = batch.add(`function someFunc() { if (condition) { return 5; } return 10; }`)
  const cr2 = batch.add(`function notAComponent() { if (condition) { return <div />; } return <div />; }`)
  const cr3 = batch.add(`callback(() => { if (condition) { return <div />; } return <div />; });`)
  const cr4 = batch.add(`function Component() { const renderContent = () => { if (false) return <></>; return <></>; }; return <>{renderContent()}</>; }`)
  const cr5 = batch.add(`function Component() { if (condition) { return <div />; } return <span />; }`)
  const cr6 = batch.add(`function Component() { return Math.random() > 0.5 ? <div>Big!</div> : <div>Small!</div>; }`)
  const cr7 = batch.add(`function Component(props) { return !!props.cond && <div>Conditional</div>; }`)

  it("metadata", () => {
    expect(componentsReturnOnce.id).toBe("components-return-once")
    expect(componentsReturnOnce.meta.fixable).toBe(true)
  })

  it("allows valid return patterns", () => {
    expect(batch.result(cr0).diagnostics).toHaveLength(0)
    expect(batch.result(cr1).diagnostics).toHaveLength(0)
    expect(batch.result(cr2).diagnostics).toHaveLength(0)
    expect(batch.result(cr3).diagnostics).toHaveLength(0)
    expect(batch.result(cr4).diagnostics).toHaveLength(0)
  })

  it("detects early and conditional returns in components", () => {
    const d5 = batch.result(cr5).diagnostics
    expect(d5).toHaveLength(1)
    expect(at(d5, 0).messageId).toBe("noEarlyReturn")

    const d6 = batch.result(cr6).diagnostics
    expect(d6).toHaveLength(1)
    expect(at(d6, 0).messageId).toBe("noConditionalReturn")

    const d7 = batch.result(cr7).diagnostics
    expect(d7).toHaveLength(1)
    expect(at(d7, 0).messageId).toBe("noConditionalReturn")
  })
})

describe("jsx-no-duplicate-props", () => {
  const batch = lazyRuleBatch(jsxNoDuplicateProps)
  const dp0 = batch.add('let el = <div a="a" b="b" />')
  const dp1 = batch.add('let el = <div a="a" A="A" />')
  const dp2 = batch.add('let el = <div class="blue" />')
  const dp3 = batch.add("let el = <div children={<div />} />")
  const dp4 = batch.add("let el = <div><div /></div>")
  const dp5 = batch.add('let el = <div a="a" a="aaaa" />')
  const dp6 = batch.add('let el = <div class="blue" class="green" />')
  const dp7 = batch.add("let el = <div children={<div />}><div /></div>")

  it("metadata", () => {
    expect(jsxNoDuplicateProps.id).toBe("jsx-no-duplicate-props")
    expect(jsxNoDuplicateProps.meta.fixable).toBe(true)
  })

  it("allows unique props and single class/children", () => {
    expect(batch.result(dp0).diagnostics).toHaveLength(0)
    expect(batch.result(dp1).diagnostics).toHaveLength(0)
    expect(batch.result(dp2).diagnostics).toHaveLength(0)
    expect(batch.result(dp3).diagnostics).toHaveLength(0)
    expect(batch.result(dp4).diagnostics).toHaveLength(0)
  })

  it("detects duplicates and fixes", () => {
    const d5 = batch.result(dp5).diagnostics
    expect(d5).toHaveLength(1)
    expect(at(d5, 0).messageId).toBe("noDuplicateProps")
    expect(applyAllFixes('let el = <div a="a" a="aaaa" />', d5)).toBe('let el = <div a="a" />')

    const d6 = batch.result(dp6).diagnostics
    expect(d6).toHaveLength(1)
    expect(at(d6, 0).messageId).toBe("noDuplicateClass")

    const d7 = batch.result(dp7).diagnostics
    expect(d7).toHaveLength(1)
    expect(at(d7, 0).messageId).toBe("noDuplicateChildren")
  })
})

describe("jsx-no-script-url", () => {
  const batch = lazyRuleBatch(jsxNoScriptUrl)
  const su0 = batch.add('let el = <a href="https://example.com" />')
  const su1 = batch.add('let el = <Link to="https://example.com" />')
  const su2 = batch.add(`const link = "https://example.com";\n    let el = <a href={link} />`)
  const su3 = batch.add(`let el = <a href="javascript:alert('hacked!')" />`)
  const su4 = batch.add(`let el = <Link to="javascript:alert('hacked!')" />`)
  const su5 = batch.add(`let el = <a href="javascript:void(0)" />`)

  it("metadata", () => {
    expect(jsxNoScriptUrl.id).toBe("jsx-no-script-url")
    expect(jsxNoScriptUrl.meta.fixable).toBe(true)
  })

  it("allows safe URLs", () => {
    expect(batch.result(su0).diagnostics).toHaveLength(0)
    expect(batch.result(su1).diagnostics).toHaveLength(0)
    expect(batch.result(su2).diagnostics).toHaveLength(0)
  })

  it("detects javascript: URLs and fixes", () => {
    const d3 = batch.result(su3).diagnostics
    expect(d3).toHaveLength(1)
    expect(at(d3, 0).messageId).toBe("noJSURL")

    expect(batch.result(su4).diagnostics).toHaveLength(1)
    expect(applyAllFixes(`let el = <a href="javascript:void(0)" />`, batch.result(su5).diagnostics)).toBe('let el = <a href="#" />')
  })
})

describe("jsx-no-undef", () => {
  const batch = lazyRuleBatch(jsxNoUndef)
  const nu0 = batch.add("let el = <div />")
  const nu1 = batch.add("let el = <my-element />")
  const nu2 = batch.add("const X = () => {}; let el = <div use:X />")
  const nu3 = batch.add("let el = <div use:X />")
  const nu4 = batch.add("let el = <div use:Y={{}} />")

  it("metadata", () => { expect(jsxNoUndef.id).toBe("jsx-no-undef") })

  it("allows valid elements and defined directives, detects undefined", () => {
    expect(batch.result(nu0).diagnostics).toHaveLength(0)
    expect(batch.result(nu1).diagnostics).toHaveLength(0)
    expect(batch.result(nu2).diagnostics).toHaveLength(0)

    const d3 = batch.result(nu3).diagnostics
    expect(d3).toHaveLength(1)
    expect(at(d3, 0).messageId).toBe("customDirectiveUndefined")

    expect(batch.result(nu4).diagnostics).toHaveLength(1)
  })
})

describe("no-unknown-namespaces", () => {
  const batch = lazyRuleBatch(noUnknownNamespaces)
  const ns0 = batch.add("let el = <div on:click={null} />;")
  const ns1 = batch.add("let el = <div oncapture:click={null} />;")
  const ns2 = batch.add("let el = <div use:X={null} />;")
  const ns3 = batch.add('let el = <div prop:scrollTop="0px" />;')
  const ns4 = batch.add('let el = <div attr:title="title" />;')
  const ns5 = batch.add("let el = <div bool:disabled={isDisabled} />;")
  const ns6 = batch.add("let el = <div foo:boo={null} />")
  const ns7 = batch.add('let el = <div style:width="100%" />')
  const ns8 = batch.add("let el = <div class:mt-10={true} />")
  const ns9 = batch.add('let el = <Box attr:foo="bar" />')

  it("metadata", () => { expect(noUnknownNamespaces.id).toBe("no-unknown-namespaces") })

  it("allows valid namespaces and detects invalid ones", () => {
    expect(batch.result(ns0).diagnostics).toHaveLength(0)
    expect(batch.result(ns1).diagnostics).toHaveLength(0)
    expect(batch.result(ns2).diagnostics).toHaveLength(0)
    expect(batch.result(ns3).diagnostics).toHaveLength(0)
    expect(batch.result(ns4).diagnostics).toHaveLength(0)
    expect(batch.result(ns5).diagnostics).toHaveLength(0)

    expect(at(batch.result(ns6).diagnostics, 0).messageId).toBe("unknownNamespace")
    expect(at(batch.result(ns7).diagnostics, 0).messageId).toBe("styleNamespace")
    expect(at(batch.result(ns8).diagnostics, 0).messageId).toBe("classNamespace")
    expect(at(batch.result(ns9).diagnostics, 0).messageId).toBe("componentNamespace")
  })
})

describe("suspense-boundary-missing", () => {
  const batch = lazyRuleBatch(suspenseBoundaryMissing)
  const sb0 = batch.add(`import { Suspense } from "solid-js"; function App() { return (<Suspense fallback={<div>Loading...</div>}><AsyncContent /></Suspense>); }`)
  const sb1 = batch.add(`import { ErrorBoundary } from "solid-js"; function App() { return (<ErrorBoundary fallback={(err) => <div>Error</div>}><Content /></ErrorBoundary>); }`)
  const sb2 = batch.add(`import { Suspense } from "solid-js"; function App() { return (<Suspense><AsyncContent /></Suspense>); }`)
  const sb3 = batch.add(`import { ErrorBoundary } from "solid-js"; function App() { return (<ErrorBoundary><Content /></ErrorBoundary>); }`)
  const sb4 = batch.add(`import { lazy } from "solid-js"; const LazyComponent = lazy(() => import("./Heavy")); function App() { return <LazyComponent />; }`)

  it("metadata", () => { expect(suspenseBoundaryMissing.id).toBe("suspense-boundary-missing") })

  it("allows valid boundaries and reports missing fallbacks", () => {
    expect(batch.result(sb0).diagnostics).toHaveLength(0)
    expect(batch.result(sb1).diagnostics).toHaveLength(0)

    expect(at(batch.result(sb2).diagnostics, 0).messageId).toBe("suspenseNoFallback")
    expect(at(batch.result(sb3).diagnostics, 0).messageId).toBe("errorBoundaryNoFallback")
    expect(at(batch.result(sb4).diagnostics, 0).messageId).toBe("lazyNoSuspense")
  })
})

describe("validate-jsx-nesting", () => {
  const batch = lazyRuleBatch(validateJsxNesting)
  const vn0 = batch.add("let el = <ul><li>item</li></ul>")
  const vn1 = batch.add("let el = <div><div>nested</div></div>")
  const vn2 = batch.add("let el = <p><span>text</span></p>")
  const vn3 = batch.add("let el = <tr><td>cell</td></tr>")

  it("metadata", () => { expect(validateJsxNesting.id).toBe("validate-jsx-nesting") })

  it("allows valid HTML nesting", () => {
    expect(batch.result(vn0).diagnostics).toHaveLength(0)
    expect(batch.result(vn1).diagnostics).toHaveLength(0)
    expect(batch.result(vn2).diagnostics).toHaveLength(0)
    expect(batch.result(vn3).diagnostics).toHaveLength(0)
  })
})

describe("show-truthy-conversion", () => {
  const batch = lazyRuleBatch(showTruthyConversion)
  const st0 = batch.add("function App() { return <div>Hello</div>; }")
  const st1 = batch.add(`import { Show, createSignal } from "solid-js"; function App() { const [count, setCount] = createSignal(0); return <Show when={count()}>Count: {count()}</Show>; }`)
  const st2 = batch.add(`import { Show, createSignal } from "solid-js"; function App() { const [count] = createSignal(0); return <Show when={count() > 0}>Count</Show>; }`)
  const st3 = batch.add(`import { Show, createSignal } from "solid-js"; function App() { const [count] = createSignal(0); return <Show when={Boolean(count())}>Count</Show>; }`)
  const st4 = batch.add(`import { Show, createSignal } from "solid-js"; function App() { const [name] = createSignal(""); return <Show when={!!name()}>Name</Show>; }`)
  const st5 = batch.add(`import { Show, createSignal } from "solid-js"; function App() { const [a] = createSignal(0); const [b] = createSignal(true); return <Show when={a() && b()}>Both</Show>; }`)
  const st6 = batch.add(`import { Show, createSignal } from "solid-js"; function App() { const [loading] = createSignal(false); return <Show when={!loading()}>Loaded</Show>; }`)
  const st7 = batch.add(`import { Show } from "solid-js"; function App() { return <Show when={true}>Always visible</Show>; }`)
  const st8 = batch.add(`import { Show, createSignal } from "solid-js"; function App() { const [count] = createSignal(0); return <Show when={count() != null}>Count</Show>; }`)
  const st9 = batch.add(`import { Show, createSignal } from "solid-js"; function App() { const [data] = createSignal(null); return <Show when={data() ? data() : null}>Data</Show>; }`)
  const st10 = batch.add(`import { Show, createSignal } from "solid-js"; function App() { const [data] = createSignal(null); return <Show when={data() ? data() : undefined}>Data</Show>; }`)
  const st11 = batch.add(`import { Show, createSignal } from "solid-js"; function App() { const [data] = createSignal(null); return <Show when={data() ? data() : false}>Data</Show>; }`)

  it("metadata", () => {
    expect(showTruthyConversion.id).toBe("show-truthy-conversion")
    expect(showTruthyConversion.meta.fixable).toBe(true)
  })

  it("allows all valid Show when patterns", () => {
    expect(batch.result(st0).diagnostics).toHaveLength(0)
    expect(batch.result(st1).diagnostics).toHaveLength(0)
    expect(batch.result(st2).diagnostics).toHaveLength(0)
    expect(batch.result(st3).diagnostics).toHaveLength(0)
    expect(batch.result(st4).diagnostics).toHaveLength(0)
    expect(batch.result(st5).diagnostics).toHaveLength(0)
    expect(batch.result(st6).diagnostics).toHaveLength(0)
    expect(batch.result(st7).diagnostics).toHaveLength(0)
    expect(batch.result(st8).diagnostics).toHaveLength(0)
    expect(batch.result(st9).diagnostics).toHaveLength(0)
    expect(batch.result(st10).diagnostics).toHaveLength(0)
    expect(batch.result(st11).diagnostics).toHaveLength(0)
  })
})
