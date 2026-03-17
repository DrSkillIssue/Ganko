/**
 * Solid Rules Tests
 */

import { describe, it, expect } from "vitest"
import { lazyRuleBatch, applyAllFixes, at } from "../test-utils"
import {
  batchOptimization,
  preferFor,
  preferMemoComplexStyles,
  preferShow,
  selfClosingComp,
  styleProp,
} from "../../../src/solid/rules/solid"

describe("batch-optimization", () => {
  const batch = lazyRuleBatch(batchOptimization)
  const bo0 = batch.add(`function test() { console.log("hello"); }`)
  const bo1 = batch.add(`import { createSignal } from "solid-js"; function Form() { const [name, setName] = createSignal(""); const handleSubmit = () => { setName("test"); }; return null; }`)
  const bo2 = batch.add(`import { createSignal } from "solid-js"; function Form() { const [name, setName] = createSignal(""); const [email, setEmail] = createSignal(""); const handleSubmit = () => { setName("test"); setEmail("test@example.com"); }; return null; }`)
  const bo3 = batch.add(`import { createSignal, batch } from "solid-js"; function Form() { const [name, setName] = createSignal(""); const [email, setEmail] = createSignal(""); const [age, setAge] = createSignal(0); const handleSubmit = () => { batch(() => { setName("test"); setEmail("test@example.com"); setAge(25); }); }; return null; }`)
  const bo4 = batch.add(`import { createSignal } from "solid-js"; function Form() { const [name, setName] = createSignal(""); const [email, setEmail] = createSignal(""); const [age, setAge] = createSignal(0); const handleSubmit = () => { setName("test"); setEmail("test@example.com"); setAge(25); }; return null; }`)
  const bo5 = batch.add(`import { createSignal } from "solid-js"; function Form() { const [name, setName] = createSignal(""); const [email, setEmail] = createSignal(""); const [age, setAge] = createSignal(0); const handleSubmit = () => { setName("test"); console.log("processing..."); setEmail("test@example.com"); console.log("more processing..."); setAge(25); }; return null; }`)
  const bo6 = batch.add(`import { createSignal, createEffect } from "solid-js"; function App() { const [a, setA] = createSignal(0); const [b, setB] = createSignal(0); const [c, setC] = createSignal(0); createEffect(() => { setA(1); setB(2); setC(3); }); return null; }`)
  const bo7 = batch.add(`import { createSignal, onMount } from "solid-js"; function App() { const [a, setA] = createSignal(0); const [b, setB] = createSignal(0); const [c, setC] = createSignal(0); onMount(() => { setA(1); setB(2); setC(3); }); return null; }`)
  const bo8 = batch.add(`import { createSignal, createComputed } from "solid-js"; function App() { const [a, setA] = createSignal(0); const [b, setB] = createSignal(0); const [c, setC] = createSignal(0); createComputed(() => { setA(1); setB(2); setC(3); }); return null; }`)
  const bo9 = batch.add(`import { createSignal, createRenderEffect } from "solid-js"; function App() { const [a, setA] = createSignal(0); const [b, setB] = createSignal(0); const [c, setC] = createSignal(0); createRenderEffect(() => { setA(1); setB(2); setC(3); }); return null; }`)
  const bo10 = batch.add(`import { createSignal, createEffect, on } from "solid-js"; function App() { const [a, setA] = createSignal(0); const [b, setB] = createSignal(0); const [c, setC] = createSignal(0); const [trigger] = createSignal(0); createEffect(on(trigger, () => { setA(1); setB(2); setC(3); })); return null; }`)
  const bo11 = batch.add(`import { createSignal, createEffect, on } from "solid-js"; function App() { const [a, setA] = createSignal(0); const [b, setB] = createSignal(0); const [c, setC] = createSignal(0); const [trigger] = createSignal(0); createEffect(on(trigger, async () => { setA(1); setB(2); setC(3); const result = await fetch("/api"); })); return null; }`)
  const bo12 = batch.add(`import { createSignal, createEffect, on } from "solid-js"; function App() { const [a, setA] = createSignal(0); const [b, setB] = createSignal(0); const [c, setC] = createSignal(0); const [trigger] = createSignal(0); createEffect(on(trigger, async () => { const result = await fetch("/api"); setA(1); setB(2); setC(3); })); return null; }`)
  const bo13 = batch.add(`import { createSignal, createEffect, on } from "solid-js"; function App() { const [loading, setLoading] = createSignal(false); const [error, setError] = createSignal(null); const [data, setData] = createSignal(null); const [trigger] = createSignal(0); createEffect(on(trigger, async () => { setLoading(true); setError(null); setData(null); const result = await fetch("/api"); setData(result); setLoading(false); setError(null); })); return null; }`)
  const bo14 = batch.add(`import { createSignal, createEffect } from "solid-js"; function App() { const [a, setA] = createSignal(0); const [b, setB] = createSignal(0); const [c, setC] = createSignal(0); createEffect(() => { setTimeout(() => { setA(1); setB(2); setC(3); }, 100); }); return null; }`)
  const bo15 = batch.add(`import { createSignal, createEffect } from "solid-js"; function App() { const [a, setA] = createSignal(0); const [b, setB] = createSignal(0); const [c, setC] = createSignal(0); createEffect(() => { fetch("/api").then((res) => { setA(1); setB(2); setC(3); }); }); return null; }`)
  const bo16 = batch.add(`import { createSignal } from "solid-js"; function App() { const [a, setA] = createSignal(0); const [b, setB] = createSignal(0); const [c, setC] = createSignal(0); const handler = () => { setA(1); setB(2); setC(3); }; return null; }`)
  const bo17 = batch.add(`import { createSignal } from "solid-js"; function App() { const [a, setA] = createSignal(0); const [b, setB] = createSignal(0); const [c, setC] = createSignal(0); function updateAll() { setA(1); setB(2); setC(3); } return null; }`)
  const bo18 = batch.add(`import { createSignal, onMount } from "solid-js"; function useCursorPagination(options) { const [loading, setLoading] = createSignal(true); const [loadingMore, setLoadingMore] = createSignal(false); const [error, setError] = createSignal(null); const refetch = async () => { setLoading(true); setLoadingMore(false); setError(null); const result = await options.fetchPage(null); setLoading(false); }; onMount(() => void refetch()); return { loading, loadingMore, error, refetch }; }`)
  const bo19 = batch.add(`import { createSignal, createMemo } from "solid-js"; function App() { const [a, setA] = createSignal(0); const [b, setB] = createSignal(0); const [c, setC] = createSignal(0); const memo = createMemo(() => { setA(1); setB(2); setC(3); return 0; }); return null; }`)
  const bo20 = batch.add(`import { createSignal, createEffect, on } from "solid-js"; function EditEntryDrawer(props) { const [entryData, setEntryData] = createSignal(null); const [fetchLoading, setFetchLoading] = createSignal(false); const [fetchError, setFetchError] = createSignal(null); const [notes, setNotes] = createSignal(""); const [expiresAt, setExpiresAt] = createSignal(""); createEffect(on(() => ({ open: props.open, id: props.entryId }), async ({ open, id }) => { if (!open || !id) return; setFetchLoading(true); setFetchError(null); setEntryData(null); const result = await props.edit.fetchEntry(id); if (result.isOk()) { setEntryData(result.value); setNotes(result.value.notes); setExpiresAt(result.value.expiresAt ? result.value.expiresAt.slice(0, 10) : ""); } else { setFetchError(result.error.message); } setFetchLoading(false); })); return null; }`)
  const bo21code = `import { createSignal, createEffect, on } from "solid-js";\nfunction App(props) {\n  const [data, setData] = createSignal(null)\n  const [loading, setLoading] = createSignal(false)\n  const [error, setError] = createSignal(null)\n  const [notes, setNotes] = createSignal("")\n  const [expiresAt, setExpiresAt] = createSignal("")\n\n  createEffect(\n    on(\n      () => props.id,\n      async (id) => {\n        if (!id) return\n\n        setLoading(true)\n        setError(null)\n        setData(null)\n\n        const result = await fetchEntry(id)\n\n        if (result.isOk()) {\n          setData(result.value)\n          setNotes(result.value.notes)\n          setExpiresAt(result.value.expiresAt)\n        } else {\n          setError(result.error.message)\n        }\n\n        setLoading(false)\n      },\n    ),\n  )\n  return null\n}`
  const bo21 = batch.add(bo21code)
  const bo22code = `import { createSignal } from "solid-js";\nfunction App() {\n  const [a, setA] = createSignal(0);\n  const [b, setB] = createSignal(0);\n  const [c, setC] = createSignal(0);\n  const handler = () => {\n    console.log("before");\n    setA(1);\n    setB(2);\n    setC(3);\n    console.log("after");\n  };\n  return null;\n}`
  const bo22 = batch.add(bo22code)
  const bo23 = batch.add(`import { createSignal, createEffect, on } from "solid-js"; function App() { const [data, setData] = createSignal(null); const [status, setStatus] = createSignal(""); const [ts, setTs] = createSignal(0); const [trigger] = createSignal(0); createEffect(on(trigger, async () => { try { const result = await fetch("/api"); setData(result); setStatus("ok"); setTs(Date.now()); } catch (err) { setData(null); setStatus("error"); setTs(Date.now()); } })); return null; }`)

  it("metadata", () => {
    expect(batchOptimization.id).toBe("batch-optimization")
    expect(batchOptimization.meta.fixable).toBe(true)
  })

  it("allows valid patterns (no signals, few setters, already batched, non-consecutive, reactive contexts)", () => {
    expect(batch.result(bo0).diagnostics).toHaveLength(0)
    expect(batch.result(bo1).diagnostics).toHaveLength(0)
    expect(batch.result(bo2).diagnostics).toHaveLength(0)
    expect(batch.result(bo3).diagnostics).toHaveLength(0)
    expect(batch.result(bo5).diagnostics).toHaveLength(0)
    expect(batch.result(bo6).diagnostics).toHaveLength(0)
    expect(batch.result(bo7).diagnostics).toHaveLength(0)
    expect(batch.result(bo8).diagnostics).toHaveLength(0)
    expect(batch.result(bo9).diagnostics).toHaveLength(0)
    expect(batch.result(bo10).diagnostics).toHaveLength(0)
    expect(batch.result(bo11).diagnostics).toHaveLength(0)
    expect(batch.result(bo19).diagnostics).toHaveLength(0)
  })

  it("reports unbatched consecutive setters in various contexts", () => {
    const d4 = batch.result(bo4).diagnostics
    expect(d4).toHaveLength(1)
    expect(at(d4, 0).messageId).toBe("multipleSetters")

    const d12 = batch.result(bo12).diagnostics
    expect(d12).toHaveLength(1)
    expect(at(d12, 0).messageId).toBe("multipleSetters")

    expect(batch.result(bo13).diagnostics).toHaveLength(1)
    expect(batch.result(bo14).diagnostics).toHaveLength(1)
    expect(batch.result(bo15).diagnostics).toHaveLength(1)
    expect(batch.result(bo16).diagnostics).toHaveLength(1)
    expect(batch.result(bo17).diagnostics).toHaveLength(1)

    const d18 = batch.result(bo18).diagnostics
    expect(d18).toHaveLength(1)
    expect(at(d18, 0).rule).toBe("batch-optimization")

    expect(batch.result(bo20).diagnostics).toHaveLength(1)
    expect(batch.result(bo23).diagnostics).toHaveLength(2)
  })

  it("provides correct fixes for post-await and non-async contexts", () => {
    const d21 = batch.result(bo21).diagnostics
    expect(d21).toHaveLength(1)
    const fixed21 = applyAllFixes(bo21code, d21)
    expect(fixed21).toContain("batch(() => {")
    expect(fixed21).toContain("if (result.isOk())")
    expect(fixed21).toContain("setLoading(false)")

    const d22 = batch.result(bo22).diagnostics
    expect(d22).toHaveLength(1)
    const fixed22 = applyAllFixes(bo22code, d22)
    expect(fixed22).toContain("batch(() => {")
    expect(fixed22).not.toContain('batch(() => {\n    console.log("before")')
  })
})

describe("prefer-for", () => {
  const batch = lazyRuleBatch(preferFor)
  const pf0 = batch.add("let Component = (props) => <ol><For each={props.data}>{d => <li>{d.text}</li>}</For></ol>;")
  const pf1 = batch.add("let abc = x.map(y => y + z);")
  const pf2 = batch.add(`let Component = (props) => { let abc = x.map(y => y + z); return <div>Hello, world!</div>; }`)
  const pf3 = batch.add("let Component = (props) => <div data-items={items.map(i => i.id)} />;")
  const pf4 = batch.add("let Component = (props) => <ol>{props.data.map(d => <li>{d}</li>, context)}</ol>;")
  const pf5 = batch.add("let Component = (props) => <ol>{props.data.filter(d => d.active)}</ol>;")
  const pf6 = batch.add("let Component = (props) => <ol>{props.data.map(renderItem)}</ol>;")
  const pf7 = batch.add("let Component = (props) => <ol>{props.data.map(d => <li>{d.text}</li>)}</ol>;")
  const pf8 = batch.add("let Component = (props) => <>{props.data.map(d => <li>{d.text}</li>)}</>;")
  const pf9 = batch.add("let Component = (props) => <ol>{props.data.map(() => <li />)}</ol>;")
  const pf10 = batch.add("let Component = (props) => <ol>{props.data.map((item, index) => <li>{index}: {item}</li>)}</ol>;")

  it("metadata", () => { expect(preferFor.id).toBe("prefer-for"); expect(preferFor.meta.fixable).toBe(true) })

  it("allows valid map patterns", () => {
    expect(batch.result(pf0).diagnostics).toHaveLength(0)
    expect(batch.result(pf1).diagnostics).toHaveLength(0)
    expect(batch.result(pf2).diagnostics).toHaveLength(0)
    expect(batch.result(pf3).diagnostics).toHaveLength(0)
    expect(batch.result(pf4).diagnostics).toHaveLength(0)
    expect(batch.result(pf5).diagnostics).toHaveLength(0)
    expect(batch.result(pf6).diagnostics).toHaveLength(0)
  })

  it("detects map in JSX and provides fixes", () => {
    const d7 = batch.result(pf7).diagnostics
    expect(d7).toHaveLength(1)
    expect(at(d7, 0).messageId).toBe("preferFor")
    expect(applyAllFixes("let Component = (props) => <ol>{props.data.map(d => <li>{d.text}</li>)}</ol>;", d7))
      .toBe("let Component = (props) => <ol><For each={props.data}>{d => <li>{d.text}</li>}</For></ol>;")

    const d8 = batch.result(pf8).diagnostics
    expect(d8).toHaveLength(1)
    expect(applyAllFixes("let Component = (props) => <>{props.data.map(d => <li>{d.text}</li>)}</>;", d8))
      .toBe("let Component = (props) => <><For each={props.data}>{d => <li>{d.text}</li>}</For></>;")

    const d9 = batch.result(pf9).diagnostics
    expect(d9).toHaveLength(1)
    expect(at(d9, 0).messageId).toBe("preferForOrIndex")

    const d10 = batch.result(pf10).diagnostics
    expect(d10).toHaveLength(1)
    expect(at(d10, 0).messageId).toBe("preferForOrIndex")
  })
})

describe("prefer-memo-complex-styles", () => {
  const batch = lazyRuleBatch(preferMemoComplexStyles)
  const pm0 = batch.add(`function Avatar(props) { return <div style={{ color: "red", padding: "10px" }} />; }`)
  const pm1 = batch.add(`function Avatar(props) { return <div style={{ color: props.active ? "blue" : "gray" }} />; }`)
  const pm2 = batch.add(`function Avatar(props) { const styleObject = createMemo(() => ({ color: props.active ? "blue" : "gray", background: props.dark ? "#000" : "#fff" })); return <div style={styleObject()} />; }`)
  const pm3 = batch.add(`function Avatar(props) { return (<div style={{ color: props.active ? "blue" : "gray", background: props.dark ? "#000" : "#fff", }} />); }`)
  const pm4 = batch.add(`function Avatar(props) { return (<div style={{ ...baseStyle, ...(props.src ? {} : { "--avatar-bg": props.background }), }} />); }`)

  it("metadata", () => { expect(preferMemoComplexStyles.id).toBe("prefer-memo-complex-styles") })

  it("allows simple styles and detects complex conditional styles", () => {
    expect(batch.result(pm0).diagnostics).toHaveLength(0)
    expect(batch.result(pm1).diagnostics).toHaveLength(0)
    expect(batch.result(pm2).diagnostics).toHaveLength(0)
    expect(at(batch.result(pm3).diagnostics, 0).messageId).toBe("preferMemoComplexStyle")
    expect(at(batch.result(pm4).diagnostics, 0).messageId).toBe("preferMemoConditionalSpread")
  })
})

describe("prefer-show", () => {
  const batch = lazyRuleBatch(preferShow)
  const ps0 = batch.add(`function Component(props) { return <Show when={props.cond}>Content</Show>; }`)
  const ps1 = batch.add(`function Component(props) { return <div>{props.cond && "text"}</div>; }`)
  const ps2 = batch.add(`function Component(props) { return <div>{props.flag ? "yes" : "no"}</div>; }`)
  const ps3 = batch.add(`function Component(props) { return <div>{props.fallback || <Default />}</div>; }`)
  const ps4 = batch.add(`function Component(props) { return <div class={props.active && "active"} />; }`)
  const ps5code = `function Component(props) {\n      return <div>{props.cond && <span>Content</span>}</div>;\n    }`
  const ps5 = batch.add(ps5code)
  const ps6 = batch.add(`function Component(props) { return <div>{props.cond ? <span>Content</span> : <span>Fallback</span>}</div>; }`)
  const ps7 = batch.add(`function Component(props) { return (<For each={props.someList}>{(listItem) => listItem.cond && <span>Content</span>}</For>); }`)

  it("metadata", () => { expect(preferShow.id).toBe("prefer-show"); expect(preferShow.meta.fixable).toBe(true) })

  it("allows valid patterns and detects conditional JSX", () => {
    expect(batch.result(ps0).diagnostics).toHaveLength(0)
    expect(batch.result(ps1).diagnostics).toHaveLength(0)
    expect(batch.result(ps2).diagnostics).toHaveLength(0)
    expect(batch.result(ps3).diagnostics).toHaveLength(0)
    expect(batch.result(ps4).diagnostics).toHaveLength(0)

    const d5 = batch.result(ps5).diagnostics
    expect(d5).toHaveLength(1)
    expect(at(d5, 0).messageId).toBe("preferShowAnd")
    const fixed5 = applyAllFixes(ps5code, d5)
    expect(fixed5).toContain("<Show when={props.cond}>")

    expect(at(batch.result(ps6).diagnostics, 0).messageId).toBe("preferShowTernary")
    expect(at(batch.result(ps7).diagnostics, 0).messageId).toBe("preferShowAnd")
  })
})

describe("self-closing-comp", () => {
  const batch = lazyRuleBatch(selfClosingComp)
  const sc0 = batch.add('let el = <Component name="Foo" />;')
  const sc1 = batch.add('let el = <Component><img src="picture.png" /></Component>;')
  const sc2 = batch.add('let el = <Component name="Foo"> </Component>;')
  const sc3 = batch.add("let el = <div></div>;")
  const sc4 = batch.add("let el = <Component></Component>;")
  const sc5 = batch.add(`let el = (\n      <div>\n      </div>\n    );`)

  it("metadata", () => { expect(selfClosingComp.id).toBe("self-closing-comp"); expect(selfClosingComp.meta.fixable).toBe(true) })

  it("allows valid patterns and detects empty elements that should self-close", () => {
    expect(batch.result(sc0).diagnostics).toHaveLength(0)
    expect(batch.result(sc1).diagnostics).toHaveLength(0)
    expect(batch.result(sc2).diagnostics).toHaveLength(0)

    expect(batch.result(sc3).diagnostics).toHaveLength(1)
    expect(applyAllFixes("let el = <div></div>;", batch.result(sc3).diagnostics)).toBe("let el = <div />;")

    expect(batch.result(sc4).diagnostics).toHaveLength(1)
    expect(applyAllFixes("let el = <Component></Component>;", batch.result(sc4).diagnostics)).toBe("let el = <Component />;")

    expect(batch.result(sc5).diagnostics).toHaveLength(1)
  })
})

describe("style-prop", () => {
  const batch = lazyRuleBatch(styleProp)
  const sp0 = batch.add('let el = <div style={{ color: "red" }} />;')
  const sp1 = batch.add('let el = <div style={{ "--custom-color": "red" }} />;')
  const sp2 = batch.add('let el = <div style="color: red" />;')
  const sp3 = batch.add('let el = <div style="color: red; background: blue" />;')

  it("metadata", () => { expect(styleProp.id).toBe("style-prop"); expect(styleProp.meta.fixable).toBe(true) })

  it("allows object styles and detects/fixes string styles", () => {
    expect(batch.result(sp0).diagnostics).toHaveLength(0)
    expect(batch.result(sp1).diagnostics).toHaveLength(0)

    const d2 = batch.result(sp2).diagnostics
    expect(d2).toHaveLength(1)
    expect(at(d2, 0).messageId).toBe("stringStyle")
    expect(applyAllFixes('let el = <div style="color: red" />;', d2)).toBe('let el = <div style={{"color":"red"}} />;')

    expect(applyAllFixes('let el = <div style="color: red; background: blue" />;', batch.result(sp3).diagnostics))
      .toBe('let el = <div style={{"color":"red","background":"blue"}} />;')
  })
})
