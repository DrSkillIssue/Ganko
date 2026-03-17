/**
 * Correctness Rules Tests
 */

import { describe, it, expect } from "vitest"
import { lazyRuleBatch, applyAllFixes, at } from "../test-utils"
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
  const batch = lazyRuleBatch(avoidConditionalSpreads)
  const cs0 = batch.add('const obj = { ...baseObj, color: "red" };')
  const cs1 = batch.add("const obj = { ...props };")
  const cs2 = batch.add("const obj = cond ? { ...a } : { ...b };")
  const cs3 = batch.add('const obj = { color: cond ? "red" : "blue" };')
  const cs4 = batch.add("const obj = { ...getStyles() };")
  const cs5 = batch.add("const obj = { ...(cond ? { a: 1 } : { b: 2 }) };")
  const cs6 = batch.add('const obj = { ...(cond ? { color: "red" } : {}) };')
  const cs7 = batch.add('const obj = { ...(cond ? {} : { color: "red" }) };')
  const cs8 = batch.add('const obj = { ...(cond && { color: "red" }) };')
  const cs9 = batch.add(`const obj = { ...baseStyle, ...(condA ? { a: 1 } : {}), ...(condB && { b: 2 }), };`)
  const cs10 = batch.add(`function Component(props) { return (<div classList={{ ...(props.active ? { active: true } : {}), }} />); }`)
  const cs11 = batch.add(`function Component(props) { return (<CustomWidget classList={{ ...(props.active ? { active: true } : {}), }} />); }`)
  const cs12 = batch.add(`function Component(props) { return (<div style={{ ...(props.bold && { "font-weight": "bold" }), }} />); }`)
  const cs13 = batch.add(`function Component(props) { const obj = { ...(props.active ? { active: true } : {}), }; return <div />; }`)

  it("metadata", () => { expect(avoidConditionalSpreads.id).toBe("avoid-conditional-spreads") })

  it("allows valid spread patterns", () => {
    expect(batch.result(cs0).diagnostics).toHaveLength(0)
    expect(batch.result(cs1).diagnostics).toHaveLength(0)
    expect(batch.result(cs2).diagnostics).toHaveLength(0)
    expect(batch.result(cs3).diagnostics).toHaveLength(0)
    expect(batch.result(cs4).diagnostics).toHaveLength(0)
    expect(batch.result(cs5).diagnostics).toHaveLength(0)
    expect(batch.result(cs10).diagnostics).toHaveLength(0)
    expect(batch.result(cs11).diagnostics).toHaveLength(0)
    expect(batch.result(cs12).diagnostics).toHaveLength(0)
  })

  it("reports conditional spread patterns", () => {
    expect(at(batch.result(cs6).diagnostics, 0).messageId).toBe("avoidConditionalSpread")
    expect(at(batch.result(cs7).diagnostics, 0).messageId).toBe("avoidConditionalSpread")
    expect(at(batch.result(cs8).diagnostics, 0).messageId).toBe("avoidLogicalAndSpread")
    expect(batch.result(cs9).diagnostics).toHaveLength(2)
    expect(batch.result(cs13).diagnostics).toHaveLength(1)
  })
})

describe("avoid-non-null-assertions", () => {
  const batch = lazyRuleBatch(avoidNonNullAssertions)
  const nn0 = batch.add("const x = obj?.property;")
  const nn1 = batch.add("const x = value ?? defaultValue;")
  const nn2 = batch.add("const x = obj.property;")
  const nn3 = batch.add("const x = !!value;")
  const nn4 = batch.add("const x = !value;")
  const nn5 = batch.add("const x = value!;")
  const nn6 = batch.add("const x = obj!.property;")
  const nn7 = batch.add("const x = arr![0];")
  const nn8 = batch.add("const x = getData()!;")
  const nn9 = batch.add("const x = a!; const y = b!;")
  const nn10 = batch.add("const x = obj!.nested!.value;")

  it("metadata", () => { expect(avoidNonNullAssertions.id).toBe("avoid-non-null-assertions"); expect(avoidNonNullAssertions.meta.fixable).toBe(true) })

  it("allows safe alternatives and reports non-null assertions with fix", () => {
    expect(batch.result(nn0).diagnostics).toHaveLength(0)
    expect(batch.result(nn1).diagnostics).toHaveLength(0)
    expect(batch.result(nn2).diagnostics).toHaveLength(0)
    expect(batch.result(nn3).diagnostics).toHaveLength(0)
    expect(batch.result(nn4).diagnostics).toHaveLength(0)

    const d5 = batch.result(nn5).diagnostics
    expect(d5).toHaveLength(1)
    expect(at(d5, 0).messageId).toBe("avoidNonNull")
    expect(applyAllFixes("const x = value!;", d5)).toBe("const x = value;")

    expect(batch.result(nn6).diagnostics).toHaveLength(1)
    expect(batch.result(nn7).diagnostics).toHaveLength(1)
    expect(batch.result(nn8).diagnostics).toHaveLength(1)
    expect(batch.result(nn9).diagnostics).toHaveLength(2)
    expect(batch.result(nn10).diagnostics).toHaveLength(2)
  })
})

describe("avoid-object-spread", () => {
  const batch = lazyRuleBatch(avoidObjectSpread)
  const os0 = batch.add("const value = props.name;")
  const os1 = batch.add("const obj = { a: 1, b: 2 };")
  const os2 = batch.add("const arr = [...items];")
  const os3 = batch.add("const merged = mergeProps(defaults, overrides);")
  const os4 = batch.add('const [local, rest] = splitProps(props, ["class"]);')
  const os5 = batch.add("const copy = { ...original };")
  const os6 = batch.add('function Comp(props) { return <NavComponent {...rest} aria-label="Pagination" />; }')
  const os7 = batch.add("function Comp(props) { return <CustomComponent {...a} {...b} />; }")
  const os8 = batch.add("function Comp(props) { const { a, ...rest } = props; return <div />; }")
  const os9 = batch.add("function Comp(props) { const copy = { ...props }; return <div />; }")

  it("metadata", () => { expect(avoidObjectSpread.id).toBe("avoid-object-spread") })

  it("allows valid patterns and reports reactive spreads", () => {
    expect(batch.result(os0).diagnostics).toHaveLength(0)
    expect(batch.result(os1).diagnostics).toHaveLength(0)
    expect(batch.result(os2).diagnostics).toHaveLength(0)
    expect(batch.result(os3).diagnostics).toHaveLength(0)
    expect(batch.result(os4).diagnostics).toHaveLength(0)
    expect(batch.result(os5).diagnostics).toHaveLength(0)

    expect(at(batch.result(os6).diagnostics, 0).messageId).toBe("avoidJsxSpread")
    expect(batch.result(os7).diagnostics).toHaveLength(2)
    expect(at(batch.result(os8).diagnostics, 0).messageId).toBe("avoidRestDestructure")
    expect(at(batch.result(os9).diagnostics, 0).messageId).toBe("avoidObjectCopy")
  })
})

describe("avoid-type-casting", () => {
  const batch = lazyRuleBatch(avoidTypeCasting)
  const tc0 = batch.add("const x: string = 'hello';")
  const tc1 = batch.add("function getString(): string { return 'hello'; }")
  const tc2 = batch.add("function identity<T>(x: T): T { return x; }")
  const tc3 = batch.add("const x = 5 as const;")
  const tc4 = batch.add(`const MessageIds = { DOUBLE_ASSERTION: "doubleAssertion", CAST_TO_ANY: "castToAny", } as const;`)
  const tc5 = batch.add('const x = "hello" as unknown as number;')
  const tc6 = batch.add("const x = value as any;")
  const tc7 = batch.add(`function isString(value: unknown): value is string { return typeof value === "string"; }`)
  const tc8 = batch.add(`const items: unknown[] = []; for (const item of items) { const typed = item as string; }`)

  it("metadata", () => { expect(avoidTypeCasting.id).toBe("avoid-type-casting"); expect(avoidTypeCasting.meta.fixable).toBe(true) })

  it("allows valid type patterns and reports unsafe casting", () => {
    expect(batch.result(tc0).diagnostics).toHaveLength(0)
    expect(batch.result(tc1).diagnostics).toHaveLength(0)
    expect(batch.result(tc2).diagnostics).toHaveLength(0)
    expect(batch.result(tc3).diagnostics).toHaveLength(0)
    expect(batch.result(tc4).diagnostics).toHaveLength(0)

    expect(at(batch.result(tc5).diagnostics, 0).messageId).toBe("doubleAssertion")
    expect(at(batch.result(tc6).diagnostics, 0).messageId).toBe("castToAny")
    expect(at(batch.result(tc7).diagnostics, 0).messageId).toBe("typePredicate")
    expect(at(batch.result(tc8).diagnostics, 0).messageId).toBe("assertionInLoop")
  })
})

describe("event-handlers", () => {
  const batch = lazyRuleBatch(eventHandlers)
  const eh0 = batch.add("let el = <div onClick={() => {}} />")
  const eh1 = batch.add("let el = <div on:click={() => {}} />")
  const eh2 = batch.add("let el = <div oncapture:click={() => {}} />")
  const eh3 = batch.add("let el = <Component onclick={() => {}} />")
  const eh4 = batch.add("let el = <div onDblClick={() => {}} />")
  const eh5 = batch.add("let el = <div onclick={() => {}} />")
  const eh6 = batch.add('let el = <div onClick="handleClick" />')
  const eh7 = batch.add("let el = <div onDoubleClick={() => {}} />")

  it("metadata", () => { expect(eventHandlers.id).toBe("event-handlers"); expect(eventHandlers.meta.fixable).toBe(true) })

  it("allows valid handlers and reports/fixes invalid ones", () => {
    expect(batch.result(eh0).diagnostics).toHaveLength(0)
    expect(batch.result(eh1).diagnostics).toHaveLength(0)
    expect(batch.result(eh2).diagnostics).toHaveLength(0)
    expect(batch.result(eh3).diagnostics).toHaveLength(0)
    expect(batch.result(eh4).diagnostics).toHaveLength(0)

    expect(at(batch.result(eh5).diagnostics, 0).messageId).toBe("capitalization")
    expect(applyAllFixes("let el = <div onclick={() => {}} />", batch.result(eh5).diagnostics)).toBe("let el = <div onClick={() => {}} />")

    expect(at(batch.result(eh6).diagnostics, 0).messageId).toBe("detectedAttr")

    expect(at(batch.result(eh7).diagnostics, 0).messageId).toBe("nonstandard")
    expect(applyAllFixes("let el = <div onDoubleClick={() => {}} />", batch.result(eh7).diagnostics)).toBe("let el = <div onDblClick={() => {}} />")
  })
})

describe("no-array-handlers", () => {
  const batch = lazyRuleBatch(noArrayHandlers)
  const ah0 = batch.add("let el = <button onClick={() => 9001} />")
  const ah1 = batch.add(`const handler = () => 1+1;\n    let el = <button onClick={handler} />`)
  const ah2 = batch.add("let el = <button prop:onClick={[(x) => x, 9001]} />")
  const ah3 = batch.add("let el = <button onClick={[(n) => console.log(n), 'str']} />")
  const ah4 = batch.add("let el = <div onMouseOver={[1,2,3]} />")
  const ah5 = batch.add("let el = <div on:click={[handler, i()]} />")

  it("metadata", () => { expect(noArrayHandlers.id).toBe("no-array-handlers") })

  it("allows valid handlers and skips array detection in standalone mode", () => {
    expect(batch.result(ah0).diagnostics).toHaveLength(0)
    expect(batch.result(ah1).diagnostics).toHaveLength(0)
    expect(batch.result(ah2).diagnostics).toHaveLength(0)
    expect(batch.result(ah3).diagnostics).toHaveLength(0)
    expect(batch.result(ah4).diagnostics).toHaveLength(0)
    expect(batch.result(ah5).diagnostics).toHaveLength(0)
  })
})

describe("no-destructure", () => {
  const batch = lazyRuleBatch(noDestructure)
  const nd0 = batch.add("let Component = props => <div />")
  const nd1 = batch.add("let Component = (props) => <div />")
  const nd2 = batch.add("let Component = (props) => <div a={props.a} />")
  const nd3 = batch.add("let NotAComponent = ({ a }, more, params) => <div a={a} />")
  const nd4 = batch.add("let Component = props => <Show when={props.show}>{({ value }) => <div>{value}</div>}</Show>")
  const nd5 = batch.add("let helper = ({ a, b }) => a + b")
  const nd6 = batch.add("let Component = ({ a }) => <div a={a} />")
  const nd7 = batch.add("let Component = ({}) => <div />")
  const nd8 = batch.add("let Component = ({ a = 5 }) => <div a={a} />")
  const nd9 = batch.add("let Component = ({ a, ...rest }) => <div a={a} />")

  it("metadata", () => { expect(noDestructure.id).toBe("no-destructure") })

  it("allows valid props access and reports destructured props", () => {
    expect(batch.result(nd0).diagnostics).toHaveLength(0)
    expect(batch.result(nd1).diagnostics).toHaveLength(0)
    expect(batch.result(nd2).diagnostics).toHaveLength(0)
    expect(batch.result(nd3).diagnostics).toHaveLength(0)
    expect(batch.result(nd4).diagnostics).toHaveLength(0)
    expect(batch.result(nd5).diagnostics).toHaveLength(0)

    expect(at(batch.result(nd6).diagnostics, 0).messageId).toBe("noDestructure")
    expect(at(batch.result(nd6).diagnostics, 0).fix).toBeUndefined()
    expect(at(batch.result(nd7).diagnostics, 0).messageId).toBe("noDestructure")
    expect(at(batch.result(nd8).diagnostics, 0).messageId).toBe("noDestructureWithDefaults")
    expect(at(batch.result(nd9).diagnostics, 0).messageId).toBe("noDestructureWithRest")
  })
})

describe("avoid-unsafe-type-annotations", () => {
  const batch = lazyRuleBatch(avoidUnsafeTypeAnnotations)
  const ut0 = batch.add("function foo(x: any) { return x }")
  const ut1 = batch.add("function foo(): any { return 1 }")
  const ut2 = batch.add("let x: any = 5")
  const ut3 = batch.add("class Foo { x: any }")
  const ut4 = batch.add("const fn = (x: any) => x")
  const ut5 = batch.add("const fn = (): any => 1")
  const ut6 = batch.add("function foo(a: any, b: any) {}")
  const ut7 = batch.add("function foo(x: unknown) { return x }")
  const ut8 = batch.add("function foo(): unknown { return 1 }")
  const ut9 = batch.add("let x: unknown = 5")
  const ut10 = batch.add("class Foo { x: unknown }")
  const ut11 = batch.add("try {} catch (e: unknown) {}")
  const ut12 = batch.add("const map: Record<string, unknown> = {}")
  const ut13 = batch.add("type Foo = unknown")
  const ut14 = batch.add("type Foo = any")
  const ut15 = batch.add("interface Foo { bar: unknown }")
  const ut16 = batch.add("interface Foo { bar: any }")
  const ut17 = batch.add("const x: Map<string, unknown> = new Map()")
  const ut18 = batch.add("const obj: { [key: string]: unknown } = {}")
  const ut19 = batch.add("type Foo<T> = T extends unknown ? T : never")
  const ut20 = batch.add("const p = Promise.resolve(); p.catch((err: unknown) => {})")
  const ut21 = batch.add("fetch('/api').then(r => r.json()).catch((err: unknown) => console.log(err))")
  const ut22 = batch.add("type Foo = { [K in string]: unknown }")
  const ut23 = batch.add("const x: any = getValue()")
  const ut24 = batch.add("const fn = function(x: any) { return x }")
  const ut25 = batch.add("function processData(input: any) {}")
  const ut26 = batch.add("function getData(): any { return null }")

  it("metadata", () => { expect(avoidUnsafeTypeAnnotations.id).toBe("avoid-unsafe-type-annotations") })

  it("flags any/unknown annotations in parameters, returns, variables, and properties", () => {
    expect(at(batch.result(ut0).diagnostics, 0).messageId).toBe("anyParameter")
    expect(at(batch.result(ut1).diagnostics, 0).messageId).toBe("anyReturn")
    expect(at(batch.result(ut2).diagnostics, 0).messageId).toBe("anyVariable")
    expect(at(batch.result(ut3).diagnostics, 0).messageId).toBe("anyProperty")
    expect(at(batch.result(ut4).diagnostics, 0).messageId).toBe("anyParameter")
    expect(at(batch.result(ut5).diagnostics, 0).messageId).toBe("anyReturn")
    expect(batch.result(ut6).diagnostics).toHaveLength(2)
    expect(at(batch.result(ut7).diagnostics, 0).messageId).toBe("unknownParameter")
    expect(at(batch.result(ut8).diagnostics, 0).messageId).toBe("unknownReturn")
    expect(at(batch.result(ut9).diagnostics, 0).messageId).toBe("unknownVariable")
    expect(at(batch.result(ut10).diagnostics, 0).messageId).toBe("unknownProperty")
    expect(at(batch.result(ut23).diagnostics, 0).messageId).toBe("anyVariable")
    expect(at(batch.result(ut24).diagnostics, 0).messageId).toBe("anyParameter")
    expect(at(batch.result(ut25).diagnostics, 0).message).toContain("processData")
    expect(at(batch.result(ut26).diagnostics, 0).message).toContain("getData")
  })

  it("allows exempt positions (catch, Record, type alias, interface, generics, index sig, conditional, .catch(), mapped)", () => {
    expect(batch.result(ut11).diagnostics).toHaveLength(0)
    expect(batch.result(ut12).diagnostics).toHaveLength(0)
    expect(batch.result(ut13).diagnostics).toHaveLength(0)
    expect(batch.result(ut14).diagnostics).toHaveLength(0)
    expect(batch.result(ut15).diagnostics).toHaveLength(0)
    expect(batch.result(ut16).diagnostics).toHaveLength(0)
    expect(batch.result(ut17).diagnostics).toHaveLength(0)
    expect(batch.result(ut18).diagnostics).toHaveLength(0)
    expect(batch.result(ut19).diagnostics).toHaveLength(0)
    expect(batch.result(ut20).diagnostics).toHaveLength(0)
    expect(batch.result(ut21).diagnostics).toHaveLength(0)
    expect(batch.result(ut22).diagnostics).toHaveLength(0)
  })
})
