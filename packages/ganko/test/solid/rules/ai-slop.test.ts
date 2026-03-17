import { describe, it, expect } from "vitest"
import { lazyRuleBatch, checkRule, applyAllFixes, at } from "../test-utils"
import { noBannerComments, avoidObjectAssign, noInlineImports, stringConcatInLoop, noAiSlopComments } from "../../../src/solid/rules/correctness"

describe("no-banner-comments", () => {
  const batch = lazyRuleBatch(noBannerComments)
  const s0 = batch.add("// This is a normal comment")
  const s1 = batch.add("// ---")
  const s2 = batch.add("/* This is a normal multi-line comment */")
  const s3 = batch.add(`/**\n * A function that does something\n * @param x - the input\n * @returns the output\n */\nfunction foo(x) { return x; }`)
  const s4 = batch.add("const x = 1; const y = 2;")
  const s5 = batch.add("// -= Header =-")
  const s6 = batch.add("// ========")
  const s7 = batch.add(`// =============================================================================\n// Helper Functions\n// =============================================================================`)
  const s8 = batch.add(`// ---------------------------------------------------------------------------\n// Section Title\n// ---------------------------------------------------------------------------`)
  const s9 = batch.add("/* ************************************************************************* */")
  const s10 = batch.add("// ===============================")
  const s11 = batch.add("// #################################")
  const s12 = batch.add("// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~")
  const s13 = batch.add("// ============")

  it("ignores normal comments, short separators, JSDoc, and mixed content", () => {
    expect(batch.result(s0).diagnostics).toHaveLength(0)
    expect(batch.result(s1).diagnostics).toHaveLength(0)
    expect(batch.result(s2).diagnostics).toHaveLength(0)
    expect(batch.result(s3).diagnostics).toHaveLength(0)
    expect(batch.result(s4).diagnostics).toHaveLength(0)
    expect(batch.result(s5).diagnostics).toHaveLength(0)
    expect(batch.result(s6).diagnostics).toHaveLength(0)
  })

  it("flags banner patterns and fixes", () => {
    const d7 = batch.result(s7).diagnostics
    expect(d7).toHaveLength(2)
    expect(applyAllFixes(`// =============================================================================\n// Helper Functions\n// =============================================================================`, d7)).toBe("\n// Helper Functions\n")

    expect(batch.result(s8).diagnostics).toHaveLength(2)
    expect(batch.result(s9).diagnostics).toHaveLength(1)
    expect(batch.result(s10).diagnostics).toHaveLength(1)
    expect(batch.result(s11).diagnostics).toHaveLength(1)
    expect(batch.result(s12).diagnostics).toHaveLength(1)
    expect(batch.result(s13).diagnostics).toHaveLength(1)
  })
})

describe("avoid-object-assign", () => {
  const batch = lazyRuleBatch(avoidObjectAssign)
  const s0 = batch.add("const merged = { ...obj1, ...obj2 };")
  const s1 = batch.add("const copy = structuredClone(original);")
  const s2 = batch.add("const keys = Object.keys(obj);")
  const s3 = batch.add(`Object.keys(obj); Object.values(obj); Object.entries(obj); Object.freeze(obj);`)
  const s4 = batch.add("const result = myObj.assign(target, source);")
  const s5 = batch.add("const result = Utils.assign(a, b);")
  const s6 = batch.add("const merged = Object.assign({}, obj);")
  const s7 = batch.add("Object.assign(target, source);")
  const s8 = batch.add("const result = Object.assign({}, a, b, c);")
  const s9 = batch.add("const obj = { data: Object.assign({}, source) };")
  const s10 = batch.add(`const a = Object.assign({}, x);\nconst b = Object.assign(target, y);`)

  it("allows non-Object.assign patterns", () => {
    expect(batch.result(s0).diagnostics).toHaveLength(0)
    expect(batch.result(s1).diagnostics).toHaveLength(0)
    expect(batch.result(s2).diagnostics).toHaveLength(0)
    expect(batch.result(s3).diagnostics).toHaveLength(0)
    expect(batch.result(s4).diagnostics).toHaveLength(0)
    expect(batch.result(s5).diagnostics).toHaveLength(0)
  })

  it("flags Object.assign and fixes to spread", () => {
    const d6 = batch.result(s6).diagnostics
    expect(d6).toHaveLength(1)
    expect(applyAllFixes("const merged = Object.assign({}, obj);", d6)).toBe("const merged = { ...obj };")

    const d7 = batch.result(s7).diagnostics
    expect(d7).toHaveLength(1)
    expect(at(d7, 0).message).toContain("mutation")

    expect(applyAllFixes("const result = Object.assign({}, a, b, c);", batch.result(s8).diagnostics)).toBe("const result = { ...a, ...b, ...c };")
    expect(applyAllFixes("const obj = { data: Object.assign({}, source) };", batch.result(s9).diagnostics)).toBe("const obj = { data: { ...source } };")
    expect(batch.result(s10).diagnostics).toHaveLength(2)
  })
})

describe("string-concat-in-loop", () => {
  const batch = lazyRuleBatch(stringConcatInLoop)
  const s0 = batch.add(`const items = [];\nfor (let i = 0; i < 100; i++) {\n  items.push(\`Item \${i}\`);\n}\nconst result = items.join(", ");`)
  const s1 = batch.add(`let result = "";\nresult += "hello";\nresult += "world";`)
  const s2 = batch.add(`let sum = 0;\nfor (let i = 0; i < 100; i++) {\n  sum += i;\n}`)
  const s3 = batch.add(`for (let i = 0; i < 100; i++) {\n  let str = "";\n  str += "item";\n}`)
  const s4 = batch.add(`let result = "";\nfor (let i = 0; i < 100; i++) {\n  result += "item";\n}`)
  const s5 = batch.add(`let r2 = "";\nlet i = 0;\nwhile (i < 100) {\n  r2 += "x";\n  i++;\n}`)
  const s6 = batch.add(`let r3 = "";\nlet j = 0;\ndo {\n  r3 += "x";\n  j++;\n} while (j < 100);`)
  const s7 = batch.add(`let r4 = "";\nconst items2 = ["a", "b", "c"];\nfor (const item of items2) {\n  r4 += item;\n}`)
  const s8 = batch.add(`let r5 = "";\nconst obj = { a: 1, b: 2 };\nfor (const key in obj) {\n  r5 += key;\n}`)

  it("ignores concat outside loops, number addition, and loop-local variables", () => {
    expect(batch.result(s0).diagnostics).toHaveLength(0)
    expect(batch.result(s1).diagnostics).toHaveLength(0)
    expect(batch.result(s2).diagnostics).toHaveLength(0)
    expect(batch.result(s3).diagnostics).toHaveLength(0)
  })

  it("flags concat in all loop types", () => {
    expect(batch.result(s4).diagnostics).toHaveLength(1)
    expect(batch.result(s5).diagnostics).toHaveLength(1)
    expect(batch.result(s6).diagnostics).toHaveLength(1)
    expect(batch.result(s7).diagnostics).toHaveLength(1)
    expect(batch.result(s8).diagnostics).toHaveLength(1)
  })
})

describe("no-inline-imports", () => {
  const batch = lazyRuleBatch(noInlineImports)
  const s0 = batch.add('import type { TSESLint } from "@typescript-eslint/utils";')
  const s1 = batch.add('import { type RuleFixer } from "@typescript-eslint/utils";')
  const s2 = batch.add("function foo(x: string): number { return x.length; }")
  const s3 = batch.add("type MyType = { foo: string };")
  const s4 = batch.add("interface MyInterface { bar: number }")
  const s5 = batch.add('function foo(fixer: import("@typescript-eslint/utils").TSESLint.RuleFixer): void {}')
  const s6 = batch.add('function bar(): import("solid-js").Accessor<number> { return () => 42; }')
  const s7 = batch.add('type Fixer = import("@typescript-eslint/utils").TSESLint.RuleFixer;')
  const s8 = batch.add('const x: import("some-module").SomeType = {};')
  const s9 = batch.add(`type A = import("mod1").Type1;\ntype B = import("mod2").Type2;`)
  const s10 = batch.add('type MyType2 = Array<import("module").SomeType>;')

  it("ignores top-level and non-import code", () => {
    expect(batch.result(s0).diagnostics).toHaveLength(0)
    expect(batch.result(s1).diagnostics).toHaveLength(0)
    expect(batch.result(s2).diagnostics).toHaveLength(0)
    expect(batch.result(s3).diagnostics).toHaveLength(0)
    expect(batch.result(s4).diagnostics).toHaveLength(0)
  })

  it("flags inline imports", () => {
    expect(batch.result(s5).diagnostics).toHaveLength(1)
    expect(batch.result(s6).diagnostics).toHaveLength(1)
    expect(batch.result(s7).diagnostics).toHaveLength(1)
    expect(batch.result(s8).diagnostics).toHaveLength(1)
    expect(batch.result(s9).diagnostics).toHaveLength(2)
    expect(batch.result(s10).diagnostics).toHaveLength(1)
  })
})

describe("no-ai-slop-comments", () => {
  // This rule uses per-test mutable options, so it can't use lazyRuleBatch
  // (all snippets in a batch share the same rule options).
  const check = (code: string, words: string[] = []) => {
    noAiSlopComments.options["words"] = words
    return checkRule(noAiSlopComments, code)
  }

  it("ignores comments without configured forbidden words", () => {
    expect(check("// optimize this code").diagnostics).toHaveLength(0)
    expect(check("// This is a normal comment", ["forbidden"]).diagnostics).toHaveLength(0)
  })

  it("flags forbidden words case-insensitively and fixes", () => {
    expect(check("// This is optimized", ["optimized"]).diagnostics).toHaveLength(1)
    expect(check("// OPTIMIZE this", ["optimize"]).diagnostics).toHaveLength(1)
    expect(check("// Optimize this", ["optimize"]).diagnostics).toHaveLength(1)
    expect(check("// optimize for efficiency", ["optimize", "efficiency"]).diagnostics).toHaveLength(2)
    expect(check("/* This is an optimized\n    implementation */", ["optimized"]).diagnostics).toHaveLength(1)
    expect(applyAllFixes("// optimize this", check("// optimize this", ["optimize"]).diagnostics)).toBe("")
    expect(check(`// optimize here\nconst x = 1;\n// efficient code`, ["optimize", "efficient"]).diagnostics).toHaveLength(2)
  })
})
