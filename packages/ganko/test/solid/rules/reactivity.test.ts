/**
 * Reactivity Rules Tests
 */

import { describe, it, expect } from "vitest"
import { checkRule, lazyRuleBatch, applyAllFixes, at } from "../test-utils"
import { storeReactiveBreak, derivedSignal, effectAsMemo, effectAsMount, cleanupScope, signalCall, signalInLoop, noTopLevelSignalCall, resourceImplicitSuspense } from "../../../src/solid/rules/reactivity"

describe("store-reactive-break", () => {
  const batch = lazyRuleBatch(storeReactiveBreak)
  const s0 = batch.add(`
        import { createStore } from "solid-js/store";
        function UserProfile() {
          const [store, setStore] = createStore({ name: "John", email: "john@example.com" });
          return (<div><span>{store.name}</span><span>{store.email}</span></div>);
        }
      `)
  const s1 = batch.add(`
        import { createStore } from "solid-js/store";
        import { createEffect } from "solid-js";
        function UserProfile() {
          const [store, setStore] = createStore({ name: "John" });
          createEffect(() => { console.log(store.name); });
          return <div>{store.name}</div>;
        }
      `)
  const s2 = batch.add(`
        import { createStore } from "solid-js/store";
        import { createMemo } from "solid-js";
        function UserProfile() {
          const [store, setStore] = createStore({ name: "John" });
          const upperName = createMemo(() => store.name.toUpperCase());
          return <div>{upperName()}</div>;
        }
      `)
  const s3 = batch.add(`
        import { createStore } from "solid-js/store";
        function UserProfile() {
          const [store, setStore] = createStore({ name: "John" });
          return (<button onClick={() => console.log(store.name)}>Log Name</button>);
        }
      `)
  const s4 = batch.add(`
        import { createStore } from "solid-js/store";
        function UserProfile() {
          const [store, setStore] = createStore({ name: "John" });
          function logName() { console.log(store.name); }
          return <button onClick={logName}>Log</button>;
        }
      `)
  const s5 = batch.add(`
        function Component() {
          const obj = { a: 1, b: 2 };
          const copy = { ...obj };
          return <div>{copy.a}</div>;
        }
      `)
  const s6 = batch.add(`
        function Component() {
          const obj = { a: 1, b: 2 };
          const { a, b } = obj;
          return <div>{a}</div>;
        }
      `)
  const s7 = batch.add(`
        import { createStore } from "solid-js/store";
        function UserProfile() {
          const [store, setStore] = createStore({ name: "John", email: "john@example.com" });
          const copy = { ...store };
          return <div>{copy.name}</div>;
        }
      `)
  const s8 = batch.add(`
        import { createStore } from "solid-js/store";
        function UserProfile() {
          const [store, setStore] = createStore({ name: "John", email: "john@example.com" });
          const name = store.name;
          return <div>{name}</div>;
        }
      `)
  const s9 = batch.add(`
        import { createStore } from "solid-js/store";
        function UserProfile() {
          const [store, setStore] = createStore({ name: "John", email: "john@example.com" });
          const { email } = store;
          return <div>{email}</div>;
        }
      `)
  const s10 = batch.add(`
        import { createStore } from "solid-js/store";
        function UserProfile() {
          const [store, setStore] = createStore({ name: "John", email: "john@example.com" });
          const { name, email } = store;
          return <div>{name} - {email}</div>;
        }
      `)
  const s11 = batch.add(`
        import { createStore } from "solid-js/store";
        function UserProfile() {
          const [store, setStore] = createStore({ name: "John" });
          const extended = { ...store, extra: true };
          return <div>{extended.name}</div>;
        }
      `)

  it("metadata", () => { expect(storeReactiveBreak.id).toBe("store-reactive-break") })

  describe("valid patterns", () => {
    it("allows all valid store access patterns", () => {
      expect(batch.result(s0).diagnostics).toHaveLength(0)
      expect(batch.result(s1).diagnostics).toHaveLength(0)
      expect(batch.result(s2).diagnostics).toHaveLength(0)
      expect(batch.result(s3).diagnostics).toHaveLength(0)
      expect(batch.result(s4).diagnostics).toHaveLength(0)
      expect(batch.result(s5).diagnostics).toHaveLength(0)
      expect(batch.result(s6).diagnostics).toHaveLength(0)
    })
  })

  describe("invalid patterns", () => {
    it("reports store spread, extraction, and destructuring", () => {
      const d7 = batch.result(s7).diagnostics
      expect(d7).toHaveLength(1)
      expect(at(d7, 0).messageId).toBe("storeSpread")

      const d8 = batch.result(s8).diagnostics
      expect(d8).toHaveLength(1)
      expect(at(d8, 0).messageId).toBe("storeTopLevelAccess")

      const d9 = batch.result(s9).diagnostics
      expect(d9).toHaveLength(1)
      expect(at(d9, 0).messageId).toBe("storeDestructure")

      const d10 = batch.result(s10).diagnostics
      expect(d10).toHaveLength(2)
      expect(at(d10, 0).messageId).toBe("storeDestructure")

      const d11 = batch.result(s11).diagnostics
      expect(d11).toHaveLength(1)
      expect(at(d11, 0).messageId).toBe("storeSpread")
    })
  })
})

describe("derived-signal", () => {
  const batch = lazyRuleBatch(derivedSignal)
  const ds0 = batch.add(`import { createSignal } from "solid-js"; function Counter() { const [count, setCount] = createSignal(0); const doubled = () => count() * 2; return <div>{doubled()}</div>; }`)
  const ds1 = batch.add(`import { createSignal, createEffect } from "solid-js"; function Counter() { const [count, setCount] = createSignal(0); const doubled = () => count() * 2; createEffect(() => { console.log(doubled()); }); return <div />; }`)
  const ds2 = batch.add(`import { createSignal, createMemo } from "solid-js"; function Counter() { const [count, setCount] = createSignal(0); const doubled = () => count() * 2; const quad = createMemo(() => doubled() * 2); return <div>{quad()}</div>; }`)
  const ds3 = batch.add(`function Counter() { const format = (n: number) => n.toFixed(2); const x = format(42); return <div>{x}</div>; }`)
  const ds4 = batch.add(`import { createSignal } from "solid-js"; function Counter() { const [count, setCount] = createSignal(0); const doubled = () => count() * 2; return <button onClick={() => console.log(doubled())}>Click</button>; }`)
  const ds5 = batch.add(`import { createSignal, splitProps } from "solid-js"; function Pagination(props) { const [local] = splitProps(props, ["page", "totalPages", "onPageChange"]); const handlePageChange = (newPage) => { if (newPage >= 1 && newPage <= local.totalPages && newPage !== local.page) { local.onPageChange?.(newPage); } }; return (<div><Index each={[1, 2, 3]}>{(_pageNum) => { const pageNum = _pageNum(); return (<Show when={typeof pageNum === "number" ? pageNum : null} keyed>{(value) => (<button onClick={() => handlePageChange(value)}>{value}</button>)}</Show>); }}</Index></div>); }`)
  const ds6 = batch.add(`import { createSignal } from "solid-js"; function Dialog() { const [open, setOpen] = createSignal(false); const toggle = () => setOpen(!open()); return (<Show when={open()}>{() => <button onClick={() => toggle()}>Close</button>}</Show>); }`)
  const ds7 = batch.add(`import { createSignal } from "solid-js"; function Counter() { const [count, setCount] = createSignal(0); const doubled = () => count() * 2; const x = doubled(); return <div>{x}</div>; }`)
  const ds8 = batch.add(`import { createSignal } from "solid-js"; function Counter() { const [count, setCount] = createSignal(0); const doubled = () => count() * 2; console.log(doubled()); return <div />; }`)
  const ds9 = batch.add(`import { createSignal } from "solid-js"; function MyWidget() { const [val, setVal] = createSignal(0); const derived = () => val(); const snap = derived(); return <div>{snap}</div>; }`)
  const ds10 = batch.add(`import { createSignal } from "solid-js"; const [count, setCount] = createSignal(0); const doubled = () => count() * 2; const x = doubled();`)
  const ds11 = batch.add(`import { createSignal } from "solid-js"; const [count2, setCount2] = createSignal(0); const doubled2 = () => count2() * 2; console.log(doubled2());`)
  const ds12 = batch.add(`function QuickActionModal(props) { const handleSubmit = (actionType) => { const config = { type: actionType }; return async (data) => { props.onStart?.(config.type, data.ip); props.onComplete?.(data.ip); }; }; const handleBlock = handleSubmit("block"); const handleWhitelist = handleSubmit("whitelist"); return <div />; }`)
  const ds13 = batch.add(`import { createSignal } from "solid-js"; function Counter() { const [count, setCount] = createSignal(0); const makeHandler = (label) => { return () => console.log(label, count()); }; const logA = makeHandler("a"); return <button onClick={logA}>Click</button>; }`)
  const ds14 = batch.add(`import { createSignal } from "solid-js"; function Counter() { const [count, setCount] = createSignal(0); const makeValue = () => { const snapshot = count(); return () => snapshot; }; const getValue = makeValue(); return <div />; }`)
  const ds15 = batch.add(`import { createSignal } from "solid-js"; function Counter() { const [count, setCount] = createSignal(0); const doubled = () => count() * 2; function formatValue() { return String(doubled()); } return <div />; }`)
  const ds16 = batch.add(`import { createSignal } from "solid-js"; function useHook() { const [sig, setSig] = createSignal(0); const accessor = () => sig(); const utility = (x) => accessor() + x; return { accessor, utility }; }`)
  const ds17 = batch.add(`import { createSignal } from "solid-js"; export function useIPValidation() { const [cacheVersion, setCacheVersion] = createSignal(0); const validateIP = (ip) => { void cacheVersion(); return ip.length > 0; }; const validateBatch = (ips) => { return ips.map(ip => validateIP(ip)); }; return { validateIP, validateBatch }; }`)
  const ds18 = batch.add(`import { createSignal } from "solid-js"; function Counter() { const [count, setCount] = createSignal(0); const doubled = () => count() * 2; const combined = () => { const x = count(); return doubled() + x; }; return <div />; }`)
  const ds19 = batch.add(`import { createSignal } from "solid-js"; function List() { const [items, setItems] = createSignal([1, 2, 3]); const multiplier = () => items().length; return <For each={items()}>{(item) => <div>{multiplier()}</div>}</For>; }`)
  const ds20 = batch.add(`import { createSignal } from "solid-js"; function List() { const [items, setItems] = createSignal([1, 2, 3]); const total = () => items().length; return <Index each={items()}>{(item) => <span>{total()}</span>}</Index>; }`)
  const ds21 = batch.add(`import { createSignal, createEffect, on } from "solid-js"; function Counter() { const [count, setCount] = createSignal(0); const doubled = () => count() * 2; createEffect(on(doubled, (val) => { console.log(val); })); return <div />; }`)
  const ds22 = batch.add(`import { createSignal } from "solid-js"; function List() { const [items, setItems] = createSignal([1, 2, 3]); const total = () => items().length; return <For each={items()}>{(item) => { const snapshot = total(); return <div>{snapshot}</div>; }}</For>; }`)
  const ds23 = batch.add(`import { createSignal } from "solid-js"; function List() { const [items2, setItems2] = createSignal([1, 2, 3]); const total2 = () => items2().length; return <Index each={items2()}>{(item) => { console.log(total2()); return <span />; }}</Index>; }`)
  const ds24 = batch.add(`import { createSignal, untrack } from "solid-js"; function Counter() { const [count, setCount] = createSignal(0); const doubled = () => count() * 2; const val = untrack(() => doubled()); return <div>{val}</div>; }`)
  const ds25 = batch.add(`import { createSignal, createRoot } from "solid-js"; function Counter() { const [count, setCount] = createSignal(0); const doubled = () => count() * 2; createRoot(() => { const x = doubled(); }); return <div />; }`)
  const ds26 = batch.add(`import { createSignal } from "solid-js"; function Counter() { const [count, setCount] = createSignal(0); const doubled = () => count() * 2; return <Show when={count()}>{(val) => { const x = doubled(); return <div>{x}</div>; }}</Show>; }`)
  const ds27 = batch.add(`import { createSignal, createEffect, on } from "solid-js"; function App() { const [isActive, setIsActive] = createSignal(false); const [isFrozen, setIsFrozen] = createSignal(false); const unfreezeAnimations = () => { if (!isFrozen()) return; setIsFrozen(false); }; createEffect(on(isActive, (active) => { if (!active) { unfreezeAnimations(); } })); return <div />; }`)
  const ds28 = batch.add(`import { createSignal, createEffect, on } from "solid-js"; function App() { const [a, setA] = createSignal(0); const [b, setB] = createSignal(0); const getSum = () => a() + b(); createEffect(on([a, b], () => { console.log(getSum()); })); return <div />; }`)

  it("metadata", () => { expect(derivedSignal.id).toBe("derived-signal") })

  describe("valid patterns", () => {
    it("allows all valid derived signal access patterns", () => {
      expect(batch.result(ds0).diagnostics).toHaveLength(0)
      expect(batch.result(ds1).diagnostics).toHaveLength(0)
      expect(batch.result(ds2).diagnostics).toHaveLength(0)
      expect(batch.result(ds3).diagnostics).toHaveLength(0)
      expect(batch.result(ds4).diagnostics).toHaveLength(0)
      expect(batch.result(ds5).diagnostics).toHaveLength(0)
      expect(batch.result(ds6).diagnostics).toHaveLength(0)
    })
  })

  describe("invalid patterns — component top-level", () => {
    it("reports accessor at component top-level", () => {
      const d7 = batch.result(ds7).diagnostics
      expect(d7).toHaveLength(1)
      expect(at(d7, 0).messageId).toBe("componentTopLevelInit")
      expect(at(d7, 0).message).toContain("captures a one-time snapshot")
      expect(at(d7, 0).message).not.toContain("re-render")

      const d8 = batch.result(ds8).diagnostics
      expect(d8).toHaveLength(1)
      expect(at(d8, 0).messageId).toBe("componentTopLevelCall")

      const d9 = batch.result(ds9).diagnostics
      expect(d9).toHaveLength(1)
      expect(at(d9, 0).message).toContain("MyWidget")
    })
  })

  describe("invalid patterns — module scope", () => {
    it("reports accessor at module scope", () => {
      const d10 = batch.result(ds10).diagnostics
      expect(d10).toHaveLength(1)
      expect(at(d10, 0).messageId).toBe("moduleScopeInit")

      const d11 = batch.result(ds11).diagnostics
      expect(d11).toHaveLength(1)
      expect(at(d11, 0).messageId).toBe("moduleScopeCall")
    })
  })

  describe("valid patterns — higher-order functions", () => {
    it("allows HOF patterns and reports direct reactive reads", () => {
      expect(batch.result(ds12).diagnostics).toHaveLength(0)
      expect(batch.result(ds13).diagnostics).toHaveLength(0)

      const d14 = batch.result(ds14).diagnostics
      expect(d14).toHaveLength(1)
      expect(at(d14, 0).message).toContain("captures a one-time snapshot")
    })
  })

  describe("valid patterns — utility and derived functions", () => {
    it("allows utility and transitive calls", () => {
      expect(batch.result(ds15).diagnostics).toHaveLength(0)
      expect(batch.result(ds16).diagnostics).toHaveLength(0)
      expect(batch.result(ds17).diagnostics).toHaveLength(0)
      expect(batch.result(ds18).diagnostics).toHaveLength(0)
    })
  })

  describe("valid patterns — flow component callbacks", () => {
    it("allows reactive accessors in flow callbacks and on() deps", () => {
      expect(batch.result(ds19).diagnostics).toHaveLength(0)
      expect(batch.result(ds20).diagnostics).toHaveLength(0)
      expect(batch.result(ds21).diagnostics).toHaveLength(0)
    })
  })

  describe("invalid patterns — flow component body level", () => {
    it("reports accessor at flow callback body level", () => {
      expect(batch.result(ds22).diagnostics).toHaveLength(1)
      expect(batch.result(ds23).diagnostics).toHaveLength(1)
    })
  })

  describe("invalid patterns — untracked contexts", () => {
    it("reports accessor in untracked contexts", () => {
      expect(batch.result(ds24).diagnostics).toHaveLength(1)
      expect(batch.result(ds25).diagnostics).toHaveLength(1)
      expect(batch.result(ds26).diagnostics).toHaveLength(1)
    })
  })

  describe("valid patterns — on() callback", () => {
    it("allows derived functions inside on() callbacks", () => {
      expect(batch.result(ds27).diagnostics).toHaveLength(0)
      expect(batch.result(ds28).diagnostics).toHaveLength(0)
    })
  })
})

describe("effect-as-memo", () => {
  const batch = lazyRuleBatch(effectAsMemo)
  const em0 = batch.add(`import { createSignal, createEffect } from "solid-js"; function App() { const [count, setCount] = createSignal(0); createEffect(() => { console.log(count()); }); return <div />; }`)
  const em1 = batch.add(`import { createSignal, createEffect } from "solid-js"; function App() { const [count, setCount] = createSignal(0); const [doubled, setDoubled] = createSignal(0); createEffect(() => { console.log(count()); setDoubled(count() * 2); }); return <div />; }`)
  const em2 = batch.add(`import { createSignal, createEffect } from "solid-js"; function App() { const [data, setData] = createSignal(null); createEffect(async () => { const result = await fetch("/api"); setData(result); }); return <div />; }`)
  const em3 = batch.add(`import { createSignal, createEffect } from "solid-js"; function App() { const [count, setCount] = createSignal(0); const [delta, setDelta] = createSignal(1); createEffect(() => { setCount(prev => prev + delta()); }); return <div />; }`)
  const em4 = batch.add(`import { createSignal, createEffect } from "solid-js"; function App() { const [count, setCount] = createSignal(0); const [doubled, setDoubled] = createSignal(0); somePlugin(setDoubled); createEffect(() => setDoubled(count() * 2)); return <div />; }`)
  const em5 = batch.add(`import { createSignal, createEffect } from "solid-js"; function App() { const [count, setCount] = createSignal(0); const [doubled, setDoubled] = createSignal(0); createEffect(() => setDoubled(count() * 2)); return <div>{doubled()}</div>; }`)
  const em6 = batch.add(`import { createSignal, createEffect } from "solid-js"; function App() { const [count, setCount] = createSignal(0); const [doubled, setDoubled] = createSignal(0); createEffect(() => { setDoubled(count() * 2); }); return <div>{doubled()}</div>; }`)
  const em7 = batch.add(`import { createSignal, createRenderEffect } from "solid-js"; function App() { const [count, setCount] = createSignal(0); const [doubled, setDoubled] = createSignal(0); createRenderEffect(() => setDoubled(count() * 2)); return <div>{doubled()}</div>; }`)
  const em8code = `\n        import { createSignal, createEffect } from "solid-js";\n        function App() {\n          const [count, setCount] = createSignal(0);\n          const [doubled, setDoubled] = createSignal(0);\n          createEffect(() => setDoubled(count() * 2));\n          return <div>{doubled()}</div>;\n        }\n      `
  const em8 = batch.add(em8code)

  it("metadata", () => { expect(effectAsMemo.id).toBe("effect-as-memo") })

  it("allows valid effect patterns", () => {
    expect(batch.result(em0).diagnostics).toHaveLength(0)
    expect(batch.result(em1).diagnostics).toHaveLength(0)
    expect(batch.result(em2).diagnostics).toHaveLength(0)
    expect(batch.result(em3).diagnostics).toHaveLength(0)
    expect(batch.result(em4).diagnostics).toHaveLength(0)
  })

  it("reports effect-as-memo patterns and provides auto-fix", () => {
    const d5 = batch.result(em5).diagnostics
    expect(d5).toHaveLength(1)
    expect(at(d5, 0).messageId).toBe("effectAsMemo")
    expect(at(d5, 0).message).toContain("doubled")

    expect(batch.result(em6).diagnostics).toHaveLength(1)
    expect(batch.result(em7).diagnostics).toHaveLength(1)

    const d8 = batch.result(em8).diagnostics
    expect(d8).toHaveLength(1)
    expect(at(d8, 0).fix).toBeDefined()
    const fixed = applyAllFixes(em8code, d8)
    expect(fixed).toContain("createMemo(() => count() * 2)")
    expect(fixed).toContain("const doubled = createMemo")
    expect(fixed).not.toContain("setDoubled(count()")
  })
})

describe("effect-as-mount", () => {
  const batch = lazyRuleBatch(effectAsMount)
  const eam0 = batch.add(`import { createSignal, createEffect } from "solid-js"; function App() { const [count, setCount] = createSignal(0); createEffect(() => { console.log(count()); }); return <div />; }`)
  const eam1 = batch.add(`import { createSignal, createEffect } from "solid-js"; function App() { const [count, setCount] = createSignal(0); createEffect((prev) => { console.log("mounted"); return prev; }, 0); return <div />; }`)
  const eam2 = batch.add(`import { createSignal, createEffect } from "solid-js"; function App() { const [count, setCount] = createSignal(0); const helper = () => count(); createEffect(() => { console.log(helper()); }); return <div />; }`)
  const eam3 = batch.add(`import { createSignal, createEffect } from "solid-js"; function useSSE(options) { const [state, setState] = createSignal("closed"); const resolveUrl = () => { const url = options.url; return typeof url === "function" ? url() : url; }; createEffect(() => { const url = resolveUrl(); if (url) setState("connecting"); }); return { state }; }`)
  const eam4 = batch.add(`import { createEffect } from "solid-js"; function App(props: { table: { isSomeSelected(): boolean } }) { let selectAllRef: HTMLInputElement | undefined; createEffect(() => { if (selectAllRef) { selectAllRef.indeterminate = props.table.isSomeSelected(); } }); return <div />; }`)
  const eam5 = batch.add(`import { createSignal, createRenderEffect } from "solid-js"; function App() { const [count, setCount] = createSignal(0); createRenderEffect(() => { document.title = String(count()); }); return <div />; }`)
  const eam6 = batch.add(`import { createSignal, createEffect } from "solid-js"; function App() { const [count, setCount] = createSignal(0); createEffect(function() { console.log(count()); }); return <div />; }`)
  const eam7 = batch.add(`import { createEffect } from "solid-js"; function App() { createEffect(() => { console.log("mounted"); }); return <div />; }`)
  const eam8code = `\n        import { createEffect } from "solid-js";\n        function App() {\n          createEffect(() => {\n            document.title = "Hello";\n          });\n          return <div />;\n        }\n      `
  const eam8 = batch.add(eam8code)
  const eam9 = batch.add(`import { createRenderEffect } from "solid-js"; function App() { createRenderEffect(() => { document.title = "Hello"; }); return <div />; }`)
  const eam10code = `\n        import { createRenderEffect } from "solid-js";\n        function App() {\n          createRenderEffect(() => {\n            document.title = "Hello";\n          });\n          return <div />;\n        }\n      `
  const eam10 = batch.add(eam10code)
  const eam11 = batch.add(`import { createEffect } from "solid-js"; function App() { createEffect(() => { window.addEventListener("resize", () => {}); }); return <div />; }`)
  const eam12 = batch.add(`import { createEffect } from "solid-js"; function App() { createEffect(() => { console.log("mounted"); }, undefined); return <div />; }`)
  const eam13code = `\n        import { createEffect } from "solid-js";\n        function App() {\n          createEffect(() => {\n            console.log("mounted");\n          });\n          return <div />;\n        }\n      `
  const eam13 = batch.add(eam13code)

  it("metadata", () => { expect(effectAsMount.id).toBe("effect-as-mount") })

  it("allows effects with reactive dependencies", () => {
    expect(batch.result(eam0).diagnostics).toHaveLength(0)
    expect(batch.result(eam1).diagnostics).toHaveLength(0)
    expect(batch.result(eam2).diagnostics).toHaveLength(0)
    expect(batch.result(eam3).diagnostics).toHaveLength(0)
    expect(batch.result(eam4).diagnostics).toHaveLength(0)
    expect(batch.result(eam5).diagnostics).toHaveLength(0)
    expect(batch.result(eam6).diagnostics).toHaveLength(0)
  })

  it("reports effects without reactive dependencies and provides fixes", () => {
    const d7 = batch.result(eam7).diagnostics
    expect(d7).toHaveLength(1)
    expect(at(d7, 0).message).toContain("createEffect")
    expect(at(d7, 0).message).toContain("onMount")

    const d8 = batch.result(eam8).diagnostics
    expect(d8).toHaveLength(1)
    expect(at(d8, 0).fix).toBeDefined()
    const fixed8 = applyAllFixes(eam8code, d8)
    expect(fixed8).toContain("onMount")

    const d9 = batch.result(eam9).diagnostics
    expect(d9).toHaveLength(1)
    expect(at(d9, 0).message).toContain("createRenderEffect")

    const d10 = batch.result(eam10).diagnostics
    expect(d10).toHaveLength(1)
    const fixed10 = applyAllFixes(eam10code, d10)
    expect(fixed10).toContain("onMount")

    expect(batch.result(eam11).diagnostics).toHaveLength(1)
    expect(batch.result(eam12).diagnostics).toHaveLength(1)

    const d13 = batch.result(eam13).diagnostics
    expect(d13).toHaveLength(1)
    const fixed13 = applyAllFixes(eam13code, d13)
    expect(fixed13).toContain("onMount")
  })
})

describe("cleanup-scope", () => {
  const batch = lazyRuleBatch(cleanupScope)
  const cs0 = batch.add(`import { onCleanup } from "solid-js"; function App() { onCleanup(() => console.log("cleanup")); return <div />; }`)
  const cs1 = batch.add(`import { createEffect, onCleanup } from "solid-js"; function App() { createEffect(() => { const id = setInterval(() => {}, 1000); onCleanup(() => clearInterval(id)); }); return <div />; }`)
  const cs2 = batch.add(`import { createMemo, onCleanup } from "solid-js"; function App() { createMemo(() => { onCleanup(() => {}); return 1; }); return <div />; }`)
  const cs3 = batch.add(`import { onCleanup } from "solid-js"; function clickOutside(el, accessor) { const handler = () => accessor()?.(); document.addEventListener("click", handler); onCleanup(() => document.removeEventListener("click", handler)); } function App() { return <div use:clickOutside={() => console.log("outside")} />; }`)
  const cs4 = batch.add(`import { createEffect, createSignal, onCleanup } from "solid-js"; function createAnimatedValue(target) { const [value, setValue] = createSignal(0); let frameId; createEffect(() => { frameId = requestAnimationFrame(() => setValue(target())); }); onCleanup(() => cancelAnimationFrame(frameId)); return value; }`)
  const cs5 = batch.add(`import { createEffect, onCleanup } from "solid-js"; function createInterval(fn, delay) { createEffect(() => { const id = setInterval(fn, delay()); onCleanup(() => clearInterval(id)); }); }`)
  const cs6 = batch.add(`import { createSignal, onCleanup } from "solid-js"; function useIPValidation(options) { const [cache, setCache] = createSignal(new Map()); const controllers = new Map(); const clearAll = () => { for (const c of controllers.values()) c.abort(); controllers.clear(); }; onCleanup(clearAll); return { cache }; }`)
  const cs7 = batch.add(`import { onMount, onCleanup } from "solid-js"; function createSimpleContext(input) { return input.init(); } const ctx = createSimpleContext({ init: () => { const handler = () => {}; window.addEventListener("resize", handler); onCleanup(() => window.removeEventListener("resize", handler)); } });`)
  const cs8 = batch.add(`import { onCleanup } from "solid-js"; onCleanup(() => console.log("cleanup"));`)
  const cs9 = batch.add(`import { onCleanup } from "solid-js"; function setupTimer() { onCleanup(() => console.log("cleanup")); }`)
  const cs10 = batch.add(`import { onCleanup } from "solid-js"; const fn = () => { onCleanup(() => console.log("cleanup")); };`)
  const cs11 = batch.add(`import { onCleanup } from "solid-js"; function create() { onCleanup(() => console.log("cleanup")); }`)
  const cs12 = batch.add(`import { onCleanup } from "solid-js"; function use() { onCleanup(() => console.log("cleanup")); }`)
  const cs13 = batch.add(`import { onCleanup } from "solid-js"; function handleState(value, setter) { onCleanup(() => console.log("cleanup")); }`)

  it("metadata", () => { expect(cleanupScope.id).toBe("cleanup-scope") })

  describe("valid patterns", () => {
    it("allows onCleanup in valid scopes", () => {
      expect(batch.result(cs0).diagnostics).toHaveLength(0)
      expect(batch.result(cs1).diagnostics).toHaveLength(0)
      expect(batch.result(cs2).diagnostics).toHaveLength(0)
      expect(batch.result(cs3).diagnostics).toHaveLength(0)
      expect(batch.result(cs4).diagnostics).toHaveLength(0)
      expect(batch.result(cs5).diagnostics).toHaveLength(0)
      expect(batch.result(cs6).diagnostics).toHaveLength(0)
      expect(batch.result(cs7).diagnostics).toHaveLength(0)
    })
  })

  describe("invalid patterns", () => {
    it("reports onCleanup in invalid scopes", () => {
      const d8 = batch.result(cs8).diagnostics
      expect(d8).toHaveLength(1)
      expect(at(d8, 0).message).toContain("module scope")

      const d9 = batch.result(cs9).diagnostics
      expect(d9).toHaveLength(1)
      expect(at(d9, 0).message).toContain("setupTimer")

      expect(batch.result(cs10).diagnostics).toHaveLength(1)
      expect(batch.result(cs11).diagnostics).toHaveLength(1)
      expect(batch.result(cs12).diagnostics).toHaveLength(1)

      const d13 = batch.result(cs13).diagnostics
      expect(d13).toHaveLength(1)
      expect(at(d13, 0).message).toContain("handleState")
    })
  })
})
describe("no-top-level-signal-call", () => {
  const batch = lazyRuleBatch(noTopLevelSignalCall)
  const ntl0 = batch.add(`import { createSignal, createMemo } from "solid-js"; function Table(props) { const allColumns = createMemo(() => props.columns ?? []); const [visible, setVisible] = createSignal(new Set(allColumns().map((c) => c.key))); return <div>{visible()}</div>; }`)
  const ntl1 = batch.add(`import { createSignal, createMemo } from "solid-js"; function Counter() { const base = createMemo(() => 10); const [count, setCount] = createSignal(base() * 2); return <div>{count()}</div>; }`)
  const ntl2 = batch.add(`import { createSignal } from "solid-js"; function Counter() { const [count] = createSignal(0); const value = count(); return <div>{value}</div>; }`)
  const ntl3 = batch.add(`import { createSignal, createMemo, createEffect } from "solid-js"; function App() { const data = createMemo(() => "hello"); createEffect(() => { const snapshot = data(); console.log(snapshot); }); return <div />; }`)

  it("metadata", () => { expect(noTopLevelSignalCall.id).toBe("no-top-level-signal-call") })

  it("allows signal calls in value-semantic positions", () => {
    expect(batch.result(ntl0).diagnostics).toHaveLength(0)
    expect(batch.result(ntl1).diagnostics).toHaveLength(0)
    expect(batch.result(ntl3).diagnostics).toHaveLength(0)
  })

  it("reports signal call at component top level", () => {
    expect(batch.result(ntl2).diagnostics).toHaveLength(1)
  })
})

describe("signal-call", () => {
  const batch = lazyRuleBatch(signalCall)
  const sc0 = batch.add(`import { createSignal } from "solid-js"; function useIPValidation(opts) { return opts.ip(); } function Form() { const [ipAddress, setIpAddress] = createSignal(""); const validation = useIPValidation({ ip: ipAddress }); return <div>{validation}</div>; }`)
  const sc1 = batch.add(`import { createSignal } from "solid-js"; function useDebounced(accessor) { return accessor(); } function Form() { const [value, setValue] = createSignal(""); const debounced = useDebounced(value); return <div>{debounced}</div>; }`)
  const sc2 = batch.add(`import { createSignal } from "solid-js"; function App() { const [label] = createSignal("hello"); return <div title={label} />; }`)

  it("metadata", () => { expect(signalCall.id).toBe("signal-call") })

  it("allows signal accessors passed to hooks and reports uncalled signals in JSX", () => {
    expect(batch.result(sc0).diagnostics).toHaveLength(0)
    expect(batch.result(sc1).diagnostics).toHaveLength(0)

    const d2 = batch.result(sc2).diagnostics
    expect(d2).toHaveLength(1)
    expect(at(d2, 0).messageId).toBe("signalInJsxAttribute")
  })
})

describe("signal-in-loop", () => {
  const batch = lazyRuleBatch(signalInLoop)
  const sl0 = batch.add(`import { createSignal } from "solid-js"; function List() { const [selected, setSelected] = createSignal(0); return (<For each={[1, 2, 3]}>{(item) => <div data-active={selected() === item}>{item}</div>}</For>); }`)
  const sl1 = batch.add(`import { createSignal } from "solid-js"; function List() { const [selected, setSelected] = createSignal(0); return (<For each={[1, 2, 3]}>{(item) => (<button onClick={() => setSelected(item)}>{selected() === item ? "active" : "inactive"}</button>)}</For>); }`)
  const sl2 = batch.add(`import { createSignal, splitProps } from "solid-js"; function Pagination(props) { const [local] = splitProps(props, ["page", "onPageChange"]); const handlePageChange = (newPage) => { local.onPageChange?.(newPage); }; return (<Index each={[1, 2, 3]}>{(pageNum) => (<button onClick={() => handlePageChange(pageNum())}>{pageNum()}</button>)}</Index>); }`)
  const sl3 = batch.add(`import { createSignal } from "solid-js"; function List() { const [highlighted, setHighlighted] = createSignal(-1); return (<For each={[{ item: "a", index: 0 }, { item: "b", index: 1 }]}>{({ item, index: itemIndex }) => (<button aria-selected={highlighted() === itemIndex} data-highlighted={highlighted() === itemIndex ? "" : undefined}>{item}</button>)}</For>); }`)
  const sl4 = batch.add(`import { createSignal } from "solid-js"; function List(props) { const [active, setActive] = createSignal(null); return (<For each={props.items}>{(item) => { const key = props.getKey(item); return (<div data-active={key === active() ? "" : undefined} onClick={() => setActive(key)}>{item.name}</div>); }}</For>); }`)
  const sl5 = batch.add(`import { createSignal } from "solid-js"; function List() { const [selected, setSelected] = createSignal(""); return (<For each={["a", "b", "c"]}>{(item) => { const id = item + "-id"; const label = id + "-label"; return <div class={selected() === label ? "active" : ""}>{item}</div>; }}</For>); }`)
  const sl6 = batch.add(`import { type Accessor } from "solid-js"; function MarkerList(props: { markers: Accessor<Array<{ id: string }>>; animatedMarkers: Accessor<Set<string>>; markersExiting: Accessor<boolean>; isClearing: Accessor<boolean>; }) { return (<For each={props.markers()}>{(annotation) => { const id = annotation.id; const needsEnterAnimation = () => !props.animatedMarkers().has(id); const animClass = () => props.markersExiting() ? "exit" : props.isClearing() ? "clearing" : needsEnterAnimation() ? "enter" : undefined; return <div data-animate={animClass()}>{id}</div>; }}</For>); }`)
  const sl7 = batch.add(`import { createSignal } from "solid-js"; function List(props) { const [selected] = createSignal(new Set<number>()); return (<For each={props.items}>{(item) => { const isSelected = () => { return selected().has(item.id); }; return <div data-selected={isSelected() || undefined}>{item.name}</div>; }}</For>); }`)
  const sl8 = batch.add(`import { createSignal, createMemo } from "solid-js"; function List() { const [items, setItems] = createSignal([1, 2, 3]); const count = createMemo(() => items().length); return (<For each={items()}>{(item) => <div>{count()} items, current: {item}</div>}</For>); }`)
  const sl9 = batch.add(`import { createSignal } from "solid-js"; function List() { const [label, setLabel] = createSignal("test"); return (<For each={[1, 2, 3]}>{(item) => <div class={label()}>{item}</div>}</For>); }`)
  const sl10 = batch.add(`import { createSignal } from "solid-js"; function List() { return (<For each={[1, 2, 3]}>{(item) => { const [local, setLocal] = createSignal(0); return <div>{local()}</div>; }}</For>); }`)
  const sl11 = batch.add(`import { createSignal, splitProps } from "solid-js"; function List(props) { const [local] = splitProps(props, ["label"]); const getLabel = () => local.label; return (<For each={[1, 2, 3]}>{(item) => <div title={getLabel()}>{item}</div>}</For>); }`)

  it("metadata", () => { expect(signalInLoop.id).toBe("signal-in-loop") })

  it("allows valid signal usage in flow component callbacks", () => {
    expect(batch.result(sl0).diagnostics).toHaveLength(0)
    expect(batch.result(sl1).diagnostics).toHaveLength(0)
    expect(batch.result(sl2).diagnostics).toHaveLength(0)
    expect(batch.result(sl3).diagnostics).toHaveLength(0)
    expect(batch.result(sl4).diagnostics).toHaveLength(0)
    expect(batch.result(sl5).diagnostics).toHaveLength(0)
    expect(batch.result(sl6).diagnostics.filter(d => d.messageId === "derivedCallInvariant")).toHaveLength(0)
    expect(batch.result(sl7).diagnostics).toHaveLength(0)
    expect(batch.result(sl8).diagnostics).toHaveLength(0)
  })

  it("reports loop-invariant signals and signals created in loops", () => {
    const d9 = batch.result(sl9).diagnostics
    expect(d9).toHaveLength(1)
    expect(at(d9, 0).messageId).toBe("signalCallInvariant")

    const d10 = batch.result(sl10).diagnostics
    expect(d10).toHaveLength(1)
    expect(at(d10, 0).messageId).toBe("signalInLoop")

    const d11 = batch.result(sl11).diagnostics
    expect(d11).toHaveLength(1)
    expect(at(d11, 0).messageId).toBe("derivedCallInvariant")
  })
})

describe("resource-implicit-suspense", () => {
  const batch = lazyRuleBatch(resourceImplicitSuspense)
  const ri0 = batch.add(`import { createResource } from "solid-js"; function UserList() { const [users] = createResource(fetchUsers, { initialValue: [] }); return <div>{users().length}</div>; }`)
  const ri1 = batch.add(`import { createResource } from "solid-js"; function UserDetail() { const [user] = createResource(() => id(), fetchUser, { initialValue: null }); return <div>{user()?.name}</div>; }`)
  const ri2 = batch.add(`import { createResource } from "solid-js"; function UserList() { const [users] = createResource(fetchUsers, { initialValue: [] }); return (<Show when={!users.loading}><div>{users().length}</div></Show>); }`)
  const ri3 = batch.add(`import { createResource } from "solid-js"; function UserList() { const [users] = createResource(fetchUsers); return <div>{users()?.length}</div>; }`)
  const ri4 = batch.add(`import { createResource } from "solid-js"; function UserList() { const [users] = createResource(fetchUsers); return (<Show when={!users.loading} fallback={<div>Loading...</div>}><div>{users().length}</div></Show>); }`)
  const ri5 = batch.add(`import { createResource } from "solid-js"; function CountryList() { const [countries] = createResource(() => regionId(), fetchCountries); return (<Show when={!countries.loading} fallback={<span>Loading countries...</span>}><ul>{countries()}</ul></Show>); }`)
  const ri6 = batch.add(`import { createResource } from "solid-js"; function DataView() { const [data] = createResource(fetchData); return <div>{data.loading ? "Loading..." : data()?.value}</div>; }`)
  const ri7 = batch.add(`import { createResource } from "solid-js"; function CountryForm() { const [countries] = createResource(fetchCountries); return <ul>{countries()}</ul>; } function Page() { return (<Suspense fallback={<div />}><div><Show when={showForm()}><CountryForm /></Show></div></Suspense>); }`)
  const ri8 = batch.add(`import { createResource } from "solid-js"; function SearchResults() { const [results] = createResource(fetchResults); return <div>{results()}</div>; } function Layout() { return (<Suspense fallback={<div />}><main><Dialog><SearchResults /></Dialog></main></Suspense>); }`)
  const ri9 = batch.add(`import { createResource } from "solid-js"; function SettingsPanel() { const [settings] = createResource(fetchSettings); return <div>{settings()}</div>; } function App() { return (<Suspense fallback={<div />}><Modal><SettingsPanel /></Modal></Suspense>); }`)
  const ri10 = batch.add(`import { createResource } from "solid-js"; function CountryForm() { const [countries] = createResource(fetchCountries); return <ul>{countries()}</ul>; } function Page() { return (<Suspense fallback={<div />}><Show when={showForm()}><Suspense fallback={<span>Loading form...</span>}><CountryForm /></Suspense></Show></Suspense>); }`)
  const ri11 = batch.add(`import { createResource } from "solid-js"; function CountryForm() { const [countries] = createResource(fetchCountries, { initialValue: [] }); return <ul>{countries()}</ul>; } function Page() { return (<Suspense fallback={<div />}><div><Show when={showForm()}><CountryForm /></Show></div></Suspense>); }`)
  const ri12 = batch.add(`import { createResource } from "solid-js"; function CountryForm() { const [countries] = createResource(async () => { const res = await fetch("/api/countries"); return res.json(); }, { initialValue: [] }); return <ul>{countries()}</ul>; } function Page() { return (<Suspense fallback={<div />}><CountryForm /></Suspense>); }`)
  const ri13 = batch.add(`import { createResource } from "solid-js"; function CountryForm() { const [countries] = createResource(async () => { const res = await fetch("/api/countries"); if (!res.ok) throw new Error("Failed"); return res.json(); }, { initialValue: [] }); return <ul>{countries()}</ul>; } function Page() { return (<Suspense fallback={<div />}><CountryForm /></Suspense>); }`)
  const ri14 = batch.add(`import { createResource } from "solid-js"; async function fetchCountries2() { const res = await fetch("/api/countries"); return res.json(); } function CountryForm() { const [countries] = createResource(fetchCountries2, { initialValue: [] }); return <ul>{countries()}</ul>; } function Page() { return (<Suspense fallback={<div />}><CountryForm /></Suspense>); }`)
  const ri15 = batch.add(`import { createResource } from "solid-js"; function UserDetail() { const [user] = createResource(() => userId(), async (id) => { const res = await fetch("/api/users/" + id); return res.json(); }, { initialValue: null }); return <div>{user()?.name}</div>; } function Page() { return (<Suspense fallback={<div />}><UserDetail /></Suspense>); }`)
  const ri16 = batch.add(`import { createResource } from "solid-js"; function CountryForm() { const [countries] = createResource(async () => { const res = await fetch("/api/countries"); return res.json(); }, { initialValue: [] }); return <ul>{countries()}</ul>; } function Page() { return (<Suspense fallback={<div />}><ErrorBoundary fallback={<div>Error</div>}><CountryForm /></ErrorBoundary></Suspense>); }`)
  const ri17 = batch.add(`import { createResource } from "solid-js"; function DataPanel() { const [data] = createResource(async () => { const res = await fetch("/api/data"); return res.json(); }, { initialValue: null }); return <div>{data()}</div>; } function Page() { return (<Suspense fallback={<div />}><div><ErrorBoundary fallback={<span>Something went wrong</span>}><DataPanel /></ErrorBoundary></div></Suspense>); }`)
  const ri18 = batch.add(`import { createResource } from "solid-js"; function StaticData() { const [data] = createResource(() => ({ name: "test" })); return <div>{data()?.name}</div>; } function Page() { return (<Suspense fallback={<div />}><StaticData /></Suspense>); }`)
  const ri19 = batch.add(`import { createResource } from "solid-js"; function CountryForm() { const [countries] = createResource(async () => { const res = await fetch("/api/countries"); return res.json(); }); return (<Show when={!countries.loading} fallback={<div>Loading...</div>}><ul>{countries()}</ul></Show>); } function Page() { return (<Suspense fallback={<div />}><CountryForm /></Suspense>); }`)
  const ri20code = `import { createResource } from "solid-js";\nfunction CountryForm() {\n  const [countries] = createResource(async () => {\n    const res = await fetch("/api/countries");\n    return res.json();\n  }, { initialValue: [] });\n  return <ul>{countries()}</ul>;\n}\nfunction Page() {\n  return (\n    <Suspense fallback={<div />}>\n      <CountryForm />\n    </Suspense>\n  );\n}`
  const ri20 = batch.add(ri20code)

  it("metadata", () => { expect(resourceImplicitSuspense.id).toBe("resource-implicit-suspense") })

  it("allows valid createResource patterns", () => {
    expect(batch.result(ri0).diagnostics).toHaveLength(0)
    expect(batch.result(ri1).diagnostics).toHaveLength(0)
    expect(batch.result(ri2).diagnostics).toHaveLength(0)
    expect(batch.result(ri3).diagnostics).toHaveLength(0)
  })

  it("warns on loading mismatch patterns", () => {
    const d4 = batch.result(ri4).diagnostics
    expect(d4).toHaveLength(1)
    expect(at(d4, 0).messageId).toBe("loadingMismatch")
    expect(at(d4, 0).severity).toBe("warn")

    expect(batch.result(ri5).diagnostics).toHaveLength(1)
    expect(batch.result(ri6).diagnostics).toHaveLength(1)
  })

  it("errors on conditional mount with distant Suspense", () => {
    const d7 = batch.result(ri7).diagnostics
    expect(d7).toHaveLength(1)
    expect(at(d7, 0).messageId).toBe("conditionalSuspense")
    expect(at(d7, 0).severity).toBe("error")

    expect(batch.result(ri8).diagnostics).toHaveLength(1)
    expect(batch.result(ri9).diagnostics).toHaveLength(1)
    expect(batch.result(ri10).diagnostics).toHaveLength(0)

    const d11 = batch.result(ri11).diagnostics
    expect(d11).toHaveLength(1)
    expect(at(d11, 0).messageId).toBe("conditionalSuspense")
  })

  it("errors on missing ErrorBoundary and allows when present", () => {
    const d12 = batch.result(ri12).diagnostics
    expect(d12).toHaveLength(1)
    expect(at(d12, 0).messageId).toBe("missingErrorBoundary")
    expect(at(d12, 0).severity).toBe("error")

    expect(batch.result(ri13).diagnostics).toHaveLength(1)
    expect(batch.result(ri14).diagnostics).toHaveLength(1)
    expect(batch.result(ri15).diagnostics).toHaveLength(1)
    expect(batch.result(ri16).diagnostics).toHaveLength(0)
    expect(batch.result(ri17).diagnostics).toHaveLength(0)
    expect(batch.result(ri18).diagnostics).toHaveLength(0)

    const d19 = batch.result(ri19).diagnostics
    const ids19 = d19.map(d => d.messageId)
    expect(ids19).toContain("loadingMismatch")
    expect(ids19).toContain("missingErrorBoundary")
  })

  it("provides auto-fix for missingErrorBoundary", () => {
    const d20 = batch.result(ri20).diagnostics
    expect(d20).toHaveLength(1)
    expect(at(d20, 0).messageId).toBe("missingErrorBoundary")
    expect(at(d20, 0).fix).toBeDefined()
    expect(at(d20, 0).suggest).toBeUndefined()

    const fixed = applyAllFixes(ri20code, d20)
    expect(fixed).toContain("<ErrorBoundary fallback={<div>Error</div>}>")
    expect(fixed).toContain("</ErrorBoundary>")
    expect(fixed).toContain(", ErrorBoundary")
  })
})
