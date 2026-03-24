import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import type { SolidSyntaxTree } from "../../src";
import { buildSolidSyntaxTree } from "../../src/solid/impl";
import { createSolidInput } from "../../src/solid/create-input";
import { buildGraph } from "./test-utils";

describe("TypeResolver TypeScript compatibility", () => {
  it("detects Solid signal tuple aliases", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ganko-ts-compat-"));
    try {
      const solidDir = join(tempDir, "solid-js");
      const entryPath = join(tempDir, "test.ts");
      mkdirSync(solidDir, { recursive: true });
      writeFileSync(
        join(solidDir, "index.d.ts"),
        [
          "export type Accessor<T> = () => T;",
          "export type Setter<T> = (value: T) => T;",
          "export type Signal<T> = [Accessor<T>, Setter<T>];",
          "export declare function createSignal<T>(value: T): Signal<T>;",
          "",
        ].join("\n"),
      );
      writeFileSync(
        entryPath,
        [
          'import { createSignal, type Signal } from "./solid-js/index";',
          "",
          "const signal: Signal<number> = createSignal(0);",
          "",
        ].join("\n"),
      );

      const graph = buildGraphFromDisk(entryPath);
      const signal = getIdentifier(graph, "signal");

      expect(graph.typeResolver.isSignalType(signal)).toBe(true);
      expect(graph.typeResolver.getReactiveKind(signal)).toBe("signal");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("classifies array and readonly-array element types", () => {
    const graph = buildGraph(`
      const numbers: number[] = [1, 2, 3];
      const readonlyNumbers: readonly number[] = [1, 2, 3];
      const users: Array<{ id: string }> = [{ id: "a" }];
    `);

    const numbers = getIdentifier(graph, "numbers");
    const readonlyNumbers = getIdentifier(graph, "readonlyNumbers");
    const users = getIdentifier(graph, "users");

    expect(graph.typeResolver.isArrayType(numbers)).toBe(true);
    expect(graph.typeResolver.isStrictArrayType(numbers)).toBe(true);
    expect(graph.typeResolver.getArrayElementKind(numbers)).toBe("primitive");

    expect(graph.typeResolver.isArrayType(readonlyNumbers)).toBe(true);
    expect(graph.typeResolver.isStrictArrayType(readonlyNumbers)).toBe(true);
    expect(graph.typeResolver.getArrayElementKind(readonlyNumbers)).toBe("primitive");

    expect(graph.typeResolver.isArrayType(users)).toBe(true);
    expect(graph.typeResolver.isStrictArrayType(users)).toBe(true);
    expect(graph.typeResolver.getArrayElementKind(users)).toBe("object");
  });

  it("handles union and intersection element typing conservatively", () => {
    const graph = buildGraph(`
      const primitiveUnion: Array<string | number> = [];
      const mixedUnion: Array<string | { id: string }> = [];
      const intersectionObjects: Array<{ id: string } & { name: string }> = [];
    `);

    const primitiveUnion = getIdentifier(graph, "primitiveUnion");
    const mixedUnion = getIdentifier(graph, "mixedUnion");
    const intersectionObjects = getIdentifier(graph, "intersectionObjects");

    expect(graph.typeResolver.getArrayElementKind(primitiveUnion)).toBe("primitive");
    expect(graph.typeResolver.getArrayElementKind(mixedUnion)).toBe("unknown");
    expect(graph.typeResolver.getArrayElementKind(intersectionObjects)).toBe("object");
  });

  it("keeps unions of array types and degenerate intersections conservative", () => {
    const graph = buildGraph(`
      const primitiveArrayUnion: string[] | number[] = [];
      const mixedArrayUnion: string[] | Array<{ id: string }> = [];
      const impossibleIntersection: Array<string & { id: string }> = [];
    `);

    const primitiveArrayUnion = getIdentifier(graph, "primitiveArrayUnion");
    const mixedArrayUnion = getIdentifier(graph, "mixedArrayUnion");
    const impossibleIntersection = getIdentifier(graph, "impossibleIntersection");

    expect(graph.typeResolver.isArrayType(primitiveArrayUnion)).toBe(true);
    expect(graph.typeResolver.getArrayElementKind(primitiveArrayUnion)).toBe("primitive");

    expect(graph.typeResolver.isArrayType(mixedArrayUnion)).toBe(true);
    expect(graph.typeResolver.getArrayElementKind(mixedArrayUnion)).toBe("unknown");

    expect(graph.typeResolver.isArrayType(impossibleIntersection)).toBe(true);
    expect(graph.typeResolver.getArrayElementKind(impossibleIntersection)).toBe("unknown");
  });
});

function getIdentifier(graph: SolidSyntaxTree, name: string): ts.Identifier {
  const identifier = findIdentifier(graph.sourceFile, name);
  if (identifier === null) {
    throw new Error(`Expected identifier '${name}' to exist`);
  }
  return identifier;
}

function buildGraphFromDisk(entryPath: string): SolidSyntaxTree {
  const program = ts.createProgram([entryPath], {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  });
  const input = createSolidInput(entryPath, program);
  return buildSolidSyntaxTree(input, "");
}

function findIdentifier(sourceFile: ts.SourceFile, name: string): ts.Identifier | null {
  let found: ts.Identifier | null = null;

  const visit = (node: ts.Node): void => {
    if (found !== null) return;

    if (ts.isIdentifier(node) && node.text === name) {
      found = node;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}
