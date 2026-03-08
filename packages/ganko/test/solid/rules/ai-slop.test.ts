/**
 * Correctness Rules Tests (Code Quality)
 */

import { describe, it, expect } from "vitest"
import { checkRule, applyAllFixes, at } from "../test-utils"
import { noBannerComments, avoidObjectAssign, noInlineImports, stringConcatInLoop, noAiSlopComments } from "../../../src/solid/rules/correctness"

describe("no-banner-comments", () => {
  const check = (code: string) => checkRule(noBannerComments, code)

  it("metadata", () => {
    expect(noBannerComments.id).toBe("no-banner-comments")
    expect(noBannerComments.meta.description).toContain("banner")
    expect(noBannerComments.meta.fixable).toBe(true)
  })

  it("ignores normal comment", () => {
    expect(check("// This is a normal comment").diagnostics).toHaveLength(0)
  })

  it("ignores short separator", () => {
    expect(check("// ---").diagnostics).toHaveLength(0)
  })

  it("ignores multi-line comment", () => {
    expect(check("/* This is a normal multi-line comment */").diagnostics).toHaveLength(0)
  })

  it("ignores JSDoc", () => {
    const code = `/**
 * A function that does something
 * @param x - the input
 * @returns the output
 */
function foo(x) { return x; }`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("ignores code without comments", () => {
    expect(check("const x = 1; const y = 2;").diagnostics).toHaveLength(0)
  })

  it("ignores mixed content separator", () => {
    expect(check("// -= Header =-").diagnostics).toHaveLength(0)
  })

  it("ignores short equals (< minLength 10)", () => {
    expect(check("// ========").diagnostics).toHaveLength(0)
  })

  it("flags equals banner", () => {
    const code = `// =============================================================================
// Helper Functions
// =============================================================================`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(2)
    expect(applyAllFixes(code, diagnostics)).toBe("\n// Helper Functions\n")
  })

  it("flags dashes banner", () => {
    const code = `// ---------------------------------------------------------------------------
// Section Title
// ---------------------------------------------------------------------------`
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(2)
    expect(applyAllFixes(code, diagnostics)).toBe("\n// Section Title\n")
  })

  it("flags asterisk banner", () => {
    const code = "/* ************************************************************************* */"
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(applyAllFixes(code, diagnostics)).toBe("")
  })

  it("flags single banner line", () => {
    const code = "// ==============================="
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(applyAllFixes(code, diagnostics)).toBe("")
  })

  it("flags hash banner", () => {
    const code = "// #################################"
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(applyAllFixes(code, diagnostics)).toBe("")
  })

  it("flags tilde banner", () => {
    const code = "// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~"
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(applyAllFixes(code, diagnostics)).toBe("")
  })

  it("respects minLength=10", () => {
    // 6 chars - below minLength
    expect(check("// ======").diagnostics).toHaveLength(0)
    // 12 chars - above minLength
    expect(check("// ============").diagnostics).toHaveLength(1)
  })
})

describe("avoid-object-assign", () => {
  const check = (code: string) => checkRule(avoidObjectAssign, code)

  it("metadata", () => {
    expect(avoidObjectAssign.id).toBe("avoid-object-assign")
    expect(avoidObjectAssign.meta.description).toContain("Object.assign")
  })

  it("ignores spread syntax", () => {
    expect(check("const merged = { ...obj1, ...obj2 };").diagnostics).toHaveLength(0)
  })

  it("ignores structuredClone", () => {
    expect(check("const copy = structuredClone(original);").diagnostics).toHaveLength(0)
  })

  it("ignores Object.keys", () => {
    expect(check("const keys = Object.keys(obj);").diagnostics).toHaveLength(0)
  })

  it("ignores other Object methods", () => {
    const code = `
      Object.keys(obj);
      Object.values(obj);
      Object.entries(obj);
      Object.freeze(obj);
    `
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("ignores custom assign", () => {
    expect(check("const result = myObj.assign(target, source);").diagnostics).toHaveLength(0)
  })

  it("ignores assign on other objects", () => {
    expect(check("const result = Utils.assign(a, b);").diagnostics).toHaveLength(0)
  })

  it("flags Object.assign with empty target", () => {
    const code = "const merged = Object.assign({}, obj);"
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).message).toContain("Object.assign")
    expect(applyAllFixes(code, diagnostics)).toBe("const merged = { ...obj };")
  })

  it("flags Object.assign mutation", () => {
    const { diagnostics } = check("Object.assign(target, source);")
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).message).toContain("mutation")
  })

  it("flags Object.assign with multiple sources", () => {
    const code = "const result = Object.assign({}, a, b, c);"
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(applyAllFixes(code, diagnostics)).toBe("const result = { ...a, ...b, ...c };")
  })

  it("flags nested Object.assign", () => {
    const code = "const obj = { data: Object.assign({}, source) };"
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(applyAllFixes(code, diagnostics)).toBe("const obj = { data: { ...source } };")
  })

  it("flags multiple Object.assign calls", () => {
    const code = `const a = Object.assign({}, x);
const b = Object.assign(target, y);`
    expect(check(code).diagnostics).toHaveLength(2)
  })
})

describe("string-concat-in-loop", () => {
  const check = (code: string) => checkRule(stringConcatInLoop, code)

  it("metadata", () => {
    expect(stringConcatInLoop.id).toBe("string-concat-in-loop")
    expect(stringConcatInLoop.meta.description).toContain("string")
  })

  it("ignores array push with join", () => {
    const code = `const items = [];
for (let i = 0; i < 100; i++) {
  items.push(\`Item \${i}\`);
}
const result = items.join(", ");`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("ignores concat outside loop", () => {
    const code = `let result = "";
result += "hello";
result += "world";`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("ignores number addition in loop", () => {
    const code = `let sum = 0;
for (let i = 0; i < 100; i++) {
  sum += i;
}`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("ignores variable declared inside loop", () => {
    const code = `for (let i = 0; i < 100; i++) {
  let str = "";
  str += "item";
}`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("flags concat in for loop", () => {
    const code = `let result = "";
for (let i = 0; i < 100; i++) {
  result += "item";
}`
    expect(check(code).diagnostics).toHaveLength(1)
  })

  it("flags concat in while loop", () => {
    const code = `let result = "";
let i = 0;
while (i < 100) {
  result += "x";
  i++;
}`
    expect(check(code).diagnostics).toHaveLength(1)
  })

  it("flags concat in do-while loop", () => {
    const code = `let result = "";
let i = 0;
do {
  result += "x";
  i++;
} while (i < 100);`
    expect(check(code).diagnostics).toHaveLength(1)
  })

  it("flags concat in for-of loop", () => {
    const code = `let result = "";
const items = ["a", "b", "c"];
for (const item of items) {
  result += item;
}`
    expect(check(code).diagnostics).toHaveLength(1)
  })

  it("flags concat in for-in loop", () => {
    const code = `let result = "";
const obj = { a: 1, b: 2 };
for (const key in obj) {
  result += key;
}`
    expect(check(code).diagnostics).toHaveLength(1)
  })
})

describe("no-inline-imports", () => {
  const check = (code: string) => checkRule(noInlineImports, code)

  it("metadata", () => {
    expect(noInlineImports.id).toBe("no-inline-imports")
    expect(noInlineImports.meta.description).toContain("inline")
  })

  it("ignores top-level import type", () => {
    expect(check('import type { TSESLint } from "@typescript-eslint/utils";').diagnostics).toHaveLength(0)
  })

  it("ignores top-level import with named type", () => {
    expect(check('import { type RuleFixer } from "@typescript-eslint/utils";').diagnostics).toHaveLength(0)
  })

  it("ignores function without inline imports", () => {
    const code = `function foo(x: string): number {
  return x.length;
}`
    expect(check(code).diagnostics).toHaveLength(0)
  })

  it("ignores type alias without inline import", () => {
    expect(check("type MyType = { foo: string };").diagnostics).toHaveLength(0)
  })

  it("ignores interface without inline import", () => {
    expect(check("interface MyInterface { bar: number }").diagnostics).toHaveLength(0)
  })

  it("flags inline import in parameter type", () => {
    const code = 'function foo(fixer: import("@typescript-eslint/utils").TSESLint.RuleFixer): void {}'
    const { diagnostics } = check(code)
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).message).toContain("TSESLint.RuleFixer")
  })

  it("flags inline import in return type", () => {
    const code = 'function bar(): import("solid-js").Accessor<number> { return () => 42; }'
    expect(check(code).diagnostics).toHaveLength(1)
  })

  it("flags inline import in type alias", () => {
    const code = 'type Fixer = import("@typescript-eslint/utils").TSESLint.RuleFixer;'
    expect(check(code).diagnostics).toHaveLength(1)
  })

  it("flags inline import in variable annotation", () => {
    const code = 'const x: import("some-module").SomeType = {};'
    expect(check(code).diagnostics).toHaveLength(1)
  })

  it("flags multiple inline imports", () => {
    const code = `type A = import("mod1").Type1;
type B = import("mod2").Type2;`
    expect(check(code).diagnostics).toHaveLength(2)
  })

  it("flags nested inline imports in generics", () => {
    const code = 'type MyType = Array<import("module").SomeType>;'
    expect(check(code).diagnostics).toHaveLength(1)
  })
})

describe("no-ai-slop-comments", () => {
  const check = (code: string, words: string[] = []) => {
    noAiSlopComments.options["words"] = words
    return checkRule(noAiSlopComments, code)
  }

  it("metadata", () => {
    expect(noAiSlopComments.id).toBe("no-ai-slop-comments")
    expect(noAiSlopComments.meta.description).toContain("forbidden")
    expect(noAiSlopComments.meta.fixable).toBe(true)
  })

  it("returns empty when no words configured", () => {
    expect(check("// optimize this code").diagnostics).toHaveLength(0)
  })

  it("ignores comments without forbidden words", () => {
    expect(check("// This is a normal comment", ["forbidden"]).diagnostics).toHaveLength(0)
  })

  it("flags comment with forbidden word", () => {
    const { diagnostics } = check("// This is optimized", ["optimized"])
    expect(diagnostics).toHaveLength(1)
    expect(at(diagnostics, 0).message).toContain("optimized")
  })

  it("is case insensitive by default", () => {
    expect(check("// OPTIMIZE this", ["optimize"]).diagnostics).toHaveLength(1)
    expect(check("// Optimize this", ["optimize"]).diagnostics).toHaveLength(1)
  })

  it("flags multiple forbidden words in same comment", () => {
    const { diagnostics } = check("// optimize for efficiency", ["optimize", "efficiency"])
    expect(diagnostics).toHaveLength(2)
  })

  it("flags multi-line comments", () => {
    const code = `/* This is an optimized
    implementation */`
    expect(check(code, ["optimized"]).diagnostics).toHaveLength(1)
  })

  it("fixes by removing comment", () => {
    const code = "// optimize this"
    const { diagnostics } = check(code, ["optimize"])
    expect(applyAllFixes(code, diagnostics)).toBe("")
  })

  it("handles multiple comments", () => {
    const code = `// optimize here
const x = 1;
// efficient code`
    const { diagnostics } = check(code, ["optimize", "efficient"])
    expect(diagnostics).toHaveLength(2)
  })
})
