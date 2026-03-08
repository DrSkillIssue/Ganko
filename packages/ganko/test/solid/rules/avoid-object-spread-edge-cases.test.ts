/**
 * avoid-object-spread Edge Case Tests
 *
 * Comprehensive tests for option combinations, edge cases, and complex patterns.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { checkRule, applyAllFixes, at } from "../test-utils"
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

function check(code: string, opts: SpreadTestOptions = {}) {
  resetOptions()
  if (opts.checkDeferred !== undefined) avoidObjectSpread.options["checkDeferred"] = opts.checkDeferred
  if (opts.checkTracked !== undefined) avoidObjectSpread.options["checkTracked"] = opts.checkTracked
  if (opts.checkNonReactive !== undefined) avoidObjectSpread.options["checkNonReactive"] = opts.checkNonReactive
  if (opts.allowedSources !== undefined) avoidObjectSpread.options["allowedSources"] = opts.allowedSources
  return checkRule(avoidObjectSpread, code)
}

describe("avoid-object-spread (option combinations)", () => {
  beforeEach(resetOptions)

  it("deferred context skipped without option", () => {
    const code = `function Component(props) {
      const onClick = () => { const copy = { ...props }; };
      return <button onClick={onClick} />;
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("deferred context reported with checkDeferred", () => {
    const code = `function Component(props) {
      const onClick = () => { const copy = { ...props }; };
      return <button onClick={onClick} />;
    }`
    const { diagnostics } = check(code, { checkDeferred: true })
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidObjectCopy")
  })

  it("allowed source skips even with tracked context", () => {
    const code = `function Component(props) {
      const rest = { a: 1 };
      const copy = { ...rest };
      return <div />;
    }`
    expect(check(code, { allowedSources: ["rest"] }).diagnostics).toHaveLength(0)
  })

  it("non-allowed tracked context reported", () => {
    const code = `function Component(props) {
      const copy = { ...props };
      return <div />;
    }`
    const { diagnostics } = check(code, { allowedSources: ["rest"] })
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidObjectCopy")
  })

  it("all options disabled allows deferred", () => {
    const code = `function Component(props) {
      const onClick = () => { const copy = { ...props }; };
      return <button onClick={onClick} />;
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("combined check options", () => {
    const code = `function Component(props) {
      const copy1 = { ...props };
      const onClick = () => { const copy2 = { ...props }; };
      return <button onClick={onClick} />;
    }`
    const { diagnostics } = check(code, { checkTracked: true, checkDeferred: true })
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics.every(d => d.messageId === "avoidObjectCopy")).toBe(true)
  })

  it("all three options enabled reports all spreads", () => {
    const code = `function Component(props) {
      const plainObj = { a: 1 };
      const copy1 = { ...props };
      const onClick = () => { const copy2 = { ...plainObj }; };
      const copy3 = { ...plainObj };
      return <button onClick={onClick} />;
    }`
    const { diagnostics } = check(code, { checkDeferred: true, checkTracked: true, checkNonReactive: true })
    expect(diagnostics).toHaveLength(3)
    expect(diagnostics.every(d => d.messageId === "avoidObjectCopy")).toBe(true)
  })
})

describe("avoid-object-spread (deep member expressions)", () => {
  beforeEach(resetOptions)

  it("deep member expression classList on DOM element is safe", () => {
    const code = `function Component(props) {
      return <div classList={{ ...props.nested.deep.classes }} />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("double nested style spread on DOM element is safe", () => {
    const code = `function Component(props) {
      return <div style={{ ...props.theme.dark }} />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("nested props in tracked context", () => {
    const code = `function Component(props) {
      const config = { nested: { ...props.config.nested } };
      return <div />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidObjectCopy")
  })

  it("props spread in conditional", () => {
    const code = `function Component(props) {
      const copy = props.nested ? { ...props.nested } : { a: 1 };
      return <div />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidObjectCopy")
  })
})

describe("avoid-object-spread (skip logic)", () => {
  beforeEach(resetOptions)

  it("literal object always skipped", () => {
    const code = `function Component(props) {
      const copy = { ...{ a: 1, b: 2 } };
      return <div />;
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("mergeProps result always safe", () => {
    const code = `import { mergeProps } from 'solid-js';
    function Component(props) {
      const merged = mergeProps({ a: 1 }, props);
      const copy = { ...merged };
      return <div />;
    }`
    expect(check(code, { checkNonReactive: true }).diagnostics).toHaveLength(0)
  })

  it("splitProps rest always safe", () => {
    const code = `import { splitProps } from 'solid-js';
    function Component(props) {
      const [local, rest] = splitProps(props, ['class']);
      const copy = { ...rest };
      return <div />;
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("splitProps rest safe even with checkDeferred", () => {
    const code = `import { splitProps } from 'solid-js';
    function Component(props) {
      const [local, rest] = splitProps(props, ['class']);
      const onClick = () => {
        const copy = { ...rest };
      };
      return <button onClick={onClick} />;
    }`
    expect(check(code, { checkDeferred: true }).diagnostics).toHaveLength(0)
  })

  it("non-safe pattern reported", () => {
    const code = `function Component(props) {
      const copy = { ...props };
      return <div />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidObjectCopy")
  })
})

describe("avoid-object-spread (jsx vs object context)", () => {
  beforeEach(resetOptions)

  it("props in direct jsx spread pure passthrough allowed", () => {
    const code = `function Component(props) {
      return <CustomComponent {...props} />;
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("props in object attribute uses generic message", () => {
    const code = `function Component(props) {
      return <div data-config={{ ...props }} />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidObjectCopy")
  })

  it("jsx spread with computed keys pure passthrough allowed", () => {
    const code = `interface Props {
      onClick: () => void;
    }
    function Component(props: Props) {
      return <CustomButton {...props} />;
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })
})

describe("avoid-object-spread (memo and resource detection)", () => {
  beforeEach(resetOptions)

  it("spread createMemo result uses signal message", () => {
    const code = `import { createMemo } from 'solid-js';
    function Component(props) {
      const memoValue = createMemo(() => ({ 
        a: props.a, 
        b: props.b 
      }));
      const copy = { ...memoValue };
      return <div />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidSignalSpread")
  })

  it("spread createResource result uses signal message", () => {
    const code = `import { createResource } from 'solid-js';
    function Component(props) {
      const [data] = createResource(() => ({ a: props.a }));
      const copy = { ...data };
      return <div />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidSignalSpread")
  })
})

describe("avoid-object-spread (message precedence)", () => {
  beforeEach(resetOptions)

  it("signal in classList on DOM element is safe", () => {
    const code = `import { createSignal } from 'solid-js';
    function Component(props) {
      const [classes] = createSignal({ active: true });
      return <div classList={{ ...classes }} />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("props in style on DOM element is safe", () => {
    const code = `function Component(props) {
      return <div style={{ ...props }} />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("classList spread on component element is safe", () => {
    const code = `function Component(props) {
      return <CustomWidget classList={{ ...props.classes }} />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("style spread on component element is safe", () => {
    const code = `function Component(props) {
      return <CustomWidget style={{ ...props.theme }} />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("avoid-object-spread (fix generation edge cases)", () => {
  beforeEach(resetOptions)

  it("pure passthrough with computed property keys allowed", () => {
    const code = `interface Props {
      'data-value': string;
      onClick: () => void;
    }
    function Component(props: Props) {
      return <CustomButton {...props} />;
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("pure passthrough with mixed keys allowed", () => {
    const code = `interface Props {
      onClick: () => void;
      [key: string]: any;
    }
    function Component(props: Props) {
      return <CustomButton {...props} />;
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("object spread with additional properties", () => {
    const code = `function Component(props) {
      const updated = { ...props, theme: 'dark' };
      return <div />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidObjectUpdate")
  })
})

describe("avoid-object-spread (complex spread patterns)", () => {
  beforeEach(resetOptions)

  it("spread of ternary expression", () => {
    const code = `function Component(props) {
      const copy = { 
        ...(props.type === 'dark' ? props.darkTheme : props.lightTheme) 
      };
      return <div />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidObjectCopy")
  })

  it("spread of logical or", () => {
    const code = `function Component(props) {
      const copy = { ...(props.config || {}) };
      return <div />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidObjectCopy")
  })
})

describe("avoid-object-spread (tracking context)", () => {
  beforeEach(resetOptions)

  it("nested deferred allowed by default", () => {
    const code = `function Component(props) {
      const onClick = () => {
        const onChange = () => {
          const copy = { ...props };
        };
        return onChange;
      };
      return <button onClick={onClick} />;
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("nested deferred checked with option", () => {
    const code = `function Component(props) {
      const onClick = () => {
        const onChange = () => {
          const copy = { ...props };
        };
        return onChange;
      };
      return <button onClick={onClick} />;
    }`
    const { diagnostics } = check(code, { checkDeferred: true })
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidObjectCopy")
  })

  it("spread multiple spreads props", () => {
    const code = `function Component(props) {
      const merged = { ...props, ...props };
      return <div />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics.every(d => d.messageId === "avoidObjectMerge")).toBe(true)
  })
})

describe("avoid-object-spread (native DOM elements)", () => {
  beforeEach(resetOptions)

  it("props spread on native div allowed", () => {
    const code = `import type { ComponentProps } from 'solid-js';
    function Wrapper(props: ComponentProps<"div">) {
      return <div {...props} />;
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("props spread on native button allowed", () => {
    const code = `import type { ComponentProps } from 'solid-js';
    function ToastActions(props: ComponentProps<"div">) {
      return <div data-slot="toast-actions" {...props} />;
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("props spread on multiple native elements", () => {
    const code = `function Component(props) {
      return (
        <>
          <button {...props} />
          <input {...props} />
          <span {...props} />
        </>
      );
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("props spread with additional attrs on native", () => {
    const code = `function Component(props) {
      return <div class="wrapper" {...props} />;
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })
})

describe("avoid-object-spread (pure pass-through)", () => {
  beforeEach(resetOptions)

  it("pure passthrough to component allowed", () => {
    const code = `function ToastTitle(props) {
      return <Kobalte.Title data-slot="toast-title" {...props} />;
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("pure passthrough with static attrs allowed", () => {
    const code = `function ToastDescription(props) {
      return <Kobalte.Description data-slot="toast-description" aria-live="polite" {...props} />;
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("pure passthrough multiple components allowed", () => {
    const code = `function Wrapper(props) {
      return (
        <Container>
          <Header {...props} />
        </Container>
      );
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("pure passthrough to PascalCase component allowed", () => {
    const code = `function Component(props) {
      return <CustomComponent {...props} />;
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("pure passthrough to MyButton allowed", () => {
    const code = `function Component(props) {
      return <MyButton {...props} />;
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("not pure passthrough props accessed locally", () => {
    const code = `function Component(props) {
      const x = props.value;
      return <CustomComponent {...props} />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidPropsSpread")
  })

  it("not pure passthrough props used in expression", () => {
    const code = `function Component(props) {
      return <CustomComponent data-value={props.id} {...props} />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidPropsSpread")
  })

  it("not pure passthrough member expression spread", () => {
    const code = `function Component(props) {
      return <CustomComponent {...props.nested} />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidPropsSpread")
  })
})

describe("avoid-object-spread (unnecessary splitProps detection)", () => {
  beforeEach(resetOptions)

  it("unnecessary splitProps empty array", () => {
    const code = `import { splitProps } from 'solid-js';
    function ToastTitle(props) {
      const [, rest] = splitProps(props, []);
      return <Kobalte.Title data-slot="toast-title" {...rest} />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("unnecessarySplitProps")
  })

  it("unnecessary splitProps with local destructured", () => {
    const code = `import { splitProps } from 'solid-js';
    function Component(props) {
      const [local, rest] = splitProps(props, []);
      return <CustomComponent {...rest} />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("unnecessarySplitProps")
  })
})

describe("avoid-object-spread (edge cases and patterns)", () => {
  beforeEach(resetOptions)

  it("literal objects never reported", () => {
    const code = `function Component(props) {
      const copy = { ...{ a: 1, b: 2 }, ...{ c: 3 } };
      return <div />;
    }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("allowed source pattern with wildcard", () => {
    const code = `function Component(props) {
      const propsLocal = { a: 1 };
      const propsOther = { b: 2 };
      const copy1 = { ...propsLocal };
      const copy2 = { ...propsOther };
      return <div />;
    }`
    expect(check(code, { allowedSources: ["props*"] }).diagnostics).toHaveLength(0)
  })

  it("empty allowedSources matches nothing", () => {
    const code = `function Component(props) {
      return <CustomComponent {...rest} />;
    }`
    const { diagnostics } = check(code, { allowedSources: [] })
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidJsxSpread")
  })

  it("spread with no source name", () => {
    const code = `function Component(props) {
      const complex = (cond ? objA : objB);
      const copy = { ...complex };
      return <div />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidObjectCopy")
  })

  it("spread undefined variable", () => {
    const code = `function Component(props) {
      const copy = { ...externalVar };
      return <div />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidObjectCopy")
  })

  it("multiple spreads in single object", () => {
    const code = `function Component(props) {
      const copy = { ...props, ...props.extra };
      return <div />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics.every(d => d.messageId === "avoidObjectMerge")).toBe(true)
  })

  it("spread in nested object literal", () => {
    const code = `function Component(props) {
      const config = {
        nested: {
          copy: { ...props }
        }
      };
      return <div />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidObjectCopy")
  })

  it("rest parameter destructure avoided", () => {
    const code = `function Component(props) {
      const { a, ...rest } = props;
      return <div />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).messageId).toBe("avoidRestDestructure")
  })

  it("rest from props variable", () => {
    const code = `function Component(props) {
      const { a, ...rest } = props;
      return <CustomComponent {...rest} />;
    }`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(2)
    expect(at(diagnostics, 0).messageId).toBe("avoidRestDestructure")
    expect(at(diagnostics, 1).messageId).toBe("avoidJsxSpread")
  })
})

describe("structural fallback for callback parameter spreads", () => {
  const check = (code: string, opts: SpreadTestOptions = {}) => {
    resetOptions()
    if (opts.checkDeferred !== undefined) avoidObjectSpread.options["checkDeferred"] = opts.checkDeferred
    if (opts.checkTracked !== undefined) avoidObjectSpread.options["checkTracked"] = opts.checkTracked
    if (opts.checkNonReactive !== undefined) avoidObjectSpread.options["checkNonReactive"] = opts.checkNonReactive
    if (opts.allowedSources !== undefined) avoidObjectSpread.options["allowedSources"] = opts.allowedSources
    return checkRule(avoidObjectSpread, code)
  }

  it("generates fix from member accesses on callback parameter", () => {
    const code = `function Parent() {
      return (
        <List itemComponent={(itemProps) => (
          <Item {...itemProps}>
            {itemProps.item.rawValue}
          </Item>
        )} />
      );
    }`
    const { diagnostics } = check(code)
    const spread = diagnostics.find(d => d.messageId === "avoidJsxSpread")
    expect(spread).toBeDefined()
    expect(spread!.fix).toBeDefined()
    const applied = applyAllFixes(code, [spread!])
    expect(applied).toContain("item={itemProps.item}")
    expect(applied).not.toContain("{...itemProps}")
  })

  it("generates fix with multiple discovered properties", () => {
    const code = `function Parent() {
      return (
        <List renderItem={(props) => (
          <Card {...props}>
            {props.title}
            <span>{props.description}</span>
          </Card>
        )} />
      );
    }`
    const { diagnostics } = check(code)
    const spread = diagnostics.find(d => d.messageId === "avoidJsxSpread")
    expect(spread).toBeDefined()
    expect(spread!.fix).toBeDefined()
    const applied = applyAllFixes(code, [spread!])
    expect(applied).toContain("title={props.title}")
    expect(applied).toContain("description={props.description}")
    expect(applied).not.toContain("{...props}")
  })

  it("does not generate fix when no member accesses on parameter", () => {
    const code = `function Parent() {
      return (
        <List renderItem={(props) => (
          <Card {...props} />
        )} />
      );
    }`
    const { diagnostics } = check(code)
    const spread = diagnostics.find(d => d.messageId === "avoidJsxSpread")
    expect(spread).toBeDefined()
    expect(spread!.fix).toBeUndefined()
  })
})
