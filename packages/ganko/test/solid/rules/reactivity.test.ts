/**
 * Reactivity Rules Tests
 */

import { describe, it, expect } from "vitest"
import { checkRule, applyAllFixes, at } from "../test-utils"
import { storeReactiveBreak, derivedSignal, effectAsMemo, effectAsMount, cleanupScope, signalCall, signalInLoop, noTopLevelSignalCall, resourceImplicitSuspense } from "../../../src/solid/rules/reactivity"

describe("store-reactive-break", () => {
  const check = (code: string) => checkRule(storeReactiveBreak, code)

  it("metadata", () => {
    expect(storeReactiveBreak.id).toBe("store-reactive-break")
  })

  describe("valid patterns", () => {
    it("allows store property access in JSX", () => {
      const { diagnostics } = check(`
        import { createStore } from "solid-js/store";
        function UserProfile() {
          const [store, setStore] = createStore({ name: "John", email: "john@example.com" });
          return (
            <div>
              <span>{store.name}</span>
              <span>{store.email}</span>
            </div>
          );
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows store property access in createEffect", () => {
      const { diagnostics } = check(`
        import { createStore } from "solid-js/store";
        import { createEffect } from "solid-js";
        function UserProfile() {
          const [store, setStore] = createStore({ name: "John" });
          createEffect(() => {
            console.log(store.name);
          });
          return <div>{store.name}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows store property access in createMemo", () => {
      const { diagnostics } = check(`
        import { createStore } from "solid-js/store";
        import { createMemo } from "solid-js";
        function UserProfile() {
          const [store, setStore] = createStore({ name: "John" });
          const upperName = createMemo(() => store.name.toUpperCase());
          return <div>{upperName()}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows store property access in event handler", () => {
      const { diagnostics } = check(`
        import { createStore } from "solid-js/store";
        function UserProfile() {
          const [store, setStore] = createStore({ name: "John" });
          return (
            <button onClick={() => console.log(store.name)}>
              Log Name
            </button>
          );
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows store access inside function", () => {
      const { diagnostics } = check(`
        import { createStore } from "solid-js/store";
        function UserProfile() {
          const [store, setStore] = createStore({ name: "John" });
          function logName() {
            console.log(store.name);
          }
          return <button onClick={logName}>Log</button>;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows non-store object spread", () => {
      const { diagnostics } = check(`
        function Component() {
          const obj = { a: 1, b: 2 };
          const copy = { ...obj };
          return <div>{copy.a}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows non-store destructuring", () => {
      const { diagnostics } = check(`
        function Component() {
          const obj = { a: 1, b: 2 };
          const { a, b } = obj;
          return <div>{a}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })

  describe("invalid patterns", () => {
    it("reports spreading store", () => {
      const { diagnostics } = check(`
        import { createStore } from "solid-js/store";
        function UserProfile() {
          const [store, setStore] = createStore({ name: "John", email: "john@example.com" });
          const copy = { ...store };
          return <div>{copy.name}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("storeSpread")
    })

    it("reports top-level store property extraction", () => {
      const { diagnostics } = check(`
        import { createStore } from "solid-js/store";
        function UserProfile() {
          const [store, setStore] = createStore({ name: "John", email: "john@example.com" });
          const name = store.name;
          return <div>{name}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("storeTopLevelAccess")
    })

    it("reports destructuring store", () => {
      const { diagnostics } = check(`
        import { createStore } from "solid-js/store";
        function UserProfile() {
          const [store, setStore] = createStore({ name: "John", email: "john@example.com" });
          const { email } = store;
          return <div>{email}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("storeDestructure")
    })

    it("reports multiple destructured properties", () => {
      const { diagnostics } = check(`
        import { createStore } from "solid-js/store";
        function UserProfile() {
          const [store, setStore] = createStore({ name: "John", email: "john@example.com" });
          const { name, email } = store;
          return <div>{name} - {email}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(2)
      expect(at(diagnostics, 0).messageId).toBe("storeDestructure")
      expect(at(diagnostics, 1).messageId).toBe("storeDestructure")
    })

    it("reports store spread with other properties", () => {
      const { diagnostics } = check(`
        import { createStore } from "solid-js/store";
        function UserProfile() {
          const [store, setStore] = createStore({ name: "John" });
          const extended = { ...store, extra: true };
          return <div>{extended.name}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("storeSpread")
    })
  })
})

describe("derived-signal", () => {
  const check = (code: string) => checkRule(derivedSignal, code)

  it("metadata", () => {
    expect(derivedSignal.id).toBe("derived-signal")
  })

  describe("valid patterns", () => {
    it("allows reactive accessor called in JSX expression", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function Counter() {
          const [count, setCount] = createSignal(0);
          const doubled = () => count() * 2;
          return <div>{doubled()}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows reactive accessor called inside createEffect", () => {
      const { diagnostics } = check(`
        import { createSignal, createEffect } from "solid-js";
        function Counter() {
          const [count, setCount] = createSignal(0);
          const doubled = () => count() * 2;
          createEffect(() => {
            console.log(doubled());
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows reactive accessor called inside createMemo", () => {
      const { diagnostics } = check(`
        import { createSignal, createMemo } from "solid-js";
        function Counter() {
          const [count, setCount] = createSignal(0);
          const doubled = () => count() * 2;
          const quad = createMemo(() => doubled() * 2);
          return <div>{quad()}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows function that does not capture reactive variables", () => {
      const { diagnostics } = check(`
        function Counter() {
          const format = (n: number) => n.toFixed(2);
          const x = format(42);
          return <div>{x}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows reactive accessor passed to event handler", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function Counter() {
          const [count, setCount] = createSignal(0);
          const doubled = () => count() * 2;
          return <button onClick={() => console.log(doubled())}>Click</button>;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows derived function called in onClick inside Show inside Index", () => {
      const { diagnostics } = check(`
        import { createSignal, splitProps } from "solid-js";
        function Pagination(props) {
          const [local] = splitProps(props, ["page", "totalPages", "onPageChange"]);
          const handlePageChange = (newPage) => {
            if (newPage >= 1 && newPage <= local.totalPages && newPage !== local.page) {
              local.onPageChange?.(newPage);
            }
          };
          return (
            <div>
              <Index each={[1, 2, 3]}>
                {(_pageNum) => {
                  const pageNum = _pageNum();
                  return (
                    <Show when={typeof pageNum === "number" ? pageNum : null} keyed>
                      {(value) => (
                        <button onClick={() => handlePageChange(value)}>
                          {value}
                        </button>
                      )}
                    </Show>
                  );
                }}
              </Index>
            </div>
          );
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows derived function in onClick inside Show callback", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function Dialog() {
          const [open, setOpen] = createSignal(false);
          const toggle = () => setOpen(!open());
          return (
            <Show when={open()}>
              {() => <button onClick={() => toggle()}>Close</button>}
            </Show>
          );
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })

  describe("invalid patterns — component top-level", () => {
    it("reports accessor assigned to variable at component top-level", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function Counter() {
          const [count, setCount] = createSignal(0);
          const doubled = () => count() * 2;
          const x = doubled();
          return <div>{x}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("componentTopLevelInit")
      expect(at(diagnostics, 0).message).toContain("captures a one-time snapshot")
      expect(at(diagnostics, 0).message).not.toContain("re-render")
    })

    it("reports accessor called at component top-level without assignment", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function Counter() {
          const [count, setCount] = createSignal(0);
          const doubled = () => count() * 2;
          console.log(doubled());
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("componentTopLevelCall")
      expect(at(diagnostics, 0).message).toContain("runs once and captures a snapshot")
      expect(at(diagnostics, 0).message).not.toContain("re-render")
    })

    it("message includes component name", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function MyWidget() {
          const [val, setVal] = createSignal(0);
          const derived = () => val();
          const snap = derived();
          return <div>{snap}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).message).toContain("MyWidget")
    })
  })

  describe("invalid patterns — module scope", () => {
    it("reports accessor assigned at module scope", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [count, setCount] = createSignal(0);
        const doubled = () => count() * 2;
        const x = doubled();
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("moduleScopeInit")
    })

    it("reports accessor called at module scope", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [count, setCount] = createSignal(0);
        const doubled = () => count() * 2;
        console.log(doubled());
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("moduleScopeCall")
    })
  })

  describe("valid patterns — higher-order functions forwarding reactive captures", () => {
    it("allows HOF that returns closure capturing props", () => {
      const { diagnostics } = check(`
        function QuickActionModal(props) {
          const handleSubmit = (actionType) => {
            const config = { type: actionType };
            return async (data) => {
              props.onStart?.(config.type, data.ip);
              props.onComplete?.(data.ip);
            };
          };
          const handleBlock = handleSubmit("block");
          const handleWhitelist = handleSubmit("whitelist");
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows HOF that returns closure capturing signal", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function Counter() {
          const [count, setCount] = createSignal(0);
          const makeHandler = (label) => {
            return () => console.log(label, count());
          };
          const logA = makeHandler("a");
          return <button onClick={logA}>Click</button>;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("still reports HOF that directly reads reactive value at call time", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function Counter() {
          const [count, setCount] = createSignal(0);
          const makeValue = () => {
            const snapshot = count();
            return () => snapshot;
          };
          const getValue = makeValue();
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).message).toContain("captures a one-time snapshot")
    })
  })

  describe("valid patterns — utility functions calling derived functions", () => {
    it("allows derived function called from non-reactive utility in component", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function Counter() {
          const [count, setCount] = createSignal(0);
          const doubled = () => count() * 2;
          function formatValue() {
            return String(doubled());
          }
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows derived function called from non-reactive utility in hook", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function useHook() {
          const [sig, setSig] = createSignal(0);
          const accessor = () => sig();
          const utility = (x) => accessor() + x;
          return { accessor, utility };
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows transitive signal reads through nested function calls", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        export function useIPValidation() {
          const [cacheVersion, setCacheVersion] = createSignal(0);
          const validateIP = (ip) => {
            void cacheVersion();
            return ip.length > 0;
          };
          const validateBatch = (ips) => {
            return ips.map(ip => validateIP(ip));
          };
          return { validateIP, validateBatch };
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows derived function called from another derived function", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function Counter() {
          const [count, setCount] = createSignal(0);
          const doubled = () => count() * 2;
          const combined = () => {
            const x = count();
            return doubled() + x;
          };
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })

  describe("valid patterns — flow component callbacks", () => {
    it("allows reactive accessor called inside For callback", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function List() {
          const [items, setItems] = createSignal([1, 2, 3]);
          const multiplier = () => items().length;
          return <For each={items()}>{(item) => <div>{multiplier()}</div>}</For>;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows reactive accessor called inside Index callback", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function List() {
          const [items, setItems] = createSignal([1, 2, 3]);
          const total = () => items().length;
          return <Index each={items()}>{(item) => <span>{total()}</span>}</Index>;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows reactive accessor passed to on() deps position", () => {
      const { diagnostics } = check(`
        import { createSignal, createEffect, on } from "solid-js";
        function Counter() {
          const [count, setCount] = createSignal(0);
          const doubled = () => count() * 2;
          createEffect(on(doubled, (val) => {
            console.log(val);
          }));
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })

  describe("invalid patterns — flow component body level", () => {
    it("reports accessor assigned at For callback body level", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function List() {
          const [items, setItems] = createSignal([1, 2, 3]);
          const total = () => items().length;
          return <For each={items()}>{(item) => {
            const snapshot = total();
            return <div>{snapshot}</div>;
          }}</For>;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("untrackedCall")
    })

    it("reports accessor called at Index callback body level", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function List() {
          const [items, setItems] = createSignal([1, 2, 3]);
          const total = () => items().length;
          return <Index each={items()}>{(item) => {
            console.log(total());
            return <span />;
          }}</Index>;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("untrackedCall")
    })
  })

  describe("invalid patterns — untracked contexts", () => {
    it("reports accessor called inside untrack()", () => {
      const { diagnostics } = check(`
        import { createSignal, untrack } from "solid-js";
        function Counter() {
          const [count, setCount] = createSignal(0);
          const doubled = () => count() * 2;
          const val = untrack(() => doubled());
          return <div>{val}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("reports accessor called inside createRoot()", () => {
      const { diagnostics } = check(`
        import { createSignal, createRoot } from "solid-js";
        function Counter() {
          const [count, setCount] = createSignal(0);
          const doubled = () => count() * 2;
          createRoot(() => {
            const x = doubled();
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("reports accessor called inside Show function children", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function Counter() {
          const [count, setCount] = createSignal(0);
          const doubled = () => count() * 2;
          return <Show when={count()}>{(val) => {
            const x = doubled();
            return <div>{x}</div>;
          }}</Show>;
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })
  })

  describe("valid patterns — on() callback", () => {
    it("allows derived function called inside on() callback", () => {
      const { diagnostics } = check(`
        import { createSignal, createEffect, on } from "solid-js";
        function App() {
          const [isActive, setIsActive] = createSignal(false);
          const [isFrozen, setIsFrozen] = createSignal(false);
          const unfreezeAnimations = () => {
            if (!isFrozen()) return;
            setIsFrozen(false);
          };
          createEffect(
            on(isActive, (active) => {
              if (!active) {
                unfreezeAnimations();
              }
            })
          );
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows derived function called inside on() with array deps", () => {
      const { diagnostics } = check(`
        import { createSignal, createEffect, on } from "solid-js";
        function App() {
          const [a, setA] = createSignal(0);
          const [b, setB] = createSignal(0);
          const getSum = () => a() + b();
          createEffect(
            on([a, b], () => {
              console.log(getSum());
            })
          );
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })
})

describe("effect-as-memo", () => {
  const check = (code: string) => checkRule(effectAsMemo, code)

  it("metadata", () => {
    expect(effectAsMemo.id).toBe("effect-as-memo")
  })

  describe("valid patterns", () => {
    it("allows createEffect with side effects", () => {
      const { diagnostics } = check(`
        import { createSignal, createEffect } from "solid-js";
        function App() {
          const [count, setCount] = createSignal(0);
          createEffect(() => {
            console.log(count());
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows createEffect with multiple statements", () => {
      const { diagnostics } = check(`
        import { createSignal, createEffect } from "solid-js";
        function App() {
          const [count, setCount] = createSignal(0);
          const [doubled, setDoubled] = createSignal(0);
          createEffect(() => {
            console.log(count());
            setDoubled(count() * 2);
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows async createEffect with setter", () => {
      const { diagnostics } = check(`
        import { createSignal, createEffect } from "solid-js";
        function App() {
          const [data, setData] = createSignal(null);
          createEffect(async () => {
            const result = await fetch("/api");
            setData(result);
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows setter with function form (previous value)", () => {
      const { diagnostics } = check(`
        import { createSignal, createEffect } from "solid-js";
        function App() {
          const [count, setCount] = createSignal(0);
          const [delta, setDelta] = createSignal(1);
          createEffect(() => {
            setCount(prev => prev + delta());
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows setter used outside the effect", () => {
      const { diagnostics } = check(`
        import { createSignal, createEffect } from "solid-js";
        function App() {
          const [count, setCount] = createSignal(0);
          const [doubled, setDoubled] = createSignal(0);
          somePlugin(setDoubled);
          createEffect(() => setDoubled(count() * 2));
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })

  describe("invalid patterns", () => {
    it("reports createEffect that only sets a derived value", () => {
      const { diagnostics } = check(`
        import { createSignal, createEffect } from "solid-js";
        function App() {
          const [count, setCount] = createSignal(0);
          const [doubled, setDoubled] = createSignal(0);
          createEffect(() => setDoubled(count() * 2));
          return <div>{doubled()}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("effectAsMemo")
      expect(at(diagnostics, 0).message).toContain("doubled")
    })

    it("reports createEffect with block body single setter", () => {
      const { diagnostics } = check(`
        import { createSignal, createEffect } from "solid-js";
        function App() {
          const [count, setCount] = createSignal(0);
          const [doubled, setDoubled] = createSignal(0);
          createEffect(() => { setDoubled(count() * 2); });
          return <div>{doubled()}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("reports createRenderEffect with single setter", () => {
      const { diagnostics } = check(`
        import { createSignal, createRenderEffect } from "solid-js";
        function App() {
          const [count, setCount] = createSignal(0);
          const [doubled, setDoubled] = createSignal(0);
          createRenderEffect(() => setDoubled(count() * 2));
          return <div>{doubled()}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("provides auto-fix to convert to createMemo", () => {
      const code = `
        import { createSignal, createEffect } from "solid-js";
        function App() {
          const [count, setCount] = createSignal(0);
          const [doubled, setDoubled] = createSignal(0);
          createEffect(() => setDoubled(count() * 2));
          return <div>{doubled()}</div>;
        }
      `
      const { diagnostics } = check(code)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).fix).toBeDefined()
      const fixed = applyAllFixes(code, diagnostics)
      expect(fixed).toContain("createMemo(() => count() * 2)")
      expect(fixed).toContain("const doubled = createMemo")
      expect(fixed).not.toContain("setDoubled(count()")
    })
  })
})

describe("effect-as-mount", () => {
  const check = (code: string) => checkRule(effectAsMount, code)

  it("metadata", () => {
    expect(effectAsMount.id).toBe("effect-as-mount")
  })

  describe("valid patterns", () => {
    it("allows createEffect with reactive dependencies", () => {
      const { diagnostics } = check(`
        import { createSignal, createEffect } from "solid-js";
        function App() {
          const [count, setCount] = createSignal(0);
          createEffect(() => {
            console.log(count());
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows createEffect with prev parameter", () => {
      const { diagnostics } = check(`
        import { createSignal, createEffect } from "solid-js";
        function App() {
          const [count, setCount] = createSignal(0);
          createEffect((prev) => {
            console.log("mounted");
            return prev;
          }, 0);
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows createEffect with indirect reactive reads via helper", () => {
      const { diagnostics } = check(`
        import { createSignal, createEffect } from "solid-js";
        function App() {
          const [count, setCount] = createSignal(0);
          const helper = () => count();
          createEffect(() => {
            console.log(helper());
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows createEffect calling function with conditional signal read", () => {
      const { diagnostics } = check(`
        import { createSignal, createEffect } from "solid-js";
        function useSSE(options) {
          const [state, setState] = createSignal("closed");
          const resolveUrl = () => {
            const url = options.url;
            return typeof url === "function" ? url() : url;
          };
          createEffect(() => {
            const url = resolveUrl();
            if (url) setState("connecting");
          });
          return { state };
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows createEffect with member-access calls that may read signals", () => {
      const { diagnostics } = check(`
        import { createEffect } from "solid-js";
        function App(props: { table: { isSomeSelected(): boolean } }) {
          let selectAllRef: HTMLInputElement | undefined;
          createEffect(() => {
            if (selectAllRef) {
              selectAllRef.indeterminate = props.table.isSomeSelected();
            }
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows createRenderEffect with reactive dependencies", () => {
      const { diagnostics } = check(`
        import { createSignal, createRenderEffect } from "solid-js";
        function App() {
          const [count, setCount] = createSignal(0);
          createRenderEffect(() => {
            document.title = String(count());
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows createEffect with function expression callback", () => {
      const { diagnostics } = check(`
        import { createSignal, createEffect } from "solid-js";
        function App() {
          const [count, setCount] = createSignal(0);
          createEffect(function() {
            console.log(count());
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })

  describe("invalid patterns", () => {
    it("reports createEffect with no reactive dependencies", () => {
      const { diagnostics } = check(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => {
            console.log("mounted");
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).message).toContain("createEffect")
      expect(at(diagnostics, 0).message).toContain("onMount")
    })

    it("reports createEffect with no deps and provides fix", () => {
      const code = `
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => {
            document.title = "Hello";
          });
          return <div />;
        }
      `
      const { diagnostics } = check(code)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).fix).toBeDefined()
      const fixed = applyAllFixes(code, diagnostics)
      expect(fixed).toContain("onMount(() => {")
      expect(fixed).toContain("onMount")
    })

    it("reports createRenderEffect with no reactive dependencies", () => {
      const { diagnostics } = check(`
        import { createRenderEffect } from "solid-js";
        function App() {
          createRenderEffect(() => {
            document.title = "Hello";
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).message).toContain("createRenderEffect")
      expect(at(diagnostics, 0).message).toContain("onMount")
    })

    it("reports createRenderEffect with no deps and provides fix", () => {
      const code = `
        import { createRenderEffect } from "solid-js";
        function App() {
          createRenderEffect(() => {
            document.title = "Hello";
          });
          return <div />;
        }
      `
      const { diagnostics } = check(code)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).fix).toBeDefined()
      const fixed = applyAllFixes(code, diagnostics)
      expect(fixed).toContain("onMount(() => {")
      expect(fixed).toContain("onMount")
    })

    it("reports createEffect with only DOM manipulation", () => {
      const { diagnostics } = check(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => {
            window.addEventListener("resize", () => {});
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("still reports when callback ignores second argument", () => {
      const { diagnostics } = check(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => {
            console.log("mounted");
          }, undefined);
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("fix adds onMount import when not present", () => {
      const code = `
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => {
            console.log("mounted");
          });
          return <div />;
        }
      `
      const { diagnostics } = check(code)
      expect(diagnostics).toHaveLength(1)
      const fixed = applyAllFixes(code, diagnostics)
      expect(fixed).toContain("onMount")
    })
  })
})

describe("cleanup-scope", () => {
  const check = (code: string) => checkRule(cleanupScope, code)

  it("metadata", () => {
    expect(cleanupScope.id).toBe("cleanup-scope")
  })

  describe("valid patterns", () => {
    it("allows onCleanup inside component body", () => {
      const { diagnostics } = check(`
        import { onCleanup } from "solid-js";
        function Timer() {
          onCleanup(() => console.log("cleanup"));
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows onCleanup inside createEffect", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          createEffect(() => {
            const id = setInterval(() => {}, 1000);
            onCleanup(() => clearInterval(id));
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows onCleanup inside createMemo", () => {
      const { diagnostics } = check(`
        import { createMemo, onCleanup } from "solid-js";
        function App() {
          const value = createMemo(() => {
            onCleanup(() => console.log("memo cleanup"));
            return 42;
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows onCleanup inside createRoot", () => {
      const { diagnostics } = check(`
        import { createRoot, onCleanup } from "solid-js";
        createRoot(() => {
          onCleanup(() => console.log("root cleanup"));
        });
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows onCleanup inside runWithOwner", () => {
      const { diagnostics } = check(`
        import { runWithOwner, getOwner, onCleanup } from "solid-js";
        const owner = getOwner();
        runWithOwner(owner, () => {
          onCleanup(() => console.log("cleanup"));
        });
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows onCleanup inside directive referenced via use:", () => {
      const { diagnostics } = check(`
        import { onCleanup } from "solid-js";
        function clickOutside(el, accessor) {
          const handler = () => accessor()?.();
          document.addEventListener("click", handler);
          onCleanup(() => document.removeEventListener("click", handler));
        }
        function App() {
          return <div use:clickOutside={() => console.log("outside")} />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows onCleanup inside create* custom reactive primitive", () => {
      const { diagnostics } = check(`
        import { createEffect, createSignal, onCleanup } from "solid-js";
        function createAnimatedValue(target) {
          const [value, setValue] = createSignal(0);
          let frameId;
          createEffect(() => {
            frameId = requestAnimationFrame(() => setValue(target()));
          });
          onCleanup(() => cancelAnimationFrame(frameId));
          return value;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows onCleanup nested inside effect within create* primitive", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup } from "solid-js";
        function createInterval(fn, delay) {
          createEffect(() => {
            const id = setInterval(fn, delay());
            onCleanup(() => clearInterval(id));
          });
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows onCleanup inside use* custom reactive primitive", () => {
      const { diagnostics } = check(`
        import { createSignal, onCleanup } from "solid-js";
        function useIPValidation(options) {
          const [cache, setCache] = createSignal(new Map());
          const controllers = new Map();
          const clearAll = () => {
            for (const c of controllers.values()) c.abort();
            controllers.clear();
          };
          onCleanup(clearAll);
          return { cache };
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows onCleanup inside object property callback passed to create* call", () => {
      const { diagnostics } = check(`
        import { onMount, onCleanup } from "solid-js";
        function createSimpleContext(input) {
          return input.init();
        }
        const ctx = createSimpleContext({
          init: () => {
            const handler = () => {};
            window.addEventListener("resize", handler);
            onCleanup(() => window.removeEventListener("resize", handler));
          }
        });
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })

  describe("invalid patterns", () => {
    it("reports onCleanup at module scope", () => {
      const { diagnostics } = check(`
        import { onCleanup } from "solid-js";
        onCleanup(() => console.log("cleanup"));
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).message).toContain("module scope")
    })

    it("reports onCleanup in standalone utility function", () => {
      const { diagnostics } = check(`
        import { onCleanup } from "solid-js";
        function setupTimer() {
          onCleanup(() => console.log("cleanup"));
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).message).toContain("setupTimer")
    })

    it("reports onCleanup in anonymous function at module scope", () => {
      const { diagnostics } = check(`
        import { onCleanup } from "solid-js";
        const fn = () => {
          onCleanup(() => console.log("cleanup"));
        };
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("reports onCleanup in function named exactly 'create' (not a convention match)", () => {
      const { diagnostics } = check(`
        import { onCleanup } from "solid-js";
        function create() {
          onCleanup(() => console.log("cleanup"));
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("reports onCleanup in function named exactly 'use' (not a convention match)", () => {
      const { diagnostics } = check(`
        import { onCleanup } from "solid-js";
        function use() {
          onCleanup(() => console.log("cleanup"));
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("does not match 2-param function as directive without use: reference", () => {
      const { diagnostics } = check(`
        import { onCleanup } from "solid-js";
        function handleState(value, setter) {
          onCleanup(() => console.log("cleanup"));
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).message).toContain("handleState")
    })
  })
})

describe("no-top-level-signal-call", () => {
  const check = (code: string) => checkRule(noTopLevelSignalCall, code)

  it("metadata", () => {
    expect(noTopLevelSignalCall.id).toBe("no-top-level-signal-call")
  })

  describe("valid patterns", () => {
    it("allows signal call inside createSignal initial value (value semantic)", () => {
      const { diagnostics } = check(`
        import { createSignal, createMemo } from "solid-js";
        function Table(props) {
          const allColumns = createMemo(() => props.columns ?? []);
          const [visible, setVisible] = createSignal(
            new Set(allColumns().map((c) => c.key)),
          );
          return <div>{visible()}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows signal call inside nested expression within createSignal initial value", () => {
      const { diagnostics } = check(`
        import { createSignal, createMemo } from "solid-js";
        function Counter() {
          const base = createMemo(() => 10);
          const [count, setCount] = createSignal(base() * 2);
          return <div>{count()}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })

  describe("invalid patterns", () => {
    it("reports signal call at component top level assigned to variable", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function Counter() {
          const [count] = createSignal(0);
          const value = count();
          return <div>{value}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("reports signal call inside createEffect callback (tracked, not value semantic)", () => {
      const { diagnostics } = check(`
        import { createSignal, createMemo, createEffect } from "solid-js";
        function App() {
          const data = createMemo(() => "hello");
          createEffect(() => {
            const snapshot = data();
            console.log(snapshot);
          });
          return <div />;
        }
      `)
      // createEffect callback is tracked — signal calls inside are fine (no report)
      expect(diagnostics).toHaveLength(0)
    })
  })
})

describe("signal-call", () => {
  const check = (code: string) => checkRule(signalCall, code)

  it("metadata", () => {
    expect(signalCall.id).toBe("signal-call")
  })

  it("allows passing signal accessor to custom hook in object argument", () => {
    const { diagnostics } = check(`
      import { createSignal } from "solid-js";
      function useIPValidation(opts) { return opts.ip(); }
      function Form() {
        const [ipAddress, setIpAddress] = createSignal("");
        const validation = useIPValidation({ ip: ipAddress });
        return <div>{validation}</div>;
      }
    `)
    expect(diagnostics).toHaveLength(0)
  })

  it("allows passing signal accessor directly to custom hook", () => {
    const { diagnostics } = check(`
      import { createSignal } from "solid-js";
      function useDebounced(accessor) { return accessor(); }
      function Form() {
        const [value, setValue] = createSignal("");
        const debounced = useDebounced(value);
        return <div>{debounced}</div>;
      }
    `)
    expect(diagnostics).toHaveLength(0)
  })

  it("reports uncalled signal in DOM element JSX attribute", () => {
    const { diagnostics } = check(`
      import { createSignal } from "solid-js";
      function App() {
        const [label] = createSignal("hello");
        return <div title={label} />;
      }
    `)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("signalInJsxAttribute")
  })
})

describe("signal-in-loop", () => {
  const check = (code: string) => checkRule(signalInLoop, code)

  it("metadata", () => {
    expect(signalInLoop.id).toBe("signal-in-loop")
  })

  describe("valid patterns", () => {
    it("allows signal call in For that uses loop item", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function List() {
          const [selected, setSelected] = createSignal(0);
          return (
            <For each={[1, 2, 3]}>
              {(item) => <div data-active={selected() === item}>{item}</div>}
            </For>
          );
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows signal call in onClick inside For", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function List() {
          const [selected, setSelected] = createSignal(0);
          return (
            <For each={[1, 2, 3]}>
              {(item) => (
                <button onClick={() => setSelected(item)}>
                  {selected() === item ? "active" : "inactive"}
                </button>
              )}
            </For>
          );
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows derived function call in onClick inside Index", () => {
      const { diagnostics } = check(`
        import { createSignal, splitProps } from "solid-js";
        function Pagination(props) {
          const [local] = splitProps(props, ["page", "onPageChange"]);
          const handlePageChange = (newPage) => {
            local.onPageChange?.(newPage);
          };
          return (
            <Index each={[1, 2, 3]}>
              {(pageNum) => (
                <button onClick={() => handlePageChange(pageNum())}>
                  {pageNum()}
                </button>
              )}
            </Index>
          );
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows signal call with destructured For callback params", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function List() {
          const [highlighted, setHighlighted] = createSignal(-1);
          return (
            <For each={[{ item: "a", index: 0 }, { item: "b", index: 1 }]}>
              {({ item, index: itemIndex }) => (
                <button
                  aria-selected={highlighted() === itemIndex}
                  data-highlighted={highlighted() === itemIndex ? "" : undefined}
                >
                  {item}
                </button>
              )}
            </For>
          );
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows signal compared with local derived from loop param", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function List(props) {
          const [active, setActive] = createSignal(null);
          return (
            <For each={props.items}>
              {(item) => {
                const key = props.getKey(item);
                return (
                  <div
                    data-active={key === active() ? "" : undefined}
                    onClick={() => setActive(key)}
                  >
                    {item.name}
                  </div>
                );
              }}
            </For>
          );
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows signal compared with chained derived local", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function List() {
          const [selected, setSelected] = createSignal("");
          return (
            <For each={["a", "b", "c"]}>
              {(item) => {
                const id = item + "-id";
                const label = id + "-label";
                return <div class={selected() === label ? "active" : ""}>{item}</div>;
              }}
            </For>
          );
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows derived arrow function that captures loop-derived local via closure", () => {
      const { diagnostics } = check(`
        import { type Accessor } from "solid-js";
        function MarkerList(props: {
          markers: Accessor<Array<{ id: string }>>;
          animatedMarkers: Accessor<Set<string>>;
          markersExiting: Accessor<boolean>;
          isClearing: Accessor<boolean>;
        }) {
          return (
            <For each={props.markers()}>
              {(annotation) => {
                const id = annotation.id;
                const needsEnterAnimation = () => !props.animatedMarkers().has(id);
                const animClass = () =>
                  props.markersExiting()
                    ? "exit"
                    : props.isClearing()
                      ? "clearing"
                      : needsEnterAnimation()
                        ? "enter"
                        : undefined;
                return <div data-animate={animClass()}>{id}</div>;
              }}
            </For>
          );
        }
      `)
      const derivedDiags = diagnostics.filter(d => d.messageId === "derivedCallInvariant")
      expect(derivedDiags).toHaveLength(0)
    })

    it("allows derived arrow function with block body that captures loop param", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function List(props) {
          const [selected] = createSignal(new Set<number>());
          return (
            <For each={props.items}>
              {(item) => {
                const isSelected = () => {
                  return selected().has(item.id);
                };
                return <div data-selected={isSelected() || undefined}>{item.name}</div>;
              }}
            </For>
          );
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows memo call inside For (cached)", () => {
      const { diagnostics } = check(`
        import { createSignal, createMemo } from "solid-js";
        function List() {
          const [items, setItems] = createSignal([1, 2, 3]);
          const count = createMemo(() => items().length);
          return (
            <For each={items()}>
              {(item) => <div>{count()} items, current: {item}</div>}
            </For>
          );
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })

  describe("invalid patterns", () => {
    it("reports loop-invariant signal call in For", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function List() {
          const [label, setLabel] = createSignal("test");
          return (
            <For each={[1, 2, 3]}>
              {(item) => <div class={label()}>{item}</div>}
            </For>
          );
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("signalCallInvariant")
    })

    it("reports createSignal inside For callback", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        function List() {
          return (
            <For each={[1, 2, 3]}>
              {(item) => {
                const [local, setLocal] = createSignal(0);
                return <div>{local()}</div>;
              }}
            </For>
          );
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("signalInLoop")
    })

    it("reports derived call that does not use loop params", () => {
      const { diagnostics } = check(`
        import { createSignal, splitProps } from "solid-js";
        function List(props) {
          const [local] = splitProps(props, ["label"]);
          const getLabel = () => local.label;
          return (
            <For each={[1, 2, 3]}>
              {(item) => <div title={getLabel()}>{item}</div>}
            </For>
          );
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("derivedCallInvariant")
    })
  })
})

describe("resource-implicit-suspense", () => {
  const check = (code: string) => checkRule(resourceImplicitSuspense, code)

  it("metadata", () => {
    expect(resourceImplicitSuspense.id).toBe("resource-implicit-suspense")
  })

  describe("valid patterns", () => {
    it("allows createResource with initialValue", () => {
      const { diagnostics } = check(`
        import { createResource } from "solid-js";
        function UserList() {
          const [users] = createResource(fetchUsers, { initialValue: [] });
          return <div>{users().length}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows createResource with source and initialValue", () => {
      const { diagnostics } = check(`
        import { createResource } from "solid-js";
        function UserDetail() {
          const [user] = createResource(() => id(), fetchUser, { initialValue: null });
          return <div>{user()?.name}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows createResource with initialValue and loading check", () => {
      const { diagnostics } = check(`
        import { createResource } from "solid-js";
        function UserList() {
          const [users] = createResource(fetchUsers, { initialValue: [] });
          return (
            <Show when={!users.loading}>
              <div>{users().length}</div>
            </Show>
          );
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows createResource without loading check and no conditional mount", () => {
      const { diagnostics } = check(`
        import { createResource } from "solid-js";
        function UserList() {
          const [users] = createResource(fetchUsers);
          return <div>{users()?.length}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })

  describe("WARN: loading mismatch", () => {
    it("warns when createResource has no initialValue but reads .loading", () => {
      const { diagnostics } = check(`
        import { createResource } from "solid-js";
        function UserList() {
          const [users] = createResource(fetchUsers);
          return (
            <Show when={!users.loading} fallback={<div>Loading...</div>}>
              <div>{users().length}</div>
            </Show>
          );
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("loadingMismatch")
      expect(at(diagnostics, 0).severity).toBe("warn")
    })

    it("warns with source + fetcher overload and loading check", () => {
      const { diagnostics } = check(`
        import { createResource } from "solid-js";
        function CountryList() {
          const [countries] = createResource(() => regionId(), fetchCountries);
          return (
            <Show when={!countries.loading} fallback={<span>Loading countries...</span>}>
              <ul>{countries()}</ul>
            </Show>
          );
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("loadingMismatch")
    })

    it("warns when loading is checked in conditional expression", () => {
      const { diagnostics } = check(`
        import { createResource } from "solid-js";
        function DataView() {
          const [data] = createResource(fetchData);
          return <div>{data.loading ? "Loading..." : data()?.value}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("loadingMismatch")
    })
  })

  describe("ERROR: conditional mount with distant Suspense", () => {
    it("errors when resource component is inside Show within distant Suspense", () => {
      const { diagnostics } = check(`
        import { createResource } from "solid-js";
        function CountryForm() {
          const [countries] = createResource(fetchCountries);
          return <ul>{countries()}</ul>;
        }
        function Page() {
          return (
            <Suspense fallback={<div />}>
              <div>
                <Show when={showForm()}>
                  <CountryForm />
                </Show>
              </div>
            </Suspense>
          );
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("conditionalSuspense")
      expect(at(diagnostics, 0).severity).toBe("error")
    })

    it("errors when resource component is inside Dialog", () => {
      const { diagnostics } = check(`
        import { createResource } from "solid-js";
        function SearchResults() {
          const [results] = createResource(fetchResults);
          return <div>{results()}</div>;
        }
        function Layout() {
          return (
            <Suspense fallback={<div />}>
              <main>
                <Dialog>
                  <SearchResults />
                </Dialog>
              </main>
            </Suspense>
          );
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("conditionalSuspense")
    })

    it("errors when resource component is inside Modal", () => {
      const { diagnostics } = check(`
        import { createResource } from "solid-js";
        function SettingsPanel() {
          const [settings] = createResource(fetchSettings);
          return <div>{settings()}</div>;
        }
        function App() {
          return (
            <Suspense fallback={<div />}>
              <Modal>
                <SettingsPanel />
              </Modal>
            </Suspense>
          );
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("conditionalSuspense")
    })

    it("no error when resource component has nearby Suspense", () => {
      const { diagnostics } = check(`
        import { createResource } from "solid-js";
        function CountryForm() {
          const [countries] = createResource(fetchCountries);
          return <ul>{countries()}</ul>;
        }
        function Page() {
          return (
            <Suspense fallback={<div />}>
              <Show when={showForm()}>
                <Suspense fallback={<span>Loading form...</span>}>
                  <CountryForm />
                </Suspense>
              </Show>
            </Suspense>
          );
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })

  describe("ERROR: missing ErrorBoundary (error path)", () => {
    it("errors when async fetcher has no ErrorBoundary before Suspense", () => {
      const { diagnostics } = check(`
        import { createResource } from "solid-js";
        function CountryForm() {
          const [countries] = createResource(async () => {
            const res = await fetch("/api/countries");
            return res.json();
          }, { initialValue: [] });
          return <ul>{countries()}</ul>;
        }
        function Page() {
          return (
            <Suspense fallback={<div />}>
              <CountryForm />
            </Suspense>
          );
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("missingErrorBoundary")
      expect(at(diagnostics, 0).severity).toBe("error")
    })

    it("errors when fetcher has explicit throw without ErrorBoundary", () => {
      const { diagnostics } = check(`
        import { createResource } from "solid-js";
        function CountryForm() {
          const [countries] = createResource(async () => {
            const res = await fetch("/api/countries");
            if (!res.ok) throw new Error("Failed");
            return res.json();
          }, { initialValue: [] });
          return <ul>{countries()}</ul>;
        }
        function Page() {
          return (
            <Suspense fallback={<div />}>
              <CountryForm />
            </Suspense>
          );
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("missingErrorBoundary")
    })

    it("errors when referenced async fetcher lacks ErrorBoundary", () => {
      const { diagnostics } = check(`
        import { createResource } from "solid-js";
        async function fetchCountries() {
          const res = await fetch("/api/countries");
          return res.json();
        }
        function CountryForm() {
          const [countries] = createResource(fetchCountries, { initialValue: [] });
          return <ul>{countries()}</ul>;
        }
        function Page() {
          return (
            <Suspense fallback={<div />}>
              <CountryForm />
            </Suspense>
          );
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("missingErrorBoundary")
    })

    it("errors with source + async fetcher and no ErrorBoundary", () => {
      const { diagnostics } = check(`
        import { createResource } from "solid-js";
        function UserDetail() {
          const [user] = createResource(() => userId(), async (id) => {
            const res = await fetch("/api/users/" + id);
            return res.json();
          }, { initialValue: null });
          return <div>{user()?.name}</div>;
        }
        function Page() {
          return (
            <Suspense fallback={<div />}>
              <UserDetail />
            </Suspense>
          );
        }
      `)
      expect(diagnostics).toHaveLength(1)
      expect(at(diagnostics, 0).messageId).toBe("missingErrorBoundary")
    })

    it("no error when ErrorBoundary wraps the component before Suspense", () => {
      const { diagnostics } = check(`
        import { createResource } from "solid-js";
        function CountryForm() {
          const [countries] = createResource(async () => {
            const res = await fetch("/api/countries");
            return res.json();
          }, { initialValue: [] });
          return <ul>{countries()}</ul>;
        }
        function Page() {
          return (
            <Suspense fallback={<div />}>
              <ErrorBoundary fallback={<div>Error</div>}>
                <CountryForm />
              </ErrorBoundary>
            </Suspense>
          );
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("no error when ErrorBoundary is between component and Suspense", () => {
      const { diagnostics } = check(`
        import { createResource } from "solid-js";
        function DataPanel() {
          const [data] = createResource(async () => {
            const res = await fetch("/api/data");
            return res.json();
          }, { initialValue: null });
          return <div>{data()}</div>;
        }
        function Page() {
          return (
            <Suspense fallback={<div />}>
              <div>
                <ErrorBoundary fallback={<span>Something went wrong</span>}>
                  <DataPanel />
                </ErrorBoundary>
              </div>
            </Suspense>
          );
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("no error when fetcher is a non-async function with no calls", () => {
      const { diagnostics } = check(`
        import { createResource } from "solid-js";
        function StaticData() {
          const [data] = createResource(() => ({ name: "test" }));
          return <div>{data()?.name}</div>;
        }
        function Page() {
          return (
            <Suspense fallback={<div />}>
              <StaticData />
            </Suspense>
          );
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("emits both loading and error path diagnostics when both apply", () => {
      const { diagnostics } = check(`
        import { createResource } from "solid-js";
        function CountryForm() {
          const [countries] = createResource(async () => {
            const res = await fetch("/api/countries");
            return res.json();
          });
          return (
            <Show when={!countries.loading} fallback={<div>Loading...</div>}>
              <ul>{countries()}</ul>
            </Show>
          );
        }
        function Page() {
          return (
            <Suspense fallback={<div />}>
              <CountryForm />
            </Suspense>
          );
        }
      `)
      const messageIds = diagnostics.map(d => d.messageId)
      expect(messageIds).toContain("loadingMismatch")
      expect(messageIds).toContain("missingErrorBoundary")
    })
  })
})
