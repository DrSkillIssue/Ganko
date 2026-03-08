/**
 * Solid Rules Tests (Imports)
 */

import { describe, it, expect } from "vitest"
import { checkRule, applyAllFixes, at } from "../test-utils"
import { imports, noReactDeps, noReactSpecificProps } from "../../../src/solid/rules/solid"

describe("imports", () => {
  const check = (code: string) => checkRule(imports, code)

  it("metadata", () => {
    expect(imports.id).toBe("imports")
    expect(imports.meta.description).toContain("solid-js")
    expect(imports.meta.fixable).toBe(false)
  })

  it("allows correct imports from solid-js", () => {
    expect(check('import { createSignal, mergeProps as merge } from "solid-js";').diagnostics).toHaveLength(0)
  })

  it("allows correct imports from solid-js with single quotes", () => {
    expect(check("import { createSignal, mergeProps as merge } from 'solid-js';").diagnostics).toHaveLength(0)
  })

  it("allows correct imports from solid-js/web", () => {
    expect(check('import { render, hydrate } from "solid-js/web";').diagnostics).toHaveLength(0)
  })

  it("allows correct imports from solid-js/store", () => {
    expect(check('import { createStore, produce } from "solid-js/store";').diagnostics).toHaveLength(0)
  })

  it("allows mixed imports from different modules", () => {
    const code = `import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { something } from "somewhere/else";
import { createStore } from "solid-js/store";`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allows namespace imports", () => {
    expect(check('import * as Solid from "solid-js"; Solid.render();').diagnostics).toHaveLength(0)
  })

  it("reports createEffect imported from wrong source", () => {
    const { diagnostics } = check('import { createEffect } from "solid-js/web";')
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("preferSource")
  })

  it("reports render imported from wrong source", () => {
    const { diagnostics } = check('import { render } from "solid-js";')
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("preferSource")
  })

  it("reports createStore imported from wrong source", () => {
    const { diagnostics } = check('import { createStore } from "solid-js";')
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("preferSource")
  })

  it("reports multiple wrong imports", () => {
    const code = `import { createEffect } from "solid-js/web";
import { render } from "solid-js";`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(2)
  })
})

describe("no-react-deps", () => {
  const check = (code: string) => checkRule(noReactDeps, code)

  it("metadata", () => {
    expect(noReactDeps.id).toBe("no-react-deps")
    expect(noReactDeps.meta.description).toContain("dependency")
    expect(noReactDeps.meta.fixable).toBe(true)
  })

  it("allows createEffect without dependency array", () => {
    const code = `createEffect(() => {
  console.log(signal());
});`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allows createEffect with previous value (initial value)", () => {
    const code = `createEffect((prev) => {
  console.log(signal());
  return prev + 1;
}, 0);`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allows createMemo without dependency array", () => {
    expect(check("const value = createMemo(() => computeExpensiveValue(a(), b()));").diagnostics).toHaveLength(0)
  })

  it("allows createMemo with initial value", () => {
    expect(check("const sum = createMemo((prev) => input() + prev, 0);").diagnostics).toHaveLength(0)
  })

  it("allows createRenderEffect without dependency array", () => {
    const code = `createRenderEffect(() => {
  console.log(signal());
});`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allows spread arguments", () => {
    const code = `const args = [() => { console.log(signal()); }, [signal()]];
createEffect(...args);`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("reports createEffect with inline dependency array", () => {
    const code = `createEffect(() => {
  console.log(signal());
}, [signal()]);`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("noUselessDep")
  })

  it("reports createMemo with inline dependency array", () => {
    const { diagnostics } = check("const value = createMemo(() => computeExpensiveValue(a(), b()), [a(), b()]);")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("noUselessDep")
  })

  it("reports createRenderEffect with inline dependency array", () => {
    const code = `createRenderEffect(() => {
  console.log(signal());
}, [signal()]);`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("noUselessDep")
  })

  it("fixes by removing dependency array", () => {
    const code = `createEffect(() => {
  console.log(signal());
}, [signal()]);`
    const { diagnostics } = check(code)
    expect(applyAllFixes(code, diagnostics)).toBe(`createEffect(() => {
  console.log(signal());
});`)
  })
})

describe("no-react-specific-props", () => {
  const check = (code: string) => checkRule(noReactSpecificProps, code)

  it("metadata", () => {
    expect(noReactSpecificProps.id).toBe("no-react-specific-props")
    expect(noReactSpecificProps.meta.description).toContain("React")
    expect(noReactSpecificProps.meta.fixable).toBe(true)
  })

  it("allows plain div elements", () => {
    expect(check("let el = <div>Hello world!</div>;").diagnostics).toHaveLength(0)
  })

  it("allows class attribute", () => {
    expect(check('let el = <div class="greeting">Hello world!</div>;').diagnostics).toHaveLength(0)
  })

  it("allows for attribute on label", () => {
    expect(check('let el = <label for="id">Hello world!</label>;').diagnostics).toHaveLength(0)
  })

  it("allows class and for on components", () => {
    expect(check('let el = <PascalComponent class="greeting" for="id" />').diagnostics).toHaveLength(0)
  })

  it("allows key on components", () => {
    expect(check("let el = <PascalComponent key={item.id} />").diagnostics).toHaveLength(0)
  })

  it("reports className on div", () => {
    const { diagnostics } = check('let el = <div className="greeting">Hello world!</div>')
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("prefer")
  })

  it("reports htmlFor on label", () => {
    const { diagnostics } = check('let el = <label htmlFor="id">Hello world!</label>')
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("prefer")
  })

  it("reports key on DOM elements", () => {
    const { diagnostics } = check("let el = <div key={item.id} />")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("noUselessKey")
  })

  it("fixes className to class", () => {
    const code = 'let el = <div className="greeting">Hello world!</div>'
    const { diagnostics } = check(code)
    expect(applyAllFixes(code, diagnostics)).toBe('let el = <div class="greeting">Hello world!</div>')
  })

  it("fixes htmlFor to for", () => {
    const code = 'let el = <label htmlFor="id">Hello world!</label>'
    const { diagnostics } = check(code)
    expect(applyAllFixes(code, diagnostics)).toBe('let el = <label for="id">Hello world!</label>')
  })

  it("fixes by removing key on DOM element", () => {
    const code = "let el = <div key={item.id} />"
    const { diagnostics } = check(code)
    expect(applyAllFixes(code, diagnostics)).toBe("let el = <div />")
  })
})
