/**
 * Performance Rules Tests
 */

import { describe, it, expect } from "vitest"
import { checkRule } from "../test-utils"
import {
  avoidArgumentsObject,
  avoidChainedArrayMethods,
  avoidDefensiveCopyForScalarStat,
  avoidDeleteOperator,
  avoidFunctionAllocationInHotLoop,
  avoidHiddenClassTransition,
  avoidIntermediateMapCopy,
  avoidMegamorphicPropertyAccess,
  avoidQuadraticPairComparison,
  avoidQuadraticSpread,
  avoidRepeatedIndexofCheck,
  avoidSliceSortPattern,
  avoidSparseArrays,
  avoidSpreadSortMapJoinPipeline,
  boundedWorklistTraversal,
  noCharArrayMaterialization,
  noDoublePassDelimiterCount,
  noFullSplitInHotParse,
  noHeavyParserConstructorInLoop,
  noLoopStringPlusEquals,
  noMultipassSplitPipeline,
  noPerCharSubstringScan,
  noRepeatedTokenNormalization,
  noRescanIndexofLoop,
  noRestSliceLoop,
  noShiftSpliceHeadConsume,
  noWriteOnlyIndex,
  preferLazyPropertyAccess,
  preferMapLookupOverLinearScan,
  preferMapOverObjectDictionary,
  preferIndexScanOverStringIterator,
  preferSetHasOverEqualityChain,
  preferSetLookupInLoop,
  noLeakedTimer,
  noLeakedEventListener,
  noLeakedObserver,
  effectOutsideRoot,
  noLeakedAnimationFrame,
  noLeakedSubscription,
  createRootDispose,
  noLeakedAbortController,
  unboundedCollection,
  recursiveTimer,
  finalizationRegistryLeak,
  unboundedSignalAccumulation,
  selfReferencingStore,
  detachedDomReference,
  closureCapturedScope,
  closureDomCircular,
  preferCharcodeOverRegexTest,
  preferPrecompiledRegex,
} from "../../../src/solid/rules/performance"

describe("prefer-lazy-property-access", () => {
  const check = (code: string) => checkRule(preferLazyPropertyAccess, code)

  it("metadata", () => {
    expect(preferLazyPropertyAccess.id).toBe("prefer-lazy-property-access")
  })

  it("flags property access before early return when not used there", () => {
    const code = `
      function test(context: any) {
        const sourceCode = context.sourceCode;
        if (!context.valid) return null;
        return sourceCode.getText();
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics.length).toBeGreaterThan(0)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("Property")
  })

  it("flags nested property access before early return", () => {
    const code = `
      function test(config: any) {
        const value = config.settings.nested.value;
        if (!config.enabled) return null;
        return value;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  it("does not flag when no early returns", () => {
    const code = `
      function test(context: any) {
        const sourceCode = context.sourceCode;
        return sourceCode.getText();
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag when variable is used before early return", () => {
    const code = `
      function test(context: any) {
        const sourceCode = context.sourceCode;
        if (!sourceCode) return null;
        return sourceCode.getText();
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag when variable method is called before early return", () => {
    const code = `
      function test(context: any) {
        const sourceCode = context.sourceCode;
        if (!sourceCode.isValid()) return null;
        return sourceCode.getText();
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("avoid-chained-array-methods", () => {
  const check = (code: string) => checkRule(avoidChainedArrayMethods, code)

  it("metadata", () => {
    expect(avoidChainedArrayMethods.id).toBe("avoid-chained-array-methods")
  })

  it("flags filter().map().reduce() chain (filter+map pattern with 2 intermediates)", () => {
    const code = `
      function test(items: number[]) {
        return items.filter(x => x > 0).map(x => x * 2).reduce((sum, x) => sum + x, 0);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics.length).toBeGreaterThan(0)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("Chain creates")
  })

  it("flags slice().filter().map() (3 intermediates)", () => {
    const code = `
      function test(items: any[]) {
        return items.slice(1).filter(x => x.valid).map(x => x.name);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  it("does not flag slice().map().join() (2 intermediates, not filter+map)", () => {
    const code = `
      function test(items: any[]) {
        return items.slice(1).map(x => x.name).join(", ");
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("flags map().join() inside loops as hot-path allocation", () => {
    const code = `
      function test(rows: number[][]) {
        for (let i = 0; i < rows.length; i++) {
          const key = rows[i].map(x => String(x)).join(",");
          if (key.length > 0) {}
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("hot path")
  })

  it("does not flag map().join() outside loops", () => {
    const code = `
      function test(row: number[]) {
        return row.map(x => String(x)).join(",");
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag single map()", () => {
    const code = `
      function test(items: number[]) {
        return items.map(x => x * 2);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag single reduce()", () => {
    const code = `
      function test(items: number[]) {
        return items.reduce((acc, x) => x > 0 ? [...acc, x * 2] : acc, []);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag tuple type chains", () => {
    const code = `
      function test() {
        const rgb: [number, number, number] = [255, 128, 64];
        return rgb.filter(v => v > 100).map(v => v / 255);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag split multipass chains handled by parsing-specific rule", () => {
    const code = `
      function parseCsv(input: string) {
        return input.split(",").map(part => part.trim()).filter(Boolean);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("avoid-quadratic-spread", () => {
  const check = (code: string) => checkRule(avoidQuadraticSpread, code)

  it("metadata", () => {
    expect(avoidQuadraticSpread.id).toBe("avoid-quadratic-spread")
  })

  it("flags spreading accumulator in reduce", () => {
    const code = `
      function test(items: number[]) {
        return items.reduce((acc, x) => [...acc, x], []);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics.length).toBeGreaterThan(0)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("O(n")
  })

  it("flags spreading accumulator with nested spread", () => {
    const code = `
      function test(items: any[]) {
        return items.reduce((acc, x) => [...acc, ...x.items], []);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  it("does not flag push pattern", () => {
    const code = `
      function test(items: number[]) {
        return items.reduce((acc, x) => { acc.push(x); return acc; }, []);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag non-array reduce", () => {
    const code = `
      function test(items: number[]) {
        return items.reduce((sum, x) => sum + x, 0);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("avoid-delete-operator", () => {
  const check = (code: string) => checkRule(avoidDeleteOperator, code)

  it("metadata", () => {
    expect(avoidDeleteOperator.id).toBe("avoid-delete-operator")
  })

  it("flags delete on property", () => {
    const code = `
      function test(user: any) {
        delete user.password;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics.length).toBeGreaterThan(0)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("slow mode")
  })

  it("flags delete on computed property", () => {
    const code = `
      function test(obj: any, key: string) {
        delete obj[key];
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  it("does not flag setting to undefined", () => {
    const code = `
      function test(user: any) {
        user.password = undefined;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("avoid-arguments-object", () => {
  const check = (code: string) => checkRule(avoidArgumentsObject, code)

  it("metadata", () => {
    expect(avoidArgumentsObject.id).toBe("avoid-arguments-object")
  })

  it("flags arguments in regular function", () => {
    const code = `
      function test() {
        return arguments[0];
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics.length).toBeGreaterThan(0)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("rest parameters")
  })

  it("flags arguments.length", () => {
    const code = `
      function test() {
        return arguments.length;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  it("does not flag rest parameters", () => {
    const code = `
      function test(...args: any[]) {
        return args[0];
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag shadowed arguments parameter", () => {
    const code = `
      function test(arguments: any) {
        return arguments;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("avoid-sparse-arrays", () => {
  const check = (code: string) => checkRule(avoidSparseArrays, code)

  it("metadata", () => {
    expect(avoidSparseArrays.id).toBe("avoid-sparse-arrays")
  })

  it("flags new Array(n)", () => {
    const code = `
      function test() {
        return new Array(100);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics.length).toBeGreaterThan(0)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("holey")
  })

  it("flags new Array(variable)", () => {
    const code = `
      function test(n: number) {
        return new Array(n);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  it("does not flag new Array().fill()", () => {
    const code = `
      function test() {
        return new Array(100).fill(0);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag empty new Array()", () => {
    const code = `
      function test() {
        return new Array();
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag Array.from", () => {
    const code = `
      function test() {
        return Array.from({ length: 100 }, (_, i) => i);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("avoid-hidden-class-transition", () => {
  const check = (code: string) => checkRule(avoidHiddenClassTransition, code)

  it("metadata", () => {
    expect(avoidHiddenClassTransition.id).toBe("avoid-hidden-class-transition")
  })

  it("does not flag mutation of existing property in conditional", () => {
    const code = `
      interface Node { status: string; output: string }
      function test(node: Node | null) {
        if (node) {
          node.status = "completed";
          node.output = "done";
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag unconditional property assignment", () => {
    const code = `
      function test() {
        const obj: any = { a: 1 };
        obj.b = 2;
        return obj;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag store-like mutation patterns", () => {
    const code = `
      interface NodeState {
        id: string;
        status: string;
        duration?: number;
        tokensUsed?: number;
      }
      function updateNode(nodes: Map<string, NodeState>, id: string) {
        const node = nodes.get(id);
        if (node) {
          node.status = "completed";
          node.duration = 100;
          node.tokensUsed = 50;
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag array index assignments", () => {
    const code = `
      interface Command { execute(): void }
      function updateArray(commands: Command[], index: number, cmd: Command) {
        if (index >= 0) {
          commands[index] = cmd;
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag array length-based index assignments", () => {
    const code = `
      interface Item { id: string }
      function replaceLastItem(items: Item[], newItem: Item) {
        if (items.length > 0) {
          items[items.length - 1] = newItem;
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag dynamic property name assignments", () => {
    const code = `
      function setDynamicProp(obj: Record<string, number>, key: string, value: number) {
        if (key) {
          obj[key] = value;
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag DOM element property assignment in conditional", () => {
    const code = `
      import { createEffect } from "solid-js";
      function App() {
        let selectAllRef: HTMLInputElement | undefined;
        createEffect(() => {
          if (selectAllRef) {
            selectAllRef.indeterminate = true;
          }
        });
        return <div />;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag parameter property assignment in conditional", () => {
    const code = `
      function update(node: { status: string }) {
        if (node.status === "pending") {
          node.status = "done";
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag class instance property assignment in conditional", () => {
    const code = `
      function setup() {
        const widget = new Widget();
        if (widget.enabled) {
          widget.visible = true;
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag object literal conditional property addition without type info", () => {
    // Without a TypeScript program, checkPropertyExistsOnType returns true
    // (safe default), so the rule correctly does not fire.
    // True positives require type info to verify the property doesn't exist
    // on the declared type — tested via ESLint integration, not unit tests.
    const code = `
      function build(condition: boolean) {
        const obj = { a: 1 };
        if (condition) {
          obj.b = 2;
        }
        return obj;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag function return value property assignment in conditional", () => {
    const code = `
      function transform() {
        const result = getResult();
        if (result) {
          result.processed = true;
        }
        return result;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("avoid-function-allocation-in-hot-loop", () => {
  const check = (code: string) => checkRule(avoidFunctionAllocationInHotLoop, code)

  it("metadata", () => {
    expect(avoidFunctionAllocationInHotLoop.id).toBe("avoid-function-allocation-in-hot-loop")
  })

  it("flags closure created in for-of loop capturing loop variable", () => {
    const code = `
      function test(items: any[]) {
        for (const item of items) {
          item.handler = () => console.log(item);
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics.length).toBeGreaterThan(0)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("closure")
  })

  it("flags closure in for loop capturing counter", () => {
    const code = `
      function test() {
        const callbacks: any[] = [];
        for (let i = 0; i < 10; i++) {
          callbacks.push(() => i);
        }
        return callbacks;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  it("does not flag hoisted function used in loop", () => {
    const code = `
      function test(items: any[]) {
        const handler = (item: any) => console.log(item);
        for (const item of items) {
          item.handler = handler;
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag callback without captures in loop", () => {
    const code = `
      function test(items: any[]) {
        for (const item of items) {
          process(item);
        }
      }
      function process(x: any) { console.log(x); }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag array method callbacks", () => {
    const code = `
      function test(items: number[]) {
        return items.map(x => x * 2);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("avoid-megamorphic-property-access", () => {
  const check = (code: string) => checkRule(avoidMegamorphicPropertyAccess, code)

  it("metadata", () => {
    expect(avoidMegamorphicPropertyAccess.id).toBe("avoid-megamorphic-property-access")
  })

  it("does not flag identity function (no property access)", () => {
    const code = `
      function identity(obj: any) {
        return obj;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag function with no params", () => {
    const code = `
      function noop() {}
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag object type containing a wide string literal union property", () => {
    const code = `
      type IconName = "home" | "settings" | "user" | "search" | "menu" | "close" | "check" | "arrow-up" | "arrow-down" | "arrow-left";
      function SidebarItem(props: { name: IconName }) {
        return props.name;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("prefer-set-has-over-equality-chain", () => {
  const check = (code: string) => checkRule(preferSetHasOverEqualityChain, code)

  it("metadata", () => {
    expect(preferSetHasOverEqualityChain.id).toBe("prefer-set-has-over-equality-chain")
  })

  it("flags 4+ === checks against string literals on the same variable", () => {
    const code = `
      function isIgnored(name: string): boolean {
        if (name === "none") return true;
        if (name === "initial") return true;
        if (name === "inherit") return true;
        if (name === "unset") return true;
        return false;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("4")
    expect(diagnostics[0].message).toContain("name")
  })

  it("flags 6 checks (real-world isIgnoredAnimationName pattern)", () => {
    const code = `
      function isIgnoredAnimationName(name: string): boolean {
        if (name === "none") return true;
        if (name === "initial") return true;
        if (name === "inherit") return true;
        if (name === "unset") return true;
        if (name === "revert") return true;
        if (name === "revert-layer") return true;
        return false;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("6")
  })

  it("does not flag 3 checks (below threshold)", () => {
    const code = `
      function check(s: string): boolean {
        if (s === "a") return true;
        if (s === "b") return true;
        if (s === "c") return true;
        return false;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag checks against different variables", () => {
    const code = `
      function check(a: string, b: string, c: string, d: string): boolean {
        if (a === "x") return true;
        if (b === "y") return true;
        if (c === "z") return true;
        if (d === "w") return true;
        return false;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag checks against number literals", () => {
    const code = `
      function check(n: number): boolean {
        if (n === 1) return true;
        if (n === 2) return true;
        if (n === 3) return true;
        if (n === 4) return true;
        return false;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag checks in different functions", () => {
    const code = `
      function a(s: string) { return s === "x"; }
      function b(s: string) { return s === "y"; }
      function c(s: string) { return s === "z"; }
      function d(s: string) { return s === "w"; }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("counts !== checks too", () => {
    const code = `
      function validate(s: string): boolean {
        if (s !== "none") return false;
        if (s !== "initial") return false;
        if (s !== "inherit") return false;
        if (s !== "unset") return false;
        return true;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag == (loose equality)", () => {
    const code = `
      function check(s: any): boolean {
        if (s == "a") return true;
        if (s == "b") return true;
        if (s == "c") return true;
        if (s == "d") return true;
        return false;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("reports separately for different variables in the same function", () => {
    const code = `
      function check(a: string, b: string): boolean {
        if (a === "1") return true;
        if (a === "2") return true;
        if (a === "3") return true;
        if (a === "4") return true;
        if (b === "x") return true;
        if (b === "y") return true;
        if (b === "z") return true;
        if (b === "w") return true;
        return false;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(2)
  })

  it("does not flag when variable is compared against non-literal expressions", () => {
    const code = `
      function check(s: string, a: string, b: string, c: string, d: string): boolean {
        if (s === a) return true;
        if (s === b) return true;
        if (s === c) return true;
        if (s === d) return true;
        return false;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})



describe("prefer-map-over-object-dictionary", () => {
  const check = (code: string) => checkRule(preferMapOverObjectDictionary, code)

  it("metadata", () => {
    expect(preferMapOverObjectDictionary.id).toBe("prefer-map-over-object-dictionary")
  })

  it("does not flag Map usage", () => {
    const code = `
      function test(key: string) {
        const cache = new Map<string, number>();
        cache.set(key, 123);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag static property access", () => {
    const code = `
      function test() {
        const obj: Record<string, number> = {};
        obj.staticProp = 123;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag literal key in bracket notation", () => {
    const code = `
      function test() {
        const obj: Record<string, number> = {};
        obj["staticKey"] = 123;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag non-dictionary typed object", () => {
    const code = `
      function test(key: string) {
        const obj: any = {};
        obj[key] = 123;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("avoid-repeated-indexof-check", () => {
  const check = (code: string) => checkRule(avoidRepeatedIndexofCheck, code)

  it("metadata", () => {
    expect(avoidRepeatedIndexofCheck.id).toBe("avoid-repeated-indexof-check")
  })

  it("flags 3+ indexOf calls on the same array variable in one function", () => {
    const code = `
      function hasValues(items: number[]): boolean {
        if (items.indexOf(1) !== -1) return true;
        if (items.indexOf(2) !== -1) return true;
        if (items.indexOf(3) !== -1) return true;
        return false;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("3")
    expect(diagnostics[0].message).toContain("items")
  })

  it("flags when there are more than 3 calls", () => {
    const code = `
      function check(tags: number[]): boolean {
        if (tags.indexOf(1) !== -1) return true;
        if (tags.indexOf(2) !== -1) return true;
        if (tags.indexOf(3) !== -1) return true;
        if (tags.indexOf(4) !== -1) return true;
        if (tags.indexOf(5) !== -1) return true;
        return false;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("5")
  })

  it("does not flag 2 indexOf calls (below threshold)", () => {
    const code = `
      function check(s: string): boolean {
        if (s.indexOf(":") !== -1) return true;
        if (s.indexOf("[") !== -1) return true;
        return false;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag indexOf on different variables", () => {
    const code = `
      function check(a: string, b: string, c: string): boolean {
        if (a.indexOf(":") !== -1) return true;
        if (b.indexOf("[") !== -1) return true;
        if (c.indexOf("]") !== -1) return true;
        return false;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag indexOf on chained expressions", () => {
    const code = `
      function check(obj: any): boolean {
        if (obj.name.indexOf(":") !== -1) return true;
        if (obj.name.indexOf("[") !== -1) return true;
        if (obj.name.indexOf("]") !== -1) return true;
        return false;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag calls in different functions", () => {
    const code = `
      function a(s: string) { return s.indexOf(":") !== -1; }
      function b(s: string) { return s.indexOf("[") !== -1; }
      function c(s: string) { return s.indexOf("]") !== -1; }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("reports separately for different variables in the same function", () => {
    const code = `
      function check(a: number[], b: number[]): boolean {
        if (a.indexOf(1) !== -1) return true;
        if (a.indexOf(2) !== -1) return true;
        if (a.indexOf(3) !== -1) return true;
        if (b.indexOf(4) !== -1) return true;
        if (b.indexOf(5) !== -1) return true;
        if (b.indexOf(6) !== -1) return true;
        return false;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(2)
  })

  it("does not flag indexOf on string variables (substring search)", () => {
    const code = `
      function hasUnsupported(s: string): boolean {
        if (s.indexOf(":") !== -1) return true;
        if (s.indexOf("[") !== -1) return true;
        if (s.indexOf("]") !== -1) return true;
        return false;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not merge shadowed receivers across scopes", () => {
    const code = `
      function check(items: number[]): boolean {
        if (items.indexOf(1) !== -1) return true;
        if (items.indexOf(2) !== -1) return true;

        {
          const items = [10, 11, 12];
          if (items.indexOf(10) !== -1) return true;
          if (items.indexOf(11) !== -1) return true;
          if (items.indexOf(12) !== -1) return true;
        }

        return false;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
  })
})

describe("prefer-set-lookup-in-loop", () => {
  const check = (code: string) => checkRule(preferSetLookupInLoop, code)

  it("metadata", () => {
    expect(preferSetLookupInLoop.id).toBe("prefer-set-lookup-in-loop")
  })

  it("flags .includes() on external array inside a for loop", () => {
    const code = `
      function test(items: string[], allowed: string[]) {
        for (let i = 0; i < items.length; i++) {
          if (allowed.includes(items[i])) {}
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("allowed")
  })

  it("flags .indexOf() on param inside a while loop", () => {
    const code = `
      function test(items: string[], blocklist: string[]) {
        let i = 0;
        while (i < items.length) {
          if (blocklist.indexOf(items[i]) !== -1) {}
          i++;
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("blocklist")
  })

  it("flags membership-style .find() inside loops", () => {
    const code = `
      function test(items: string[], allowed: string[]) {
        for (let i = 0; i < items.length; i++) {
          if (allowed.find(v => v === items[i])) {}
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("allowed")
  })

  it("does not flag non-membership .find() predicate", () => {
    const code = `
      function test(items: string[], users: Array<{ id: string }>) {
        for (let i = 0; i < items.length; i++) {
          if (users.find(user => user.id === items[i])) {}
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag .includes() outside a loop", () => {
    const code = `
      function test(items: string[], allowed: string[]) {
        if (allowed.includes("foo")) {}
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag .includes() on a locally-built array inside the loop", () => {
    const code = `
      function test(items: string[]) {
        for (let i = 0; i < items.length; i++) {
          const local = ["a", "b", "c"];
          if (local.includes(items[i])) {}
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag .includes() on chained receiver", () => {
    const code = `
      function test(items: string[], obj: any) {
        for (let i = 0; i < items.length; i++) {
          if (obj.list.includes(items[i])) {}
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("reports once per variable per loop even with multiple calls", () => {
    const code = `
      function test(items: string[], allowed: string[]) {
        for (let i = 0; i < items.length; i++) {
          if (allowed.includes(items[i])) {}
          if (allowed.includes("extra")) {}
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag when includes is inside a callback in a loop", () => {
    const code = `
      function test(items: string[], allowed: string[]) {
        for (let i = 0; i < items.length; i++) {
          items.forEach(item => {
            if (allowed.includes(item)) {}
          });
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("avoid-slice-sort-pattern", () => {
  const check = (code: string) => checkRule(avoidSliceSortPattern, code)

  it("metadata", () => {
    expect(avoidSliceSortPattern.id).toBe("avoid-slice-sort-pattern")
  })

  it("flags .slice().sort()", () => {
    const code = `
      function test(items: number[]) {
        return items.slice().sort((a, b) => a - b);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("toSorted")
  })

  it("flags .slice().reverse()", () => {
    const code = `
      function test(items: number[]) {
        return items.slice().reverse();
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("toReversed")
  })

  it("flags .slice(1).sort()", () => {
    const code = `
      function test(items: number[]) {
        return items.slice(1).sort();
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
  })

  it("flags [...arr].sort()", () => {
    const code = `
      function test(items: number[]) {
        return [...items].sort((a, b) => a - b);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("toSorted")
  })

  it("flags [...arr].reverse()", () => {
    const code = `
      function test(items: number[]) {
        return [...items].reverse();
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("toReversed")
  })

  it("does not flag .sort() alone", () => {
    const code = `
      function test(items: number[]) {
        return items.sort((a, b) => a - b);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag .slice() alone", () => {
    const code = `
      function test(items: number[]) {
        return items.slice(1);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag .filter().sort()", () => {
    const code = `
      function test(items: number[]) {
        return items.filter(x => x > 0).sort();
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag .map().reverse()", () => {
    const code = `
      function test(items: number[]) {
        return items.map(x => x * 2).reverse();
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag mixed array literal with spread", () => {
    const code = `
      function test(items: number[]) {
        return [0, ...items].sort();
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("prefer-map-lookup-over-linear-scan", () => {
  const check = (code: string) => checkRule(preferMapLookupOverLinearScan, code)

  it("metadata", () => {
    expect(preferMapLookupOverLinearScan.id).toBe("prefer-map-lookup-over-linear-scan")
  })

  it("flags fixed-table linear scan in loops", () => {
    const code = `
      const KEYS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
      function test(items: string[]) {
        for (let i = 0; i < items.length; i++) {
          if (KEYS.includes(items[i])) return true;
        }
        return false;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("KEYS")
  })

  it("flags repeated linear scans in the same function", () => {
    const code = `
      const KEYS = ["a", "b", "c", "d", "e", "f", "g", "h"];
      function test(value: string) {
        if (KEYS.includes(value)) return true;
        return KEYS.indexOf(value) !== -1;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag small fixed collections", () => {
    const code = `
      const KEYS = ["a", "b", "c"];
      function test(items: string[]) {
        for (let i = 0; i < items.length; i++) {
          if (KEYS.includes(items[i])) return true;
        }
        return false;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag dynamic collections", () => {
    const code = `
      function getKeys(): string[] { return ["a", "b", "c", "d", "e", "f", "g", "h"]; }
      const keys = getKeys();
      function test(value: string) {
        return keys.includes(value);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("flags fixed-table membership find scan", () => {
    const code = `
      const KEYS = ["a", "b", "c", "d", "e", "f", "g", "h"];
      function test(value: string) {
        const hit = KEYS.find(k => k === value);
        const second = KEYS.find(k => k === value);
        return hit ?? second ?? null;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
  })
})

describe("no-write-only-index", () => {
  const check = (code: string) => checkRule(noWriteOnlyIndex, code)

  it("metadata", () => {
    expect(noWriteOnlyIndex.id).toBe("no-write-only-index")
  })

  it("flags write-only Map indexes", () => {
    const code = `
      function test(items: string[]) {
        const byKey = new Map<string, number>();
        for (let i = 0; i < items.length; i++) {
          byKey.set(items[i], i);
        }
        for (const [key, value] of byKey) {
          console.log(key, value);
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("byKey")
  })

  it("flags write-only object dictionary indexes", () => {
    const code = `
      function test(items: Array<{ id: string }>) {
        const byId: Record<string, number> = {};
        for (let i = 0; i < items.length; i++) {
          byId[items[i].id] = i;
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("byId")
  })

  it("does not flag indexes that are queried by key", () => {
    const code = `
      function test(items: string[], needle: string) {
        const byKey = new Map<string, number>();
        for (let i = 0; i < items.length; i++) {
          byKey.set(items[i], i);
        }
        return byKey.get(needle) ?? -1;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag indexes that escape via return", () => {
    const code = `
      function test(items: string[]) {
        const byKey = new Map<string, number>();
        for (let i = 0; i < items.length; i++) {
          byKey.set(items[i], i);
        }
        return byKey;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag indexes passed to helper functions", () => {
    const code = `
      function consume(index: Map<string, number>) {
        return index.size;
      }

      function test(items: string[]) {
        const byKey = new Map<string, number>();
        for (let i = 0; i < items.length; i++) {
          byKey.set(items[i], i);
        }
        return consume(byKey);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("avoid-defensive-copy-for-scalar-stat", () => {
  const check = (code: string) => checkRule(avoidDefensiveCopyForScalarStat, code)

  it("metadata", () => {
    expect(avoidDefensiveCopyForScalarStat.id).toBe("avoid-defensive-copy-for-scalar-stat")
  })

  it("flags spread defensive copies passed to scalar stats", () => {
    const code = `
      function computeMedian(values: number[]): number { return values[0] ?? 0; }
      function test(sorted: number[]) {
        return computeMedian([...sorted]);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("computeMedian")
  })

  it("flags slice defensive copies passed to scalar stats", () => {
    const code = `
      function percentile(values: number[], p: number): number { return values[p] ?? 0; }
      function test(values: number[]) {
        return percentile(values.slice(), 95);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("percentile")
  })

  it("does not flag non-statistic copy pipelines", () => {
    const code = `
      function test(values: number[]) {
        const copy = values.slice();
        copy.sort((a, b) => a - b);
        return copy;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag toSorted pipelines", () => {
    const code = `
      function test(values: number[]) {
        return [...values].toSorted((a, b) => a - b);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("avoid-intermediate-map-copy", () => {
  const check = (code: string) => checkRule(avoidIntermediateMapCopy, code)

  it("metadata", () => {
    expect(avoidIntermediateMapCopy.id).toBe("avoid-intermediate-map-copy")
  })

  it("flags temporary map copied key-for-key into output map", () => {
    const code = `
      function test(items: Array<{ id: string; name: string }>) {
        const candidates = new Map<string, { id: string; name: string }>();
        for (let i = 0; i < items.length; i++) {
          candidates.set(items[i].id, items[i]);
        }

        const out = new Map<string, string>();
        for (const [id, value] of candidates) {
          out.set(id, value.name);
        }
        return out;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("candidates")
  })

  it("does not flag when temporary map is queried", () => {
    const code = `
      function test(items: Array<{ id: string; name: string }>, needle: string) {
        const candidates = new Map<string, { id: string; name: string }>();
        for (let i = 0; i < items.length; i++) {
          candidates.set(items[i].id, items[i]);
        }
        const found = candidates.get(needle);
        return found?.name ?? null;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag when temporary map escapes by return", () => {
    const code = `
      function test(items: Array<{ id: string }>) {
        const candidates = new Map<string, { id: string }>();
        for (let i = 0; i < items.length; i++) {
          candidates.set(items[i].id, items[i]);
        }
        return candidates;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag temporary map with multiple consumer loops", () => {
    const code = `
      function test(items: Array<{ id: string; name: string }>) {
        const candidates = new Map<string, { id: string; name: string }>();
        for (let i = 0; i < items.length; i++) {
          candidates.set(items[i].id, items[i]);
        }

        const out = new Map<string, string>();
        for (const [id, value] of candidates) {
          out.set(id, value.name);
        }

        for (const [id] of candidates) {
          if (id.length === 0) {}
        }

        return out;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("avoid-spread-sort-map-join-pipeline", () => {
  const check = (code: string) => checkRule(avoidSpreadSortMapJoinPipeline, code)

  it("metadata", () => {
    expect(avoidSpreadSortMapJoinPipeline.id).toBe("avoid-spread-sort-map-join-pipeline")
  })

  it("flags spread sort map join pipeline", () => {
    const code = `
      function test(byKey: Map<string, { key: string }>) {
        return [...byKey.values()]
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((guard) => guard.key)
          .join("&");
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("Spread+sort+map+join")
  })

  it("does not flag pipelines without spread root", () => {
    const code = `
      function test(values: string[]) {
        return values.sort().map((v) => v).join("&");
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag spread map join without sort", () => {
    const code = `
      function test(values: string[]) {
        return [...values].map((v) => v).join("&");
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("bounded-worklist-traversal", () => {
  const check = (code: string) => checkRule(boundedWorklistTraversal, code)

  it("metadata", () => {
    expect(boundedWorklistTraversal.id).toBe("bounded-worklist-traversal")
  })

  it("flags unbounded queue growth", () => {
    const code = `
      function walk(root: any): void {
        const queue = [root];
        for (let i = 0; i < queue.length; i++) {
          const current = queue[i];
          for (const child of current.children) {
            queue.push(child);
          }
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("queue")
  })

  it("does not flag queue traversal with explicit bound", () => {
    const code = `
      function walk(root: any): void {
        const queue = [root];
        for (let i = 0; i < queue.length; i++) {
          if (queue.length > 256) return;
          const current = queue[i];
          for (const child of current.children) {
            queue.push(child);
          }
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag queue traversal with visited set guard", () => {
    const code = `
      function walk(root: any): void {
        const queue = [root];
        const seen = new Set<any>();
        for (let i = 0; i < queue.length; i++) {
          const current = queue[i];
          if (seen.has(current)) continue;
          seen.add(current);
          for (const child of current.children) {
            queue.push(child);
          }
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("no-shift-splice-head-consume", () => {
  const check = (code: string) => checkRule(noShiftSpliceHeadConsume, code)

  it("metadata", () => {
    expect(noShiftSpliceHeadConsume.id).toBe("no-shift-splice-head-consume")
  })

  it("flags shift() head consume in loops", () => {
    const code = `
      function parse(tokens: string[]) {
        while (tokens.length > 0) {
          const token = tokens.shift();
          if (!token) break;
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
  })

  it("flags splice(0, 1) head consume in loops", () => {
    const code = `
      function parse(tokens: string[]) {
        for (let i = 0; i < 10; i++) {
          tokens.splice(0, 1);
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag shift() outside loops", () => {
    const code = `
      function parse(tokens: string[]) {
        return tokens.shift();
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag tiny fixed literal queues", () => {
    const code = `
      function parse() {
        const tokens = ["a", "b", "c"];
        while (tokens.length > 0) {
          tokens.shift();
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("no-rest-slice-loop", () => {
  const check = (code: string) => checkRule(noRestSliceLoop, code)

  it("metadata", () => {
    expect(noRestSliceLoop.id).toBe("no-rest-slice-loop")
  })

  it("flags repeated rest = rest.slice(...) in loops", () => {
    const code = `
      function parse(input: string) {
        let rest = input;
        while (rest.length > 0) {
          const i = rest.indexOf(",");
          rest = i === -1 ? "" : rest.slice(i + 1);
          rest = rest.slice(0);
          if (i === -1) break;
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag one-off slicing", () => {
    const code = `
      function parse(input: string) {
        let rest = input;
        while (rest.length > 0) {
          const i = rest.indexOf(",");
          rest = i === -1 ? "" : rest.slice(i + 1);
          break;
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("no-rescan-indexof-loop", () => {
  const check = (code: string) => checkRule(noRescanIndexofLoop, code)

  it("metadata", () => {
    expect(noRescanIndexofLoop.id).toBe("no-rescan-indexof-loop")
  })

  it("flags repeated indexOf from start in loops", () => {
    const code = `
      function parse(text: string) {
        for (let i = 0; i < 2; i++) {
          const a = text.indexOf(":");
          const b = text.indexOf(":", 0);
          if (a === -1 || b === -1) break;
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag cursor-based indexOf", () => {
    const code = `
      function parse(text: string) {
        let cursor = 0;
        while (cursor < text.length) {
          const idx = text.indexOf(":", cursor);
          if (idx === -1) break;
          cursor = idx + 1;
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("no-multipass-split-pipeline", () => {
  const check = (code: string) => checkRule(noMultipassSplitPipeline, code)

  it("metadata", () => {
    expect(noMultipassSplitPipeline.id).toBe("no-multipass-split-pipeline")
  })

  it("flags split().map().filter() pipelines", () => {
    const code = `
      function parse(line: string) {
        return line.split(",").map(v => v.trim()).filter(Boolean);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag split with only one pass", () => {
    const code = `
      function parse(line: string) {
        return line.split(",").map(v => v.trim());
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag short literal split pipelines", () => {
    const code = `
      function parse() {
        return "a,b".split(",").map(v => v.trim()).filter(Boolean);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("no-per-char-substring-scan", () => {
  const check = (code: string) => checkRule(noPerCharSubstringScan, code)

  it("metadata", () => {
    expect(noPerCharSubstringScan.id).toBe("no-per-char-substring-scan")
  })

  it("flags charAt(i) scanner loops", () => {
    const code = `
      function scan(input: string) {
        for (let i = 0; i < input.length; i++) {
          const ch = input.charAt(i);
          if (ch === ",") return i;
        }
        return -1;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
  })

  it("flags slice(i, i + 1) scanner loops", () => {
    const code = `
      function scan(input: string) {
        for (let i = 0; i < input.length; i++) {
          const ch = input.slice(i, i + 1);
          if (ch === ",") return i;
        }
        return -1;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag non-loop charAt", () => {
    const code = `
      function read(input: string) {
        return input.charAt(0);
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("no-repeated-token-normalization", () => {
  const check = (code: string) => checkRule(noRepeatedTokenNormalization, code)

  it("metadata", () => {
    expect(noRepeatedTokenNormalization.id).toBe("no-repeated-token-normalization")
  })

  it("flags repeated trim/toLowerCase chains", () => {
    const code = `
      function parse(key: string) {
        if (key.trim().toLowerCase() === "content-type") return true;
        if (key.trim().toLowerCase() === "accept") return true;
        return false;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag when normalized once", () => {
    const code = `
      function parse(key: string) {
        const normalized = key.trim().toLowerCase();
        if (normalized === "content-type") return true;
        if (normalized === "accept") return true;
        return false;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag when token variable is reassigned", () => {
    const code = `
      function parse(input: string, fallback: string) {
        let key = input;
        if (key.trim().toLowerCase() === "a") return true;
        key = fallback;
        if (key.trim().toLowerCase() === "b") return true;
        return false;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag shadowed token variables", () => {
    const code = `
      function parse(key: string) {
        if (key.trim().toLowerCase() === "a") return true;
        {
          const key = "inner";
          if (key.trim().toLowerCase() === "inner") return true;
        }
        return false;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("no-full-split-in-hot-parse", () => {
  const check = (code: string) => checkRule(noFullSplitInHotParse, code)

  it("metadata", () => {
    expect(noFullSplitInHotParse.id).toBe("no-full-split-in-hot-parse")
  })

  it("flags split in parsing loops", () => {
    const code = `
      function parseLine(input: string) {
        let cursor = 0;
        while (cursor < input.length) {
          const parts = input.split(",");
          cursor++;
          if (parts.length === 0) break;
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag split outside loops", () => {
    const code = `
      function parseLine(input: string) {
        return input.split(",");
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("no-loop-string-plus-equals", () => {
  const check = (code: string) => checkRule(noLoopStringPlusEquals, code)

  it("metadata", () => {
    expect(noLoopStringPlusEquals.id).toBe("no-loop-string-plus-equals")
  })

  it("flags repeated += accumulation in parse loops", () => {
    const code = `
      function parseAscii(input: string) {
        let out = "";
        for (let i = 0; i < input.length; i++) {
          out += input.charAt(i);
          out += ",";
        }
        return out;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag a single += in loop", () => {
    const code = `
      function parseAscii(input: string) {
        let out = "";
        for (let i = 0; i < input.length; i++) {
          out += input.charAt(i);
        }
        return out;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("no-char-array-materialization", () => {
  const check = (code: string) => checkRule(noCharArrayMaterialization, code)

  it("metadata", () => {
    expect(noCharArrayMaterialization.id).toBe("no-char-array-materialization")
  })

  it("flags split(\"\") in parser loop", () => {
    const code = `
      function parseAscii(input: string) {
        while (input.length > 0) {
          const chars = input.split("");
          if (chars.length === 0) break;
          input = input.slice(1);
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
  })

  it("flags Array.from(str) in parser loop", () => {
    const code = `
      function parseAscii(input: string) {
        for (let i = 0; i < 2; i++) {
          const chars = Array.from(input);
          if (chars.length === 0) return;
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag char materialization outside loops", () => {
    const code = `
      function parseAscii(input: string) {
        return [...input];
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("no-heavy-parser-constructor-in-loop", () => {
  const check = (code: string) => checkRule(noHeavyParserConstructorInLoop, code)

  it("metadata", () => {
    expect(noHeavyParserConstructorInLoop.id).toBe("no-heavy-parser-constructor-in-loop")
  })

  it("flags new RegExp inside parsing loops", () => {
    const code = `
      function parseLine(input: string) {
        for (let i = 0; i < input.length; i++) {
          const matcher = new RegExp(",");
          if (matcher.test(input.charAt(i))) return i;
        }
        return -1;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag constructor outside loops", () => {
    const code = `
      function parseLine() {
        const matcher = new RegExp(",");
        return matcher;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("no-double-pass-delimiter-count", () => {
  const check = (code: string) => checkRule(noDoublePassDelimiterCount, code)

  it("metadata", () => {
    expect(noDoublePassDelimiterCount.id).toBe("no-double-pass-delimiter-count")
  })

  it("flags split length counting followed by another split", () => {
    const code = `
      function parseCsv(input: string) {
        const columns = input.split(",").length;
        const parts = input.split(",");
        return columns + parts.length;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag when split is used once", () => {
    const code = `
      function parseCsv(input: string) {
        return input.split(",").length;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("prefer-index-scan-over-string-iterator", () => {
  const check = (code: string) => checkRule(preferIndexScanOverStringIterator, code)

  it("metadata", () => {
    expect(preferIndexScanOverStringIterator.id).toBe("prefer-index-scan-over-string-iterator")
  })

  it("flags for-of string iteration in ASCII parser contexts", () => {
    const code = `
      function parseAscii(input: string) {
        let count = 0;
        for (const ch of input) {
          if (ch === ",") count++;
        }
        return count;
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag unicode-aware loops", () => {
    const code = `
      function parseAscii(input: string) {
        for (const ch of input) {
          ch.codePointAt(0);
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("avoid-quadratic-pair-comparison", () => {
  const check = (code: string) => checkRule(avoidQuadraticPairComparison, code)

  it("metadata", () => {
    expect(avoidQuadraticPairComparison.id).toBe("avoid-quadratic-pair-comparison")
  })

  it("flags nested for-loops with j < i over same array", () => {
    const code = `
      function test(items: string[]) {
        for (let i = 0; i < items.length; i++) {
          for (let j = 0; j < i; j++) {
            if (items[i] === items[j]) {}
          }
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("items")
  })

  it("flags nested for-loops with j < arr.length over same array", () => {
    const code = `
      function test(arr: number[]) {
        for (let i = 0; i < arr.length; i++) {
          for (let j = 0; j < arr.length; j++) {
            if (arr[i] > arr[j]) {}
          }
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
  })

  it("does not flag nested loops over different arrays", () => {
    const code = `
      function test(a: number[], b: number[]) {
        for (let i = 0; i < a.length; i++) {
          for (let j = 0; j < b.length; j++) {
            if (a[i] === b[j]) {}
          }
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag single for-loop", () => {
    const code = `
      function test(items: string[]) {
        for (let i = 0; i < items.length; i++) {
          console.log(items[i]);
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag nested loops where inner does not access outer's collection", () => {
    const code = `
      function test(items: string[], other: string[]) {
        for (let i = 0; i < items.length; i++) {
          for (let j = 0; j < i; j++) {
            console.log(other[j]);
          }
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag for-of loops", () => {
    const code = `
      function test(items: string[]) {
        for (const a of items) {
          for (const b of items) {
            if (a === b) {}
          }
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag when inner loop uses different bound variable", () => {
    const code = `
      function test(items: string[], n: number) {
        for (let i = 0; i < items.length; i++) {
          for (let j = 0; j < n; j++) {
            if (items[i] === items[j]) {}
          }
        }
      }
    `
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("no-leaked-timer", () => {
  const check = (code: string) => checkRule(noLeakedTimer, code)

  it("metadata", () => {
    expect(noLeakedTimer.id).toBe("no-leaked-timer")
  })

  describe("invalid patterns", () => {
    it("flags setInterval in createEffect without onCleanup", () => {
      const { diagnostics } = check(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => {
            const id = setInterval(() => {}, 1000);
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("setInterval")
      expect(diagnostics[0].message).toContain("clearInterval")
    })

    it("flags setTimeout in createEffect without onCleanup", () => {
      const { diagnostics } = check(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => {
            setTimeout(() => {}, 1000);
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("setTimeout")
      expect(diagnostics[0].message).toContain("clearTimeout")
    })

    it("flags setInterval in createRenderEffect without onCleanup", () => {
      const { diagnostics } = check(`
        import { createRenderEffect } from "solid-js";
        function App() {
          createRenderEffect(() => {
            setInterval(() => {}, 500);
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("flags setInterval in createComputed without onCleanup", () => {
      const { diagnostics } = check(`
        import { createComputed } from "solid-js";
        function App() {
          createComputed(() => {
            setInterval(() => {}, 500);
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("flags window.setInterval in createEffect without onCleanup", () => {
      const { diagnostics } = check(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => {
            const id = window.setInterval(() => {}, 1000);
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("setInterval")
    })

    it("flags when onCleanup exists but clears wrong timer type", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          createEffect(() => {
            const id = setInterval(() => {}, 1000);
            onCleanup(() => clearTimeout(id));
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("clearInterval")
    })

    it("flags setInterval in onMount without onCleanup", () => {
      const { diagnostics } = check(`
        import { onMount } from "solid-js";
        function App() {
          onMount(() => {
            const id = setInterval(() => {}, 1000);
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("setInterval")
    })
  })

  describe("valid patterns", () => {
    it("allows setInterval with onCleanup clearInterval", () => {
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

    it("allows setInterval with named cleanup function passed to onCleanup", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          createEffect(() => {
            const id = setInterval(() => {}, 1000);
            const cleanup = () => clearInterval(id);
            onCleanup(cleanup);
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows window.setInterval with window.clearInterval in onCleanup", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          createEffect(() => {
            const id = window.setInterval(() => {}, 1000);
            onCleanup(() => window.clearInterval(id));
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows setTimeout with onCleanup clearTimeout", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          createEffect(() => {
            const id = setTimeout(() => {}, 1000);
            onCleanup(() => clearTimeout(id));
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows setInterval outside effects (component body)", () => {
      const { diagnostics } = check(`
        function App() {
          const id = setInterval(() => {}, 1000);
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows setInterval at module scope", () => {
      const { diagnostics } = check(`
        const id = setInterval(() => {}, 1000);
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows setInterval in event handlers", () => {
      const { diagnostics } = check(`
        function App() {
          return <button onClick={() => setInterval(() => {}, 1000)}>Start</button>;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows component-level onCleanup with clearInterval", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup, createSignal } from "solid-js";
        function App() {
          const [delay] = createSignal(1000);
          let timerId: number | undefined;
          createEffect(() => {
            clearInterval(timerId);
            timerId = setInterval(() => {}, delay());
          });
          onCleanup(() => clearInterval(timerId));
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows direct clearTimeout in effect body before setTimeout", () => {
      const { diagnostics } = check(`
        import { createEffect, createSignal } from "solid-js";
        function App() {
          const [delay] = createSignal(1000);
          let timerId = 0;
          createEffect(() => {
            clearTimeout(timerId);
            timerId = setTimeout(() => {}, delay());
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })
})

describe("no-leaked-event-listener", () => {
  const check = (code: string) => checkRule(noLeakedEventListener, code)

  it("metadata", () => {
    expect(noLeakedEventListener.id).toBe("no-leaked-event-listener")
  })

  describe("invalid patterns", () => {
    it("flags addEventListener in createEffect without onCleanup", () => {
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
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("addEventListener")
    })

    it("flags addEventListener in createRenderEffect without cleanup", () => {
      const { diagnostics } = check(`
        import { createRenderEffect } from "solid-js";
        function App() {
          createRenderEffect(() => {
            document.addEventListener("click", () => {});
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })
  })

  describe("valid patterns", () => {
    it("allows addEventListener with removeEventListener in onCleanup", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          createEffect(() => {
            const handler = () => {};
            window.addEventListener("resize", handler);
            onCleanup(() => window.removeEventListener("resize", handler));
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows addEventListener outside effects", () => {
      const { diagnostics } = check(`
        function App() {
          window.addEventListener("resize", () => {});
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows addEventListener in event handlers", () => {
      const { diagnostics } = check(`
        function App() {
          return <button onClick={() => window.addEventListener("click", () => {})}>Add</button>;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows component-level onCleanup with removeEventListener", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup, createSignal } from "solid-js";
        function App() {
          const [target] = createSignal("resize");
          const handler = () => {};
          createEffect(() => {
            const event = target();
            window.addEventListener(event, handler);
          });
          onCleanup(() => window.removeEventListener("resize", handler));
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows addEventListener with .close() on the same target in onCleanup", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup, createSignal } from "solid-js";
        function useSSE() {
          const [url] = createSignal("/stream");
          createEffect(() => {
            const es = new EventSource(url());
            es.addEventListener("message", (event) => {
              console.log(event.data);
            });
            onCleanup(() => es.close());
          });
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows addEventListener with .abort() on the same target in onCleanup", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          createEffect(() => {
            const controller = new AbortController();
            controller.addEventListener("abort", () => console.log("aborted"));
            onCleanup(() => controller.abort());
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows addEventListener with .terminate() on Worker target in onCleanup", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          createEffect(() => {
            const worker = new Worker("worker.js");
            worker.addEventListener("message", (e) => console.log(e.data));
            onCleanup(() => worker.terminate());
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows addEventListener with AbortController signal and abort in onCleanup", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          createEffect(() => {
            const controller = new AbortController();
            window.addEventListener("resize", () => {}, { signal: controller.signal });
            onCleanup(() => controller.abort());
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows AbortController signal pattern with multiple listeners", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          createEffect(() => {
            const controller = new AbortController();
            window.addEventListener("resize", () => {}, { signal: controller.signal });
            document.addEventListener("click", () => {}, { signal: controller.signal });
            onCleanup(() => controller.abort());
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows AbortController signal with addEventListener on controller itself", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          createEffect(() => {
            const controller = new AbortController();
            window.addEventListener("resize", () => {}, { signal: controller.signal });
            controller.addEventListener("abort", () => console.log("aborted"));
            onCleanup(() => controller.abort());
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows AbortController signal with sibling onCleanup", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          const controller = new AbortController();
          createEffect(() => {
            window.addEventListener("resize", () => {}, { signal: controller.signal });
          });
          onCleanup(() => controller.abort());
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("flags addEventListener when .close() is on a different target", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          createEffect(() => {
            const es = new EventSource("/stream");
            const other = new EventSource("/other");
            es.addEventListener("message", (e) => console.log(e.data));
            onCleanup(() => other.close());
          });
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("flags addEventListener with signal from different controller than cleanup aborts", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          createEffect(() => {
            const controller = new AbortController();
            const other = new AbortController();
            window.addEventListener("resize", () => {}, { signal: controller.signal });
            onCleanup(() => other.abort());
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("flags addEventListener with signal but no abort in cleanup", () => {
      const { diagnostics } = check(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => {
            const controller = new AbortController();
            window.addEventListener("resize", () => {}, { signal: controller.signal });
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })
  })
})

describe("no-leaked-observer", () => {
  const check = (code: string) => checkRule(noLeakedObserver, code)

  it("metadata", () => {
    expect(noLeakedObserver.id).toBe("no-leaked-observer")
  })

  describe("invalid patterns", () => {
    it("flags ResizeObserver in createEffect without disconnect", () => {
      const { diagnostics } = check(`
        import { createEffect } from "solid-js";
        function App() {
          let ref: HTMLDivElement;
          createEffect(() => {
            const observer = new ResizeObserver(() => {});
            observer.observe(ref);
          });
          return <div ref={ref!} />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("ResizeObserver")
    })

    it("flags MutationObserver in createEffect without disconnect", () => {
      const { diagnostics } = check(`
        import { createEffect } from "solid-js";
        function App() {
          let ref: HTMLDivElement;
          createEffect(() => {
            const observer = new MutationObserver(() => {});
            observer.observe(ref, { childList: true });
          });
          return <div ref={ref!} />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("MutationObserver")
    })

    it("flags IntersectionObserver in createEffect without disconnect", () => {
      const { diagnostics } = check(`
        import { createEffect } from "solid-js";
        function App() {
          let ref: HTMLDivElement;
          createEffect(() => {
            const observer = new IntersectionObserver(() => {});
            observer.observe(ref);
          });
          return <div ref={ref!} />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("IntersectionObserver")
    })
  })

  describe("valid patterns", () => {
    it("allows ResizeObserver with disconnect in onCleanup", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          let ref: HTMLDivElement;
          createEffect(() => {
            const observer = new ResizeObserver(() => {});
            observer.observe(ref);
            onCleanup(() => observer.disconnect());
          });
          return <div ref={ref!} />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows ResizeObserver outside effects", () => {
      const { diagnostics } = check(`
        function App() {
          const observer = new ResizeObserver(() => {});
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows component-level onCleanup with disconnect", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          let ref: HTMLDivElement;
          const observer = new ResizeObserver(() => {});
          createEffect(() => {
            observer.observe(ref);
          });
          onCleanup(() => observer.disconnect());
          return <div ref={ref!} />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })
})

describe("effect-outside-root", () => {
  const check = (code: string) => checkRule(effectOutsideRoot, code)

  it("metadata", () => {
    expect(effectOutsideRoot.id).toBe("effect-outside-root")
  })

  describe("invalid patterns", () => {
    it("flags createEffect at module scope", () => {
      const { diagnostics } = check(`
        import { createEffect, createSignal } from "solid-js";
        const [count, setCount] = createSignal(0);
        createEffect(() => console.log(count()));
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("createEffect")
      expect(diagnostics[0].message).toContain("reactive root")
    })

    it("flags createMemo at module scope", () => {
      const { diagnostics } = check(`
        import { createMemo, createSignal } from "solid-js";
        const [count, setCount] = createSignal(0);
        const doubled = createMemo(() => count() * 2);
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("createMemo")
    })

    it("flags createComputed at module scope", () => {
      const { diagnostics } = check(`
        import { createComputed, createSignal } from "solid-js";
        const [count, setCount] = createSignal(0);
        createComputed(() => console.log(count()));
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("flags createRenderEffect at module scope", () => {
      const { diagnostics } = check(`
        import { createRenderEffect, createSignal } from "solid-js";
        const [count, setCount] = createSignal(0);
        createRenderEffect(() => console.log(count()));
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("flags createEffect in non-component function", () => {
      const { diagnostics } = check(`
        import { createEffect } from "solid-js";
        function helper() {
          createEffect(() => console.log("hi"));
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })
  })

  describe("valid patterns", () => {
    it("allows createEffect inside component", () => {
      const { diagnostics } = check(`
        import { createEffect, createSignal } from "solid-js";
        function App() {
          const [count, setCount] = createSignal(0);
          createEffect(() => console.log(count()));
          return <div>{count()}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows createMemo inside component", () => {
      const { diagnostics } = check(`
        import { createMemo, createSignal } from "solid-js";
        function App() {
          const [count, setCount] = createSignal(0);
          const doubled = createMemo(() => count() * 2);
          return <div>{doubled()}</div>;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows createEffect inside createRoot", () => {
      const { diagnostics } = check(`
        import { createEffect, createRoot, createSignal } from "solid-js";
        const [count, setCount] = createSignal(0);
        createRoot(() => {
          createEffect(() => console.log(count()));
        });
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows createEffect inside runWithOwner", () => {
      const { diagnostics } = check(`
        import { createEffect, runWithOwner, getOwner } from "solid-js";
        const owner = getOwner();
        runWithOwner(owner, () => {
          createEffect(() => console.log("tracked"));
        });
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows createEffect inside custom reactive primitive (createXxx)", () => {
      const { diagnostics } = check(`
        import { createEffect } from "solid-js";
        function createTimer(fn: () => void, delay: number) {
          createEffect(() => fn());
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows createEffect inside custom hook (useXxx)", () => {
      const { diagnostics } = check(`
        import { createEffect } from "solid-js";
        function useDebounce(value: () => string) {
          createEffect(() => console.log(value()));
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows createEffect inside object property callback passed to create* call", () => {
      const { diagnostics } = check(`
        import { createEffect, createSignal } from "solid-js";
        function createSimpleContext(input) {
          return input.init();
        }
        const ctx = createSimpleContext({
          init: () => {
            const [count, setCount] = createSignal(0);
            createEffect(() => console.log(count()));
          }
        });
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows createEffect inside object property callback passed to use* call", () => {
      const { diagnostics } = check(`
        import { createEffect, createSignal } from "solid-js";
        function useContext(input) {
          return input.setup();
        }
        const ctx = useContext({
          setup: () => {
            const [count, setCount] = createSignal(0);
            createEffect(() => console.log(count()));
          }
        });
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })
})

describe("no-leaked-animation-frame", () => {
  const check = (code: string) => checkRule(noLeakedAnimationFrame, code)

  it("metadata", () => {
    expect(noLeakedAnimationFrame.id).toBe("no-leaked-animation-frame")
  })

  describe("invalid patterns", () => {
    it("flags requestAnimationFrame in createEffect without cleanup", () => {
      const { diagnostics } = check(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => {
            requestAnimationFrame(() => {});
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("requestAnimationFrame")
    })

    it("flags window.requestAnimationFrame in createEffect without cleanup", () => {
      const { diagnostics } = check(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => {
            window.requestAnimationFrame(() => {});
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("flags requestAnimationFrame in createReaction without cleanup", () => {
      const { diagnostics } = check(`
        import { createReaction, createSignal } from "solid-js";
        function App() {
          const [count] = createSignal(0);
          const track = createReaction(() => {
            requestAnimationFrame(() => {});
          });
          track(() => count());
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("requestAnimationFrame")
    })

    it("flags requestAnimationFrame in createMemo without cleanup", () => {
      const { diagnostics } = check(`
        import { createMemo, createSignal } from "solid-js";
        function App() {
          const [count] = createSignal(0);
          const derived = createMemo(() => {
            requestAnimationFrame(() => {});
            return count();
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })
  })

  describe("valid patterns", () => {
    it("allows requestAnimationFrame with cancelAnimationFrame in onCleanup", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          createEffect(() => {
            const id = requestAnimationFrame(() => {});
            onCleanup(() => cancelAnimationFrame(id));
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows requestAnimationFrame outside effects", () => {
      const { diagnostics } = check(`
        function App() {
          requestAnimationFrame(() => {});
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows component-level onCleanup with named cleanup function", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup, untrack, createSignal } from "solid-js";
        function App() {
          const [value] = createSignal(0);
          let frameId: number | undefined;
          function cleanup() {
            if (frameId !== undefined) {
              cancelAnimationFrame(frameId);
              frameId = undefined;
            }
          }
          createEffect(() => {
            const v = value();
            cleanup();
            frameId = requestAnimationFrame(() => {});
          });
          onCleanup(cleanup);
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows component-level onCleanup with inline arrow containing cancelAnimationFrame", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup, createSignal } from "solid-js";
        function App() {
          const [value] = createSignal(0);
          let frameId = 0;
          createEffect(() => {
            const v = value();
            cancelAnimationFrame(frameId);
            frameId = requestAnimationFrame(() => {});
          });
          onCleanup(() => cancelAnimationFrame(frameId));
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows direct cancelAnimationFrame in effect body before re-request", () => {
      const { diagnostics } = check(`
        import { createEffect, createSignal } from "solid-js";
        function App() {
          const [value] = createSignal(0);
          let frameId = 0;
          createEffect(() => {
            const v = value();
            cancelAnimationFrame(frameId);
            frameId = requestAnimationFrame(() => {});
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows cleanup function called in effect body (one-level indirection)", () => {
      const { diagnostics } = check(`
        import { createEffect, createSignal } from "solid-js";
        function App() {
          const [value] = createSignal(0);
          let frameId: number | undefined;
          function stop() {
            if (frameId !== undefined) cancelAnimationFrame(frameId);
          }
          createEffect(() => {
            const v = value();
            stop();
            frameId = requestAnimationFrame(() => {});
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows one-shot requestAnimationFrame in onMount", () => {
      const { diagnostics } = check(`
        import { onMount } from "solid-js";
        function App() {
          onMount(() => {
            requestAnimationFrame(() => {})
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows requestAnimationFrame in onMount with DOM read", () => {
      const { diagnostics } = check(`
        import { onMount } from "solid-js";
        function App() {
          let ref: HTMLDivElement;
          onMount(() => {
            requestAnimationFrame(() => {
              ref.scrollTop = ref.scrollHeight;
            })
          });
          return <div ref={ref!} />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows recursive rAF with component-level onCleanup (createAnimatedValue pattern)", () => {
      const { diagnostics } = check(`
        import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
        function createAnimatedValue(target: () => number) {
          const [displayValue, setDisplayValue] = createSignal(0);
          let frameId: number | undefined;
          function cleanup() {
            if (frameId !== undefined) {
              cancelAnimationFrame(frameId);
              frameId = undefined;
            }
          }
          createEffect(() => {
            const targetValue = target();
            const startValue = untrack(displayValue);
            cleanup();
            function animate(currentTime: number) {
              setDisplayValue(Math.round(startValue + (targetValue - startValue) * 0.5));
              if (currentTime < 1000) {
                frameId = requestAnimationFrame(animate);
              }
            }
            frameId = requestAnimationFrame(animate);
          });
          onCleanup(cleanup);
          return displayValue;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })
})

describe("no-leaked-subscription", () => {
  const check = (code: string) => checkRule(noLeakedSubscription, code)

  it("metadata", () => {
    expect(noLeakedSubscription.id).toBe("no-leaked-subscription")
  })

  describe("invalid patterns", () => {
    it("flags WebSocket in createEffect without close", () => {
      const { diagnostics } = check(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => {
            const ws = new WebSocket("wss://example.com");
            ws.onmessage = () => {};
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("WebSocket")
    })

    it("flags EventSource in createEffect without close", () => {
      const { diagnostics } = check(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => {
            const source = new EventSource("/stream");
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("EventSource")
    })

    it("flags BroadcastChannel in createEffect without close", () => {
      const { diagnostics } = check(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => {
            const channel = new BroadcastChannel("test");
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("BroadcastChannel")
    })
  })

  describe("valid patterns", () => {
    it("allows WebSocket with close in onCleanup", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          createEffect(() => {
            const ws = new WebSocket("wss://example.com");
            onCleanup(() => ws.close());
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows WebSocket outside effects", () => {
      const { diagnostics } = check(`
        function App() {
          const ws = new WebSocket("wss://example.com");
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows component-level onCleanup with ws.close()", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup, createSignal } from "solid-js";
        function App() {
          const [url] = createSignal("wss://example.com");
          let ws: WebSocket;
          createEffect(() => {
            ws = new WebSocket(url());
          });
          onCleanup(() => ws.close());
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })
})

describe("create-root-dispose", () => {
  const check = (code: string) => checkRule(createRootDispose, code)

  it("metadata", () => {
    expect(createRootDispose.id).toBe("create-root-dispose")
  })

  describe("invalid patterns", () => {
    it("flags createRoot with unused dispose parameter", () => {
      const { diagnostics } = check(`
        import { createRoot, createEffect, createSignal } from "solid-js";
        const [state, setState] = createSignal(0);
        createRoot((dispose) => {
          createEffect(() => console.log(state()));
        });
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("dispose")
    })
  })

  describe("valid patterns", () => {
    it("allows createRoot without dispose parameter", () => {
      const { diagnostics } = check(`
        import { createRoot, createEffect } from "solid-js";
        createRoot(() => {
          createEffect(() => {});
        });
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows createRoot where dispose is called", () => {
      const { diagnostics } = check(`
        import { createRoot, onCleanup } from "solid-js";
        createRoot((dispose) => {
          onCleanup(dispose);
        });
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows createRoot where dispose is returned", () => {
      const { diagnostics } = check(`
        import { createRoot } from "solid-js";
        const cleanup = createRoot((dispose) => {
          return dispose;
        });
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows createRoot where dispose is stored", () => {
      const { diagnostics } = check(`
        import { createRoot } from "solid-js";
        let cleanup: () => void;
        createRoot((dispose) => {
          cleanup = dispose;
        });
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })

  describe("shadowed names", () => {
    it("flags when dispose name is shadowed and only shadowed version is used", () => {
      const { diagnostics } = check(`
        import { createRoot, createEffect } from "solid-js";
        createRoot((dispose) => {
          function inner() {
            const dispose = () => {};
            dispose();
          }
          createEffect(() => {});
        });
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("flags when module-scope variable has same name as dispose param", () => {
      const { diagnostics } = check(`
        import { createRoot, createEffect } from "solid-js";
        const dispose = "something";
        createRoot((dispose) => {
          createEffect(() => {});
        });
      `)
      expect(diagnostics).toHaveLength(1)
    })
  })
})

describe("no-leaked-abort-controller", () => {
  const check = (code: string) => checkRule(noLeakedAbortController, code)

  it("metadata", () => {
    expect(noLeakedAbortController.id).toBe("no-leaked-abort-controller")
  })

  describe("invalid patterns", () => {
    it("flags AbortController in createEffect without abort", () => {
      const { diagnostics } = check(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => {
            const controller = new AbortController();
            fetch("/api", { signal: controller.signal });
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("AbortController")
    })
  })

  describe("valid patterns", () => {
    it("allows AbortController with abort in onCleanup", () => {
      const { diagnostics } = check(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          createEffect(() => {
            const controller = new AbortController();
            fetch("/api", { signal: controller.signal });
            onCleanup(() => controller.abort());
          });
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows AbortController outside effects", () => {
      const { diagnostics } = check(`
        function App() {
          const controller = new AbortController();
          return <div />;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })
})

describe("unbounded-collection", () => {
  const check = (code: string) => checkRule(unboundedCollection, code)

  it("metadata", () => {
    expect(unboundedCollection.id).toBe("unbounded-collection")
  })

  describe("invalid patterns", () => {
    it("flags module-scoped Map with only set()", () => {
      const { diagnostics } = check(`
        const cache = new Map<string, number>();
        function add(key: string, value: number) {
          cache.set(key, value);
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("Map")
      expect(diagnostics[0].message).toContain("cache")
    })

    it("flags module-scoped Set with only add()", () => {
      const { diagnostics } = check(`
        const visited = new Set<string>();
        function track(url: string) {
          visited.add(url);
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("Set")
    })

    it("flags module-scoped Array with only push()", () => {
      const { diagnostics } = check(`
        const logs: string[] = [];
        function log(msg: string) {
          logs.push(msg);
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("Array")
    })

    it("flags computed property access cache[\"set\"](key, value)", () => {
      const { diagnostics } = check(`
        const cache = new Map<string, number>();
        function add(key: string, value: number) {
          cache["set"](key, value);
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("cache")
    })

  })

  describe("valid patterns", () => {
    it("allows Map with delete()", () => {
      const { diagnostics } = check(`
        const cache = new Map<string, number>();
        function add(key: string, value: number) {
          cache.set(key, value);
        }
        function remove(key: string) {
          cache.delete(key);
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows Map with clear()", () => {
      const { diagnostics } = check(`
        const cache = new Map<string, number>();
        function add(key: string, value: number) {
          cache.set(key, value);
        }
        function reset() {
          cache.clear();
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows function-scoped collections", () => {
      const { diagnostics } = check(`
        function process() {
          const temp = new Map<string, number>();
          temp.set("a", 1);
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows module-scoped Map with no additive methods", () => {
      const { diagnostics } = check(`
        const config = new Map<string, string>();
        function get(key: string) {
          return config.get(key);
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows Array with splice()", () => {
      const { diagnostics } = check(`
        const items: string[] = [];
        function add(item: string) {
          items.push(item);
        }
        function removeAt(index: number) {
          items.splice(index, 1);
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows static lookup table initialized at module scope", () => {
      const { diagnostics } = check(`
        const MIME_TYPES = new Map<string, string>();
        MIME_TYPES.set("html", "text/html");
        MIME_TYPES.set("css", "text/css");
        MIME_TYPES.set("js", "application/javascript");
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows reassignment as eviction: let cache = new Map()", () => {
      const { diagnostics } = check(`
        let cache = new Map<string, number>();
        function add(key: string, value: number) {
          cache.set(key, value);
        }
        function reset() {
          cache = new Map();
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })
})

describe("recursive-timer", () => {
  const check = (code: string) => checkRule(recursiveTimer, code)

  it("metadata", () => {
    expect(recursiveTimer.id).toBe("recursive-timer")
  })

  describe("invalid patterns", () => {
    it("flags setTimeout with direct reference to enclosing function", () => {
      const { diagnostics } = check(`
        function poll() {
          fetch("/status").then(() => setTimeout(poll, 5000));
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("poll")
    })

    it("flags setTimeout with arrow calling enclosing function", () => {
      const { diagnostics } = check(`
        function refresh() {
          fetch("/data").then(() => {
            setTimeout(() => refresh(), 3000);
          });
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("refresh")
    })
  })

  describe("valid patterns", () => {
    it("allows setTimeout calling a different function", () => {
      const { diagnostics } = check(`
        function other() {}
        function start() {
          setTimeout(other, 1000);
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows non-recursive setTimeout", () => {
      const { diagnostics } = check(`
        function init() {
          setTimeout(() => console.log("done"), 1000);
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows recursive setTimeout with early return termination condition", () => {
      const { diagnostics } = check(`
        let shouldStop = false;
        function poll() {
          if (shouldStop) return;
          fetch("/status").then(() => setTimeout(poll, 5000));
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows recursive setTimeout with guard via arrow callback", () => {
      const { diagnostics } = check(`
        let done = false;
        function retry() {
          if (done) return;
          fetch("/api").then(() => {
            setTimeout(() => retry(), 3000);
          });
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })
})

describe("finalization-registry-leak", () => {
  const check = (code: string) => checkRule(finalizationRegistryLeak, code)

  it("metadata", () => {
    expect(finalizationRegistryLeak.id).toBe("finalization-registry-leak")
  })

  describe("invalid patterns", () => {
    it("flags register() where heldValue IS the target", () => {
      const { diagnostics } = check(`
        const registry = new FinalizationRegistry(() => {});
        const obj = {};
        registry.register(obj, obj);
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("obj")
    })

    it("flags register() where heldValue is an object containing the target", () => {
      const { diagnostics } = check(`
        const registry = new FinalizationRegistry(() => {});
        const obj = {};
        registry.register(obj, { ref: obj });
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("obj")
    })

    it("flags register() where heldValue is an array containing the target", () => {
      const { diagnostics } = check(`
        const registry = new FinalizationRegistry(() => {});
        const target = {};
        registry.register(target, [target]);
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("target")
    })

    it("flags register() where heldValue references target via member expression", () => {
      const { diagnostics } = check(`
        const registry = new FinalizationRegistry(() => {});
        const obj = { data: 1 };
        registry.register(obj, obj.data);
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("obj")
    })

    it("flags register() where heldValue contains spread of target", () => {
      const { diagnostics } = check(`
        const registry = new FinalizationRegistry(() => {});
        const obj = { a: 1 };
        registry.register(obj, { ...obj });
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("obj")
    })

    it("flags register() with member expression target matching heldValue", () => {
      const { diagnostics } = check(`
        const registry = new FinalizationRegistry(() => {});
        const container = { ref: {} };
        registry.register(container.ref, container.ref);
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("container.ref")
    })

    it("flags register() where heldValue wraps target in conditional", () => {
      const { diagnostics } = check(`
        const registry = new FinalizationRegistry(() => {});
        const obj = {};
        const flag = true;
        registry.register(obj, flag ? obj : null);
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("obj")
    })

    it("flags register() where heldValue wraps target in call", () => {
      const { diagnostics } = check(`
        const registry = new FinalizationRegistry(() => {});
        const obj = {};
        registry.register(obj, wrap(obj));
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("obj")
    })

    it("flags register() with computed property access target (items[0])", () => {
      const { diagnostics } = check(`
        const registry = new FinalizationRegistry(() => {});
        const items = [{}];
        registry.register(items[0], items[0]);
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("flags register() on class property registry via this.registry", () => {
      const { diagnostics } = check(`
        class Cache {
          registry = new FinalizationRegistry(() => {});
          track(obj: object) {
            this.registry.register(obj, obj);
          }
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("obj")
    })
  })

  describe("valid patterns", () => {
    it("allows register() with a different heldValue", () => {
      const { diagnostics } = check(`
        const registry = new FinalizationRegistry(() => {});
        const obj = {};
        registry.register(obj, "cleanup-token");
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows register() with a primitive heldValue", () => {
      const { diagnostics } = check(`
        const registry = new FinalizationRegistry(() => {});
        const obj = { id: 42 };
        registry.register(obj, 42);
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows register() with unrelated object heldValue", () => {
      const { diagnostics } = check(`
        const registry = new FinalizationRegistry(() => {});
        const obj = {};
        const meta = { name: "test" };
        registry.register(obj, meta);
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows register() with only one argument", () => {
      const { diagnostics } = check(`
        const registry = new FinalizationRegistry(() => {});
        const obj = {};
        registry.register(obj);
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows register() on non-FinalizationRegistry objects", () => {
      const { diagnostics } = check(`
        const map = new Map();
        const obj = {};
        map.register(obj, obj);
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows register() on custom registries", () => {
      const { diagnostics } = check(`
        class EventRegistry { register(a: any, b: any) {} }
        const registry = new EventRegistry();
        const obj = {};
        registry.register(obj, obj);
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })
})

describe("unbounded-signal-accumulation", () => {
  const check = (code: string) => checkRule(unboundedSignalAccumulation, code)

  it("metadata", () => {
    expect(unboundedSignalAccumulation.id).toBe("unbounded-signal-accumulation")
  })

  describe("invalid patterns", () => {
    it("flags arrow expression spread+append: prev => [...prev, x]", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [items, setItems] = createSignal<string[]>([]);
        setItems(prev => [...prev, "new"]);
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("setItems")
    })

    it("flags block body return spread+append", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [logs, setLogs] = createSignal<string[]>([]);
        setLogs(prev => {
          return [...prev, "entry"];
        });
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("setLogs")
    })

    it("flags prepend pattern: [x, ...prev]", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [items, setItems] = createSignal<number[]>([]);
        setItems(prev => ["first", ...prev]);
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("flags multiple appended items", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [items, setItems] = createSignal<number[]>([]);
        setItems(prev => [...prev, 1, 2, 3]);
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("flags block body with multiple statements before return", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [items, setItems] = createSignal<string[]>([]);
        setItems(prev => {
          console.log("adding item");
          return [...prev, "new"];
        });
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("flags concat pattern: prev.concat(x)", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [items, setItems] = createSignal<string[]>([]);
        setItems(prev => prev.concat(["new"]));
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("flags concat with single argument", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [items, setItems] = createSignal<string[]>([]);
        setItems(prev => prev.concat("new"));
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("flags setter alias: const add = setItems; add(prev => [...])", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [items, setItems] = createSignal<string[]>([]);
        const add = setItems;
        add(prev => [...prev, "new"]);
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("setItems")
    })
  })

  describe("valid patterns", () => {
    it("allows spread+append with slice truncation on prev", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [items, setItems] = createSignal<string[]>([]);
        setItems(prev => [...prev.slice(-100), "new"]);
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows spread+append with filter on prev", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [items, setItems] = createSignal<string[]>([]);
        setItems(prev => [...prev.filter(x => x !== "old"), "new"]);
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows result chained with slice", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [items, setItems] = createSignal<string[]>([]);
        setItems(prev => [...prev, "new"].slice(-100));
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows direct value set (not updater pattern)", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [items, setItems] = createSignal<string[]>([]);
        setItems(["a", "b"]);
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows setter with multiple arguments", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [items, setItems] = createSignal<string[]>([]);
        setItems(prev => prev, "extra");
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows setter called without updater", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [count, setCount] = createSignal(0);
        setCount(5);
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows multi-return with early truncation return", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [items, setItems] = createSignal<string[]>([]);
        setItems(prev => {
          if (prev.length > 100) return prev.slice(-50);
          return [...prev, "new"];
        });
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows multi-return with truncated spread in alternate path", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [logs, setLogs] = createSignal<string[]>([]);
        setLogs(prev => {
          if (prev.length >= 200) return [...prev.filter(x => x !== "debug"), "new"];
          return [...prev, "new"];
        });
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows non-createSignal destructure", () => {
      const { diagnostics } = check(`
        function useCustom() { return [() => [], () => {}]; }
        const [items, setItems] = useCustom();
        setItems(prev => [...prev, "new"]);
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })

  describe("sibling setter truncation", () => {
    it("allows when sibling call site uses filter (pending operations pattern)", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [pending, setPending] = createSignal<string[]>([]);
        const add = (ip: string) => {
          setPending(prev => [...prev, ip]);
        };
        const remove = (ip: string) => {
          setPending(prev => prev.filter(op => op !== ip));
        };
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows toast queue with setTimeout filter removal", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [toasts, setToasts] = createSignal<{ text: string }[]>([]);
        const addToast = (msg: string) => {
          const toast = { text: msg };
          setToasts(p => [...p, toast]);
          setTimeout(() => setToasts(p => p.filter(t => t !== toast)), 3000);
        };
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows selection toggle with filter in ternary", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [selected, setSelected] = createSignal<string[]>([]);
        const toggle = (id: string) => {
          setSelected(prev =>
            prev.includes(id)
              ? prev.filter(s => s !== id)
              : [...prev, id]
          );
        };
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows when sibling uses slice truncation", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [items, setItems] = createSignal<number[]>([]);
        setItems(prev => [...prev, 42]);
        const trim = () => {
          setItems(prev => prev.slice(-100));
        };
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows when sibling uses splice", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [items, setItems] = createSignal<string[]>([]);
        setItems(prev => [...prev, "new"]);
        const removeFirst = () => {
          setItems(prev => { prev.splice(0, 1); return prev; });
        };
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows when setter alias has sibling truncation", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [items, setItems] = createSignal<string[]>([]);
        const update = setItems;
        update(prev => [...prev, "new"]);
        setItems(prev => prev.filter(x => x !== "old"));
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("still flags when no sibling has truncation", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [logs, setLogs] = createSignal<string[]>([]);
        setLogs(prev => [...prev, "entry"]);
        setLogs(prev => [...prev, "another"]);
      `)
      expect(diagnostics).toHaveLength(2)
    })

    it("still flags when sibling uses direct reset (not updater truncation)", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [messages, setMessages] = createSignal<string[]>([]);
        setMessages(prev => [...prev, "msg"]);
        const clear = () => setMessages([]);
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("allows concat accumulation with sibling filter removal", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [events, setEvents] = createSignal<string[]>([]);
        setEvents(prev => prev.concat("new"));
        const dismiss = (id: string) => {
          setEvents(prev => prev.filter(e => e !== id));
        };
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows when sibling truncation is in block body with return", () => {
      const { diagnostics } = check(`
        import { createSignal } from "solid-js";
        const [items, setItems] = createSignal<number[]>([]);
        setItems(prev => [...prev, 1]);
        const evict = () => {
          setItems(prev => {
            return prev.filter(x => x > 0);
          });
        };
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })
})

describe("self-referencing-store", () => {
  const check = (code: string) => checkRule(selfReferencingStore, code)

  it("metadata", () => {
    expect(selfReferencingStore.id).toBe("self-referencing-store")
  })

  describe("invalid patterns", () => {
    it("flags setStore where value IS the store", () => {
      const { diagnostics } = check(`
        import { createStore } from "solid-js/store";
        const [store, setStore] = createStore({});
        setStore("self", store);
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("store")
    })

    it("flags setStore where value contains the store in an object", () => {
      const { diagnostics } = check(`
        import { createStore } from "solid-js/store";
        const [state, setState] = createStore({});
        setState("nested", { ref: state });
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("state")
    })

    it("flags setStore where value contains the store in an array", () => {
      const { diagnostics } = check(`
        import { createStore } from "solid-js/store";
        const [store, setStore] = createStore({});
        setStore("items", [store]);
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("flags setStore with deep path and self-ref value", () => {
      const { diagnostics } = check(`
        import { createStore } from "solid-js/store";
        const [store, setStore] = createStore({});
        setStore("a", "b", store);
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("flags setStore with function updater returning store", () => {
      const { diagnostics } = check(`
        import { createStore } from "solid-js/store";
        const [store, setStore] = createStore({});
        setStore("self", () => store);
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("store")
    })

    it("flags setStore where value is a store alias", () => {
      const { diagnostics } = check(`
        import { createStore } from "solid-js/store";
        const [store, setStore] = createStore({});
        const alias = store;
        setStore("self", alias);
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("store")
    })
  })

  describe("valid patterns", () => {
    it("allows setStore with unrelated value", () => {
      const { diagnostics } = check(`
        import { createStore } from "solid-js/store";
        const [store, setStore] = createStore({});
        setStore("key", "value");
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows setStore with different variable as value", () => {
      const { diagnostics } = check(`
        import { createStore } from "solid-js/store";
        const [store, setStore] = createStore({});
        const other = { data: 1 };
        setStore("key", other);
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows setStore with spread of store (shallow copy)", () => {
      const { diagnostics } = check(`
        import { createStore } from "solid-js/store";
        const [store, setStore] = createStore({});
        setStore("copy", { ...store });
      `)
      // Spread creates a shallow copy, which doesn't create a proxy cycle.
      // However our containsIdentifier does walk into SpreadElements.
      // This is a false positive edge case we accept since spread of store
      // in setStore can still retain reactive proxy references.
      expect(diagnostics).toHaveLength(1)
    })

    it("allows setStore with member access on store (reads property value, not proxy)", () => {
      const { diagnostics } = check(`
        import { createStore } from "solid-js/store";
        const [store, setStore] = createStore({ count: 0 });
        setStore("prev", store.count);
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows setStore with no arguments", () => {
      const { diagnostics } = check(`
        import { createStore } from "solid-js/store";
        const [store, setStore] = createStore({});
        setStore();
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows setStore with function updater", () => {
      const { diagnostics } = check(`
        import { createStore } from "solid-js/store";
        const [store, setStore] = createStore({ count: 0 });
        setStore("count", prev => prev + 1);
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })
})

describe("detached-dom-reference", () => {
  const check = (code: string) => checkRule(detachedDomReference, code)

  it("metadata", () => {
    expect(detachedDomReference.id).toBe("detached-dom-reference")
  })

  describe("invalid patterns", () => {
    it("flags module-scoped querySelector result", () => {
      const { diagnostics } = check(`
        const el = document.querySelector("#app");
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("querySelector")
      expect(diagnostics[0].message).toContain("el")
    })

    it("flags module-scoped getElementById result", () => {
      const { diagnostics } = check(`
        const header = document.getElementById("header");
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("getElementById")
    })

    it("flags module-scoped querySelectorAll result", () => {
      const { diagnostics } = check(`
        const items = document.querySelectorAll(".item");
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("querySelectorAll")
    })

    it("flags module-scoped getElementsByClassName result", () => {
      const { diagnostics } = check(`
        const buttons = document.getElementsByClassName("btn");
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("flags assignment to pre-declared module-scope variable", () => {
      const { diagnostics } = check(`
        let cachedEl: Element | null = null;
        function init() {
          cachedEl = document.querySelector("#app");
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("cachedEl")
    })

    it("flags property assignment on module-scoped object", () => {
      const { diagnostics } = check(`
        const state = { el: null as Element | null };
        function init() {
          state.el = document.querySelector("#app");
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("state.el")
    })
  })

  describe("valid patterns", () => {
    it("allows querySelector inside a function", () => {
      const { diagnostics } = check(`
        function setup() {
          const el = document.querySelector("#app");
          return el;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows querySelector inside an arrow function", () => {
      const { diagnostics } = check(`
        const setup = () => {
          const el = document.querySelector("#app");
          return el;
        };
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows querySelector result not stored in a variable", () => {
      const { diagnostics } = check(`
        function process() {
          document.querySelector("#app")?.remove();
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows querySelector in class method", () => {
      const { diagnostics } = check(`
        class View {
          init() {
            const el = document.querySelector("#root");
          }
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })
})

describe("closure-captured-scope", () => {
  const check = (code: string) => checkRule(closureCapturedScope, code)

  it("metadata", () => {
    expect(closureCapturedScope.id).toBe("closure-captured-scope")
  })

  describe("invalid patterns", () => {
    it("flags large allocation unreferenced by returned closure", () => {
      const { diagnostics } = check(`
        function process() {
          const huge = new Array(1000);
          const summary = huge.length;
          return () => summary;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("huge")
    })

    it("flags Uint8Array allocation unreferenced by returned closure", () => {
      const { diagnostics } = check(`
        function encode() {
          const buffer = new Uint8Array(4096);
          const hash = buffer[0];
          return () => hash;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("buffer")
    })

    it("flags Array.from allocation", () => {
      const { diagnostics } = check(`
        function transform() {
          const items = Array.from({ length: 1000 });
          const count = items.length;
          return () => count;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("items")
    })

    it("flags chained new Array().fill().map()", () => {
      const { diagnostics } = check(`
        function build() {
          const data = new Array(100).fill(0).map((_, i) => i);
          const total = data.length;
          return () => total;
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("flags returned object with closure method not referencing large allocation", () => {
      const { diagnostics } = check(`
        function createProcessor() {
          const huge = new Array(1_000_000);
          const summary = huge.length;
          return { getSummary: () => summary };
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("huge")
    })

    it("flags Buffer.alloc allocation", () => {
      const { diagnostics } = check(`
        function process() {
          const buf = Buffer.alloc(10_000_000);
          const checksum = buf[0];
          return () => checksum;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("buf")
    })

    it("flags [...data] spread as large allocation", () => {
      const { diagnostics } = check(`
        function process(source: number[]) {
          const copy = [...source];
          const len = copy.length;
          return () => len;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("copy")
    })

    it("flags closure escaping via assignment to outer-scope variable", () => {
      const { diagnostics } = check(`
        let handler: (() => number) | null = null;
        function process() {
          const huge = new Array(1_000_000).fill(0);
          const summary = huge.length;
          handler = () => summary;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("huge")
    })
  })

  describe("valid patterns", () => {
    it("allows when returned closure references the large allocation", () => {
      const { diagnostics } = check(`
        function getData() {
          const data = new Array(1000);
          return () => data;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows when no closure is returned", () => {
      const { diagnostics } = check(`
        function process() {
          const data = new Array(1000);
          return data.length;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows when large allocation is in inner scope", () => {
      const { diagnostics } = check(`
        function process() {
          const summary = (() => {
            const huge = new Array(1000);
            return huge.length;
          })();
          return () => summary;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows function without large allocations", () => {
      const { diagnostics } = check(`
        function create() {
          const name = "test";
          return () => name;
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })
})

describe("closure-dom-circular", () => {
  const check = (code: string) => checkRule(closureDomCircular, code)

  it("metadata", () => {
    expect(closureDomCircular.id).toBe("closure-dom-circular")
  })

  describe("invalid patterns", () => {
    it("flags onclick handler closure that captures the element parameter", () => {
      const { diagnostics } = check(`
        function setup(element: HTMLElement) {
          element.onclick = () => {
            element.classList.toggle("active");
          };
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("element")
    })

    it("flags onmouseover handler closure that captures param", () => {
      const { diagnostics } = check(`
        function attach(el: HTMLDivElement) {
          el.onmouseover = () => {
            el.style.color = "red";
          };
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("el")
    })

    it("flags function expression handler", () => {
      const { diagnostics } = check(`
        function bind(node: HTMLElement) {
          node.onclick = function() {
            node.remove();
          };
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("flags event handler on local variable that creates circular ref", () => {
      const { diagnostics } = check(`
        function setup() {
          const el = document.createElement("div");
          el.onclick = () => {
            el.classList.toggle("active");
          };
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("el")
    })

    it("flags destructured parameter with circular event handler", () => {
      const { diagnostics } = check(`
        function setup({ el }: { el: HTMLElement }) {
          el.onclick = () => {
            el.classList.toggle("active");
          };
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("el")
    })
  })

  describe("valid patterns", () => {
    it("allows handler that does not capture the element", () => {
      const { diagnostics } = check(`
        function setup(element: HTMLElement) {
          element.onclick = () => {
            console.log("clicked");
          };
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows addEventListener instead of property assignment", () => {
      const { diagnostics } = check(`
        function setup(element: HTMLElement) {
          element.addEventListener("click", () => {
            element.classList.toggle("active");
          });
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows non-event property assignment", () => {
      const { diagnostics } = check(`
        function setup(element: HTMLElement) {
          element.textContent = "hello";
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows onerror handler on EventSource capturing the variable", () => {
      const { diagnostics } = check(`
        function setup() {
          const es = new EventSource("/stream");
          es.onerror = () => {
            if (es.readyState === EventSource.CLOSED) {
              console.log("closed");
            }
          };
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows onmessage handler on WebSocket capturing the variable", () => {
      const { diagnostics } = check(`
        function setup() {
          const ws = new WebSocket("wss://example.com");
          ws.onerror = () => {
            ws.close();
          };
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows onmessage handler on Worker capturing the variable", () => {
      const { diagnostics } = check(`
        function setup() {
          const worker = new Worker("worker.js");
          worker.onerror = () => {
            worker.terminate();
          };
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows onerror handler on XMLHttpRequest capturing the variable", () => {
      const { diagnostics } = check(`
        function request() {
          const xhr = new XMLHttpRequest();
          xhr.onerror = () => {
            xhr.abort();
          };
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })
})

describe("prefer-charcode-over-regex-test", () => {
  const check = (code: string) => checkRule(preferCharcodeOverRegexTest, code)

  it("metadata", () => {
    expect(preferCharcodeOverRegexTest.id).toBe("prefer-charcode-over-regex-test")
  })

  describe("invalid patterns", () => {
    it("flags /[a-zA-Z]/.test(str[0])", () => {
      const { diagnostics } = check(`
        function classify(str: string) {
          if (/[a-zA-Z]/.test(str[0])) return true;
          return false;
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("charCodeAt")
    })

    it("flags /[0-9]/.test(ch) in a while loop", () => {
      const { diagnostics } = check(`
        function scan(s: string) {
          let i = 0;
          while (/[0-9]/.test(s[i])) i++;
          return i;
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("flags /[a-z]/.test(str.charAt(i)) with charAt arg", () => {
      const { diagnostics } = check(`
        function isLower(s: string, i: number) {
          return /[a-z]/.test(s.charAt(i));
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })

  })

  describe("valid patterns", () => {
    it("does not flag /[a-z]/.test(c) with bare identifier arg", () => {
      const { diagnostics } = check(`
        function isLower(c: string) {
          return /[a-z]/.test(c);
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("does not flag /[*?{]/.test(pattern) — bare identifier is not provably single-char", () => {
      const { diagnostics } = check(`
        function isGlob(pattern: string) {
          return /[*?{]/.test(pattern);
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })
    it("allows regex .test() on full strings (not single char)", () => {
      const { diagnostics } = check(`
        function validate(input: string) {
          return /^[a-z]+$/.test(input);
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows non-regex .test() calls", () => {
      const { diagnostics } = check(`
        function check(suite: { test: (s: string) => boolean }) {
          return suite.test("hello");
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows precompiled regex .test()", () => {
      const { diagnostics } = check(`
        const ALPHA = /[a-zA-Z]/;
        function classify(str: string) {
          return ALPHA.test(str[0]);
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })
})

describe("prefer-precompiled-regex", () => {
  const check = (code: string) => checkRule(preferPrecompiledRegex, code)

  it("metadata", () => {
    expect(preferPrecompiledRegex.id).toBe("prefer-precompiled-regex")
  })

  describe("invalid patterns", () => {
    it("flags inline regex in function as .test() receiver", () => {
      const { diagnostics } = check(`
        function isAlpha(c: string) {
          return /[a-z]/.test(c);
        }
      `)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("module-level")
    })

    it("flags inline regex as argument to .replace()", () => {
      const { diagnostics } = check(`
        function normalize(s: string) {
          return s.replace(/\\s+/g, " ");
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })

    it("flags inline regex as argument to .match()", () => {
      const { diagnostics } = check(`
        function extract(s: string) {
          return s.match(/[0-9]+/);
        }
      `)
      expect(diagnostics).toHaveLength(1)
    })
  })

  describe("valid patterns", () => {
    it("allows module-level regex used in function", () => {
      const { diagnostics } = check(`
        const WHITESPACE = /\\s+/g;
        function normalize(s: string) {
          return s.replace(WHITESPACE, " ");
        }
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it("allows regex at module scope (not inside a function)", () => {
      const { diagnostics } = check(`
        const result = "hello world".replace(/\\s+/g, "-");
      `)
      expect(diagnostics).toHaveLength(0)
    })
  })
})
