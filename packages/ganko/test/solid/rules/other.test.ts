/**
 * Correctness Rules Tests
 */

import { describe, it, expect } from "vitest"
import { checkRule, applyAllFixes, at } from "../test-utils"
import {
  avoidConditionalSpreads,
  avoidNonNullAssertions,
  avoidObjectSpread,
  avoidTypeCasting,
  avoidUnsafeTypeAnnotations,
  eventHandlers,
  noArrayHandlers,
  noDestructure,
} from "../../../src/solid/rules/correctness"

describe("avoid-conditional-spreads", () => {
  const check = (code: string) => checkRule(avoidConditionalSpreads, code)

  it("metadata", () => {
    expect(avoidConditionalSpreads.id).toBe("avoid-conditional-spreads")
  })

  it("allows simple spread", () => {
    expect(check('const obj = { ...baseObj, color: "red" };').diagnostics).toHaveLength(0)
  })

  it("allows spread of a variable", () => {
    expect(check("const obj = { ...props };").diagnostics).toHaveLength(0)
  })

  it("allows conditional outside spread", () => {
    expect(check("const obj = cond ? { ...a } : { ...b };").diagnostics).toHaveLength(0)
  })

  it("allows ternary property value (not a spread)", () => {
    expect(check('const obj = { color: cond ? "red" : "blue" };').diagnostics).toHaveLength(0)
  })

  it("allows spread of function call", () => {
    expect(check("const obj = { ...getStyles() };").diagnostics).toHaveLength(0)
  })

  it("allows conditional spread with non-empty objects", () => {
    expect(check("const obj = { ...(cond ? { a: 1 } : { b: 2 }) };").diagnostics).toHaveLength(0)
  })

  it("reports conditional spread with empty object fallback", () => {
    const { diagnostics } = check('const obj = { ...(cond ? { color: "red" } : {}) };')
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidConditionalSpread")
  })

  it("reports inverted conditional spread", () => {
    const { diagnostics } = check('const obj = { ...(cond ? {} : { color: "red" }) };')
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidConditionalSpread")
  })

  it("reports logical AND spread pattern", () => {
    const { diagnostics } = check('const obj = { ...(cond && { color: "red" }) };')
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidLogicalAndSpread")
  })

  it("reports multiple conditional spreads", () => {
    const code = `const obj = {
      ...baseStyle,
      ...(condA ? { a: 1 } : {}),
      ...(condB && { b: 2 }),
    };`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(2)
  })

  it("allows conditional spread in classList on DOM element", () => {
    const code = `function Component(props) {
      return (
        <div classList={{
          ...(props.active ? { active: true } : {}),
        }} />
      );
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allows conditional spread in classList on component element", () => {
    const code = `function Component(props) {
      return (
        <CustomWidget classList={{
          ...(props.active ? { active: true } : {}),
        }} />
      );
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allows logical AND spread in style attribute", () => {
    const code = `function Component(props) {
      return (
        <div style={{
          ...(props.bold && { "font-weight": "bold" }),
        }} />
      );
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("still reports conditional spread outside classList/style", () => {
    const code = `function Component(props) {
      const obj = {
        ...(props.active ? { active: true } : {}),
      };
      return <div />;
    }`
    expect(check(code).diagnostics).toHaveLength(1)
  })
})

describe("avoid-non-null-assertions", () => {
  const check = (code: string) => checkRule(avoidNonNullAssertions, code)

  it("metadata", () => {
    expect(avoidNonNullAssertions.id).toBe("avoid-non-null-assertions")
    expect(avoidNonNullAssertions.meta.fixable).toBe(true)
  })

  it("allows optional chaining", () => {
    expect(check("const x = obj?.property;").diagnostics).toHaveLength(0)
  })

  it("allows nullish coalescing", () => {
    expect(check("const x = value ?? defaultValue;").diagnostics).toHaveLength(0)
  })

  it("allows regular member access", () => {
    expect(check("const x = obj.property;").diagnostics).toHaveLength(0)
  })

  it("allows double negation for boolean coercion", () => {
    expect(check("const x = !!value;").diagnostics).toHaveLength(0)
  })

  it("allows logical NOT operator", () => {
    expect(check("const x = !value;").diagnostics).toHaveLength(0)
  })

  it("reports non-null assertion on identifier", () => {
    const { diagnostics } = check("const x = value!;")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidNonNull")
  })

  it("reports non-null assertion before member access", () => {
    const { diagnostics } = check("const x = obj!.property;")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidNonNull")
  })

  it("reports non-null assertion before array access", () => {
    const { diagnostics } = check("const x = arr![0];")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidNonNull")
  })

  it("reports non-null assertion on call result", () => {
    const { diagnostics } = check("const x = getData()!;")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidNonNull")
  })

  it("reports multiple non-null assertions", () => {
    const { diagnostics } = check("const x = a!; const y = b!;")
    expect(diagnostics).toHaveLength(2)
  })

  it("reports nested non-null assertions", () => {
    const { diagnostics } = check("const x = obj!.nested!.value;")
    expect(diagnostics).toHaveLength(2)
  })

  it("fixes non-null assertion by removing it", () => {
    const code = "const x = value!;"
    const { diagnostics } = check(code)
    expect(applyAllFixes(code, diagnostics)).toBe("const x = value;")
  })
})

describe("avoid-object-spread", () => {
  const check = (code: string) => checkRule(avoidObjectSpread, code)

  it("metadata", () => {
    expect(avoidObjectSpread.id).toBe("avoid-object-spread")
  })

  it("allows direct property access", () => {
    expect(check("const value = props.name;").diagnostics).toHaveLength(0)
  })

  it("allows object literal without spread", () => {
    expect(check("const obj = { a: 1, b: 2 };").diagnostics).toHaveLength(0)
  })

  it("allows array spread (not covered)", () => {
    expect(check("const arr = [...items];").diagnostics).toHaveLength(0)
  })

  it("allows mergeProps usage", () => {
    expect(check("const merged = mergeProps(defaults, overrides);").diagnostics).toHaveLength(0)
  })

  it("allows splitProps usage", () => {
    expect(check('const [local, rest] = splitProps(props, ["class"]);').diagnostics).toHaveLength(0)
  })

  it("allows object copy spread in non-reactive code", () => {
    expect(check("const copy = { ...original };").diagnostics).toHaveLength(0)
  })

  // Reactive spreads (props, signals, stores) are reported by default in component contexts
  // because spreading them breaks Solid's fine-grained reactivity.

  it("reports JSX spread of unknown source in component", () => {
    const code = 'function Comp(props) { return <NavComponent {...rest} aria-label="Pagination" />; }'
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidJsxSpread")
  })

  it("reports multiple JSX spreads of unknown sources in component", () => {
    const code = "function Comp(props) { return <CustomComponent {...a} {...b} />; }"
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(2)
  })

  it("reports rest destructuring of props in component", () => {
    const code = "function Comp(props) { const { a, ...rest } = props; return <div />; }"
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidRestDestructure")
  })

  it("reports spread of props in component", () => {
    const code = "function Comp(props) { const copy = { ...props }; return <div />; }"
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidObjectCopy")
  })
})

describe("avoid-type-casting", () => {
  const check = (code: string) => checkRule(avoidTypeCasting, code)

  it("metadata", () => {
    expect(avoidTypeCasting.id).toBe("avoid-type-casting")
    expect(avoidTypeCasting.meta.fixable).toBe(true)
  })

  it("allows simple type annotations", () => {
    expect(check("const x: string = 'hello';").diagnostics).toHaveLength(0)
  })

  it("allows type-safe function returns", () => {
    expect(check("function getString(): string { return 'hello'; }").diagnostics).toHaveLength(0)
  })

  it("allows generic functions with proper constraints", () => {
    expect(check("function identity<T>(x: T): T { return x; }").diagnostics).toHaveLength(0)
  })

  it("allows as const assertion on primitives", () => {
    expect(check("const x = 5 as const;").diagnostics).toHaveLength(0)
  })

  it("allows as const assertion on objects", () => {
    const code = `const MessageIds = {
      DOUBLE_ASSERTION: "doubleAssertion",
      CAST_TO_ANY: "castToAny",
    } as const;`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("reports double assertion through unknown", () => {
    const { diagnostics } = check('const x = "hello" as unknown as number;')
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("doubleAssertion")
  })

  it("reports casting to any", () => {
    const { diagnostics } = check("const x = value as any;")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("castToAny")
  })

  it("reports type predicate functions", () => {
    const code = `function isString(value: unknown): value is string {
      return typeof value === "string";
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("typePredicate")
  })

  it("reports assertion inside for loop", () => {
    const code = `const items: unknown[] = [];
    for (const item of items) {
      const typed = item as string;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("assertionInLoop")
  })
})

describe("event-handlers", () => {
  const check = (code: string) => checkRule(eventHandlers, code)

  it("metadata", () => {
    expect(eventHandlers.id).toBe("event-handlers")
    expect(eventHandlers.meta.fixable).toBe(true)
  })

  it("allows properly cased event handlers", () => {
    expect(check("let el = <div onClick={() => {}} />").diagnostics).toHaveLength(0)
  })

  it("allows on: namespaced handlers", () => {
    expect(check("let el = <div on:click={() => {}} />").diagnostics).toHaveLength(0)
  })

  it("allows oncapture: namespaced handlers", () => {
    expect(check("let el = <div oncapture:click={() => {}} />").diagnostics).toHaveLength(0)
  })

  it("ignores components (PascalCase)", () => {
    expect(check("let el = <Component onclick={() => {}} />").diagnostics).toHaveLength(0)
  })

  it("allows onDblClick", () => {
    expect(check("let el = <div onDblClick={() => {}} />").diagnostics).toHaveLength(0)
  })

  it("reports incorrect capitalization", () => {
    const { diagnostics } = check("let el = <div onclick={() => {}} />")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("capitalization")
  })

  it("reports static value for event handler", () => {
    const { diagnostics } = check('let el = <div onClick="handleClick" />')
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("detectedAttr")
  })

  it("reports nonstandard event name", () => {
    const { diagnostics } = check("let el = <div onDoubleClick={() => {}} />")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("nonstandard")
  })

  it("fixes incorrect capitalization", () => {
    const code = "let el = <div onclick={() => {}} />"
    const { diagnostics } = check(code)
    expect(applyAllFixes(code, diagnostics)).toBe("let el = <div onClick={() => {}} />")
  })

  it("fixes nonstandard event name", () => {
    const code = "let el = <div onDoubleClick={() => {}} />"
    const { diagnostics } = check(code)
    expect(applyAllFixes(code, diagnostics)).toBe("let el = <div onDblClick={() => {}} />")
  })
})

describe("no-array-handlers", () => {
  const check = (code: string) => checkRule(noArrayHandlers, code)

  it("metadata", () => {
    expect(noArrayHandlers.id).toBe("no-array-handlers")
    expect(noArrayHandlers.meta.fixable).toBe(false)
  })

  it("allows normal event handler", () => {
    expect(check("let el = <button onClick={() => 9001} />").diagnostics).toHaveLength(0)
  })

  it("allows event handler with variable reference", () => {
    const code = `const handler = () => 1+1;
    let el = <button onClick={handler} />`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allows prop: namespace array", () => {
    expect(check("let el = <button prop:onClick={[(x) => x, 9001]} />").diagnostics).toHaveLength(0)
  })

  // Note: no-array-handlers uses typeIsArray(graph, attr.valueNode) which requires
  // TypeScript type information. In standalone tests without full TS project,
  // array literals may not have their type info available.
  it("skips array handler detection in standalone mode", () => {
    const code = "let el = <button onClick={[(n) => console.log(n), 'str']} />"
    const { diagnostics } = check(code)
    // typeIsArray requires TS type checker info
    expect(diagnostics).toHaveLength(0)
  })

  it("skips array handler on onMouseOver in standalone mode", () => {
    const code = "let el = <div onMouseOver={[1,2,3]} />"
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("skips array handler on on:click in standalone mode", () => {
    const code = "let el = <div on:click={[handler, i()]} />"
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("no-destructure", () => {
  const check = (code: string) => checkRule(noDestructure, code)

  it("metadata", () => {
    expect(noDestructure.id).toBe("no-destructure")
    expect(noDestructure.meta.fixable).toBe(false)
  })

  it("allows props without destructuring", () => {
    expect(check("let Component = props => <div />").diagnostics).toHaveLength(0)
  })

  it("allows props with parentheses", () => {
    expect(check("let Component = (props) => <div />").diagnostics).toHaveLength(0)
  })

  it("allows accessing props via property access", () => {
    expect(check("let Component = (props) => <div a={props.a} />").diagnostics).toHaveLength(0)
  })

  it("allows functions with multiple parameters", () => {
    const code = "let NotAComponent = ({ a }, more, params) => <div a={a} />"
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allows render props", () => {
    const code = "let Component = props => <Show when={props.show}>{({ value }) => <div>{value}</div>}</Show>"
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allows functions without JSX", () => {
    expect(check("let helper = ({ a, b }) => a + b").diagnostics).toHaveLength(0)
  })

  it("reports destructured props", () => {
    const { diagnostics } = check("let Component = ({ a }) => <div a={a} />")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("noDestructure")
  })

  it("reports empty destructuring", () => {
    const { diagnostics } = check("let Component = ({}) => <div />")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("noDestructure")
  })

  it("reports destructured props with defaults", () => {
    const { diagnostics } = check("let Component = ({ a = 5 }) => <div a={a} />")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("noDestructureWithDefaults")
  })

  it("reports destructured props with rest", () => {
    const { diagnostics } = check("let Component = ({ a, ...rest }) => <div a={a} />")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("noDestructureWithRest")
  })

  // Note: no-destructure has fixable: false - no autofix support
  it("does not provide fixes (fixable: false)", () => {
    const code = "let Component = ({ a }) => <div a={a} />"
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).fix).toBeUndefined()
  })
})

describe("avoid-unsafe-type-annotations", () => {
  const check = (code: string) => checkRule(avoidUnsafeTypeAnnotations, code)

  it("metadata", () => {
    expect(avoidUnsafeTypeAnnotations.id).toBe("avoid-unsafe-type-annotations")
  })

  // --- `any` annotations ---

  it("flags `any` parameter", () => {
    const { diagnostics } = check("function foo(x: any) { return x }")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("anyParameter")
  })

  it("flags `any` return type", () => {
    const { diagnostics } = check("function foo(): any { return 1 }")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("anyReturn")
  })

  it("flags `any` variable", () => {
    const { diagnostics } = check("let x: any = 5")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("anyVariable")
  })

  it("flags `any` class property", () => {
    const { diagnostics } = check("class Foo { x: any }")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("anyProperty")
  })

  it("flags `any` arrow function parameter", () => {
    const { diagnostics } = check("const fn = (x: any) => x")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("anyParameter")
  })

  it("flags `any` arrow function return", () => {
    const { diagnostics } = check("const fn = (): any => 1")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("anyReturn")
  })

  it("flags multiple `any` parameters", () => {
    const { diagnostics } = check("function foo(a: any, b: any) {}")
    expect(diagnostics).toHaveLength(2)
  })

  // --- `unknown` annotations ---

  it("flags `unknown` parameter", () => {
    const { diagnostics } = check("function foo(x: unknown) { return x }")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("unknownParameter")
  })

  it("flags `unknown` return type", () => {
    const { diagnostics } = check("function foo(): unknown { return 1 }")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("unknownReturn")
  })

  it("flags `unknown` variable", () => {
    const { diagnostics } = check("let x: unknown = 5")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("unknownVariable")
  })

  it("flags `unknown` class property", () => {
    const { diagnostics } = check("class Foo { x: unknown }")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("unknownProperty")
  })

  // --- Exemptions: should NOT flag ---

  it("allows `unknown` in catch clause", () => {
    const { diagnostics } = check("try {} catch (e: unknown) {}")
    expect(diagnostics).toHaveLength(0)
  })

  it("allows `unknown` in Record type argument", () => {
    const { diagnostics } = check("const map: Record<string, unknown> = {}")
    expect(diagnostics).toHaveLength(0)
  })

  it("allows `unknown` in type alias", () => {
    const { diagnostics } = check("type Foo = unknown")
    expect(diagnostics).toHaveLength(0)
  })

  it("allows `any` in type alias", () => {
    const { diagnostics } = check("type Foo = any")
    expect(diagnostics).toHaveLength(0)
  })

  it("allows `unknown` in interface member", () => {
    const { diagnostics } = check("interface Foo { bar: unknown }")
    expect(diagnostics).toHaveLength(0)
  })

  it("allows `any` in interface member", () => {
    const { diagnostics } = check("interface Foo { bar: any }")
    expect(diagnostics).toHaveLength(0)
  })

  it("allows `unknown` in generic type argument position", () => {
    const { diagnostics } = check("const x: Map<string, unknown> = new Map()")
    expect(diagnostics).toHaveLength(0)
  })

  it("allows `unknown` in index signature", () => {
    const code = "const obj: { [key: string]: unknown } = {}"
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("allows `unknown` in conditional type", () => {
    const { diagnostics } = check("type Foo<T> = T extends unknown ? T : never")
    expect(diagnostics).toHaveLength(0)
  })

  it("allows `unknown` in .catch() callback parameter", () => {
    const { diagnostics } = check("const p = Promise.resolve(); p.catch((err: unknown) => {})")
    expect(diagnostics).toHaveLength(0)
  })

  it("allows `unknown` in chained .catch() callback", () => {
    const { diagnostics } = check("fetch('/api').then(r => r.json()).catch((err: unknown) => console.log(err))")
    expect(diagnostics).toHaveLength(0)
  })

  it("allows `unknown` in mapped type", () => {
    const { diagnostics } = check("type Foo = { [K in string]: unknown }")
    expect(diagnostics).toHaveLength(0)
  })

  // --- Edge cases ---

  it("flags `any` in const declaration", () => {
    const { diagnostics } = check("const x: any = getValue()")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("anyVariable")
  })

  it("flags `any` in function expression parameter", () => {
    const { diagnostics } = check("const fn = function(x: any) { return x }")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("anyParameter")
  })

  it("includes function name in parameter message", () => {
    const { diagnostics } = check("function processData(input: any) {}")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).message).toContain("processData")
  })

  it("includes function name in return type message", () => {
    const { diagnostics } = check("function getData(): any { return null }")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).message).toContain("getData")
  })
})
