import { describe, it, expect } from "vitest"
import { lazyRuleBatch, applyAllFixes, at } from "../test-utils"
import { imports, noReactDeps, noReactSpecificProps } from "../../../src/solid/rules/solid"

describe("imports", () => {
  const batch = lazyRuleBatch(imports)
  const s0 = batch.add('import { createSignal, mergeProps as merge } from "solid-js";')
  const s1 = batch.add("import { createSignal, mergeProps as merge } from 'solid-js';")
  const s2 = batch.add('import { render, hydrate } from "solid-js/web";')
  const s3 = batch.add('import { createStore, produce } from "solid-js/store";')
  const s4 = batch.add(`import { createSignal } from "solid-js";\nimport { render } from "solid-js/web";\nimport { something } from "somewhere/else";\nimport { createStore } from "solid-js/store";`)
  const s5 = batch.add('import * as Solid from "solid-js"; Solid.render();')
  const s6 = batch.add('import { createEffect } from "solid-js/web";')
  const s7 = batch.add('import { render } from "solid-js";')
  const s8 = batch.add('import { createStore } from "solid-js";')
  const s9 = batch.add(`import { createEffect } from "solid-js/web";\nimport { render } from "solid-js";`)

  it("metadata", () => {
    expect(imports.id).toBe("imports")
    expect(imports.meta.description).toContain("solid-js")
    expect(imports.meta.fixable).toBe(false)
  })

  it("allows correct imports", () => {
    expect(batch.result(s0).diagnostics).toHaveLength(0)
    expect(batch.result(s1).diagnostics).toHaveLength(0)
    expect(batch.result(s2).diagnostics).toHaveLength(0)
    expect(batch.result(s3).diagnostics).toHaveLength(0)
    expect(batch.result(s4).diagnostics).toHaveLength(0)
    expect(batch.result(s5).diagnostics).toHaveLength(0)
  })

  it("reports imports from wrong source modules", () => {
    const d6 = batch.result(s6).diagnostics
    expect(d6).toHaveLength(1)
    expect(at(d6, 0).messageId).toBe("preferSource")

    expect(batch.result(s7).diagnostics).toHaveLength(1)
    expect(batch.result(s8).diagnostics).toHaveLength(1)
    expect(batch.result(s9).diagnostics).toHaveLength(2)
  })
})

describe("no-react-deps", () => {
  const batch = lazyRuleBatch(noReactDeps)
  const s0 = batch.add(`createEffect(() => { console.log(signal()); });`)
  const s1 = batch.add(`createEffect((prev) => { console.log(signal()); return prev + 1; }, 0);`)
  const s2 = batch.add("const value = createMemo(() => computeExpensiveValue(a(), b()));")
  const s3 = batch.add("const sum = createMemo((prev) => input() + prev, 0);")
  const s4 = batch.add(`createRenderEffect(() => { console.log(signal()); });`)
  const s5 = batch.add(`const args = [() => { console.log(signal()); }, [signal()]];\ncreateEffect(...args);`)
  const s6 = batch.add(`createEffect(() => {\n  console.log(signal());\n}, [signal()]);`)
  const s7 = batch.add("const value = createMemo(() => computeExpensiveValue(a(), b()), [a(), b()]);")
  const s8 = batch.add(`createRenderEffect(() => {\n  console.log(signal());\n}, [signal()]);`)

  it("metadata", () => {
    expect(noReactDeps.id).toBe("no-react-deps")
    expect(noReactDeps.meta.fixable).toBe(true)
  })

  it("allows effects without dependency arrays", () => {
    expect(batch.result(s0).diagnostics).toHaveLength(0)
    expect(batch.result(s1).diagnostics).toHaveLength(0)
    expect(batch.result(s2).diagnostics).toHaveLength(0)
    expect(batch.result(s3).diagnostics).toHaveLength(0)
    expect(batch.result(s4).diagnostics).toHaveLength(0)
    expect(batch.result(s5).diagnostics).toHaveLength(0)
  })

  it("reports inline dependency arrays and fixes by removing them", () => {
    const d6 = batch.result(s6).diagnostics
    expect(d6).toHaveLength(1)
    expect(at(d6, 0).messageId).toBe("noUselessDep")
    expect(applyAllFixes(`createEffect(() => {\n  console.log(signal());\n}, [signal()]);`, d6)).toBe(`createEffect(() => {\n  console.log(signal());\n});`)

    expect(batch.result(s7).diagnostics).toHaveLength(1)
    expect(batch.result(s8).diagnostics).toHaveLength(1)
  })
})

describe("no-react-specific-props", () => {
  const batch = lazyRuleBatch(noReactSpecificProps)
  const s0 = batch.add("let el = <div>Hello world!</div>;")
  const s1 = batch.add('let el = <div class="greeting">Hello world!</div>;')
  const s2 = batch.add('let el = <label for="id">Hello world!</label>;')
  const s3 = batch.add('let el = <PascalComponent class="greeting" for="id" />')
  const s4 = batch.add("let el = <PascalComponent key={item.id} />")
  const s5 = batch.add('let el = <div className="greeting">Hello world!</div>')
  const s6 = batch.add('let el = <label htmlFor="id">Hello world!</label>')
  const s7 = batch.add("let el = <div key={item.id} />")

  it("metadata", () => {
    expect(noReactSpecificProps.id).toBe("no-react-specific-props")
    expect(noReactSpecificProps.meta.fixable).toBe(true)
  })

  it("allows correct Solid props", () => {
    expect(batch.result(s0).diagnostics).toHaveLength(0)
    expect(batch.result(s1).diagnostics).toHaveLength(0)
    expect(batch.result(s2).diagnostics).toHaveLength(0)
    expect(batch.result(s3).diagnostics).toHaveLength(0)
    expect(batch.result(s4).diagnostics).toHaveLength(0)
  })

  it("reports and fixes React-specific props", () => {
    const d5 = batch.result(s5).diagnostics
    expect(d5).toHaveLength(1)
    expect(at(d5, 0).messageId).toBe("prefer")
    expect(applyAllFixes('let el = <div className="greeting">Hello world!</div>', d5)).toBe('let el = <div class="greeting">Hello world!</div>')

    const d6 = batch.result(s6).diagnostics
    expect(d6).toHaveLength(1)
    expect(applyAllFixes('let el = <label htmlFor="id">Hello world!</label>', d6)).toBe('let el = <label for="id">Hello world!</label>')

    const d7 = batch.result(s7).diagnostics
    expect(d7).toHaveLength(1)
    expect(at(d7, 0).messageId).toBe("noUselessKey")
    expect(applyAllFixes("let el = <div key={item.id} />", d7)).toBe("let el = <div />")
  })
})
