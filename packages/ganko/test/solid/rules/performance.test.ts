/**
 * Performance Rules Tests
 */

import { describe, it, expect } from "vitest"
import { checkRule, lazyRuleBatch } from "../test-utils"
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
  const batch = lazyRuleBatch(preferLazyPropertyAccess)
  const s0 = batch.add(`
      function test(context: any) {
        const sourceCode = context.sourceCode;
        if (!context.valid) return null;
        return sourceCode.getText();
      }
    `)
  const s1 = batch.add(`
      function test(config: any) {
        const value = config.settings.nested.value;
        if (!config.enabled) return null;
        return value;
      }
    `)
  const s2 = batch.add(`
      function test(context: any) {
        const sourceCode = context.sourceCode;
        return sourceCode.getText();
      }
    `)
  const s3 = batch.add(`
      function test(context: any) {
        const sourceCode = context.sourceCode;
        if (!sourceCode) return null;
        return sourceCode.getText();
      }
    `)
  const s4 = batch.add(`
      function test(context: any) {
        const sourceCode = context.sourceCode;
        if (!sourceCode.isValid()) return null;
        return sourceCode.getText();
      }
    `)

  it("metadata", () => {
    expect(preferLazyPropertyAccess.id).toBe("prefer-lazy-property-access")
  })

  it("flags property access before early return when not used there", () => {
    const { diagnostics } = batch.result(s0)
    expect(diagnostics.length).toBeGreaterThan(0)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("Property")
  })

  it("flags nested property access before early return", () => {
    const { diagnostics } = batch.result(s1)
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  it("does not flag when no early returns", () => {
    const { diagnostics } = batch.result(s2)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag when variable is used before early return", () => {
    const { diagnostics } = batch.result(s3)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag when variable method is called before early return", () => {
    const { diagnostics } = batch.result(s4)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("avoid-chained-array-methods", () => {
  const batch = lazyRuleBatch(avoidChainedArrayMethods)
  const s0 = batch.add(`
      function test(items: number[]) {
        return items.filter(x => x > 0).map(x => x * 2).reduce((sum, x) => sum + x, 0);
      }
    `)
  const s1 = batch.add(`
      function test(items: any[]) {
        return items.slice(1).filter(x => x.valid).map(x => x.name);
      }
    `)
  const s2 = batch.add(`
      function test(items: any[]) {
        return items.slice(1).map(x => x.name).join(", ");
      }
    `)
  const s3 = batch.add(`
      function test(rows: number[][]) {
        for (let i = 0; i < rows.length; i++) {
          const key = rows[i].map(x => String(x)).join(",");
          if (key.length > 0) {}
        }
      }
    `)
  const s4 = batch.add(`
      function test(row: number[]) {
        return row.map(x => String(x)).join(",");
      }
    `)
  const s5 = batch.add(`
      function test(items: number[]) {
        return items.map(x => x * 2);
      }
    `)
  const s6 = batch.add(`
      function test(items: number[]) {
        return items.reduce((acc, x) => x > 0 ? [...acc, x * 2] : acc, []);
      }
    `)
  const s7 = batch.add(`
      function test() {
        const rgb: [number, number, number] = [255, 128, 64];
        return rgb.filter(v => v > 100).map(v => v / 255);
      }
    `)
  const s8 = batch.add(`
      function parseCsv(input: string) {
        return input.split(",").map(part => part.trim()).filter(Boolean);
      }
    `)

  it("metadata", () => {
    expect(avoidChainedArrayMethods.id).toBe("avoid-chained-array-methods")
  })

  it("flags filter().map().reduce() chain (filter+map pattern with 2 intermediates)", () => {
    const { diagnostics } = batch.result(s0)
    expect(diagnostics.length).toBeGreaterThan(0)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("Chain creates")
  })

  it("flags slice().filter().map() (3 intermediates)", () => {
    const { diagnostics } = batch.result(s1)
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  it("does not flag slice().map().join() (2 intermediates, not filter+map)", () => {
    const { diagnostics } = batch.result(s2)
    expect(diagnostics).toHaveLength(0)
  })

  it("flags map().join() inside loops as hot-path allocation", () => {
    const { diagnostics } = batch.result(s3)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("hot path")
  })

  it("does not flag map().join() outside loops", () => {
    const { diagnostics } = batch.result(s4)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag single map()", () => {
    const { diagnostics } = batch.result(s5)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag single reduce()", () => {
    const { diagnostics } = batch.result(s6)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag tuple type chains", () => {
    const { diagnostics } = batch.result(s7)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag split multipass chains handled by parsing-specific rule", () => {
    const { diagnostics } = batch.result(s8)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("avoid-quadratic-spread", () => {
  const batch = lazyRuleBatch(avoidQuadraticSpread)
  const s0 = batch.add(`
      function test(items: number[]) {
        return items.reduce((acc, x) => [...acc, x], []);
      }
    `)
  const s1 = batch.add(`
      function test(items: any[]) {
        return items.reduce((acc, x) => [...acc, ...x.items], []);
      }
    `)
  const s2 = batch.add(`
      function test(items: number[]) {
        return items.reduce((acc, x) => { acc.push(x); return acc; }, []);
      }
    `)
  const s3 = batch.add(`
      function test(items: number[]) {
        return items.reduce((sum, x) => sum + x, 0);
      }
    `)

  it("metadata", () => {
    expect(avoidQuadraticSpread.id).toBe("avoid-quadratic-spread")
  })

  it("flags spreading accumulator in reduce", () => {
    const { diagnostics } = batch.result(s0)
    expect(diagnostics.length).toBeGreaterThan(0)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("O(n")
  })

  it("flags spreading accumulator with nested spread", () => {
    const { diagnostics } = batch.result(s1)
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  it("does not flag push pattern", () => {
    const { diagnostics } = batch.result(s2)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag non-array reduce", () => {
    const { diagnostics } = batch.result(s3)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("avoid-delete-operator", () => {
  const batch = lazyRuleBatch(avoidDeleteOperator)
  const s0 = batch.add(`
      function test(user: any) {
        delete user.password;
      }
    `)
  const s1 = batch.add(`
      function test(obj: any, key: string) {
        delete obj[key];
      }
    `)
  const s2 = batch.add(`
      function test(user: any) {
        user.password = undefined;
      }
    `)

  it("metadata", () => {
    expect(avoidDeleteOperator.id).toBe("avoid-delete-operator")
  })

  it("flags delete on property", () => {
    const { diagnostics } = batch.result(s0)
    expect(diagnostics.length).toBeGreaterThan(0)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("slow mode")
  })

  it("flags delete on computed property", () => {
    const { diagnostics } = batch.result(s1)
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  it("does not flag setting to undefined", () => {
    const { diagnostics } = batch.result(s2)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("avoid-arguments-object", () => {
  const batch = lazyRuleBatch(avoidArgumentsObject)
  const s0 = batch.add(`
      function test() {
        return arguments[0];
      }
    `)
  const s1 = batch.add(`
      function test() {
        return arguments.length;
      }
    `)
  const s2 = batch.add(`
      function test(...args: any[]) {
        return args[0];
      }
    `)
  const s3 = batch.add(`
      function test(arguments: any) {
        return arguments;
      }
    `)

  it("metadata", () => {
    expect(avoidArgumentsObject.id).toBe("avoid-arguments-object")
  })

  it("flags arguments in regular function", () => {
    const { diagnostics } = batch.result(s0)
    expect(diagnostics.length).toBeGreaterThan(0)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("rest parameters")
  })

  it("flags arguments.length", () => {
    const { diagnostics } = batch.result(s1)
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  it("does not flag rest parameters", () => {
    const { diagnostics } = batch.result(s2)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag shadowed arguments parameter", () => {
    const { diagnostics } = batch.result(s3)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("avoid-sparse-arrays", () => {
  const batch = lazyRuleBatch(avoidSparseArrays)
  const s0 = batch.add(`
      function test() {
        return new Array(100);
      }
    `)
  const s1 = batch.add(`
      function test(n: number) {
        return new Array(n);
      }
    `)
  const s2 = batch.add(`
      function test() {
        return new Array(100).fill(0);
      }
    `)
  const s3 = batch.add(`
      function test() {
        return new Array();
      }
    `)
  const s4 = batch.add(`
      function test() {
        return Array.from({ length: 100 }, (_, i) => i);
      }
    `)

  it("metadata", () => {
    expect(avoidSparseArrays.id).toBe("avoid-sparse-arrays")
  })

  it("flags new Array(n)", () => {
    const { diagnostics } = batch.result(s0)
    expect(diagnostics.length).toBeGreaterThan(0)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("holey")
  })

  it("flags new Array(variable)", () => {
    const { diagnostics } = batch.result(s1)
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  it("does not flag new Array().fill()", () => {
    const { diagnostics } = batch.result(s2)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag empty new Array()", () => {
    const { diagnostics } = batch.result(s3)
    expect(diagnostics).toHaveLength(0)
  })

  it("does not flag Array.from", () => {
    const { diagnostics } = batch.result(s4)
    expect(diagnostics).toHaveLength(0)
  })
})

describe("avoid-hidden-class-transition", () => {
  const batch = lazyRuleBatch(avoidHiddenClassTransition)
  const s0 = batch.add(`
      interface Node { status: string; output: string }
      function test(node: Node | null) {
        if (node) {
          node.status = "completed";
          node.output = "done";
        }
      }
    `)
  const s1 = batch.add(`
      function test() {
        const obj: any = { a: 1 };
        obj.b = 2;
        return obj;
      }
    `)
  const s2 = batch.add(`
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
    `)
  const s3 = batch.add(`
      interface Command { execute(): void }
      function updateArray(commands: Command[], index: number, cmd: Command) {
        if (index >= 0) {
          commands[index] = cmd;
        }
      }
    `)
  const s4 = batch.add(`
      interface Item { id: string }
      function replaceLastItem(items: Item[], newItem: Item) {
        if (items.length > 0) {
          items[items.length - 1] = newItem;
        }
      }
    `)
  const s5 = batch.add(`
      function setDynamicProp(obj: Record<string, number>, key: string, value: number) {
        if (key) {
          obj[key] = value;
        }
      }
    `)
  const s6 = batch.add(`
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
    `)
  const s7 = batch.add(`
      function update(node: { status: string }) {
        if (node.status === "pending") {
          node.status = "done";
        }
      }
    `)
  const s8 = batch.add(`
      function setup() {
        const widget = new Widget();
        if (widget.enabled) {
          widget.visible = true;
        }
      }
    `)
  const s9 = batch.add(`
      function build(condition: boolean) {
        const obj = { a: 1 };
        if (condition) {
          obj.b = 2;
        }
        return obj;
      }
    `)
  const s10 = batch.add(`
      function transform() {
        const result = getResult();
        if (result) {
          result.processed = true;
        }
        return result;
      }
    `)

  it("metadata", () => {
    expect(avoidHiddenClassTransition.id).toBe("avoid-hidden-class-transition")
  })

  it("does not flag mutation of existing property in conditional", () => {
    expect(batch.result(s0).diagnostics).toHaveLength(0)
  })

  it("does not flag unconditional property assignment", () => {
    expect(batch.result(s1).diagnostics).toHaveLength(0)
  })

  it("does not flag store-like mutation patterns", () => {
    expect(batch.result(s2).diagnostics).toHaveLength(0)
  })

  it("does not flag array index assignments", () => {
    expect(batch.result(s3).diagnostics).toHaveLength(0)
  })

  it("does not flag array length-based index assignments", () => {
    expect(batch.result(s4).diagnostics).toHaveLength(0)
  })

  it("does not flag dynamic property name assignments", () => {
    expect(batch.result(s5).diagnostics).toHaveLength(0)
  })

  it("does not flag DOM element property assignment in conditional", () => {
    expect(batch.result(s6).diagnostics).toHaveLength(0)
  })

  it("does not flag parameter property assignment in conditional", () => {
    expect(batch.result(s7).diagnostics).toHaveLength(0)
  })

  it("does not flag class instance property assignment in conditional", () => {
    expect(batch.result(s8).diagnostics).toHaveLength(0)
  })

  it("flags object literal conditional property addition with type info", () => {
    expect(batch.result(s9).diagnostics).toHaveLength(1)
  })

  it("does not flag function return value property assignment in conditional", () => {
    expect(batch.result(s10).diagnostics).toHaveLength(0)
  })
})

describe("avoid-function-allocation-in-hot-loop", () => {
  const batch = lazyRuleBatch(avoidFunctionAllocationInHotLoop)
  const s0 = batch.add(`
      function test(items: any[]) {
        for (const item of items) {
          item.handler = () => console.log(item);
        }
      }
    `)
  const s1 = batch.add(`
      function test() {
        const callbacks: any[] = [];
        for (let i = 0; i < 10; i++) {
          callbacks.push(() => i);
        }
        return callbacks;
      }
    `)
  const s2 = batch.add(`
      function test(items: any[]) {
        const handler = (item: any) => console.log(item);
        for (const item of items) {
          item.handler = handler;
        }
      }
    `)
  const s3 = batch.add(`
      function test(items: any[]) {
        for (const item of items) {
          process(item);
        }
      }
      function process(x: any) { console.log(x); }
    `)
  const s4 = batch.add(`
      function test(items: number[]) {
        return items.map(x => x * 2);
      }
    `)

  it("metadata", () => {
    expect(avoidFunctionAllocationInHotLoop.id).toBe("avoid-function-allocation-in-hot-loop")
  })

  it("flags closure created in for-of loop capturing loop variable", () => {
    const { diagnostics } = batch.result(s0)
    expect(diagnostics.length).toBeGreaterThan(0)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("closure")
  })

  it("flags closure in for loop capturing counter", () => {
    const { diagnostics } = batch.result(s1)
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  it("does not flag hoisted function used in loop", () => {
    expect(batch.result(s2).diagnostics).toHaveLength(0)
  })

  it("does not flag callback without captures in loop", () => {
    expect(batch.result(s3).diagnostics).toHaveLength(0)
  })

  it("does not flag array method callbacks", () => {
    expect(batch.result(s4).diagnostics).toHaveLength(0)
  })
})

describe("avoid-megamorphic-property-access", () => {
  const batch = lazyRuleBatch(avoidMegamorphicPropertyAccess)
  const s0 = batch.add(`
      function identity(obj: any) {
        return obj;
      }
    `)
  const s1 = batch.add(`
      function noop() {}
    `)
  const s2 = batch.add(`
      type IconName = "home" | "settings" | "user" | "search" | "menu" | "close" | "check" | "arrow-up" | "arrow-down" | "arrow-left";
      function SidebarItem(props: { name: IconName }) {
        return props.name;
      }
    `)

  it("metadata", () => {
    expect(avoidMegamorphicPropertyAccess.id).toBe("avoid-megamorphic-property-access")
  })

  it("does not flag identity function (no property access)", () => {
    expect(batch.result(s0).diagnostics).toHaveLength(0)
  })

  it("does not flag function with no params", () => {
    expect(batch.result(s1).diagnostics).toHaveLength(0)
  })

  it("does not flag object type containing a wide string literal union property", () => {
    expect(batch.result(s2).diagnostics).toHaveLength(0)
  })
})

describe("prefer-set-has-over-equality-chain", () => {
  const batch = lazyRuleBatch(preferSetHasOverEqualityChain)
  const se0 = batch.add(`
      function isIgnored(name: string): boolean {
        if (name === "none") return true;
        if (name === "initial") return true;
        if (name === "inherit") return true;
        if (name === "unset") return true;
        return false;
      }
    `)
  const se1 = batch.add(`
      function isIgnoredAnimationName(name: string): boolean {
        if (name === "none") return true;
        if (name === "initial") return true;
        if (name === "inherit") return true;
        if (name === "unset") return true;
        if (name === "revert") return true;
        if (name === "revert-layer") return true;
        return false;
      }
    `)
  const se2 = batch.add(`
      function check(s: string): boolean {
        if (s === "a") return true;
        if (s === "b") return true;
        if (s === "c") return true;
        return false;
      }
    `)
  const se3 = batch.add(`
      function check(a: string, b: string, c: string, d: string): boolean {
        if (a === "x") return true;
        if (b === "y") return true;
        if (c === "z") return true;
        if (d === "w") return true;
        return false;
      }
    `)
  const se4 = batch.add(`
      function check(n: number): boolean {
        if (n === 1) return true;
        if (n === 2) return true;
        if (n === 3) return true;
        if (n === 4) return true;
        return false;
      }
    `)
  const se5 = batch.add(`
      function a(s: string) { return s === "x"; }
      function b(s: string) { return s === "y"; }
      function c(s: string) { return s === "z"; }
      function d(s: string) { return s === "w"; }
    `)
  const se6 = batch.add(`
      function validate(s: string): boolean {
        if (s !== "none") return false;
        if (s !== "initial") return false;
        if (s !== "inherit") return false;
        if (s !== "unset") return false;
        return true;
      }
    `)
  const se7 = batch.add(`
      function check(s: any): boolean {
        if (s == "a") return true;
        if (s == "b") return true;
        if (s == "c") return true;
        if (s == "d") return true;
        return false;
      }
    `)
  const se8 = batch.add(`
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
    `)
  const se9 = batch.add(`
      function check(s: string, a: string, b: string, c: string, d: string): boolean {
        if (s === a) return true;
        if (s === b) return true;
        if (s === c) return true;
        if (s === d) return true;
        return false;
      }
    `)

  it("metadata", () => {
    expect(preferSetHasOverEqualityChain.id).toBe("prefer-set-has-over-equality-chain")
  })

  it("flags 4+ === checks against string literals on the same variable", () => {
    const { diagnostics } = batch.result(se0)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("4")
    expect(diagnostics[0].message).toContain("name")
  })

  it("flags 6 checks (real-world isIgnoredAnimationName pattern)", () => {
    const { diagnostics } = batch.result(se1)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("6")
  })

  it("does not flag 3 checks (below threshold)", () => {
    expect(batch.result(se2).diagnostics).toHaveLength(0)
  })

  it("does not flag checks against different variables", () => {
    expect(batch.result(se3).diagnostics).toHaveLength(0)
  })

  it("does not flag checks against number literals", () => {
    expect(batch.result(se4).diagnostics).toHaveLength(0)
  })

  it("does not flag checks in different functions", () => {
    expect(batch.result(se5).diagnostics).toHaveLength(0)
  })

  it("counts !== checks too", () => {
    expect(batch.result(se6).diagnostics).toHaveLength(1)
  })

  it("does not flag == (loose equality)", () => {
    expect(batch.result(se7).diagnostics).toHaveLength(0)
  })

  it("reports separately for different variables in the same function", () => {
    expect(batch.result(se8).diagnostics).toHaveLength(2)
  })

  it("does not flag when variable is compared against non-literal expressions", () => {
    expect(batch.result(se9).diagnostics).toHaveLength(0)
  })
})



describe("prefer-map-over-object-dictionary", () => {
  const batch = lazyRuleBatch(preferMapOverObjectDictionary)
  const s0 = batch.add(`
      function test(key: string) {
        const cache = new Map<string, number>();
        cache.set(key, 123);
      }
    `)
  const s1 = batch.add(`
      function test() {
        const obj: Record<string, number> = {};
        obj.staticProp = 123;
      }
    `)
  const s2 = batch.add(`
      function test() {
        const obj: Record<string, number> = {};
        obj["staticKey"] = 123;
      }
    `)
  const s3 = batch.add(`
      function test(key: string) {
        const obj: any = {};
        obj[key] = 123;
      }
    `)

  it("metadata", () => {
    expect(preferMapOverObjectDictionary.id).toBe("prefer-map-over-object-dictionary")
  })

  it("does not flag Map usage", () => {
    expect(batch.result(s0).diagnostics).toHaveLength(0)
  })

  it("does not flag static property access", () => {
    expect(batch.result(s1).diagnostics).toHaveLength(0)
  })

  it("does not flag literal key in bracket notation", () => {
    expect(batch.result(s2).diagnostics).toHaveLength(0)
  })

  it("does not flag non-dictionary typed object", () => {
    expect(batch.result(s3).diagnostics).toHaveLength(0)
  })
})

describe("avoid-repeated-indexof-check", () => {
  const batch = lazyRuleBatch(avoidRepeatedIndexofCheck)
  const s0 = batch.add(`
      function hasValues(items: number[]): boolean {
        if (items.indexOf(1) !== -1) return true;
        if (items.indexOf(2) !== -1) return true;
        if (items.indexOf(3) !== -1) return true;
        return false;
      }
    `)
  const s1 = batch.add(`
      function check(tags: number[]): boolean {
        if (tags.indexOf(1) !== -1) return true;
        if (tags.indexOf(2) !== -1) return true;
        if (tags.indexOf(3) !== -1) return true;
        if (tags.indexOf(4) !== -1) return true;
        if (tags.indexOf(5) !== -1) return true;
        return false;
      }
    `)
  const s2 = batch.add(`
      function check(s: string): boolean {
        if (s.indexOf(":") !== -1) return true;
        if (s.indexOf("[") !== -1) return true;
        return false;
      }
    `)
  const s3 = batch.add(`
      function check(a: string, b: string, c: string): boolean {
        if (a.indexOf(":") !== -1) return true;
        if (b.indexOf("[") !== -1) return true;
        if (c.indexOf("]") !== -1) return true;
        return false;
      }
    `)
  const s4 = batch.add(`
      function check(obj: any): boolean {
        if (obj.name.indexOf(":") !== -1) return true;
        if (obj.name.indexOf("[") !== -1) return true;
        if (obj.name.indexOf("]") !== -1) return true;
        return false;
      }
    `)
  const s5 = batch.add(`
      function a(s: string) { return s.indexOf(":") !== -1; }
      function b(s: string) { return s.indexOf("[") !== -1; }
      function c(s: string) { return s.indexOf("]") !== -1; }
    `)
  const s6 = batch.add(`
      function check(a: number[], b: number[]): boolean {
        if (a.indexOf(1) !== -1) return true;
        if (a.indexOf(2) !== -1) return true;
        if (a.indexOf(3) !== -1) return true;
        if (b.indexOf(4) !== -1) return true;
        if (b.indexOf(5) !== -1) return true;
        if (b.indexOf(6) !== -1) return true;
        return false;
      }
    `)
  const s7 = batch.add(`
      function hasUnsupported(s: string): boolean {
        if (s.indexOf(":") !== -1) return true;
        if (s.indexOf("[") !== -1) return true;
        if (s.indexOf("]") !== -1) return true;
        return false;
      }
    `)
  const s8 = batch.add(`
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
    `)

  it("metadata", () => {
    expect(avoidRepeatedIndexofCheck.id).toBe("avoid-repeated-indexof-check")
  })

  it("flags 3+ indexOf calls on the same array variable in one function", () => {
    const { diagnostics } = batch.result(s0)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("3")
    expect(diagnostics[0].message).toContain("items")
  })

  it("flags when there are more than 3 calls", () => {
    const { diagnostics } = batch.result(s1)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("5")
  })

  it("does not flag 2 indexOf calls (below threshold)", () => {
    expect(batch.result(s2).diagnostics).toHaveLength(0)
  })

  it("does not flag indexOf on different variables", () => {
    expect(batch.result(s3).diagnostics).toHaveLength(0)
  })

  it("does not flag indexOf on chained expressions", () => {
    expect(batch.result(s4).diagnostics).toHaveLength(0)
  })

  it("does not flag calls in different functions", () => {
    expect(batch.result(s5).diagnostics).toHaveLength(0)
  })

  it("reports separately for different variables in the same function", () => {
    expect(batch.result(s6).diagnostics).toHaveLength(2)
  })

  it("does not flag indexOf on string variables (substring search)", () => {
    expect(batch.result(s7).diagnostics).toHaveLength(0)
  })

  it("does not merge shadowed receivers across scopes", () => {
    expect(batch.result(s8).diagnostics).toHaveLength(1)
  })
})

describe("prefer-set-lookup-in-loop", () => {
  const batch = lazyRuleBatch(preferSetLookupInLoop)
  const s0 = batch.add(`
      function test(items: string[], allowed: string[]) {
        for (let i = 0; i < items.length; i++) {
          if (allowed.includes(items[i])) {}
        }
      }
    `)
  const s1 = batch.add(`
      function test(items: string[], blocklist: string[]) {
        let i = 0;
        while (i < items.length) {
          if (blocklist.indexOf(items[i]) !== -1) {}
          i++;
        }
      }
    `)
  const s2 = batch.add(`
      function test(items: string[], allowed: string[]) {
        for (let i = 0; i < items.length; i++) {
          if (allowed.find(v => v === items[i])) {}
        }
      }
    `)
  const s3 = batch.add(`
      function test(items: string[], users: Array<{ id: string }>) {
        for (let i = 0; i < items.length; i++) {
          if (users.find(user => user.id === items[i])) {}
        }
      }
    `)
  const s4 = batch.add(`
      function test(items: string[], allowed: string[]) {
        if (allowed.includes("foo")) {}
      }
    `)
  const s5 = batch.add(`
      function test(items: string[]) {
        for (let i = 0; i < items.length; i++) {
          const local = ["a", "b", "c"];
          if (local.includes(items[i])) {}
        }
      }
    `)
  const s6 = batch.add(`
      function test(items: string[], obj: any) {
        for (let i = 0; i < items.length; i++) {
          if (obj.list.includes(items[i])) {}
        }
      }
    `)
  const s7 = batch.add(`
      function test(items: string[], allowed: string[]) {
        for (let i = 0; i < items.length; i++) {
          if (allowed.includes(items[i])) {}
          if (allowed.includes("extra")) {}
        }
      }
    `)
  const s8 = batch.add(`
      function test(items: string[], allowed: string[]) {
        for (let i = 0; i < items.length; i++) {
          items.forEach(item => {
            if (allowed.includes(item)) {}
          });
        }
      }
    `)

  it("metadata", () => {
    expect(preferSetLookupInLoop.id).toBe("prefer-set-lookup-in-loop")
  })

  it("flags .includes() on external array inside a for loop", () => {
    const { diagnostics } = batch.result(s0)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("allowed")
  })

  it("flags .indexOf() on param inside a while loop", () => {
    const { diagnostics } = batch.result(s1)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("blocklist")
  })

  it("flags membership-style .find() inside loops", () => {
    const { diagnostics } = batch.result(s2)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("allowed")
  })

  it("does not flag non-membership .find() predicate", () => {
    expect(batch.result(s3).diagnostics).toHaveLength(0)
  })

  it("does not flag .includes() outside a loop", () => {
    expect(batch.result(s4).diagnostics).toHaveLength(0)
  })

  it("does not flag .includes() on a locally-built array inside the loop", () => {
    expect(batch.result(s5).diagnostics).toHaveLength(0)
  })

  it("does not flag .includes() on chained receiver", () => {
    expect(batch.result(s6).diagnostics).toHaveLength(0)
  })

  it("reports once per variable per loop even with multiple calls", () => {
    expect(batch.result(s7).diagnostics).toHaveLength(1)
  })

  it("does not flag when includes is inside a callback in a loop", () => {
    expect(batch.result(s8).diagnostics).toHaveLength(0)
  })
})

describe("avoid-slice-sort-pattern", () => {
  const batch = lazyRuleBatch(avoidSliceSortPattern)
  const s0 = batch.add(`
      function test(items: number[]) {
        return items.slice().sort((a, b) => a - b);
      }
    `)
  const s1 = batch.add(`
      function test(items: number[]) {
        return items.slice().reverse();
      }
    `)
  const s2 = batch.add(`
      function test(items: number[]) {
        return items.slice(1).sort();
      }
    `)
  const s3 = batch.add(`
      function test(items: number[]) {
        return [...items].sort((a, b) => a - b);
      }
    `)
  const s4 = batch.add(`
      function test(items: number[]) {
        return [...items].reverse();
      }
    `)
  const s5 = batch.add(`
      function test(items: number[]) {
        return items.sort((a, b) => a - b);
      }
    `)
  const s6 = batch.add(`
      function test(items: number[]) {
        return items.slice(1);
      }
    `)
  const s7 = batch.add(`
      function test(items: number[]) {
        return items.filter(x => x > 0).sort();
      }
    `)
  const s8 = batch.add(`
      function test(items: number[]) {
        return items.map(x => x * 2).reverse();
      }
    `)
  const s9 = batch.add(`
      function test(items: number[]) {
        return [0, ...items].sort();
      }
    `)

  it("metadata", () => {
    expect(avoidSliceSortPattern.id).toBe("avoid-slice-sort-pattern")
  })

  it("flags .slice().sort()", () => {
    const { diagnostics } = batch.result(s0)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("toSorted")
  })

  it("flags .slice().reverse()", () => {
    const { diagnostics } = batch.result(s1)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("toReversed")
  })

  it("flags .slice(1).sort()", () => {
    expect(batch.result(s2).diagnostics).toHaveLength(1)
  })

  it("flags [...arr].sort()", () => {
    const { diagnostics } = batch.result(s3)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("toSorted")
  })

  it("flags [...arr].reverse()", () => {
    const { diagnostics } = batch.result(s4)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("toReversed")
  })

  it("does not flag .sort() alone", () => {
    expect(batch.result(s5).diagnostics).toHaveLength(0)
  })

  it("does not flag .slice() alone", () => {
    expect(batch.result(s6).diagnostics).toHaveLength(0)
  })

  it("does not flag .filter().sort()", () => {
    expect(batch.result(s7).diagnostics).toHaveLength(0)
  })

  it("does not flag .map().reverse()", () => {
    expect(batch.result(s8).diagnostics).toHaveLength(0)
  })

  it("does not flag mixed array literal with spread", () => {
    expect(batch.result(s9).diagnostics).toHaveLength(0)
  })
})

describe("prefer-map-lookup-over-linear-scan", () => {
  const batch = lazyRuleBatch(preferMapLookupOverLinearScan)
  const s0 = batch.add(`
      const KEYS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
      function test(items: string[]) {
        for (let i = 0; i < items.length; i++) {
          if (KEYS.includes(items[i])) return true;
        }
        return false;
      }
    `)
  const s1 = batch.add(`
      const KEYS2 = ["a", "b", "c", "d", "e", "f", "g", "h"];
      function test2(value: string) {
        if (KEYS2.includes(value)) return true;
        return KEYS2.indexOf(value) !== -1;
      }
    `)
  const s2 = batch.add(`
      const SMALL_KEYS = ["a", "b", "c"];
      function test3(items: string[]) {
        for (let i = 0; i < items.length; i++) {
          if (SMALL_KEYS.includes(items[i])) return true;
        }
        return false;
      }
    `)
  const s3 = batch.add(`
      function getKeys(): string[] { return ["a", "b", "c", "d", "e", "f", "g", "h"]; }
      const dynKeys = getKeys();
      function test4(value: string) {
        return dynKeys.includes(value);
      }
    `)
  const s4 = batch.add(`
      const FIND_KEYS = ["a", "b", "c", "d", "e", "f", "g", "h"];
      function test5(value: string) {
        const hit = FIND_KEYS.find(k => k === value);
        const second = FIND_KEYS.find(k => k === value);
        return hit ?? second ?? null;
      }
    `)

  it("metadata", () => {
    expect(preferMapLookupOverLinearScan.id).toBe("prefer-map-lookup-over-linear-scan")
  })

  it("flags fixed-table linear scan in loops", () => {
    const { diagnostics } = batch.result(s0)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("KEYS")
  })

  it("flags repeated linear scans in the same function", () => {
    expect(batch.result(s1).diagnostics).toHaveLength(1)
  })

  it("does not flag small fixed collections", () => {
    expect(batch.result(s2).diagnostics).toHaveLength(0)
  })

  it("does not flag dynamic collections", () => {
    expect(batch.result(s3).diagnostics).toHaveLength(0)
  })

  it("flags fixed-table membership find scan", () => {
    expect(batch.result(s4).diagnostics).toHaveLength(1)
  })
})

describe("no-write-only-index", () => {
  const batch = lazyRuleBatch(noWriteOnlyIndex)
  const s0 = batch.add(`
      function test(items: string[]) {
        const byKey = new Map<string, number>();
        for (let i = 0; i < items.length; i++) { byKey.set(items[i], i); }
        for (const [key, value] of byKey) { console.log(key, value); }
      }
    `)
  const s1 = batch.add(`
      function test(items: Array<{ id: string }>) {
        const byId: Record<string, number> = {};
        for (let i = 0; i < items.length; i++) { byId[items[i].id] = i; }
      }
    `)
  const s2 = batch.add(`
      function test(items: string[], needle: string) {
        const byKey = new Map<string, number>();
        for (let i = 0; i < items.length; i++) { byKey.set(items[i], i); }
        return byKey.get(needle) ?? -1;
      }
    `)
  const s3 = batch.add(`
      function test(items: string[]) {
        const byKey = new Map<string, number>();
        for (let i = 0; i < items.length; i++) { byKey.set(items[i], i); }
        return byKey;
      }
    `)
  const s4 = batch.add(`
      function consume(index: Map<string, number>) { return index.size; }
      function test(items: string[]) {
        const byKey = new Map<string, number>();
        for (let i = 0; i < items.length; i++) { byKey.set(items[i], i); }
        return consume(byKey);
      }
    `)

  it("metadata", () => { expect(noWriteOnlyIndex.id).toBe("no-write-only-index") })

  it("flags write-only Map indexes", () => {
    const { diagnostics } = batch.result(s0)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("byKey")
  })

  it("flags write-only object dictionary indexes", () => {
    const { diagnostics } = batch.result(s1)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("byId")
  })

  it("does not flag indexes that are queried by key", () => { expect(batch.result(s2).diagnostics).toHaveLength(0) })
  it("does not flag indexes that escape via return", () => { expect(batch.result(s3).diagnostics).toHaveLength(0) })
  it("does not flag indexes passed to helper functions", () => { expect(batch.result(s4).diagnostics).toHaveLength(0) })
})

describe("avoid-defensive-copy-for-scalar-stat", () => {
  const batch = lazyRuleBatch(avoidDefensiveCopyForScalarStat)
  const s0 = batch.add(`
      function computeMedian(values: number[]): number { return values[0] ?? 0; }
      function test(sorted: number[]) { return computeMedian([...sorted]); }
    `)
  const s1 = batch.add(`
      function percentile(values: number[], p: number): number { return values[p] ?? 0; }
      function test(values: number[]) { return percentile(values.slice(), 95); }
    `)
  const s2 = batch.add(`
      function test(values: number[]) { const copy = values.slice(); copy.sort((a, b) => a - b); return copy; }
    `)
  const s3 = batch.add(`
      function test(values: number[]) { return [...values].toSorted((a, b) => a - b); }
    `)

  it("metadata", () => { expect(avoidDefensiveCopyForScalarStat.id).toBe("avoid-defensive-copy-for-scalar-stat") })

  it("flags spread defensive copies passed to scalar stats", () => {
    const { diagnostics } = batch.result(s0)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("computeMedian")
  })

  it("flags slice defensive copies passed to scalar stats", () => {
    const { diagnostics } = batch.result(s1)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("percentile")
  })

  it("does not flag non-statistic copy pipelines", () => { expect(batch.result(s2).diagnostics).toHaveLength(0) })
  it("does not flag toSorted pipelines", () => { expect(batch.result(s3).diagnostics).toHaveLength(0) })
})

describe("avoid-intermediate-map-copy", () => {
  const batch = lazyRuleBatch(avoidIntermediateMapCopy)
  const s0 = batch.add(`
      function test(items: Array<{ id: string; name: string }>) {
        const candidates = new Map<string, { id: string; name: string }>();
        for (let i = 0; i < items.length; i++) { candidates.set(items[i].id, items[i]); }
        const out = new Map<string, string>();
        for (const [id, value] of candidates) { out.set(id, value.name); }
        return out;
      }
    `)
  const s1 = batch.add(`
      function test(items: Array<{ id: string; name: string }>, needle: string) {
        const candidates = new Map<string, { id: string; name: string }>();
        for (let i = 0; i < items.length; i++) { candidates.set(items[i].id, items[i]); }
        const found = candidates.get(needle);
        return found?.name ?? null;
      }
    `)
  const s2 = batch.add(`
      function test(items: Array<{ id: string }>) {
        const candidates = new Map<string, { id: string }>();
        for (let i = 0; i < items.length; i++) { candidates.set(items[i].id, items[i]); }
        return candidates;
      }
    `)
  const s3 = batch.add(`
      function test(items: Array<{ id: string; name: string }>) {
        const candidates = new Map<string, { id: string; name: string }>();
        for (let i = 0; i < items.length; i++) { candidates.set(items[i].id, items[i]); }
        const out = new Map<string, string>();
        for (const [id, value] of candidates) { out.set(id, value.name); }
        for (const [id] of candidates) { if (id.length === 0) {} }
        return out;
      }
    `)

  it("metadata", () => { expect(avoidIntermediateMapCopy.id).toBe("avoid-intermediate-map-copy") })

  it("flags temporary map copied key-for-key into output map", () => {
    const { diagnostics } = batch.result(s0)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("candidates")
  })

  it("does not flag when temporary map is queried", () => { expect(batch.result(s1).diagnostics).toHaveLength(0) })
  it("does not flag when temporary map escapes by return", () => { expect(batch.result(s2).diagnostics).toHaveLength(0) })
  it("does not flag temporary map with multiple consumer loops", () => { expect(batch.result(s3).diagnostics).toHaveLength(0) })
})

describe("avoid-spread-sort-map-join-pipeline", () => {
  const batch = lazyRuleBatch(avoidSpreadSortMapJoinPipeline)
  const s0 = batch.add(`
      function test(byKey: Map<string, { key: string }>) {
        return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key)).map((guard) => guard.key).join("&");
      }
    `)
  const s1 = batch.add(`
      function test(values: string[]) { return values.sort().map((v) => v).join("&"); }
    `)
  const s2 = batch.add(`
      function test(values: string[]) { return [...values].map((v) => v).join("&"); }
    `)

  it("metadata", () => { expect(avoidSpreadSortMapJoinPipeline.id).toBe("avoid-spread-sort-map-join-pipeline") })

  it("flags spread sort map join pipeline", () => {
    const { diagnostics } = batch.result(s0)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("Spread+sort+map+join")
  })

  it("does not flag pipelines without spread root", () => { expect(batch.result(s1).diagnostics).toHaveLength(0) })
  it("does not flag spread map join without sort", () => { expect(batch.result(s2).diagnostics).toHaveLength(0) })
})

describe("bounded-worklist-traversal", () => {
  const batch = lazyRuleBatch(boundedWorklistTraversal)
  const s0 = batch.add(`
      function walk(root: any): void {
        const queue = [root];
        for (let i = 0; i < queue.length; i++) {
          const current = queue[i];
          for (const child of current.children) { queue.push(child); }
        }
      }
    `)
  const s1 = batch.add(`
      function walk(root: any): void {
        const queue = [root];
        for (let i = 0; i < queue.length; i++) {
          if (queue.length > 256) return;
          const current = queue[i];
          for (const child of current.children) { queue.push(child); }
        }
      }
    `)
  const s2 = batch.add(`
      function walk(root: any): void {
        const queue = [root];
        const seen = new Set<any>();
        for (let i = 0; i < queue.length; i++) {
          const current = queue[i];
          if (seen.has(current)) continue;
          seen.add(current);
          for (const child of current.children) { queue.push(child); }
        }
      }
    `)

  it("metadata", () => { expect(boundedWorklistTraversal.id).toBe("bounded-worklist-traversal") })

  it("flags unbounded queue growth", () => {
    const { diagnostics } = batch.result(s0)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("queue")
  })

  it("does not flag queue traversal with explicit bound", () => { expect(batch.result(s1).diagnostics).toHaveLength(0) })
  it("does not flag queue traversal with visited set guard", () => { expect(batch.result(s2).diagnostics).toHaveLength(0) })
})

describe("no-shift-splice-head-consume", () => {
  const batch = lazyRuleBatch(noShiftSpliceHeadConsume)
  const s0 = batch.add(`
      function parse(tokens: string[]) { while (tokens.length > 0) { const token = tokens.shift(); if (!token) break; } }
    `)
  const s1 = batch.add(`
      function parse(tokens: string[]) { for (let i = 0; i < 10; i++) { tokens.splice(0, 1); } }
    `)
  const s2 = batch.add(`
      function parse(tokens: string[]) { return tokens.shift(); }
    `)
  const s3 = batch.add(`
      function parse() { const tokens = ["a", "b", "c"]; while (tokens.length > 0) { tokens.shift(); } }
    `)

  it("metadata", () => { expect(noShiftSpliceHeadConsume.id).toBe("no-shift-splice-head-consume") })
  it("flags shift() head consume in loops", () => { expect(batch.result(s0).diagnostics).toHaveLength(1) })
  it("flags splice(0, 1) head consume in loops", () => { expect(batch.result(s1).diagnostics).toHaveLength(1) })
  it("does not flag shift() outside loops", () => { expect(batch.result(s2).diagnostics).toHaveLength(0) })
  it("does not flag tiny fixed literal queues", () => { expect(batch.result(s3).diagnostics).toHaveLength(0) })
})

describe("no-rest-slice-loop", () => {
  const batch = lazyRuleBatch(noRestSliceLoop)
  const s0 = batch.add(`
      function parse(input: string) {
        let rest = input;
        while (rest.length > 0) {
          const i = rest.indexOf(",");
          rest = i === -1 ? "" : rest.slice(i + 1);
          rest = rest.slice(0);
          if (i === -1) break;
        }
      }
    `)
  const s1 = batch.add(`
      function parse(input: string) {
        let rest = input;
        while (rest.length > 0) {
          const i = rest.indexOf(",");
          rest = i === -1 ? "" : rest.slice(i + 1);
          break;
        }
      }
    `)

  it("metadata", () => { expect(noRestSliceLoop.id).toBe("no-rest-slice-loop") })
  it("flags repeated rest = rest.slice(...) in loops", () => { expect(batch.result(s0).diagnostics).toHaveLength(1) })
  it("does not flag one-off slicing", () => { expect(batch.result(s1).diagnostics).toHaveLength(0) })
})

describe("no-rescan-indexof-loop", () => {
  const batch = lazyRuleBatch(noRescanIndexofLoop)
  const s0 = batch.add(`
      function parse(text: string) {
        for (let i = 0; i < 2; i++) {
          const a = text.indexOf(":");
          const b = text.indexOf(":", 0);
          if (a === -1 || b === -1) break;
        }
      }
    `)
  const s1 = batch.add(`
      function parse(text: string) {
        let cursor = 0;
        while (cursor < text.length) {
          const idx = text.indexOf(":", cursor);
          if (idx === -1) break;
          cursor = idx + 1;
        }
      }
    `)

  it("metadata", () => { expect(noRescanIndexofLoop.id).toBe("no-rescan-indexof-loop") })
  it("flags repeated indexOf from start in loops", () => { expect(batch.result(s0).diagnostics).toHaveLength(1) })
  it("does not flag cursor-based indexOf", () => { expect(batch.result(s1).diagnostics).toHaveLength(0) })
})

describe("no-multipass-split-pipeline", () => {
  const batch = lazyRuleBatch(noMultipassSplitPipeline)
  const s0 = batch.add(`
      function parse(line: string) { return line.split(",").map(v => v.trim()).filter(Boolean); }
    `)
  const s1 = batch.add(`
      function parse(line: string) { return line.split(",").map(v => v.trim()); }
    `)
  const s2 = batch.add(`
      function parse() { return "a,b".split(",").map(v => v.trim()).filter(Boolean); }
    `)

  it("metadata", () => { expect(noMultipassSplitPipeline.id).toBe("no-multipass-split-pipeline") })
  it("flags split().map().filter() pipelines", () => { expect(batch.result(s0).diagnostics).toHaveLength(1) })
  it("does not flag split with only one pass", () => { expect(batch.result(s1).diagnostics).toHaveLength(0) })
  it("does not flag short literal split pipelines", () => { expect(batch.result(s2).diagnostics).toHaveLength(0) })
})

describe("no-per-char-substring-scan", () => {
  const batch = lazyRuleBatch(noPerCharSubstringScan)
  const s0 = batch.add(`
      function scan(input: string) {
        for (let i = 0; i < input.length; i++) { const ch = input.charAt(i); if (ch === ",") return i; }
        return -1;
      }
    `)
  const s1 = batch.add(`
      function scan(input: string) {
        for (let i = 0; i < input.length; i++) { const ch = input.slice(i, i + 1); if (ch === ",") return i; }
        return -1;
      }
    `)
  const s2 = batch.add(`
      function read(input: string) { return input.charAt(0); }
    `)

  it("metadata", () => { expect(noPerCharSubstringScan.id).toBe("no-per-char-substring-scan") })
  it("flags charAt(i) scanner loops", () => { expect(batch.result(s0).diagnostics).toHaveLength(1) })
  it("flags slice(i, i + 1) scanner loops", () => { expect(batch.result(s1).diagnostics).toHaveLength(1) })
  it("does not flag non-loop charAt", () => { expect(batch.result(s2).diagnostics).toHaveLength(0) })
})

describe("no-repeated-token-normalization", () => {
  const batch = lazyRuleBatch(noRepeatedTokenNormalization)
  const s0 = batch.add(`
      function parse(key: string) {
        if (key.trim().toLowerCase() === "content-type") return true;
        if (key.trim().toLowerCase() === "accept") return true;
        return false;
      }
    `)
  const s1 = batch.add(`
      function parse(key: string) {
        const normalized = key.trim().toLowerCase();
        if (normalized === "content-type") return true;
        if (normalized === "accept") return true;
        return false;
      }
    `)
  const s2 = batch.add(`
      function parse(input: string, fallback: string) {
        let key = input;
        if (key.trim().toLowerCase() === "a") return true;
        key = fallback;
        if (key.trim().toLowerCase() === "b") return true;
        return false;
      }
    `)
  const s3 = batch.add(`
      function parse(key: string) {
        if (key.trim().toLowerCase() === "a") return true;
        {
          const key = "inner";
          if (key.trim().toLowerCase() === "inner") return true;
        }
        return false;
      }
    `)

  it("metadata", () => { expect(noRepeatedTokenNormalization.id).toBe("no-repeated-token-normalization") })
  it("flags repeated trim/toLowerCase chains", () => { expect(batch.result(s0).diagnostics).toHaveLength(1) })
  it("does not flag when normalized once", () => { expect(batch.result(s1).diagnostics).toHaveLength(0) })
  it("does not flag when token variable is reassigned", () => { expect(batch.result(s2).diagnostics).toHaveLength(0) })
  it("does not flag shadowed token variables", () => { expect(batch.result(s3).diagnostics).toHaveLength(0) })
})

describe("no-full-split-in-hot-parse", () => {
  const batch = lazyRuleBatch(noFullSplitInHotParse)
  const s0 = batch.add(`
      function parseLine(input: string) {
        let cursor = 0;
        while (cursor < input.length) { const parts = input.split(","); cursor++; if (parts.length === 0) break; }
      }
    `)
  const s1 = batch.add(`
      function parseLine(input: string) { return input.split(","); }
    `)

  it("metadata", () => { expect(noFullSplitInHotParse.id).toBe("no-full-split-in-hot-parse") })
  it("flags split in parsing loops", () => { expect(batch.result(s0).diagnostics).toHaveLength(1) })
  it("does not flag split outside loops", () => { expect(batch.result(s1).diagnostics).toHaveLength(0) })
})

describe("no-loop-string-plus-equals", () => {
  const batch = lazyRuleBatch(noLoopStringPlusEquals)
  const s0 = batch.add(`
      function parseAscii(input: string) {
        let out = "";
        for (let i = 0; i < input.length; i++) { out += input.charAt(i); out += ","; }
        return out;
      }
    `)
  const s1 = batch.add(`
      function parseAscii(input: string) {
        let out = "";
        for (let i = 0; i < input.length; i++) { out += input.charAt(i); }
        return out;
      }
    `)

  it("metadata", () => { expect(noLoopStringPlusEquals.id).toBe("no-loop-string-plus-equals") })
  it("flags repeated += accumulation in parse loops", () => { expect(batch.result(s0).diagnostics).toHaveLength(1) })
  it("does not flag a single += in loop", () => { expect(batch.result(s1).diagnostics).toHaveLength(0) })
})

describe("no-char-array-materialization", () => {
  const batch = lazyRuleBatch(noCharArrayMaterialization)
  const s0 = batch.add(`
      function parseAscii(input: string) {
        while (input.length > 0) { const chars = input.split(""); if (chars.length === 0) break; input = input.slice(1); }
      }
    `)
  const s1 = batch.add(`
      function parseAscii(input: string) {
        for (let i = 0; i < 2; i++) { const chars = Array.from(input); if (chars.length === 0) return; }
      }
    `)
  const s2 = batch.add(`
      function parseAscii(input: string) { return [...input]; }
    `)

  it("metadata", () => { expect(noCharArrayMaterialization.id).toBe("no-char-array-materialization") })
  it("flags split(\"\") in parser loop", () => { expect(batch.result(s0).diagnostics).toHaveLength(1) })
  it("flags Array.from(str) in parser loop", () => { expect(batch.result(s1).diagnostics).toHaveLength(1) })
  it("does not flag char materialization outside loops", () => { expect(batch.result(s2).diagnostics).toHaveLength(0) })
})

describe("no-heavy-parser-constructor-in-loop", () => {
  const batch = lazyRuleBatch(noHeavyParserConstructorInLoop)
  const s0 = batch.add(`
      function parseLine(input: string) {
        for (let i = 0; i < input.length; i++) { const matcher = new RegExp(","); if (matcher.test(input.charAt(i))) return i; }
        return -1;
      }
    `)
  const s1 = batch.add(`
      function parseLine() { const matcher = new RegExp(","); return matcher; }
    `)

  it("metadata", () => { expect(noHeavyParserConstructorInLoop.id).toBe("no-heavy-parser-constructor-in-loop") })
  it("flags new RegExp inside parsing loops", () => { expect(batch.result(s0).diagnostics).toHaveLength(1) })
  it("does not flag constructor outside loops", () => { expect(batch.result(s1).diagnostics).toHaveLength(0) })
})

describe("no-double-pass-delimiter-count", () => {
  const batch = lazyRuleBatch(noDoublePassDelimiterCount)
  const s0 = batch.add(`
      function parseCsv(input: string) {
        const columns = input.split(",").length;
        const parts = input.split(",");
        return columns + parts.length;
      }
    `)
  const s1 = batch.add(`
      function parseCsv(input: string) { return input.split(",").length; }
    `)

  it("metadata", () => { expect(noDoublePassDelimiterCount.id).toBe("no-double-pass-delimiter-count") })
  it("flags split length counting followed by another split", () => { expect(batch.result(s0).diagnostics).toHaveLength(1) })
  it("does not flag when split is used once", () => { expect(batch.result(s1).diagnostics).toHaveLength(0) })
})

describe("prefer-index-scan-over-string-iterator", () => {
  const batch = lazyRuleBatch(preferIndexScanOverStringIterator)
  const s0 = batch.add(`
      function parseAscii(input: string) {
        let count = 0;
        for (const ch of input) { if (ch === ",") count++; }
        return count;
      }
    `)
  const s1 = batch.add(`
      function parseAscii(input: string) {
        for (const ch of input) { ch.codePointAt(0); }
      }
    `)

  it("metadata", () => { expect(preferIndexScanOverStringIterator.id).toBe("prefer-index-scan-over-string-iterator") })
  it("flags for-of string iteration in ASCII parser contexts", () => { expect(batch.result(s0).diagnostics).toHaveLength(1) })
  it("does not flag unicode-aware loops", () => { expect(batch.result(s1).diagnostics).toHaveLength(0) })
})

describe("avoid-quadratic-pair-comparison", () => {
  const batch = lazyRuleBatch(avoidQuadraticPairComparison)
  const s0 = batch.add(`
      function test(items: string[]) {
        for (let i = 0; i < items.length; i++) {
          for (let j = 0; j < i; j++) { if (items[i] === items[j]) {} }
        }
      }
    `)
  const s1 = batch.add(`
      function test(arr: number[]) {
        for (let i = 0; i < arr.length; i++) {
          for (let j = 0; j < arr.length; j++) { if (arr[i] > arr[j]) {} }
        }
      }
    `)
  const s2 = batch.add(`
      function test(a: number[], b: number[]) {
        for (let i = 0; i < a.length; i++) {
          for (let j = 0; j < b.length; j++) { if (a[i] === b[j]) {} }
        }
      }
    `)
  const s3 = batch.add(`
      function test(items: string[]) {
        for (let i = 0; i < items.length; i++) { console.log(items[i]); }
      }
    `)
  const s4 = batch.add(`
      function test(items: string[], other: string[]) {
        for (let i = 0; i < items.length; i++) {
          for (let j = 0; j < i; j++) { console.log(other[j]); }
        }
      }
    `)
  const s5 = batch.add(`
      function test(items: string[]) {
        for (const a of items) { for (const b of items) { if (a === b) {} } }
      }
    `)
  const s6 = batch.add(`
      function test(items: string[], n: number) {
        for (let i = 0; i < items.length; i++) {
          for (let j = 0; j < n; j++) { if (items[i] === items[j]) {} }
        }
      }
    `)

  it("metadata", () => { expect(avoidQuadraticPairComparison.id).toBe("avoid-quadratic-pair-comparison") })

  it("flags nested for-loops with j < i over same array", () => {
    const { diagnostics } = batch.result(s0)
    expect(diagnostics).toHaveLength(1)
    if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
    expect(diagnostics[0].message).toContain("items")
  })

  it("flags nested for-loops with j < arr.length over same array", () => { expect(batch.result(s1).diagnostics).toHaveLength(1) })
  it("does not flag nested loops over different arrays", () => { expect(batch.result(s2).diagnostics).toHaveLength(0) })
  it("does not flag single for-loop", () => { expect(batch.result(s3).diagnostics).toHaveLength(0) })
  it("does not flag nested loops where inner does not access outer's collection", () => { expect(batch.result(s4).diagnostics).toHaveLength(0) })
  it("does not flag for-of loops", () => { expect(batch.result(s5).diagnostics).toHaveLength(0) })
  it("does not flag when inner loop uses different bound variable", () => { expect(batch.result(s6).diagnostics).toHaveLength(0) })
})

describe("no-leaked-timer", () => {
  const batch = lazyRuleBatch(noLeakedTimer)
  const s0 = batch.add(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => { const id = setInterval(() => {}, 1000); });
          return <div />;
        }
      `)
  const s1 = batch.add(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => { setTimeout(() => {}, 1000); });
          return <div />;
        }
      `)
  const s2 = batch.add(`
        import { createRenderEffect } from "solid-js";
        function App() {
          createRenderEffect(() => { setInterval(() => {}, 500); });
          return <div />;
        }
      `)
  const s3 = batch.add(`
        import { createComputed } from "solid-js";
        function App() {
          createComputed(() => { setInterval(() => {}, 500); });
          return <div />;
        }
      `)
  const s4 = batch.add(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => { const id = window.setInterval(() => {}, 1000); });
          return <div />;
        }
      `)
  const s5 = batch.add(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          createEffect(() => {
            const id = setInterval(() => {}, 1000);
            onCleanup(() => clearTimeout(id));
          });
          return <div />;
        }
      `)
  const s6 = batch.add(`
        import { onMount } from "solid-js";
        function App() {
          onMount(() => { const id = setInterval(() => {}, 1000); });
          return <div />;
        }
      `)
  const s7 = batch.add(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          createEffect(() => {
            const id = setInterval(() => {}, 1000);
            onCleanup(() => clearInterval(id));
          });
          return <div />;
        }
      `)
  const s8 = batch.add(`
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
  const s9 = batch.add(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          createEffect(() => {
            const id = window.setInterval(() => {}, 1000);
            onCleanup(() => window.clearInterval(id));
          });
          return <div />;
        }
      `)
  const s10 = batch.add(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          createEffect(() => {
            const id = setTimeout(() => {}, 1000);
            onCleanup(() => clearTimeout(id));
          });
          return <div />;
        }
      `)
  const s11 = batch.add(`
        function App() {
          const id = setInterval(() => {}, 1000);
          return <div />;
        }
      `)
  const s12 = batch.add(`
        const id = setInterval(() => {}, 1000);
      `)
  const s13 = batch.add(`
        function App() {
          return <button onClick={() => setInterval(() => {}, 1000)}>Start</button>;
        }
      `)
  const s14 = batch.add(`
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
  const s15 = batch.add(`
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

  it("metadata", () => { expect(noLeakedTimer.id).toBe("no-leaked-timer") })

  describe("invalid patterns", () => {
    it("flags setInterval in createEffect without onCleanup", () => {
      const { diagnostics } = batch.result(s0)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("setInterval")
      expect(diagnostics[0].message).toContain("clearInterval")
    })
    it("flags setTimeout in createEffect without onCleanup", () => {
      const { diagnostics } = batch.result(s1)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("setTimeout")
      expect(diagnostics[0].message).toContain("clearTimeout")
    })
    it("flags setInterval in createRenderEffect without onCleanup", () => { expect(batch.result(s2).diagnostics).toHaveLength(1) })
    it("flags setInterval in createComputed without onCleanup", () => { expect(batch.result(s3).diagnostics).toHaveLength(1) })
    it("flags window.setInterval in createEffect without onCleanup", () => {
      const { diagnostics } = batch.result(s4)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("setInterval")
    })
    it("flags when onCleanup exists but clears wrong timer type", () => {
      const { diagnostics } = batch.result(s5)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("clearInterval")
    })
    it("flags setInterval in onMount without onCleanup", () => {
      const { diagnostics } = batch.result(s6)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("setInterval")
    })
  })

  describe("valid patterns", () => {
    it("allows setInterval with onCleanup clearInterval", () => { expect(batch.result(s7).diagnostics).toHaveLength(0) })
    it("allows setInterval with named cleanup function passed to onCleanup", () => { expect(batch.result(s8).diagnostics).toHaveLength(0) })
    it("allows window.setInterval with window.clearInterval in onCleanup", () => { expect(batch.result(s9).diagnostics).toHaveLength(0) })
    it("allows setTimeout with onCleanup clearTimeout", () => { expect(batch.result(s10).diagnostics).toHaveLength(0) })
    it("allows setInterval outside effects (component body)", () => { expect(batch.result(s11).diagnostics).toHaveLength(0) })
    it("allows setInterval at module scope", () => { expect(batch.result(s12).diagnostics).toHaveLength(0) })
    it("allows setInterval in event handlers", () => { expect(batch.result(s13).diagnostics).toHaveLength(0) })
    it("allows component-level onCleanup with clearInterval", () => { expect(batch.result(s14).diagnostics).toHaveLength(0) })
    it("allows direct clearTimeout in effect body before setTimeout", () => { expect(batch.result(s15).diagnostics).toHaveLength(0) })
  })
})

describe("no-leaked-event-listener", () => {
  const batch = lazyRuleBatch(noLeakedEventListener)
  const s0 = batch.add(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => { window.addEventListener("resize", () => {}); });
          return <div />;
        }
      `)
  const s1 = batch.add(`
        import { createRenderEffect } from "solid-js";
        function App() {
          createRenderEffect(() => { document.addEventListener("click", () => {}); });
          return <div />;
        }
      `)
  const s2 = batch.add(`
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
  const s3 = batch.add(`
        function App() {
          window.addEventListener("resize", () => {});
          return <div />;
        }
      `)
  const s4 = batch.add(`
        function App() {
          return <button onClick={() => window.addEventListener("click", () => {})}>Add</button>;
        }
      `)
  const s5 = batch.add(`
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
  const s6 = batch.add(`
        import { createEffect, onCleanup, createSignal } from "solid-js";
        function useSSE() {
          const [url] = createSignal("/stream");
          createEffect(() => {
            const es = new EventSource(url());
            es.addEventListener("message", (event) => { console.log(event.data); });
            onCleanup(() => es.close());
          });
        }
      `)
  const s7 = batch.add(`
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
  const s8 = batch.add(`
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
  const s9 = batch.add(`
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
  const s10 = batch.add(`
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
  const s11 = batch.add(`
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
  const s12 = batch.add(`
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
  const s13 = batch.add(`
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
  const s14 = batch.add(`
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
  const s15 = batch.add(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => {
            const controller = new AbortController();
            window.addEventListener("resize", () => {}, { signal: controller.signal });
          });
          return <div />;
        }
      `)

  it("metadata", () => { expect(noLeakedEventListener.id).toBe("no-leaked-event-listener") })

  describe("invalid patterns", () => {
    it("flags addEventListener in createEffect without onCleanup", () => {
      const { diagnostics } = batch.result(s0)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("addEventListener")
    })
    it("flags addEventListener in createRenderEffect without cleanup", () => { expect(batch.result(s1).diagnostics).toHaveLength(1) })
  })

  describe("valid patterns", () => {
    it("allows addEventListener with removeEventListener in onCleanup", () => { expect(batch.result(s2).diagnostics).toHaveLength(0) })
    it("allows addEventListener outside effects", () => { expect(batch.result(s3).diagnostics).toHaveLength(0) })
    it("allows addEventListener in event handlers", () => { expect(batch.result(s4).diagnostics).toHaveLength(0) })
    it("allows component-level onCleanup with removeEventListener", () => { expect(batch.result(s5).diagnostics).toHaveLength(0) })
    it("allows addEventListener with .close() on the same target in onCleanup", () => { expect(batch.result(s6).diagnostics).toHaveLength(0) })
    it("allows addEventListener with .abort() on the same target in onCleanup", () => { expect(batch.result(s7).diagnostics).toHaveLength(0) })
    it("allows addEventListener with .terminate() on Worker target in onCleanup", () => { expect(batch.result(s8).diagnostics).toHaveLength(0) })
    it("allows addEventListener with AbortController signal and abort in onCleanup", () => { expect(batch.result(s9).diagnostics).toHaveLength(0) })
    it("allows AbortController signal pattern with multiple listeners", () => { expect(batch.result(s10).diagnostics).toHaveLength(0) })
    it("allows AbortController signal with addEventListener on controller itself", () => { expect(batch.result(s11).diagnostics).toHaveLength(0) })
    it("allows AbortController signal with sibling onCleanup", () => { expect(batch.result(s12).diagnostics).toHaveLength(0) })
    it("flags addEventListener when .close() is on a different target", () => { expect(batch.result(s13).diagnostics).toHaveLength(1) })
    it("flags addEventListener with signal from different controller than cleanup aborts", () => { expect(batch.result(s14).diagnostics).toHaveLength(1) })
    it("flags addEventListener with signal but no abort in cleanup", () => { expect(batch.result(s15).diagnostics).toHaveLength(1) })
  })
})

describe("no-leaked-observer", () => {
  const batch = lazyRuleBatch(noLeakedObserver)
  const s0 = batch.add(`
        import { createEffect } from "solid-js";
        function App() {
          let ref: HTMLDivElement;
          createEffect(() => { const observer = new ResizeObserver(() => {}); observer.observe(ref); });
          return <div ref={ref!} />;
        }
      `)
  const s1 = batch.add(`
        import { createEffect } from "solid-js";
        function App() {
          let ref: HTMLDivElement;
          createEffect(() => { const observer = new MutationObserver(() => {}); observer.observe(ref, { childList: true }); });
          return <div ref={ref!} />;
        }
      `)
  const s2 = batch.add(`
        import { createEffect } from "solid-js";
        function App() {
          let ref: HTMLDivElement;
          createEffect(() => { const observer = new IntersectionObserver(() => {}); observer.observe(ref); });
          return <div ref={ref!} />;
        }
      `)
  const s3 = batch.add(`
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
  const s4 = batch.add(`
        function App() {
          const observer = new ResizeObserver(() => {});
          return <div />;
        }
      `)
  const s5 = batch.add(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          let ref: HTMLDivElement;
          const observer = new ResizeObserver(() => {});
          createEffect(() => { observer.observe(ref); });
          onCleanup(() => observer.disconnect());
          return <div ref={ref!} />;
        }
      `)

  it("metadata", () => { expect(noLeakedObserver.id).toBe("no-leaked-observer") })

  describe("invalid patterns", () => {
    it("flags ResizeObserver in createEffect without disconnect", () => {
      const { diagnostics } = batch.result(s0)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("ResizeObserver")
    })
    it("flags MutationObserver in createEffect without disconnect", () => {
      const { diagnostics } = batch.result(s1)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("MutationObserver")
    })
    it("flags IntersectionObserver in createEffect without disconnect", () => {
      const { diagnostics } = batch.result(s2)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("IntersectionObserver")
    })
  })

  describe("valid patterns", () => {
    it("allows ResizeObserver with disconnect in onCleanup", () => { expect(batch.result(s3).diagnostics).toHaveLength(0) })
    it("allows ResizeObserver outside effects", () => { expect(batch.result(s4).diagnostics).toHaveLength(0) })
    it("allows component-level onCleanup with disconnect", () => { expect(batch.result(s5).diagnostics).toHaveLength(0) })
  })
})

describe("effect-outside-root", () => {
  const batch = lazyRuleBatch(effectOutsideRoot)
  const s0 = batch.add(`
        import { createEffect, createSignal } from "solid-js";
        const [count, setCount] = createSignal(0);
        createEffect(() => console.log(count()));
      `)
  const s1 = batch.add(`
        import { createMemo, createSignal } from "solid-js";
        const [count, setCount] = createSignal(0);
        const doubled = createMemo(() => count() * 2);
      `)
  const s2 = batch.add(`
        import { createComputed, createSignal } from "solid-js";
        const [count, setCount] = createSignal(0);
        createComputed(() => console.log(count()));
      `)
  const s3 = batch.add(`
        import { createRenderEffect, createSignal } from "solid-js";
        const [count, setCount] = createSignal(0);
        createRenderEffect(() => console.log(count()));
      `)
  const s4 = batch.add(`
        import { createEffect } from "solid-js";
        function helper() { createEffect(() => console.log("hi")); }
      `)
  const s5 = batch.add(`
        import { createEffect, createSignal } from "solid-js";
        function App() {
          const [count, setCount] = createSignal(0);
          createEffect(() => console.log(count()));
          return <div>{count()}</div>;
        }
      `)
  const s6 = batch.add(`
        import { createMemo, createSignal } from "solid-js";
        function App() {
          const [count, setCount] = createSignal(0);
          const doubled = createMemo(() => count() * 2);
          return <div>{doubled()}</div>;
        }
      `)
  const s7 = batch.add(`
        import { createEffect, createRoot, createSignal } from "solid-js";
        const [count, setCount] = createSignal(0);
        createRoot(() => { createEffect(() => console.log(count())); });
      `)
  const s8 = batch.add(`
        import { createEffect, runWithOwner, getOwner } from "solid-js";
        const owner = getOwner();
        runWithOwner(owner, () => { createEffect(() => console.log("tracked")); });
      `)
  const s9 = batch.add(`
        import { createEffect } from "solid-js";
        function createTimer(fn: () => void, delay: number) { createEffect(() => fn()); }
      `)
  const s10 = batch.add(`
        import { createEffect } from "solid-js";
        function useDebounce(value: () => string) { createEffect(() => console.log(value())); }
      `)
  const s11 = batch.add(`
        import { createEffect, createSignal } from "solid-js";
        function createSimpleContext(input) { return input.init(); }
        const ctx = createSimpleContext({
          init: () => {
            const [count, setCount] = createSignal(0);
            createEffect(() => console.log(count()));
          }
        });
      `)
  const s12 = batch.add(`
        import { createEffect, createSignal } from "solid-js";
        function useContext(input) { return input.setup(); }
        const ctx = useContext({
          setup: () => {
            const [count, setCount] = createSignal(0);
            createEffect(() => console.log(count()));
          }
        });
      `)

  it("metadata", () => { expect(effectOutsideRoot.id).toBe("effect-outside-root") })

  describe("invalid patterns", () => {
    it("flags createEffect at module scope", () => {
      const { diagnostics } = batch.result(s0)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("createEffect")
      expect(diagnostics[0].message).toContain("reactive root")
    })
    it("flags createMemo at module scope", () => {
      const { diagnostics } = batch.result(s1)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("createMemo")
    })
    it("flags createComputed at module scope", () => { expect(batch.result(s2).diagnostics).toHaveLength(1) })
    it("flags createRenderEffect at module scope", () => { expect(batch.result(s3).diagnostics).toHaveLength(1) })
    it("flags createEffect in non-component function", () => { expect(batch.result(s4).diagnostics).toHaveLength(1) })
  })

  describe("valid patterns", () => {
    it("allows createEffect inside component", () => { expect(batch.result(s5).diagnostics).toHaveLength(0) })
    it("allows createMemo inside component", () => { expect(batch.result(s6).diagnostics).toHaveLength(0) })
    it("allows createEffect inside createRoot", () => { expect(batch.result(s7).diagnostics).toHaveLength(0) })
    it("allows createEffect inside runWithOwner", () => { expect(batch.result(s8).diagnostics).toHaveLength(0) })
    it("allows createEffect inside custom reactive primitive (createXxx)", () => { expect(batch.result(s9).diagnostics).toHaveLength(0) })
    it("allows createEffect inside custom hook (useXxx)", () => { expect(batch.result(s10).diagnostics).toHaveLength(0) })
    it("allows createEffect inside object property callback passed to create* call", () => { expect(batch.result(s11).diagnostics).toHaveLength(0) })
    it("allows createEffect inside object property callback passed to use* call", () => { expect(batch.result(s12).diagnostics).toHaveLength(0) })
  })
})

describe("no-leaked-animation-frame", () => {
  const batch = lazyRuleBatch(noLeakedAnimationFrame)
  const s0 = batch.add(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => { requestAnimationFrame(() => {}); });
          return <div />;
        }
      `)
  const s1 = batch.add(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => { window.requestAnimationFrame(() => {}); });
          return <div />;
        }
      `)
  const s2 = batch.add(`
        import { createReaction, createSignal } from "solid-js";
        function App() {
          const [count] = createSignal(0);
          const track = createReaction(() => { requestAnimationFrame(() => {}); });
          track(() => count());
          return <div />;
        }
      `)
  const s3 = batch.add(`
        import { createMemo, createSignal } from "solid-js";
        function App() {
          const [count] = createSignal(0);
          const derived = createMemo(() => { requestAnimationFrame(() => {}); return count(); });
          return <div />;
        }
      `)
  const s4 = batch.add(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          createEffect(() => {
            const id = requestAnimationFrame(() => {});
            onCleanup(() => cancelAnimationFrame(id));
          });
          return <div />;
        }
      `)
  const s5 = batch.add(`
        function App() { requestAnimationFrame(() => {}); return <div />; }
      `)
  const s6 = batch.add(`
        import { createEffect, onCleanup, untrack, createSignal } from "solid-js";
        function App() {
          const [value] = createSignal(0);
          let frameId: number | undefined;
          function cleanup() { if (frameId !== undefined) { cancelAnimationFrame(frameId); frameId = undefined; } }
          createEffect(() => { const v = value(); cleanup(); frameId = requestAnimationFrame(() => {}); });
          onCleanup(cleanup);
          return <div />;
        }
      `)
  const s7 = batch.add(`
        import { createEffect, onCleanup, createSignal } from "solid-js";
        function App() {
          const [value] = createSignal(0);
          let frameId = 0;
          createEffect(() => { const v = value(); cancelAnimationFrame(frameId); frameId = requestAnimationFrame(() => {}); });
          onCleanup(() => cancelAnimationFrame(frameId));
          return <div />;
        }
      `)
  const s8 = batch.add(`
        import { createEffect, createSignal } from "solid-js";
        function App() {
          const [value] = createSignal(0);
          let frameId = 0;
          createEffect(() => { const v = value(); cancelAnimationFrame(frameId); frameId = requestAnimationFrame(() => {}); });
          return <div />;
        }
      `)
  const s9 = batch.add(`
        import { createEffect, createSignal } from "solid-js";
        function App() {
          const [value] = createSignal(0);
          let frameId: number | undefined;
          function stop() { if (frameId !== undefined) cancelAnimationFrame(frameId); }
          createEffect(() => { const v = value(); stop(); frameId = requestAnimationFrame(() => {}); });
          return <div />;
        }
      `)
  const s10 = batch.add(`
        import { onMount } from "solid-js";
        function App() {
          onMount(() => { requestAnimationFrame(() => {}) });
          return <div />;
        }
      `)
  const s11 = batch.add(`
        import { onMount } from "solid-js";
        function App() {
          let ref: HTMLDivElement;
          onMount(() => { requestAnimationFrame(() => { ref.scrollTop = ref.scrollHeight; }) });
          return <div ref={ref!} />;
        }
      `)
  const s12 = batch.add(`
        import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
        function createAnimatedValue(target: () => number) {
          const [displayValue, setDisplayValue] = createSignal(0);
          let frameId: number | undefined;
          function cleanup() { if (frameId !== undefined) { cancelAnimationFrame(frameId); frameId = undefined; } }
          createEffect(() => {
            const targetValue = target();
            const startValue = untrack(displayValue);
            cleanup();
            function animate(currentTime: number) {
              setDisplayValue(Math.round(startValue + (targetValue - startValue) * 0.5));
              if (currentTime < 1000) { frameId = requestAnimationFrame(animate); }
            }
            frameId = requestAnimationFrame(animate);
          });
          onCleanup(cleanup);
          return displayValue;
        }
      `)

  it("metadata", () => { expect(noLeakedAnimationFrame.id).toBe("no-leaked-animation-frame") })

  describe("invalid patterns", () => {
    it("flags requestAnimationFrame in createEffect without cleanup", () => {
      const { diagnostics } = batch.result(s0)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("requestAnimationFrame")
    })
    it("flags window.requestAnimationFrame in createEffect without cleanup", () => { expect(batch.result(s1).diagnostics).toHaveLength(1) })
    it("flags requestAnimationFrame in createReaction without cleanup", () => {
      const { diagnostics } = batch.result(s2)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("requestAnimationFrame")
    })
    it("flags requestAnimationFrame in createMemo without cleanup", () => { expect(batch.result(s3).diagnostics).toHaveLength(1) })
  })

  describe("valid patterns", () => {
    it("allows requestAnimationFrame with cancelAnimationFrame in onCleanup", () => { expect(batch.result(s4).diagnostics).toHaveLength(0) })
    it("allows requestAnimationFrame outside effects", () => { expect(batch.result(s5).diagnostics).toHaveLength(0) })
    it("allows component-level onCleanup with named cleanup function", () => { expect(batch.result(s6).diagnostics).toHaveLength(0) })
    it("allows component-level onCleanup with inline arrow containing cancelAnimationFrame", () => { expect(batch.result(s7).diagnostics).toHaveLength(0) })
    it("allows direct cancelAnimationFrame in effect body before re-request", () => { expect(batch.result(s8).diagnostics).toHaveLength(0) })
    it("allows cleanup function called in effect body (one-level indirection)", () => { expect(batch.result(s9).diagnostics).toHaveLength(0) })
    it("allows one-shot requestAnimationFrame in onMount", () => { expect(batch.result(s10).diagnostics).toHaveLength(0) })
    it("allows requestAnimationFrame in onMount with DOM read", () => { expect(batch.result(s11).diagnostics).toHaveLength(0) })
    it("allows recursive rAF with component-level onCleanup (createAnimatedValue pattern)", () => { expect(batch.result(s12).diagnostics).toHaveLength(0) })
  })
})

describe("no-leaked-subscription", () => {
  const batch = lazyRuleBatch(noLeakedSubscription)
  const s0 = batch.add(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => { const ws = new WebSocket("wss://example.com"); ws.onmessage = () => {}; });
          return <div />;
        }
      `)
  const s1 = batch.add(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => { const source = new EventSource("/stream"); });
          return <div />;
        }
      `)
  const s2 = batch.add(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => { const channel = new BroadcastChannel("test"); });
          return <div />;
        }
      `)
  const s3 = batch.add(`
        import { createEffect, onCleanup } from "solid-js";
        function App() {
          createEffect(() => {
            const ws = new WebSocket("wss://example.com");
            onCleanup(() => ws.close());
          });
          return <div />;
        }
      `)
  const s4 = batch.add(`
        function App() { const ws = new WebSocket("wss://example.com"); return <div />; }
      `)
  const s5 = batch.add(`
        import { createEffect, onCleanup, createSignal } from "solid-js";
        function App() {
          const [url] = createSignal("wss://example.com");
          let ws: WebSocket;
          createEffect(() => { ws = new WebSocket(url()); });
          onCleanup(() => ws.close());
          return <div />;
        }
      `)

  it("metadata", () => { expect(noLeakedSubscription.id).toBe("no-leaked-subscription") })

  describe("invalid patterns", () => {
    it("flags WebSocket in createEffect without close", () => {
      const { diagnostics } = batch.result(s0)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("WebSocket")
    })
    it("flags EventSource in createEffect without close", () => {
      const { diagnostics } = batch.result(s1)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("EventSource")
    })
    it("flags BroadcastChannel in createEffect without close", () => {
      const { diagnostics } = batch.result(s2)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("BroadcastChannel")
    })
  })

  describe("valid patterns", () => {
    it("allows WebSocket with close in onCleanup", () => { expect(batch.result(s3).diagnostics).toHaveLength(0) })
    it("allows WebSocket outside effects", () => { expect(batch.result(s4).diagnostics).toHaveLength(0) })
    it("allows component-level onCleanup with ws.close()", () => { expect(batch.result(s5).diagnostics).toHaveLength(0) })
  })
})

describe("create-root-dispose", () => {
  const batch = lazyRuleBatch(createRootDispose)
  const s0 = batch.add(`
        import { createRoot, createEffect, createSignal } from "solid-js";
        const [state, setState] = createSignal(0);
        createRoot((dispose) => {
          createEffect(() => console.log(state()));
        });
      `)
  const s1 = batch.add(`
        import { createRoot, createEffect } from "solid-js";
        createRoot(() => { createEffect(() => {}); });
      `)
  const s2 = batch.add(`
        import { createRoot, onCleanup } from "solid-js";
        createRoot((dispose) => { onCleanup(dispose); });
      `)
  const s3 = batch.add(`
        import { createRoot } from "solid-js";
        const cleanup = createRoot((dispose) => { return dispose; });
      `)
  const s4 = batch.add(`
        import { createRoot } from "solid-js";
        let cleanup: () => void;
        createRoot((dispose) => { cleanup = dispose; });
      `)
  const s5 = batch.add(`
        import { createRoot, createEffect } from "solid-js";
        createRoot((dispose) => {
          function inner() { const dispose = () => {}; dispose(); }
          createEffect(() => {});
        });
      `)
  const s6 = batch.add(`
        import { createRoot, createEffect } from "solid-js";
        const dispose = "something";
        createRoot((dispose) => { createEffect(() => {}); });
      `)

  it("metadata", () => { expect(createRootDispose.id).toBe("create-root-dispose") })

  describe("invalid patterns", () => {
    it("flags createRoot with unused dispose parameter", () => {
      const { diagnostics } = batch.result(s0)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("dispose")
    })
  })

  describe("valid patterns", () => {
    it("allows createRoot without dispose parameter", () => { expect(batch.result(s1).diagnostics).toHaveLength(0) })
    it("allows createRoot where dispose is called", () => { expect(batch.result(s2).diagnostics).toHaveLength(0) })
    it("allows createRoot where dispose is returned", () => { expect(batch.result(s3).diagnostics).toHaveLength(0) })
    it("allows createRoot where dispose is stored", () => { expect(batch.result(s4).diagnostics).toHaveLength(0) })
  })

  describe("shadowed names", () => {
    it("flags when dispose name is shadowed and only shadowed version is used", () => { expect(batch.result(s5).diagnostics).toHaveLength(1) })
    it("flags when module-scope variable has same name as dispose param", () => { expect(batch.result(s6).diagnostics).toHaveLength(1) })
  })
})

describe("no-leaked-abort-controller", () => {
  const batch = lazyRuleBatch(noLeakedAbortController)
  const s0 = batch.add(`
        import { createEffect } from "solid-js";
        function App() {
          createEffect(() => {
            const controller = new AbortController();
            fetch("/api", { signal: controller.signal });
          });
          return <div />;
        }
      `)
  const s1 = batch.add(`
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
  const s2 = batch.add(`
        function App() { const controller = new AbortController(); return <div />; }
      `)

  it("metadata", () => { expect(noLeakedAbortController.id).toBe("no-leaked-abort-controller") })

  describe("invalid patterns", () => {
    it("flags AbortController in createEffect without abort", () => {
      const { diagnostics } = batch.result(s0)
      expect(diagnostics).toHaveLength(1)
      if (!diagnostics[0]) throw new Error("Expected diagnostic at index 0")
      expect(diagnostics[0].message).toContain("AbortController")
    })
  })

  describe("valid patterns", () => {
    it("allows AbortController with abort in onCleanup", () => { expect(batch.result(s1).diagnostics).toHaveLength(0) })
    it("allows AbortController outside effects", () => { expect(batch.result(s2).diagnostics).toHaveLength(0) })
  })
})

describe("unbounded-collection", () => {
  const batch = lazyRuleBatch(unboundedCollection)
  const s0 = batch.add(`
        const cache = new Map<string, number>();
        function add(key: string, value: number) { cache.set(key, value); }
      `)
  const s1 = batch.add(`
        const visited = new Set<string>();
        function track(url: string) { visited.add(url); }
      `)
  const s2 = batch.add(`
        const logs: string[] = [];
        function log(msg: string) { logs.push(msg); }
      `)
  const s3 = batch.add(`
        const computedCache = new Map<string, number>();
        function addComputed(key: string, value: number) { computedCache["set"](key, value); }
      `)
  const s4 = batch.add(`
        const cacheWithDelete = new Map<string, number>();
        function addDel(key: string, value: number) { cacheWithDelete.set(key, value); }
        function removeDel(key: string) { cacheWithDelete.delete(key); }
      `)
  const s5 = batch.add(`
        const cacheWithClear = new Map<string, number>();
        function addClear(key: string, value: number) { cacheWithClear.set(key, value); }
        function resetClear() { cacheWithClear.clear(); }
      `)
  const s6 = batch.add(`
        function process() { const temp = new Map<string, number>(); temp.set("a", 1); }
      `)
  const s7 = batch.add(`
        const config = new Map<string, string>();
        function get(key: string) { return config.get(key); }
      `)
  const s8 = batch.add(`
        const items: string[] = [];
        function add(item: string) { items.push(item); }
        function removeAt(index: number) { items.splice(index, 1); }
      `)
  const s9 = batch.add(`
        const MIME_TYPES = new Map<string, string>();
        MIME_TYPES.set("html", "text/html");
        MIME_TYPES.set("css", "text/css");
        MIME_TYPES.set("js", "application/javascript");
      `)
  const s10 = batch.add(`
        let cache = new Map<string, number>();
        function add(key: string, value: number) { cache.set(key, value); }
        function reset() { cache = new Map(); }
      `)

  it("metadata", () => { expect(unboundedCollection.id).toBe("unbounded-collection") })

  it("flags unbounded module-scoped collections", () => {
    const d0 = batch.result(s0).diagnostics
    expect(d0).toHaveLength(1)
    if (!d0[0]) throw new Error("Expected diagnostic at index 0")
    expect(d0[0].message).toContain("Map")
    expect(d0[0].message).toContain("cache")

    const d1 = batch.result(s1).diagnostics
    expect(d1).toHaveLength(1)
    if (!d1[0]) throw new Error("Expected diagnostic at index 0")
    expect(d1[0].message).toContain("Set")

    const d2 = batch.result(s2).diagnostics
    expect(d2).toHaveLength(1)
    if (!d2[0]) throw new Error("Expected diagnostic at index 0")
    expect(d2[0].message).toContain("Array")

    const d3 = batch.result(s3).diagnostics
    expect(d3).toHaveLength(1)
    if (!d3[0]) throw new Error("Expected diagnostic at index 0")
    expect(d3[0].message).toContain("computedCache")
  })

  it("allows bounded or evictable collections", () => {
    expect(batch.result(s4).diagnostics).toHaveLength(0)
    expect(batch.result(s5).diagnostics).toHaveLength(0)
    expect(batch.result(s6).diagnostics).toHaveLength(0)
    expect(batch.result(s7).diagnostics).toHaveLength(0)
    expect(batch.result(s8).diagnostics).toHaveLength(0)
    expect(batch.result(s9).diagnostics).toHaveLength(0)
    expect(batch.result(s10).diagnostics).toHaveLength(0)
  })
})

describe("recursive-timer", () => {
  const batch = lazyRuleBatch(recursiveTimer)
  const s0 = batch.add(`
        function poll() { fetch("/status").then(() => setTimeout(poll, 5000)); }
      `)
  const s1 = batch.add(`
        function refresh() { fetch("/data").then(() => { setTimeout(() => refresh(), 3000); }); }
      `)
  const s2 = batch.add(`
        function other() {}
        function start() { setTimeout(other, 1000); }
      `)
  const s3 = batch.add(`
        function init() { setTimeout(() => console.log("done"), 1000); }
      `)
  const s4 = batch.add(`
        let shouldStop = false;
        function poll() { if (shouldStop) return; fetch("/status").then(() => setTimeout(poll, 5000)); }
      `)
  const s5 = batch.add(`
        let done = false;
        function retry() { if (done) return; fetch("/api").then(() => { setTimeout(() => retry(), 3000); }); }
      `)

  it("metadata", () => { expect(recursiveTimer.id).toBe("recursive-timer") })

  it("flags recursive timer patterns", () => {
    const d0 = batch.result(s0).diagnostics
    expect(d0).toHaveLength(1)
    if (!d0[0]) throw new Error("Expected diagnostic at index 0")
    expect(d0[0].message).toContain("poll")

    const d1 = batch.result(s1).diagnostics
    expect(d1).toHaveLength(1)
    if (!d1[0]) throw new Error("Expected diagnostic at index 0")
    expect(d1[0].message).toContain("refresh")
  })

  it("allows non-recursive and guarded recursive timers", () => {
    expect(batch.result(s2).diagnostics).toHaveLength(0)
    expect(batch.result(s3).diagnostics).toHaveLength(0)
    expect(batch.result(s4).diagnostics).toHaveLength(0)
    expect(batch.result(s5).diagnostics).toHaveLength(0)
  })
})

describe("finalization-registry-leak", () => {
  const batch = lazyRuleBatch(finalizationRegistryLeak)
  const s0 = batch.add(`
        const registry = new FinalizationRegistry(() => {});
        const obj = {};
        registry.register(obj, obj);
      `)
  const s1 = batch.add(`
        const registry = new FinalizationRegistry(() => {});
        const obj = {};
        registry.register(obj, { ref: obj });
      `)
  const s2 = batch.add(`
        const registry = new FinalizationRegistry(() => {});
        const target = {};
        registry.register(target, [target]);
      `)
  const s3 = batch.add(`
        const registry = new FinalizationRegistry(() => {});
        const obj = { data: 1 };
        registry.register(obj, obj.data);
      `)
  const s4 = batch.add(`
        const registry = new FinalizationRegistry(() => {});
        const obj = { a: 1 };
        registry.register(obj, { ...obj });
      `)
  const s5 = batch.add(`
        const registry = new FinalizationRegistry(() => {});
        const container = { ref: {} };
        registry.register(container.ref, container.ref);
      `)
  const s6 = batch.add(`
        const registry = new FinalizationRegistry(() => {});
        const obj = {};
        const flag = true;
        registry.register(obj, flag ? obj : null);
      `)
  const s7 = batch.add(`
        const registry = new FinalizationRegistry(() => {});
        const obj = {};
        registry.register(obj, wrap(obj));
      `)
  const s8 = batch.add(`
        const registry = new FinalizationRegistry(() => {});
        const items = [{}];
        registry.register(items[0], items[0]);
      `)
  const s9 = batch.add(`
        class Cache {
          registry = new FinalizationRegistry(() => {});
          track(obj: object) { this.registry.register(obj, obj); }
        }
      `)
  const s10 = batch.add(`
        const registry = new FinalizationRegistry(() => {});
        const obj = {};
        registry.register(obj, "cleanup-token");
      `)
  const s11 = batch.add(`
        const registry = new FinalizationRegistry(() => {});
        const obj = { id: 42 };
        registry.register(obj, 42);
      `)
  const s12 = batch.add(`
        const registry = new FinalizationRegistry(() => {});
        const obj = {};
        const meta = { name: "test" };
        registry.register(obj, meta);
      `)
  const s13 = batch.add(`
        const registry = new FinalizationRegistry(() => {});
        const obj = {};
        registry.register(obj);
      `)
  const s14 = batch.add(`
        const map = new Map();
        const obj = {};
        map.register(obj, obj);
      `)
  const s15 = batch.add(`
        class EventRegistry { register(a: any, b: any) {} }
        const registry = new EventRegistry();
        const obj = {};
        registry.register(obj, obj);
      `)

  it("metadata", () => { expect(finalizationRegistryLeak.id).toBe("finalization-registry-leak") })

  it("flags register() where heldValue references the target", () => {
    const d0 = batch.result(s0).diagnostics
    expect(d0).toHaveLength(1)
    if (!d0[0]) throw new Error("Expected diagnostic")
    expect(d0[0].message).toContain("obj")

    expect(batch.result(s1).diagnostics).toHaveLength(1)
    expect(batch.result(s2).diagnostics).toHaveLength(1)
    expect(batch.result(s3).diagnostics).toHaveLength(1)
    expect(batch.result(s4).diagnostics).toHaveLength(1)

    const d5 = batch.result(s5).diagnostics
    expect(d5).toHaveLength(1)
    if (!d5[0]) throw new Error("Expected diagnostic")
    expect(d5[0].message).toContain("container.ref")

    expect(batch.result(s6).diagnostics).toHaveLength(1)
    expect(batch.result(s7).diagnostics).toHaveLength(1)
    expect(batch.result(s8).diagnostics).toHaveLength(1)

    const d9 = batch.result(s9).diagnostics
    expect(d9).toHaveLength(1)
    if (!d9[0]) throw new Error("Expected diagnostic")
    expect(d9[0].message).toContain("obj")
  })

  it("allows register() with independent heldValue or non-FinalizationRegistry", () => {
    expect(batch.result(s10).diagnostics).toHaveLength(0)
    expect(batch.result(s11).diagnostics).toHaveLength(0)
    expect(batch.result(s12).diagnostics).toHaveLength(0)
    expect(batch.result(s13).diagnostics).toHaveLength(0)
    expect(batch.result(s14).diagnostics).toHaveLength(0)
    expect(batch.result(s15).diagnostics).toHaveLength(0)
  })
})

describe("unbounded-signal-accumulation", () => {
  const batch = lazyRuleBatch(unboundedSignalAccumulation)
  const s0 = batch.add(`import { createSignal } from "solid-js"; const [items, setItems] = createSignal<string[]>([]); setItems(prev => [...prev, "new"]);`)
  const s1 = batch.add(`import { createSignal } from "solid-js"; const [logs, setLogs] = createSignal<string[]>([]); setLogs(prev => { return [...prev, "entry"]; });`)
  const s2 = batch.add(`import { createSignal } from "solid-js"; const [items, setItems] = createSignal<number[]>([]); setItems(prev => ["first", ...prev]);`)
  const s3 = batch.add(`import { createSignal } from "solid-js"; const [items, setItems] = createSignal<number[]>([]); setItems(prev => [...prev, 1, 2, 3]);`)
  const s4 = batch.add(`import { createSignal } from "solid-js"; const [items, setItems] = createSignal<string[]>([]); setItems(prev => { console.log("adding item"); return [...prev, "new"]; });`)
  const s5 = batch.add(`import { createSignal } from "solid-js"; const [items, setItems] = createSignal<string[]>([]); setItems(prev => prev.concat(["new"]));`)
  const s6 = batch.add(`import { createSignal } from "solid-js"; const [items, setItems] = createSignal<string[]>([]); setItems(prev => prev.concat("new"));`)
  const s7 = batch.add(`import { createSignal } from "solid-js"; const [items, setItems] = createSignal<string[]>([]); const add = setItems; add(prev => [...prev, "new"]);`)
  const s8 = batch.add(`import { createSignal } from "solid-js"; const [items, setItems] = createSignal<string[]>([]); setItems(prev => [...prev.slice(-100), "new"]);`)
  const s9 = batch.add(`import { createSignal } from "solid-js"; const [items, setItems] = createSignal<string[]>([]); setItems(prev => [...prev.filter(x => x !== "old"), "new"]);`)
  const s10 = batch.add(`import { createSignal } from "solid-js"; const [items, setItems] = createSignal<string[]>([]); setItems(prev => [...prev, "new"].slice(-100));`)
  const s11 = batch.add(`import { createSignal } from "solid-js"; const [items, setItems] = createSignal<string[]>([]); setItems(["a", "b"]);`)
  const s12 = batch.add(`import { createSignal } from "solid-js"; const [items, setItems] = createSignal<string[]>([]); setItems(prev => prev, "extra");`)
  const s13 = batch.add(`import { createSignal } from "solid-js"; const [count, setCount] = createSignal(0); setCount(5);`)
  const s14 = batch.add(`import { createSignal } from "solid-js"; const [items, setItems] = createSignal<string[]>([]); setItems(prev => { if (prev.length > 100) return prev.slice(-50); return [...prev, "new"]; });`)
  const s15 = batch.add(`import { createSignal } from "solid-js"; const [logs, setLogs] = createSignal<string[]>([]); setLogs(prev => { if (prev.length >= 200) return [...prev.filter(x => x !== "debug"), "new"]; return [...prev, "new"]; });`)
  const s16 = batch.add(`function useCustom() { return [() => [], () => {}]; } const [items, setItems] = useCustom(); setItems(prev => [...prev, "new"]);`)
  const s17 = batch.add(`import { createSignal } from "solid-js"; const [pending, setPending] = createSignal<string[]>([]); const add = (ip: string) => { setPending(prev => [...prev, ip]); }; const remove = (ip: string) => { setPending(prev => prev.filter(op => op !== ip)); };`)
  const s18 = batch.add(`import { createSignal } from "solid-js"; const [toasts, setToasts] = createSignal<{ text: string }[]>([]); const addToast = (msg: string) => { const toast = { text: msg }; setToasts(p => [...p, toast]); setTimeout(() => setToasts(p => p.filter(t => t !== toast)), 3000); };`)
  const s19 = batch.add(`import { createSignal } from "solid-js"; const [selected, setSelected] = createSignal<string[]>([]); const toggle = (id: string) => { setSelected(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]); };`)
  const s20 = batch.add(`import { createSignal } from "solid-js"; const [items, setItems] = createSignal<number[]>([]); setItems(prev => [...prev, 42]); const trim = () => { setItems(prev => prev.slice(-100)); };`)
  const s21 = batch.add(`import { createSignal } from "solid-js"; const [items, setItems] = createSignal<string[]>([]); setItems(prev => [...prev, "new"]); const removeFirst = () => { setItems(prev => { prev.splice(0, 1); return prev; }); };`)
  const s22 = batch.add(`import { createSignal } from "solid-js"; const [items, setItems] = createSignal<string[]>([]); const update = setItems; update(prev => [...prev, "new"]); setItems(prev => prev.filter(x => x !== "old"));`)
  const s23 = batch.add(`import { createSignal } from "solid-js"; const [logs, setLogs] = createSignal<string[]>([]); setLogs(prev => [...prev, "entry"]); setLogs(prev => [...prev, "another"]);`)
  const s24 = batch.add(`import { createSignal } from "solid-js"; const [messages, setMessages] = createSignal<string[]>([]); setMessages(prev => [...prev, "msg"]); const clear = () => setMessages([]);`)
  const s25 = batch.add(`import { createSignal } from "solid-js"; const [events, setEvents] = createSignal<string[]>([]); setEvents(prev => prev.concat("new")); const dismiss = (id: string) => { setEvents(prev => prev.filter(e => e !== id)); };`)
  const s26 = batch.add(`import { createSignal } from "solid-js"; const [items, setItems] = createSignal<number[]>([]); setItems(prev => [...prev, 1]); const evict = () => { setItems(prev => { return prev.filter(x => x > 0); }); };`)

  it("metadata", () => { expect(unboundedSignalAccumulation.id).toBe("unbounded-signal-accumulation") })

  it("flags unbounded spread/concat accumulation patterns", () => {
    const d0 = batch.result(s0).diagnostics
    expect(d0).toHaveLength(1)
    if (!d0[0]) throw new Error("Expected diagnostic")
    expect(d0[0].message).toContain("setItems")

    const d1 = batch.result(s1).diagnostics
    expect(d1).toHaveLength(1)
    if (!d1[0]) throw new Error("Expected diagnostic")
    expect(d1[0].message).toContain("setLogs")

    expect(batch.result(s2).diagnostics).toHaveLength(1)
    expect(batch.result(s3).diagnostics).toHaveLength(1)
    expect(batch.result(s4).diagnostics).toHaveLength(1)
    expect(batch.result(s5).diagnostics).toHaveLength(1)
    expect(batch.result(s6).diagnostics).toHaveLength(1)

    const d7 = batch.result(s7).diagnostics
    expect(d7).toHaveLength(1)
    if (!d7[0]) throw new Error("Expected diagnostic")
    expect(d7[0].message).toContain("setItems")
  })

  it("allows bounded accumulation patterns (slice, filter, direct set, multi-return)", () => {
    expect(batch.result(s8).diagnostics).toHaveLength(0)
    expect(batch.result(s9).diagnostics).toHaveLength(0)
    expect(batch.result(s10).diagnostics).toHaveLength(0)
    expect(batch.result(s11).diagnostics).toHaveLength(0)
    expect(batch.result(s12).diagnostics).toHaveLength(0)
    expect(batch.result(s13).diagnostics).toHaveLength(0)
    expect(batch.result(s14).diagnostics).toHaveLength(0)
    expect(batch.result(s15).diagnostics).toHaveLength(0)
    expect(batch.result(s16).diagnostics).toHaveLength(0)
  })

  it("allows sibling setter truncation patterns and flags when missing", () => {
    expect(batch.result(s17).diagnostics).toHaveLength(0)
    expect(batch.result(s18).diagnostics).toHaveLength(0)
    expect(batch.result(s19).diagnostics).toHaveLength(0)
    expect(batch.result(s20).diagnostics).toHaveLength(0)
    expect(batch.result(s21).diagnostics).toHaveLength(0)
    expect(batch.result(s22).diagnostics).toHaveLength(0)
    expect(batch.result(s25).diagnostics).toHaveLength(0)
    expect(batch.result(s26).diagnostics).toHaveLength(0)

    expect(batch.result(s23).diagnostics).toHaveLength(2)
    expect(batch.result(s24).diagnostics).toHaveLength(1)
  })
})

describe("self-referencing-store", () => {
  const batch = lazyRuleBatch(selfReferencingStore)
  const s0 = batch.add(`import { createStore } from "solid-js/store"; const [store, setStore] = createStore({}); setStore("self", store);`)
  const s1 = batch.add(`import { createStore } from "solid-js/store"; const [state, setState] = createStore({}); setState("nested", { ref: state });`)
  const s2 = batch.add(`import { createStore } from "solid-js/store"; const [store, setStore] = createStore({}); setStore("items", [store]);`)
  const s3 = batch.add(`import { createStore } from "solid-js/store"; const [store, setStore] = createStore({}); setStore("a", "b", store);`)
  const s4 = batch.add(`import { createStore } from "solid-js/store"; const [store, setStore] = createStore({}); setStore("self", () => store);`)
  const s5 = batch.add(`import { createStore } from "solid-js/store"; const [store, setStore] = createStore({}); const alias = store; setStore("self", alias);`)
  const s6 = batch.add(`import { createStore } from "solid-js/store"; const [store, setStore] = createStore({}); setStore("key", "value");`)
  const s7 = batch.add(`import { createStore } from "solid-js/store"; const [store, setStore] = createStore({}); const other = { data: 1 }; setStore("key", other);`)
  const s8 = batch.add(`import { createStore } from "solid-js/store"; const [store, setStore] = createStore({}); setStore("copy", { ...store });`)
  const s9 = batch.add(`import { createStore } from "solid-js/store"; const [store, setStore] = createStore({ count: 0 }); setStore("prev", store.count);`)
  const s10 = batch.add(`import { createStore } from "solid-js/store"; const [store, setStore] = createStore({}); setStore();`)
  const s11 = batch.add(`import { createStore } from "solid-js/store"; const [store, setStore] = createStore({ count: 0 }); setStore("count", prev => prev + 1);`)

  it("metadata", () => { expect(selfReferencingStore.id).toBe("self-referencing-store") })

  it("flags setStore where value references the store proxy", () => {
    const d0 = batch.result(s0).diagnostics
    expect(d0).toHaveLength(1)
    if (!d0[0]) throw new Error("Expected diagnostic")
    expect(d0[0].message).toContain("store")

    const d1 = batch.result(s1).diagnostics
    expect(d1).toHaveLength(1)
    if (!d1[0]) throw new Error("Expected diagnostic")
    expect(d1[0].message).toContain("state")

    expect(batch.result(s2).diagnostics).toHaveLength(1)
    expect(batch.result(s3).diagnostics).toHaveLength(1)
    expect(batch.result(s4).diagnostics).toHaveLength(1)
    expect(batch.result(s5).diagnostics).toHaveLength(1)
    // Spread of store still flags (containsIdentifier walks into SpreadElements)
    expect(batch.result(s8).diagnostics).toHaveLength(1)
  })

  it("allows setStore with independent values", () => {
    expect(batch.result(s6).diagnostics).toHaveLength(0)
    expect(batch.result(s7).diagnostics).toHaveLength(0)
    expect(batch.result(s9).diagnostics).toHaveLength(0)
    expect(batch.result(s10).diagnostics).toHaveLength(0)
    expect(batch.result(s11).diagnostics).toHaveLength(0)
  })
})

describe("detached-dom-reference", () => {
  const batch = lazyRuleBatch(detachedDomReference)
  const s0 = batch.add(`const el = document.querySelector("#app");`)
  const s1 = batch.add(`const header = document.getElementById("header");`)
  const s2 = batch.add(`const items = document.querySelectorAll(".item");`)
  const s3 = batch.add(`const buttons = document.getElementsByClassName("btn");`)
  const s4 = batch.add(`let cachedEl: Element | null = null; function init() { cachedEl = document.querySelector("#app"); }`)
  const s5 = batch.add(`const state = { el: null as Element | null }; function init() { state.el = document.querySelector("#app"); }`)
  const s6 = batch.add(`function setup() { const el = document.querySelector("#app"); return el; }`)
  const s7 = batch.add(`const setup = () => { const el = document.querySelector("#app"); return el; };`)
  const s8 = batch.add(`function process() { document.querySelector("#app")?.remove(); }`)
  const s9 = batch.add(`class View { init() { const el = document.querySelector("#root"); } }`)

  it("metadata", () => {
    expect(detachedDomReference.id).toBe("detached-dom-reference")
  })

  it("flags module-scoped DOM query results", () => {
    const d0 = batch.result(s0).diagnostics
    expect(d0).toHaveLength(1)
    if (!d0[0]) throw new Error("Expected diagnostic")
    expect(d0[0].message).toContain("querySelector")
    expect(d0[0].message).toContain("el")

    expect(batch.result(s1).diagnostics).toHaveLength(1)
    expect(batch.result(s2).diagnostics).toHaveLength(1)
    expect(batch.result(s3).diagnostics).toHaveLength(1)

    const d4 = batch.result(s4).diagnostics
    expect(d4).toHaveLength(1)
    if (!d4[0]) throw new Error("Expected diagnostic")
    expect(d4[0].message).toContain("cachedEl")

    const d5 = batch.result(s5).diagnostics
    expect(d5).toHaveLength(1)
    if (!d5[0]) throw new Error("Expected diagnostic")
    expect(d5[0].message).toContain("state.el")
  })

  it("allows function-scoped DOM queries", () => {
    expect(batch.result(s6).diagnostics).toHaveLength(0)
    expect(batch.result(s7).diagnostics).toHaveLength(0)
    expect(batch.result(s8).diagnostics).toHaveLength(0)
    expect(batch.result(s9).diagnostics).toHaveLength(0)
  })
})

describe("closure-captured-scope", () => {
  const batch = lazyRuleBatch(closureCapturedScope)
  const s0 = batch.add(`function process() { const huge = new Array(1000); const summary = huge.length; return () => summary; }`)
  const s1 = batch.add(`function encode() { const buffer = new Uint8Array(4096); const hash = buffer[0]; return () => hash; }`)
  const s2 = batch.add(`function transform() { const items = Array.from({ length: 1000 }); const count = items.length; return () => count; }`)
  const s3 = batch.add(`function build() { const data = new Array(100).fill(0).map((_, i) => i); const total = data.length; return () => total; }`)
  const s4 = batch.add(`function createProcessor() { const huge = new Array(1_000_000); const summary = huge.length; return { getSummary: () => summary }; }`)
  const s5 = batch.add(`function process() { const buf = Buffer.alloc(10_000_000); const checksum = buf[0]; return () => checksum; }`)
  const s6 = batch.add(`function process(source: number[]) { const copy = [...source]; const len = copy.length; return () => len; }`)
  const s7 = batch.add(`let handler: (() => number) | null = null; function process() { const huge = new Array(1_000_000).fill(0); const summary = huge.length; handler = () => summary; }`)
  const s8 = batch.add(`function getData() { const data = new Array(1000); return () => data; }`)
  const s9 = batch.add(`function process() { const data = new Array(1000); return data.length; }`)
  const s10 = batch.add(`function process() { const summary = (() => { const huge = new Array(1000); return huge.length; })(); return () => summary; }`)
  const s11 = batch.add(`function create() { const name = "test"; return () => name; }`)

  it("metadata", () => { expect(closureCapturedScope.id).toBe("closure-captured-scope") })

  it("flags large allocations retained in closure scope", () => {
    const d0 = batch.result(s0).diagnostics
    expect(d0).toHaveLength(1)
    if (!d0[0]) throw new Error("Expected diagnostic")
    expect(d0[0].message).toContain("huge")

    const d1 = batch.result(s1).diagnostics
    expect(d1).toHaveLength(1)
    if (!d1[0]) throw new Error("Expected diagnostic")
    expect(d1[0].message).toContain("buffer")

    expect(batch.result(s2).diagnostics).toHaveLength(1)
    expect(batch.result(s3).diagnostics).toHaveLength(1)
    expect(batch.result(s4).diagnostics).toHaveLength(1)
    expect(batch.result(s5).diagnostics).toHaveLength(1)
    expect(batch.result(s6).diagnostics).toHaveLength(1)
    expect(batch.result(s7).diagnostics).toHaveLength(1)
  })

  it("allows when closure references the allocation or no closure escapes", () => {
    expect(batch.result(s8).diagnostics).toHaveLength(0)
    expect(batch.result(s9).diagnostics).toHaveLength(0)
    expect(batch.result(s10).diagnostics).toHaveLength(0)
    expect(batch.result(s11).diagnostics).toHaveLength(0)
  })
})

describe("closure-dom-circular", () => {
  const batch = lazyRuleBatch(closureDomCircular)
  const s0 = batch.add(`function setup(element: HTMLElement) { element.onclick = () => { element.classList.toggle("active"); }; }`)
  const s1 = batch.add(`function attach(el: HTMLDivElement) { el.onmouseover = () => { el.style.color = "red"; }; }`)
  const s2 = batch.add(`function bind(node: HTMLElement) { node.onclick = function() { node.remove(); }; }`)
  const s3 = batch.add(`function setup() { const el = document.createElement("div"); el.onclick = () => { el.classList.toggle("active"); }; }`)
  const s4 = batch.add(`function setup({ el }: { el: HTMLElement }) { el.onclick = () => { el.classList.toggle("active"); }; }`)
  const s5 = batch.add(`function setup(element: HTMLElement) { element.onclick = () => { console.log("clicked"); }; }`)
  const s6 = batch.add(`function setup(element: HTMLElement) { element.addEventListener("click", () => { element.classList.toggle("active"); }); }`)
  const s7 = batch.add(`function setup(element: HTMLElement) { element.textContent = "hello"; }`)
  const s8 = batch.add(`function setup() { const es = new EventSource("/stream"); es.onerror = () => { if (es.readyState === EventSource.CLOSED) { console.log("closed"); } }; }`)
  const s9 = batch.add(`function setup() { const ws = new WebSocket("wss://example.com"); ws.onerror = () => { ws.close(); }; }`)
  const s10 = batch.add(`function setup() { const worker = new Worker("worker.js"); worker.onerror = () => { worker.terminate(); }; }`)
  const s11 = batch.add(`function request() { const xhr = new XMLHttpRequest(); xhr.onerror = () => { xhr.abort(); }; }`)

  it("metadata", () => { expect(closureDomCircular.id).toBe("closure-dom-circular") })

  it("flags DOM event handler property assignments that capture the element", () => {
    const d0 = batch.result(s0).diagnostics
    expect(d0).toHaveLength(1)
    if (!d0[0]) throw new Error("Expected diagnostic")
    expect(d0[0].message).toContain("element")

    expect(batch.result(s1).diagnostics).toHaveLength(1)
    expect(batch.result(s2).diagnostics).toHaveLength(1)
    expect(batch.result(s3).diagnostics).toHaveLength(1)
    expect(batch.result(s4).diagnostics).toHaveLength(1)
  })

  it("allows non-circular handlers and non-DOM event targets", () => {
    expect(batch.result(s5).diagnostics).toHaveLength(0)
    expect(batch.result(s6).diagnostics).toHaveLength(0)
    expect(batch.result(s7).diagnostics).toHaveLength(0)
    expect(batch.result(s8).diagnostics).toHaveLength(0)
    expect(batch.result(s9).diagnostics).toHaveLength(0)
    expect(batch.result(s10).diagnostics).toHaveLength(0)
    expect(batch.result(s11).diagnostics).toHaveLength(0)
  })
})

describe("prefer-charcode-over-regex-test", () => {
  const batch = lazyRuleBatch(preferCharcodeOverRegexTest)
  const s0 = batch.add(`function classify(str: string) { if (/[a-zA-Z]/.test(str[0])) return true; return false; }`)
  const s1 = batch.add(`function scan(s: string) { let i = 0; while (/[0-9]/.test(s[i])) i++; return i; }`)
  const s2 = batch.add(`function isLower(s: string, i: number) { return /[a-z]/.test(s.charAt(i)); }`)
  const s3 = batch.add(`function isLower(c: string) { return /[a-z]/.test(c); }`)
  const s4 = batch.add(`function isGlob(pattern: string) { return /[*?{]/.test(pattern); }`)
  const s5 = batch.add(`function validate(input: string) { return /^[a-z]+$/.test(input); }`)
  const s6 = batch.add(`function check(suite: { test: (s: string) => boolean }) { return suite.test("hello"); }`)
  const s7 = batch.add(`const ALPHA = /[a-zA-Z]/; function classify(str: string) { return ALPHA.test(str[0]); }`)

  it("metadata", () => { expect(preferCharcodeOverRegexTest.id).toBe("prefer-charcode-over-regex-test") })

  it("flags single-char regex .test() patterns", () => {
    const d0 = batch.result(s0).diagnostics
    expect(d0).toHaveLength(1)
    if (!d0[0]) throw new Error("Expected diagnostic")
    expect(d0[0].message).toContain("charCodeAt")

    expect(batch.result(s1).diagnostics).toHaveLength(1)
    expect(batch.result(s2).diagnostics).toHaveLength(1)
  })

  it("allows non-single-char, bare identifier, and precompiled patterns", () => {
    expect(batch.result(s3).diagnostics).toHaveLength(0)
    expect(batch.result(s4).diagnostics).toHaveLength(0)
    expect(batch.result(s5).diagnostics).toHaveLength(0)
    expect(batch.result(s6).diagnostics).toHaveLength(0)
    expect(batch.result(s7).diagnostics).toHaveLength(0)
  })
})

describe("prefer-precompiled-regex", () => {
  const batch = lazyRuleBatch(preferPrecompiledRegex)
  const s0 = batch.add(`function isAlpha(c: string) { return /[a-z]/.test(c); }`)
  const s1 = batch.add(`function normalize(s: string) { return s.replace(/\\s+/g, " "); }`)
  const s2 = batch.add(`function extract(s: string) { return s.match(/[0-9]+/); }`)
  const s3 = batch.add(`const WHITESPACE = /\\s+/g; function normalize(s: string) { return s.replace(WHITESPACE, " "); }`)
  const s4 = batch.add(`const result = "hello world".replace(/\\s+/g, "-");`)

  it("metadata", () => { expect(preferPrecompiledRegex.id).toBe("prefer-precompiled-regex") })

  it("flags inline regex inside functions", () => {
    const d0 = batch.result(s0).diagnostics
    expect(d0).toHaveLength(1)
    if (!d0[0]) throw new Error("Expected diagnostic")
    expect(d0[0].message).toContain("module-level")

    expect(batch.result(s1).diagnostics).toHaveLength(1)
    expect(batch.result(s2).diagnostics).toHaveLength(1)
  })

  it("allows module-level regex and module-scope usage", () => {
    expect(batch.result(s3).diagnostics).toHaveLength(0)
    expect(batch.result(s4).diagnostics).toHaveLength(0)
  })
})
