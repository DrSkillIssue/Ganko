/**
 * Solid Rules Tests
 */

import { describe, it, expect } from "vitest"
import { checkRule, applyAllFixes, at } from "../test-utils"
import {
  batchOptimization,
  preferFor,
  preferMemoComplexStyles,
  preferShow,
  selfClosingComp,
  styleProp,
} from "../../../src/solid/rules/solid"

describe("batch-optimization", () => {
  const check = (code: string) => checkRule(batchOptimization, code)

  it("metadata", () => {
    expect(batchOptimization.id).toBe("batch-optimization")
    expect(batchOptimization.meta.fixable).toBe(true)
  })

  it("does not report when there are no signals", () => {
    const { diagnostics } = check(`
      function test() {
        console.log("hello");
      }
    `)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not report when only one setter is called", () => {
    const { diagnostics } = check(`
      import { createSignal } from "solid-js";
      function Form() {
        const [name, setName] = createSignal("");
        const handleSubmit = () => {
          setName("test");
        };
        return null;
      }
    `)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not report when only two setters are called", () => {
    const { diagnostics } = check(`
      import { createSignal } from "solid-js";
      function Form() {
        const [name, setName] = createSignal("");
        const [email, setEmail] = createSignal("");
        const handleSubmit = () => {
          setName("test");
          setEmail("test@example.com");
        };
        return null;
      }
    `)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not report when setters are already in batch", () => {
    const { diagnostics } = check(`
      import { createSignal, batch } from "solid-js";
      function Form() {
        const [name, setName] = createSignal("");
        const [email, setEmail] = createSignal("");
        const [age, setAge] = createSignal(0);
        const handleSubmit = () => {
          batch(() => {
            setName("test");
            setEmail("test@example.com");
            setAge(25);
          });
        };
        return null;
      }
    `)
    expect(diagnostics).toHaveLength(0)
  })

  it("reports when 3+ consecutive setters are called without batch", () => {
    const { diagnostics } = check(`
      import { createSignal } from "solid-js";
      function Form() {
        const [name, setName] = createSignal("");
        const [email, setEmail] = createSignal("");
        const [age, setAge] = createSignal(0);
        const handleSubmit = () => {
          setName("test");
          setEmail("test@example.com");
          setAge(25);
        };
        return null;
      }
    `)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("multipleSetters")
  })

  it("does not report non-consecutive setters", () => {
    const { diagnostics } = check(`
      import { createSignal } from "solid-js";
      function Form() {
        const [name, setName] = createSignal("");
        const [email, setEmail] = createSignal("");
        const [age, setAge] = createSignal(0);
        const handleSubmit = () => {
          setName("test");
          console.log("processing...");
          setEmail("test@example.com");
          console.log("more processing...");
          setAge(25);
        };
        return null;
      }
    `)
    expect(diagnostics).toHaveLength(0)
  })

  it("suppresses inside createEffect synchronous body", () => {
    const { diagnostics } = check(`
      import { createSignal, createEffect } from "solid-js";
      function App() {
        const [a, setA] = createSignal(0);
        const [b, setB] = createSignal(0);
        const [c, setC] = createSignal(0);
        createEffect(() => {
          setA(1);
          setB(2);
          setC(3);
        });
        return null;
      }
    `)
    expect(diagnostics).toHaveLength(0)
  })

  it("suppresses inside onMount", () => {
    const { diagnostics } = check(`
      import { createSignal, onMount } from "solid-js";
      function App() {
        const [a, setA] = createSignal(0);
        const [b, setB] = createSignal(0);
        const [c, setC] = createSignal(0);
        onMount(() => {
          setA(1);
          setB(2);
          setC(3);
        });
        return null;
      }
    `)
    expect(diagnostics).toHaveLength(0)
  })

  it("suppresses inside createComputed", () => {
    const { diagnostics } = check(`
      import { createSignal, createComputed } from "solid-js";
      function App() {
        const [a, setA] = createSignal(0);
        const [b, setB] = createSignal(0);
        const [c, setC] = createSignal(0);
        createComputed(() => {
          setA(1);
          setB(2);
          setC(3);
        });
        return null;
      }
    `)
    expect(diagnostics).toHaveLength(0)
  })

  it("suppresses inside createRenderEffect", () => {
    const { diagnostics } = check(`
      import { createSignal, createRenderEffect } from "solid-js";
      function App() {
        const [a, setA] = createSignal(0);
        const [b, setB] = createSignal(0);
        const [c, setC] = createSignal(0);
        createRenderEffect(() => {
          setA(1);
          setB(2);
          setC(3);
        });
        return null;
      }
    `)
    expect(diagnostics).toHaveLength(0)
  })

  it("suppresses inside createEffect with on() wrapper", () => {
    const { diagnostics } = check(`
      import { createSignal, createEffect, on } from "solid-js";
      function App() {
        const [a, setA] = createSignal(0);
        const [b, setB] = createSignal(0);
        const [c, setC] = createSignal(0);
        const [trigger] = createSignal(0);
        createEffect(on(trigger, () => {
          setA(1);
          setB(2);
          setC(3);
        }));
        return null;
      }
    `)
    expect(diagnostics).toHaveLength(0)
  })

  it("suppresses before await in async effect", () => {
    const { diagnostics } = check(`
      import { createSignal, createEffect, on } from "solid-js";
      function App() {
        const [a, setA] = createSignal(0);
        const [b, setB] = createSignal(0);
        const [c, setC] = createSignal(0);
        const [trigger] = createSignal(0);
        createEffect(on(trigger, async () => {
          setA(1);
          setB(2);
          setC(3);
          const result = await fetch("/api");
        }));
        return null;
      }
    `)
    expect(diagnostics).toHaveLength(0)
  })

  it("reports after await in async effect", () => {
    const { diagnostics } = check(`
      import { createSignal, createEffect, on } from "solid-js";
      function App() {
        const [a, setA] = createSignal(0);
        const [b, setB] = createSignal(0);
        const [c, setC] = createSignal(0);
        const [trigger] = createSignal(0);
        createEffect(on(trigger, async () => {
          const result = await fetch("/api");
          setA(1);
          setB(2);
          setC(3);
        }));
        return null;
      }
    `)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("multipleSetters")
  })

  it("suppresses before + reports after await in same async effect", () => {
    const { diagnostics } = check(`
      import { createSignal, createEffect, on } from "solid-js";
      function App() {
        const [loading, setLoading] = createSignal(false);
        const [error, setError] = createSignal(null);
        const [data, setData] = createSignal(null);
        const [trigger] = createSignal(0);
        createEffect(on(trigger, async () => {
          setLoading(true);
          setError(null);
          setData(null);
          const result = await fetch("/api");
          setData(result);
          setLoading(false);
          setError(null);
        }));
        return null;
      }
    `)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("multipleSetters")
  })

  it("reports in setTimeout inside effect", () => {
    const { diagnostics } = check(`
      import { createSignal, createEffect } from "solid-js";
      function App() {
        const [a, setA] = createSignal(0);
        const [b, setB] = createSignal(0);
        const [c, setC] = createSignal(0);
        createEffect(() => {
          setTimeout(() => {
            setA(1);
            setB(2);
            setC(3);
          }, 100);
        });
        return null;
      }
    `)
    expect(diagnostics).toHaveLength(1)
  })

  it("reports in .then() inside effect", () => {
    const { diagnostics } = check(`
      import { createSignal, createEffect } from "solid-js";
      function App() {
        const [a, setA] = createSignal(0);
        const [b, setB] = createSignal(0);
        const [c, setC] = createSignal(0);
        createEffect(() => {
          fetch("/api").then((res) => {
            setA(1);
            setB(2);
            setC(3);
          });
        });
        return null;
      }
    `)
    expect(diagnostics).toHaveLength(1)
  })

  it("reports in event handler (not auto-batched)", () => {
    const { diagnostics } = check(`
      import { createSignal } from "solid-js";
      function App() {
        const [a, setA] = createSignal(0);
        const [b, setB] = createSignal(0);
        const [c, setC] = createSignal(0);
        const handler = () => {
          setA(1);
          setB(2);
          setC(3);
        };
        return null;
      }
    `)
    expect(diagnostics).toHaveLength(1)
  })

  it("reports in standalone function (unknown calling context)", () => {
    const { diagnostics } = check(`
      import { createSignal } from "solid-js";
      function App() {
        const [a, setA] = createSignal(0);
        const [b, setB] = createSignal(0);
        const [c, setC] = createSignal(0);
        function updateAll() {
          setA(1);
          setB(2);
          setC(3);
        }
        return null;
      }
    `)
    expect(diagnostics).toHaveLength(1)
  })

  it("reports in async function returned from create* hook (callable from non-batched contexts)", () => {
    const { diagnostics } = check(`
      import { createSignal, onMount } from "solid-js";
      function useCursorPagination(options) {
        const [loading, setLoading] = createSignal(true);
        const [loadingMore, setLoadingMore] = createSignal(false);
        const [error, setError] = createSignal(null);

        const refetch = async () => {
          setLoading(true);
          setLoadingMore(false);
          setError(null);

          const result = await options.fetchPage(null);
          setLoading(false);
        };

        onMount(() => void refetch());
        return { loading, loadingMore, error, refetch };
      }
    `)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).rule).toBe("batch-optimization")
  })

  it("suppresses in createMemo body", () => {
    const { diagnostics } = check(`
      import { createSignal, createMemo } from "solid-js";
      function App() {
        const [a, setA] = createSignal(0);
        const [b, setB] = createSignal(0);
        const [c, setC] = createSignal(0);
        const memo = createMemo(() => {
          setA(1);
          setB(2);
          setC(3);
          return 0;
        });
        return null;
      }
    `)
    expect(diagnostics).toHaveLength(0)
  })

  it("suppresses pre-await and reports post-await in createEffect(on(..., async)) - real world", () => {
    const { diagnostics } = check(`
      import { createSignal, createEffect, on } from "solid-js";
      function EditEntryDrawer(props) {
        const [entryData, setEntryData] = createSignal(null)
        const [fetchLoading, setFetchLoading] = createSignal(false)
        const [fetchError, setFetchError] = createSignal(null)
        const [notes, setNotes] = createSignal("")
        const [expiresAt, setExpiresAt] = createSignal("")

        createEffect(
          on(
            () => ({ open: props.open, id: props.entryId }),
            async ({ open, id }) => {
              if (!open || !id) return

              setFetchLoading(true)
              setFetchError(null)
              setEntryData(null)

              const result = await props.edit.fetchEntry(id)

              if (result.isOk()) {
                setEntryData(result.value)
                setNotes(result.value.notes)
                setExpiresAt(result.value.expiresAt ? result.value.expiresAt.slice(0, 10) : "")
              } else {
                setFetchError(result.error.message)
              }

              setFetchLoading(false)
            },
          ),
        )
        return null
      }
    `)
    // Pre-await group (setFetchLoading, setFetchError, setEntryData) should be suppressed
    // Post-await group (setEntryData, setNotes, setExpiresAt) should be reported
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("multipleSetters")
  })

  it("fix wraps all post-await statements in batch(), not just the consecutive setters", () => {
    const code = `import { createSignal, createEffect, on } from "solid-js";
function App(props) {
  const [data, setData] = createSignal(null)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal(null)
  const [notes, setNotes] = createSignal("")
  const [expiresAt, setExpiresAt] = createSignal("")

  createEffect(
    on(
      () => props.id,
      async (id) => {
        if (!id) return

        setLoading(true)
        setError(null)
        setData(null)

        const result = await fetchEntry(id)

        if (result.isOk()) {
          setData(result.value)
          setNotes(result.value.notes)
          setExpiresAt(result.value.expiresAt)
        } else {
          setError(result.error.message)
        }

        setLoading(false)
      },
    ),
  )
  return null
}`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    const fixed = applyAllFixes(code, diagnostics)
    // Should wrap everything after the await, not just the 3 consecutive setters
    expect(fixed).toContain("batch(() => {")
    expect(fixed).toContain("if (result.isOk())")
    expect(fixed).toContain("setLoading(false)")
    expect(fixed).toContain("} else {")
    expect(fixed).toContain("setError(result.error.message)")
  })

  it("fix for non-async context wraps only consecutive setters", () => {
    const code = `import { createSignal } from "solid-js";
function App() {
  const [a, setA] = createSignal(0);
  const [b, setB] = createSignal(0);
  const [c, setC] = createSignal(0);
  const handler = () => {
    console.log("before");
    setA(1);
    setB(2);
    setC(3);
    console.log("after");
  };
  return null;
}`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    const fixed = applyAllFixes(code, diagnostics)
    expect(fixed).toContain("batch(() => {")
    // Should NOT wrap console.log statements
    expect(fixed).not.toContain('batch(() => {\n    console.log("before")')
  })

  it("reports after await in try/catch", () => {
    const { diagnostics } = check(`
      import { createSignal, createEffect, on } from "solid-js";
      function App() {
        const [data, setData] = createSignal(null);
        const [status, setStatus] = createSignal("");
        const [ts, setTs] = createSignal(0);
        const [trigger] = createSignal(0);
        createEffect(on(trigger, async () => {
          try {
            const result = await fetch("/api");
            setData(result);
            setStatus("ok");
            setTs(Date.now());
          } catch (err) {
            setData(null);
            setStatus("error");
            setTs(Date.now());
          }
        }));
        return null;
      }
    `)
    expect(diagnostics).toHaveLength(2)
  })
})

describe("prefer-for", () => {
  const check = (code: string) => checkRule(preferFor, code)

  it("metadata", () => {
    expect(preferFor.id).toBe("prefer-for")
    expect(preferFor.meta.fixable).toBe(true)
  })

  it("allows For component", () => {
    const { diagnostics } = check("let Component = (props) => <ol><For each={props.data}>{d => <li>{d.text}</li>}</For></ol>;")
    expect(diagnostics).toHaveLength(0)
  })

  it("allows map outside JSX", () => {
    const { diagnostics } = check("let abc = x.map(y => y + z);")
    expect(diagnostics).toHaveLength(0)
  })

  it("allows map result stored in variable", () => {
    const { diagnostics } = check(`let Component = (props) => {
      let abc = x.map(y => y + z);
      return <div>Hello, world!</div>;
    }`)
    expect(diagnostics).toHaveLength(0)
  })

  it("allows map in JSX attribute", () => {
    const { diagnostics } = check("let Component = (props) => <div data-items={items.map(i => i.id)} />;")
    expect(diagnostics).toHaveLength(0)
  })

  it("allows map with thisArg", () => {
    const { diagnostics } = check("let Component = (props) => <ol>{props.data.map(d => <li>{d}</li>, context)}</ol>;")
    expect(diagnostics).toHaveLength(0)
  })

  it("allows filter call", () => {
    const { diagnostics } = check("let Component = (props) => <ol>{props.data.filter(d => d.active)}</ol>;")
    expect(diagnostics).toHaveLength(0)
  })

  it("allows map with function reference", () => {
    const { diagnostics } = check("let Component = (props) => <ol>{props.data.map(renderItem)}</ol>;")
    expect(diagnostics).toHaveLength(0)
  })

  it("detects map with single param", () => {
    const code = "let Component = (props) => <ol>{props.data.map(d => <li>{d.text}</li>)}</ol>;"
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("preferFor")
  })

  it("fixes map to For", () => {
    const code = "let Component = (props) => <ol>{props.data.map(d => <li>{d.text}</li>)}</ol>;"
    const { diagnostics } = check(code)
    expect(applyAllFixes(code, diagnostics)).toBe("let Component = (props) => <ol><For each={props.data}>{d => <li>{d.text}</li>}</For></ol>;")
  })

  it("detects map inside fragment", () => {
    const code = "let Component = (props) => <>{props.data.map(d => <li>{d.text}</li>)}</>;"
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(applyAllFixes(code, diagnostics)).toBe("let Component = (props) => <><For each={props.data}>{d => <li>{d.text}</li>}</For></>;")
  })

  it("detects no params - no auto-fix", () => {
    const code = "let Component = (props) => <ol>{props.data.map(() => <li />)}</ol>;"
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("preferForOrIndex")
    expect(applyAllFixes(code, diagnostics)).toBe(code)
  })

  it("detects index param - no auto-fix", () => {
    const code = "let Component = (props) => <ol>{props.data.map((item, index) => <li>{index}: {item}</li>)}</ol>;"
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("preferForOrIndex")
    expect(applyAllFixes(code, diagnostics)).toBe(code)
  })
})

describe("prefer-memo-complex-styles", () => {
  const check = (code: string) => checkRule(preferMemoComplexStyles, code)

  it("metadata", () => {
    expect(preferMemoComplexStyles.id).toBe("prefer-memo-complex-styles")
    expect(preferMemoComplexStyles.meta.fixable).toBe(false)
  })

  it("allows simple style object", () => {
    const { diagnostics } = check(`function Avatar(props) {
      return <div style={{ color: "red", padding: "10px" }} />;
    }`)
    expect(diagnostics).toHaveLength(0)
  })

  it("allows single conditional", () => {
    const { diagnostics } = check(`function Avatar(props) {
      return <div style={{ color: props.active ? "blue" : "gray" }} />;
    }`)
    expect(diagnostics).toHaveLength(0)
  })

  it("allows createMemo usage", () => {
    const { diagnostics } = check(`function Avatar(props) {
      const styleObject = createMemo(() => ({
        color: props.active ? "blue" : "gray",
        background: props.dark ? "#000" : "#fff"
      }));
      return <div style={styleObject()} />;
    }`)
    expect(diagnostics).toHaveLength(0)
  })

  it("detects multiple conditionals", () => {
    const { diagnostics } = check(`function Avatar(props) {
      return (
        <div
          style={{
            color: props.active ? "blue" : "gray",
            background: props.dark ? "#000" : "#fff",
          }}
        />
      );
    }`)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("preferMemoComplexStyle")
  })

  it("detects conditional spread", () => {
    const { diagnostics } = check(`function Avatar(props) {
      return (
        <div
          style={{
            ...baseStyle,
            ...(props.src ? {} : { "--avatar-bg": props.background }),
          }}
        />
      );
    }`)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("preferMemoConditionalSpread")
  })
})

describe("prefer-show", () => {
  const check = (code: string) => checkRule(preferShow, code)

  it("metadata", () => {
    expect(preferShow.id).toBe("prefer-show")
    expect(preferShow.meta.fixable).toBe(true)
  })

  it("allows Show component", () => {
    const { diagnostics } = check(`function Component(props) {
      return <Show when={props.cond}>Content</Show>;
    }`)
    expect(diagnostics).toHaveLength(0)
  })

  it("allows && with string literal", () => {
    const { diagnostics } = check(`function Component(props) {
      return <div>{props.cond && "text"}</div>;
    }`)
    expect(diagnostics).toHaveLength(0)
  })

  it("allows ternary with literal branches", () => {
    const { diagnostics } = check(`function Component(props) {
      return <div>{props.flag ? "yes" : "no"}</div>;
    }`)
    expect(diagnostics).toHaveLength(0)
  })

  it("allows || operator", () => {
    const { diagnostics } = check(`function Component(props) {
      return <div>{props.fallback || <Default />}</div>;
    }`)
    expect(diagnostics).toHaveLength(0)
  })

  it("allows conditional in JSX attribute", () => {
    const { diagnostics } = check(`function Component(props) {
      return <div class={props.active && "active"} />;
    }`)
    expect(diagnostics).toHaveLength(0)
  })

  it("detects && with JSX element", () => {
    const code = `function Component(props) {
      return <div>{props.cond && <span>Content</span>}</div>;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("preferShowAnd")
  })

  it("fixes && to Show", () => {
    const code = `function Component(props) {
      return <div>{props.cond && <span>Content</span>}</div>;
    }`
    const { diagnostics } = check(code)
    expect(applyAllFixes(code, diagnostics)).toBe(`import { Show } from "solid-js";

function Component(props) {
      return <div><Show when={props.cond}><span>Content</span></Show></div>;
    }`)
  })

  it("detects ternary with JSX branches", () => {
    const code = `function Component(props) {
      return <div>{props.cond ? <span>Content</span> : <span>Fallback</span>}</div>;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("preferShowTernary")
  })

  it("detects && in For callback", () => {
    const code = `function Component(props) {
      return (
        <For each={props.someList}>
          {(listItem) => listItem.cond && <span>Content</span>}
        </For>
      );
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("preferShowAnd")
  })
})

describe("self-closing-comp", () => {
  const check = (code: string) => checkRule(selfClosingComp, code)

  it("metadata", () => {
    expect(selfClosingComp.id).toBe("self-closing-comp")
    expect(selfClosingComp.meta.fixable).toBe(true)
  })

  it("allows self-closing component", () => {
    const { diagnostics } = check('let el = <Component name="Foo" />;')
    expect(diagnostics).toHaveLength(0)
  })

  it("allows component with children", () => {
    const { diagnostics } = check('let el = <Component><img src="picture.png" /></Component>;')
    expect(diagnostics).toHaveLength(0)
  })

  it("allows single-line whitespace", () => {
    const { diagnostics } = check('let el = <Component name="Foo"> </Component>;')
    expect(diagnostics).toHaveLength(0)
  })

  it("detects empty div should self-close", () => {
    const code = "let el = <div></div>;"
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("selfClose")
  })

  it("fixes empty div to self-close", () => {
    const code = "let el = <div></div>;"
    const { diagnostics } = check(code)
    expect(applyAllFixes(code, diagnostics)).toBe("let el = <div />;")
  })

  it("detects empty component should self-close", () => {
    const code = "let el = <Component></Component>;"
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("selfClose")
  })

  it("fixes empty component to self-close", () => {
    const code = "let el = <Component></Component>;"
    const { diagnostics } = check(code)
    expect(applyAllFixes(code, diagnostics)).toBe("let el = <Component />;")
  })

  it("detects multiline empty should self-close", () => {
    const code = `let el = (
      <div>
      </div>
    );`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
  })
})

describe("style-prop", () => {
  const check = (code: string) => checkRule(styleProp, code)

  it("metadata", () => {
    expect(styleProp.id).toBe("style-prop")
    expect(styleProp.meta.fixable).toBe(true)
  })

  it("allows object style", () => {
    const { diagnostics } = check('let el = <div style={{ color: "red" }} />;')
    expect(diagnostics).toHaveLength(0)
  })

  it("allows css variable in object style", () => {
    const { diagnostics } = check('let el = <div style={{ "--custom-color": "red" }} />;')
    expect(diagnostics).toHaveLength(0)
  })

  it("detects string style", () => {
    const code = 'let el = <div style="color: red" />;'
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("stringStyle")
  })

  it("fixes string style to object", () => {
    const code = 'let el = <div style="color: red" />;'
    const { diagnostics } = check(code)
    expect(applyAllFixes(code, diagnostics)).toBe('let el = <div style={{"color":"red"}} />;')
  })

  it("fixes multiple properties", () => {
    const code = 'let el = <div style="color: red; background: blue" />;'
    const { diagnostics } = check(code)
    expect(applyAllFixes(code, diagnostics)).toBe('let el = <div style={{"color":"red","background":"blue"}} />;')
  })
})
