/**
 * JSX Rules Tests
 */

import { describe, it, expect } from "vitest"
import { checkRule, applyAllFixes, at } from "../test-utils"
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
  const check = (code: string) => checkRule(componentsReturnOnce, code)

  it("metadata", () => {
    expect(componentsReturnOnce.id).toBe("components-return-once")
    expect(componentsReturnOnce.meta.fixable).toBe(true)
  })

  it("allows single return in component", () => {
    expect(check(`function Component() { return <div />; }`).diagnostics).toHaveLength(0)
  })

  it("allows early returns in non-JSX functions", () => {
    const code = `function someFunc() {
      if (condition) { return 5; }
      return 10;
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allows early returns in lowercase render functions", () => {
    const code = `function notAComponent() {
      if (condition) { return <div />; }
      return <div />;
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allows early returns in callbacks", () => {
    const code = `callback(() => {
      if (condition) { return <div />; }
      return <div />;
    });`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allows nested render functions with early returns", () => {
    const code = `function Component() {
      const renderContent = () => {
        if (false) return <></>;
        return <></>;
      }
      return <>{renderContent()}</>;
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("detects early return in component", () => {
    const code = `function Component() {
      if (condition) { return <div />; }
      return <span />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("noEarlyReturn")
  })

  it("detects conditional return (ternary)", () => {
    const code = `function Component() {
      return Math.random() > 0.5 ? <div>Big!</div> : <div>Small!</div>;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("noConditionalReturn")
  })

  it("detects conditional return (logical &&)", () => {
    const code = `function Component(props) {
      return !!props.cond && <div>Conditional</div>;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("noConditionalReturn")
  })
})

describe("jsx-no-duplicate-props", () => {
  const check = (code: string) => checkRule(jsxNoDuplicateProps, code)

  it("metadata", () => {
    expect(jsxNoDuplicateProps.id).toBe("jsx-no-duplicate-props")
    expect(jsxNoDuplicateProps.meta.fixable).toBe(true)
  })

  it("allows unique props", () => {
    expect(check('let el = <div a="a" b="b" />').diagnostics).toHaveLength(0)
  })

  it("allows different case props when case-sensitive", () => {
    expect(check('let el = <div a="a" A="A" />').diagnostics).toHaveLength(0)
  })

  it("allows class once", () => {
    expect(check('let el = <div class="blue" />').diagnostics).toHaveLength(0)
  })

  it("allows children prop alone", () => {
    expect(check("let el = <div children={<div />} />").diagnostics).toHaveLength(0)
  })

  it("allows JSX children alone", () => {
    expect(check("let el = <div><div /></div>").diagnostics).toHaveLength(0)
  })

  it("detects duplicate direct props", () => {
    const { diagnostics } = check('let el = <div a="a" a="aaaa" />')
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("noDuplicateProps")
  })

  it("detects duplicate class props", () => {
    const { diagnostics } = check('let el = <div class="blue" class="green" />')
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("noDuplicateClass")
  })

  it("detects children + JSX children conflict", () => {
    const { diagnostics } = check("let el = <div children={<div />}><div /></div>")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("noDuplicateChildren")
  })

  it("fixes duplicate prop by removing second", () => {
    const code = 'let el = <div a="a" a="aaaa" />'
    const { diagnostics } = check(code)
    expect(applyAllFixes(code, diagnostics)).toBe('let el = <div a="a" />')
  })
})

describe("jsx-no-script-url", () => {
  const check = (code: string) => checkRule(jsxNoScriptUrl, code)

  it("metadata", () => {
    expect(jsxNoScriptUrl.id).toBe("jsx-no-script-url")
    expect(jsxNoScriptUrl.meta.fixable).toBe(true)
  })

  it("allows regular URLs", () => {
    expect(check('let el = <a href="https://example.com" />').diagnostics).toHaveLength(0)
  })

  it("allows component props with regular URLs", () => {
    expect(check('let el = <Link to="https://example.com" />').diagnostics).toHaveLength(0)
  })

  it("allows variable references with safe URLs", () => {
    const code = `const link = "https://example.com";
    let el = <a href={link} />`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("detects direct javascript: URL", () => {
    const { diagnostics } = check(`let el = <a href="javascript:alert('hacked!')" />`)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("noJSURL")
  })

  it("detects javascript: URL in component props", () => {
    const { diagnostics } = check(`let el = <Link to="javascript:alert('hacked!')" />`)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("noJSURL")
  })

  it("fixes javascript URL by replacing with #", () => {
    const code = `let el = <a href="javascript:void(0)" />`
    const { diagnostics } = check(code)
    expect(applyAllFixes(code, diagnostics)).toBe('let el = <a href="#" />')
  })
})

describe("jsx-no-undef", () => {
  const check = (code: string) => checkRule(jsxNoUndef, code)

  it("metadata", () => {
    expect(jsxNoUndef.id).toBe("jsx-no-undef")
    expect(jsxNoUndef.meta.fixable).toBe(false)
  })

  // Note: ganko jsx-no-undef only checks custom directives
  // Component undefined checks are delegated to TypeScript

  it("allows DOM elements", () => {
    expect(check("let el = <div />").diagnostics).toHaveLength(0)
  })

  it("allows custom elements (lowercase with dash)", () => {
    expect(check("let el = <my-element />").diagnostics).toHaveLength(0)
  })

  it("allows defined custom directive", () => {
    const code = `const X = () => {}; let el = <div use:X />`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("detects undefined custom directive", () => {
    const { diagnostics } = check("let el = <div use:X />")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("customDirectiveUndefined")
  })

  it("detects undefined directive with value", () => {
    const { diagnostics } = check("let el = <div use:Y={{}} />")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("customDirectiveUndefined")
  })
})

describe("no-unknown-namespaces", () => {
  const check = (code: string) => checkRule(noUnknownNamespaces, code)

  it("metadata", () => {
    expect(noUnknownNamespaces.id).toBe("no-unknown-namespaces")
  })

  it("allows on: namespace", () => {
    expect(check("let el = <div on:click={null} />;").diagnostics).toHaveLength(0)
  })

  it("allows oncapture: namespace", () => {
    expect(check("let el = <div oncapture:click={null} />;").diagnostics).toHaveLength(0)
  })

  it("allows use: namespace", () => {
    expect(check("let el = <div use:X={null} />;").diagnostics).toHaveLength(0)
  })

  it("allows prop: namespace", () => {
    expect(check('let el = <div prop:scrollTop="0px" />;').diagnostics).toHaveLength(0)
  })

  it("allows attr: namespace", () => {
    expect(check('let el = <div attr:title="title" />;').diagnostics).toHaveLength(0)
  })

  it("allows bool: namespace", () => {
    expect(check("let el = <div bool:disabled={isDisabled} />;").diagnostics).toHaveLength(0)
  })

  it("detects unknown namespace", () => {
    const { diagnostics } = check("let el = <div foo:boo={null} />")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("unknownNamespace")
  })

  it("detects style: namespace (discouraged)", () => {
    const { diagnostics } = check('let el = <div style:width="100%" />')
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("styleNamespace")
  })

  it("detects class: namespace (discouraged)", () => {
    const { diagnostics } = check("let el = <div class:mt-10={true} />")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("classNamespace")
  })

  it("detects namespace on component", () => {
    const { diagnostics } = check('let el = <Box attr:foo="bar" />')
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("componentNamespace")
  })
})

describe("suspense-boundary-missing", () => {
  const check = (code: string) => checkRule(suspenseBoundaryMissing, code)

  it("metadata", () => {
    expect(suspenseBoundaryMissing.id).toBe("suspense-boundary-missing")
    expect(suspenseBoundaryMissing.meta.fixable).toBe(false)
  })

  it("allows Suspense with fallback prop", () => {
    const code = `import { Suspense } from "solid-js";
    function App() {
      return (
        <Suspense fallback={<div>Loading...</div>}>
          <AsyncContent />
        </Suspense>
      );
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allows ErrorBoundary with fallback prop", () => {
    const code = `import { ErrorBoundary } from "solid-js";
    function App() {
      return (
        <ErrorBoundary fallback={(err) => <div>Error</div>}>
          <Content />
        </ErrorBoundary>
      );
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("reports Suspense without fallback", () => {
    const code = `import { Suspense } from "solid-js";
    function App() {
      return (
        <Suspense>
          <AsyncContent />
        </Suspense>
      );
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("suspenseNoFallback")
  })

  it("reports ErrorBoundary without fallback", () => {
    const code = `import { ErrorBoundary } from "solid-js";
    function App() {
      return (
        <ErrorBoundary>
          <Content />
        </ErrorBoundary>
      );
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("errorBoundaryNoFallback")
  })

  it("reports lazy component without Suspense", () => {
    const code = `import { lazy } from "solid-js";
    const LazyComponent = lazy(() => import("./Heavy"));
    function App() {
      return <LazyComponent />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("lazyNoSuspense")
  })
})

describe("validate-jsx-nesting", () => {
  const check = (code: string) => checkRule(validateJsxNesting, code)

  it("metadata", () => {
    expect(validateJsxNesting.id).toBe("validate-jsx-nesting")
    expect(validateJsxNesting.meta.fixable).toBe(false)
  })

  it("allows valid nesting", () => {
    expect(check("let el = <ul><li>item</li></ul>").diagnostics).toHaveLength(0)
  })

  it("allows div in div", () => {
    expect(check("let el = <div><div>nested</div></div>").diagnostics).toHaveLength(0)
  })

  it("allows span in p", () => {
    expect(check("let el = <p><span>text</span></p>").diagnostics).toHaveLength(0)
  })

  it("allows td in tr", () => {
    expect(check("let el = <tr><td>cell</td></tr>").diagnostics).toHaveLength(0)
  })
})

describe("show-truthy-conversion", () => {
  const check = (code: string) => checkRule(showTruthyConversion, code)

  it("metadata", () => {
    expect(showTruthyConversion.id).toBe("show-truthy-conversion")
    expect(showTruthyConversion.meta.fixable).toBe(true)
  })

  it("does not report when no Show elements exist", () => {
    expect(check("function App() { return <div>Hello</div>; }").diagnostics).toHaveLength(0)
  })

  it("does not report without type info (rule requires TypeScript)", () => {
    // Without type info, the rule returns early
    const code = `
      import { Show, createSignal } from "solid-js";
      function App() {
        const [count, setCount] = createSignal(0);
        return <Show when={count()}>Count: {count()}</Show>;
      }
    `
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allows comparison expressions", () => {
    const code = `
      import { Show, createSignal } from "solid-js";
      function App() {
        const [count] = createSignal(0);
        return <Show when={count() > 0}>Count</Show>;
      }
    `
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allows Boolean() conversion", () => {
    const code = `
      import { Show, createSignal } from "solid-js";
      function App() {
        const [count] = createSignal(0);
        return <Show when={Boolean(count())}>Count</Show>;
      }
    `
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allows double negation (!!)", () => {
    const code = `
      import { Show, createSignal } from "solid-js";
      function App() {
        const [name] = createSignal("");
        return <Show when={!!name()}>Name</Show>;
      }
    `
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allows logical expressions", () => {
    const code = `
      import { Show, createSignal } from "solid-js";
      function App() {
        const [a] = createSignal(0);
        const [b] = createSignal(true);
        return <Show when={a() && b()}>Both</Show>;
      }
    `
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allows NOT expression", () => {
    const code = `
      import { Show, createSignal } from "solid-js";
      function App() {
        const [loading] = createSignal(false);
        return <Show when={!loading()}>Loaded</Show>;
      }
    `
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allows boolean literal", () => {
    const code = `
      import { Show } from "solid-js";
      function App() {
        return <Show when={true}>Always visible</Show>;
      }
    `
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allows null check (!=)", () => {
    const code = `
      import { Show, createSignal } from "solid-js";
      function App() {
        const [count] = createSignal(0);
        return <Show when={count() != null}>Count</Show>;
      }
    `
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allows guarded ternary with null alternate", () => {
    const code = `
      import { Show, createSignal } from "solid-js";
      function App() {
        const [data] = createSignal(null);
        return <Show when={data() ? data() : null}>Data</Show>;
      }
    `
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allows guarded ternary with undefined alternate", () => {
    const code = `
      import { Show, createSignal } from "solid-js";
      function App() {
        const [data] = createSignal(null);
        return <Show when={data() ? data() : undefined}>Data</Show>;
      }
    `
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allows guarded ternary with false alternate", () => {
    const code = `
      import { Show, createSignal } from "solid-js";
      function App() {
        const [data] = createSignal(null);
        return <Show when={data() ? data() : false}>Data</Show>;
      }
    `
    expect(check(code).diagnostics).toHaveLength(0)
  })
})
