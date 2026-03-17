import { describe, it, expect, beforeEach } from "vitest"
import { lazyRuleBatch, applyAllFixes, at } from "../test-utils"
import { avoidObjectSpread } from "../../../src/solid/rules/correctness"

function resetOptions() {
  avoidObjectSpread.options["checkDeferred"] = false
  avoidObjectSpread.options["checkTracked"] = false
  avoidObjectSpread.options["checkNonReactive"] = false
  avoidObjectSpread.options["allowedSources"] = []
}

interface SpreadTestOptions {
  checkDeferred?: boolean
  checkTracked?: boolean
  checkNonReactive?: boolean
  allowedSources?: string[]
}

/** Creates a setup callback that configures rule options before check */
function opts(o: SpreadTestOptions = {}): () => void {
  return () => {
    resetOptions()
    if (o.checkDeferred !== undefined) avoidObjectSpread.options["checkDeferred"] = o.checkDeferred
    if (o.checkTracked !== undefined) avoidObjectSpread.options["checkTracked"] = o.checkTracked
    if (o.checkNonReactive !== undefined) avoidObjectSpread.options["checkNonReactive"] = o.checkNonReactive
    if (o.allowedSources !== undefined) avoidObjectSpread.options["allowedSources"] = o.allowedSources
  }
}

const batch = lazyRuleBatch(avoidObjectSpread)

// --- option combinations ---
const oc0 = batch.add(`function Component(props) { const onClick = () => { const copy = { ...props }; }; return <button onClick={onClick} />; }`, opts())
const oc1 = batch.add(`function Component(props) { const onClick = () => { const copy = { ...props }; }; return <button onClick={onClick} />; }`, opts({ checkDeferred: true }))
const oc2 = batch.add(`function Component(props) { const rest = { a: 1 }; const copy = { ...rest }; return <div />; }`, opts({ allowedSources: ["rest"] }))
const oc3 = batch.add(`function Component(props) { const copy = { ...props }; return <div />; }`, opts({ allowedSources: ["rest"] }))
const oc4 = batch.add(`function Component(props) { const onClick = () => { const copy = { ...props }; }; return <button onClick={onClick} />; }`, opts())
const oc5 = batch.add(`function Component(props) { const copy1 = { ...props }; const onClick = () => { const copy2 = { ...props }; }; return <button onClick={onClick} />; }`, opts({ checkTracked: true, checkDeferred: true }))
const oc6 = batch.add(`function Component(props) { const plainObj = { a: 1 }; const copy1 = { ...props }; const onClick = () => { const copy2 = { ...plainObj }; }; const copy3 = { ...plainObj }; return <button onClick={onClick} />; }`, opts({ checkDeferred: true, checkTracked: true, checkNonReactive: true }))

describe("avoid-object-spread (option combinations)", () => {
  it("handles option combinations correctly", () => {
    expect(batch.result(oc0).diagnostics).toHaveLength(0)

    const d1 = batch.result(oc1).diagnostics
    expect(d1).toHaveLength(1)
    expect(at(d1, 0).messageId).toBe("avoidObjectCopy")

    expect(batch.result(oc2).diagnostics).toHaveLength(0)

    const d3 = batch.result(oc3).diagnostics
    expect(d3).toHaveLength(1)
    expect(at(d3, 0).messageId).toBe("avoidObjectCopy")

    expect(batch.result(oc4).diagnostics).toHaveLength(0)

    const d5 = batch.result(oc5).diagnostics
    expect(d5).toHaveLength(2)
    expect(d5.every(d => d.messageId === "avoidObjectCopy")).toBe(true)

    const d6 = batch.result(oc6).diagnostics
    expect(d6).toHaveLength(3)
    expect(d6.every(d => d.messageId === "avoidObjectCopy")).toBe(true)
  })
})

// --- deep member expressions ---
const dm0 = batch.add(`function Component(props) { return <div classList={{ ...props.nested.deep.classes }} />; }`, opts())
const dm1 = batch.add(`function Component(props) { return <div style={{ ...props.theme.dark }} />; }`, opts())
const dm2 = batch.add(`function Component(props) { const config = { nested: { ...props.config.nested } }; return <div />; }`, opts())
const dm3 = batch.add(`function Component(props) { const copy = props.nested ? { ...props.nested } : { a: 1 }; return <div />; }`, opts())

// --- skip logic ---
const sk0 = batch.add(`function Component(props) { const copy = { ...{ a: 1, b: 2 } }; return <div />; }`, opts())
const sk1 = batch.add(`import { mergeProps } from 'solid-js'; function Component(props) { const merged = mergeProps({ a: 1 }, props); const copy = { ...merged }; return <div />; }`, opts({ checkNonReactive: true }))
const sk2 = batch.add(`import { splitProps } from 'solid-js'; function Component(props) { const [local, rest] = splitProps(props, ['class']); const copy = { ...rest }; return <div />; }`, opts())
const sk3 = batch.add(`import { splitProps } from 'solid-js'; function Component(props) { const [local, rest] = splitProps(props, ['class']); const onClick = () => { const copy = { ...rest }; }; return <button onClick={onClick} />; }`, opts({ checkDeferred: true }))
const sk4 = batch.add(`function Component(props) { const copy = { ...props }; return <div />; }`, opts())

// --- jsx vs object context ---
const jx0 = batch.add(`function Component(props) { return <CustomComponent {...props} />; }`, opts())
const jx1 = batch.add(`function Component(props) { return <div data-config={{ ...props }} />; }`, opts())
const jx2 = batch.add(`interface Props { onClick: () => void; } function Component(props: Props) { return <CustomButton {...props} />; }`, opts())

// --- memo and resource detection ---
const mr0 = batch.add(`import { createMemo } from 'solid-js'; function Component(props) { const memoValue = createMemo(() => ({ a: props.a, b: props.b })); const copy = { ...memoValue }; return <div />; }`, opts())
const mr1 = batch.add(`import { createResource } from 'solid-js'; function Component(props) { const [data] = createResource(() => ({ a: props.a })); const copy = { ...data }; return <div />; }`, opts())

// --- message precedence ---
const mp0 = batch.add(`import { createSignal } from 'solid-js'; function Component(props) { const [classes] = createSignal({ active: true }); return <div classList={{ ...classes }} />; }`, opts())
const mp1 = batch.add(`function Component(props) { return <div style={{ ...props }} />; }`, opts())
const mp2 = batch.add(`function Component(props) { return <CustomWidget classList={{ ...props.classes }} />; }`, opts())
const mp3 = batch.add(`function Component(props) { return <CustomWidget style={{ ...props.theme }} />; }`, opts())

// --- fix generation edge cases ---
const fg0 = batch.add(`interface Props { 'data-value': string; onClick: () => void; } function Component(props: Props) { return <CustomButton {...props} />; }`, opts())
const fg1 = batch.add(`interface Props { onClick: () => void; [key: string]: any; } function Component(props: Props) { return <CustomButton {...props} />; }`, opts())
const fg2 = batch.add(`function Component(props) { const updated = { ...props, theme: 'dark' }; return <div />; }`, opts())

// --- complex spread patterns ---
const cp0 = batch.add(`function Component(props) { const copy = { ...(props.type === 'dark' ? props.darkTheme : props.lightTheme) }; return <div />; }`, opts())
const cp1 = batch.add(`function Component(props) { const copy = { ...(props.config || {}) }; return <div />; }`, opts())

// --- tracking context ---
const tc0 = batch.add(`function Component(props) { const onClick = () => { const onChange = () => { const copy = { ...props }; }; return onChange; }; return <button onClick={onClick} />; }`, opts())
const tc1 = batch.add(`function Component(props) { const onClick = () => { const onChange = () => { const copy = { ...props }; }; return onChange; }; return <button onClick={onClick} />; }`, opts({ checkDeferred: true }))
const tc2 = batch.add(`function Component(props) { const merged = { ...props, ...props }; return <div />; }`, opts())

// --- native DOM elements ---
const nd0 = batch.add(`import type { ComponentProps } from 'solid-js'; function Wrapper(props: ComponentProps<"div">) { return <div {...props} />; }`, opts())
const nd1 = batch.add(`import type { ComponentProps } from 'solid-js'; function ToastActions(props: ComponentProps<"div">) { return <div data-slot="toast-actions" {...props} />; }`, opts())
const nd2 = batch.add(`function Component(props) { return (<><button {...props} /><input {...props} /><span {...props} /></>); }`, opts())
const nd3 = batch.add(`function Component(props) { return <div class="wrapper" {...props} />; }`, opts())

// --- pure pass-through ---
const pt0 = batch.add(`function ToastTitle(props) { return <Kobalte.Title data-slot="toast-title" {...props} />; }`, opts())
const pt1 = batch.add(`function ToastDescription(props) { return <Kobalte.Description data-slot="toast-description" aria-live="polite" {...props} />; }`, opts())
const pt2 = batch.add(`function Wrapper(props) { return (<Container><Header {...props} /></Container>); }`, opts())
const pt3 = batch.add(`function Component(props) { return <CustomComponent {...props} />; }`, opts())
const pt4 = batch.add(`function Component(props) { return <MyButton {...props} />; }`, opts())
const pt5 = batch.add(`function Component(props) { const x = props.value; return <CustomComponent {...props} />; }`, opts())
const pt6 = batch.add(`function Component(props) { return <CustomComponent data-value={props.id} {...props} />; }`, opts())
const pt7 = batch.add(`function Component(props) { return <CustomComponent {...props.nested} />; }`, opts())

// --- unnecessary splitProps ---
const us0 = batch.add(`import { splitProps } from 'solid-js'; function ToastTitle(props) { const [, rest] = splitProps(props, []); return <Kobalte.Title data-slot="toast-title" {...rest} />; }`, opts())
const us1 = batch.add(`import { splitProps } from 'solid-js'; function Component(props) { const [local, rest] = splitProps(props, []); return <CustomComponent {...rest} />; }`, opts())

// --- edge cases and patterns ---
const ec0 = batch.add(`function Component(props) { const copy = { ...{ a: 1, b: 2 }, ...{ c: 3 } }; return <div />; }`, opts())
const ec1 = batch.add(`function Component(props) { const propsLocal = { a: 1 }; const propsOther = { b: 2 }; const copy1 = { ...propsLocal }; const copy2 = { ...propsOther }; return <div />; }`, opts({ allowedSources: ["props*"] }))
const ec2 = batch.add(`function Component(props) { return <CustomComponent {...rest} />; }`, opts({ allowedSources: [] }))
const ec3 = batch.add(`function Component(props) { const complex = (cond ? objA : objB); const copy = { ...complex }; return <div />; }`, opts())
const ec4 = batch.add(`function Component(props) { const copy = { ...externalVar }; return <div />; }`, opts())
const ec5 = batch.add(`function Component(props) { const copy = { ...props, ...props.extra }; return <div />; }`, opts())
const ec6 = batch.add(`function Component(props) { const config = { nested: { copy: { ...props } } }; return <div />; }`, opts())
const ec7 = batch.add(`function Component(props) { const { a, ...rest } = props; return <div />; }`, opts())
const ec8 = batch.add(`function Component(props) { const { a, ...rest } = props; return <CustomComponent {...rest} />; }`, opts())

// --- structural fallback ---
const sf0 = batch.add(`function Parent() { return (<List itemComponent={(itemProps) => (<Item {...itemProps}>{itemProps.item.rawValue}</Item>)} />); }`, opts())
const sf1 = batch.add(`function Parent() { return (<List renderItem={(props) => (<Card {...props}>{props.title}<span>{props.description}</span></Card>)} />); }`, opts())
const sf2 = batch.add(`function Parent() { return (<List renderItem={(props) => (<Card {...props} />)} />); }`, opts())

describe("avoid-object-spread (deep member expressions)", () => {
  it("handles deep member expression patterns", () => {
    expect(batch.result(dm0).diagnostics).toHaveLength(0)
    expect(batch.result(dm1).diagnostics).toHaveLength(0)
    expect(at(batch.result(dm2).diagnostics, 0).messageId).toBe("avoidObjectCopy")
    expect(at(batch.result(dm3).diagnostics, 0).messageId).toBe("avoidObjectCopy")
  })
})

describe("avoid-object-spread (skip logic)", () => {
  it("skips safe patterns and reports unsafe ones", () => {
    expect(batch.result(sk0).diagnostics).toHaveLength(0)
    expect(batch.result(sk1).diagnostics).toHaveLength(0)
    expect(batch.result(sk2).diagnostics).toHaveLength(0)
    expect(batch.result(sk3).diagnostics).toHaveLength(0)
    expect(at(batch.result(sk4).diagnostics, 0).messageId).toBe("avoidObjectCopy")
  })
})

describe("avoid-object-spread (jsx vs object context)", () => {
  it("distinguishes jsx and object spread contexts", () => {
    expect(batch.result(jx0).diagnostics).toHaveLength(0)
    expect(at(batch.result(jx1).diagnostics, 0).messageId).toBe("avoidObjectCopy")
    expect(batch.result(jx2).diagnostics).toHaveLength(0)
  })
})

describe("avoid-object-spread (memo and resource detection)", () => {
  it("detects signal spread from memo and resource", () => {
    expect(at(batch.result(mr0).diagnostics, 0).messageId).toBe("avoidSignalSpread")
    expect(at(batch.result(mr1).diagnostics, 0).messageId).toBe("avoidSignalSpread")
  })
})

describe("avoid-object-spread (message precedence)", () => {
  it("allows safe classList/style spreads on DOM and component elements", () => {
    expect(batch.result(mp0).diagnostics).toHaveLength(0)
    expect(batch.result(mp1).diagnostics).toHaveLength(0)
    expect(batch.result(mp2).diagnostics).toHaveLength(0)
    expect(batch.result(mp3).diagnostics).toHaveLength(0)
  })
})

describe("avoid-object-spread (fix generation edge cases)", () => {
  it("allows pure passthrough and detects object update spread", () => {
    expect(batch.result(fg0).diagnostics).toHaveLength(0)
    expect(batch.result(fg1).diagnostics).toHaveLength(0)
    expect(at(batch.result(fg2).diagnostics, 0).messageId).toBe("avoidObjectUpdate")
  })
})

describe("avoid-object-spread (complex spread patterns)", () => {
  it("detects ternary and logical-or spreads", () => {
    expect(at(batch.result(cp0).diagnostics, 0).messageId).toBe("avoidObjectCopy")
    expect(at(batch.result(cp1).diagnostics, 0).messageId).toBe("avoidObjectCopy")
  })
})

describe("avoid-object-spread (tracking context)", () => {
  it("handles nested deferred and multiple spreads", () => {
    expect(batch.result(tc0).diagnostics).toHaveLength(0)
    expect(at(batch.result(tc1).diagnostics, 0).messageId).toBe("avoidObjectCopy")
    const d2 = batch.result(tc2).diagnostics
    expect(d2).toHaveLength(2)
    expect(d2.every(d => d.messageId === "avoidObjectMerge")).toBe(true)
  })
})

describe("avoid-object-spread (native DOM elements)", () => {
  it("allows props spread on native DOM elements", () => {
    expect(batch.result(nd0).diagnostics).toHaveLength(0)
    expect(batch.result(nd1).diagnostics).toHaveLength(0)
    expect(batch.result(nd2).diagnostics).toHaveLength(0)
    expect(batch.result(nd3).diagnostics).toHaveLength(0)
  })
})

describe("avoid-object-spread (pure pass-through)", () => {
  it("allows pure passthrough and detects non-pure patterns", () => {
    expect(batch.result(pt0).diagnostics).toHaveLength(0)
    expect(batch.result(pt1).diagnostics).toHaveLength(0)
    expect(batch.result(pt2).diagnostics).toHaveLength(0)
    expect(batch.result(pt3).diagnostics).toHaveLength(0)
    expect(batch.result(pt4).diagnostics).toHaveLength(0)
    expect(at(batch.result(pt5).diagnostics, 0).messageId).toBe("avoidPropsSpread")
    expect(at(batch.result(pt6).diagnostics, 0).messageId).toBe("avoidPropsSpread")
    expect(at(batch.result(pt7).diagnostics, 0).messageId).toBe("avoidPropsSpread")
  })
})

describe("avoid-object-spread (unnecessary splitProps detection)", () => {
  it("detects unnecessary splitProps with empty array", () => {
    expect(at(batch.result(us0).diagnostics, 0).messageId).toBe("unnecessarySplitProps")
    expect(at(batch.result(us1).diagnostics, 0).messageId).toBe("unnecessarySplitProps")
  })
})

describe("avoid-object-spread (edge cases and patterns)", () => {
  it("handles all edge cases correctly", () => {
    expect(batch.result(ec0).diagnostics).toHaveLength(0)
    expect(batch.result(ec1).diagnostics).toHaveLength(0)
    expect(at(batch.result(ec2).diagnostics, 0).messageId).toBe("avoidJsxSpread")
    expect(at(batch.result(ec3).diagnostics, 0).messageId).toBe("avoidObjectCopy")
    expect(at(batch.result(ec4).diagnostics, 0).messageId).toBe("avoidObjectCopy")
    const d5 = batch.result(ec5).diagnostics
    expect(d5).toHaveLength(2)
    expect(d5.every(d => d.messageId === "avoidObjectMerge")).toBe(true)
    expect(at(batch.result(ec6).diagnostics, 0).messageId).toBe("avoidObjectCopy")
    expect(at(batch.result(ec7).diagnostics, 0).messageId).toBe("avoidRestDestructure")
    const d8 = batch.result(ec8).diagnostics
    expect(d8).toHaveLength(2)
    expect(at(d8, 0).messageId).toBe("avoidRestDestructure")
    expect(at(d8, 1).messageId).toBe("avoidJsxSpread")
  })
})

describe("structural fallback for callback parameter spreads", () => {
  it("generates fix from member accesses and skips when none found", () => {
    const d0 = batch.result(sf0).diagnostics
    const spread0 = d0.find(d => d.messageId === "avoidJsxSpread")
    expect(spread0).toBeDefined()
    expect(spread0!.fix).toBeDefined()
    const applied0 = applyAllFixes(`function Parent() { return (<List itemComponent={(itemProps) => (<Item {...itemProps}>{itemProps.item.rawValue}</Item>)} />); }`, [spread0!])
    expect(applied0).toContain("item={itemProps.item}")

    const d1 = batch.result(sf1).diagnostics
    const spread1 = d1.find(d => d.messageId === "avoidJsxSpread")
    expect(spread1).toBeDefined()
    expect(spread1!.fix).toBeDefined()
    const applied1 = applyAllFixes(`function Parent() { return (<List renderItem={(props) => (<Card {...props}>{props.title}<span>{props.description}</span></Card>)} />); }`, [spread1!])
    expect(applied1).toContain("title={props.title}")
    expect(applied1).toContain("description={props.description}")

    const d2 = batch.result(sf2).diagnostics
    const spread2 = d2.find(d => d.messageId === "avoidJsxSpread")
    expect(spread2).toBeDefined()
    expect(spread2!.fix).toBeUndefined()
  })
})
