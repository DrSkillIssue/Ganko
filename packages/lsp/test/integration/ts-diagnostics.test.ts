/**
 * TypeScript Diagnostic Push Integration Tests
 *
 * Tests that TypeScript syntactic and semantic diagnostics are pushed
 * alongside ganko diagnostics when enableTypeScriptDiagnostics is true.
 * Exercises the real LSP server over stdio via LSPClient.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LSPClient } from "../helpers/lsp-client";
import type { Diagnostic as LSPDiagnostic } from "vscode-languageserver";

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ESNext",
    module: "ESNext",
    moduleResolution: "bundler",
    strict: true,
    jsx: "preserve",
    jsxImportSource: "solid-js",
    skipLibCheck: true,
    noEmit: true,
  },
  include: ["**/*.tsx", "**/*.ts"],
});

/** TSX with a type error: assigning string to number. */
const TSX_TYPE_ERROR = `export function App() {
  const x: number = "hello";
  return <div>{x}</div>;
}
`;

/** TSX with no errors. */
const TSX_CLEAN = `export function App() {
  const x: number = 42;
  return <div>{x}</div>;
}
`;

/** TSX with both a ganko signal-call violation and a TS type error. */
const TSX_BOTH_ERRORS = `import { createSignal } from "solid-js";

export function App() {
  const [count] = createSignal(0);
  const x: number = "hello";
  return <div>{count}</div>;
}
`;

/** TSX with a syntax error (missing closing brace). */
const TSX_SYNTAX_ERROR = `export function App() {
  return <div>hello</div>;

`;

/** A types module that App.tsx imports. */
const TYPES_V1 = `export type Foo = number;
`;

/** Changed types module — Foo becomes string, breaking App.tsx's usage. */
const TYPES_V2 = `export type Foo = string;
`;

/** App that imports Foo and uses it as number. */
const TSX_IMPORTS_FOO = `import type { Foo } from "./types";

export function App() {
  const x: Foo = 42;
  return <div>{x}</div>;
}
`;

function filterBySource(diags: LSPDiagnostic[], source: string): LSPDiagnostic[] {
  return diags.filter(d => d.source === source);
}

function lastPublication(pubs: { diagnostics: LSPDiagnostic[] }[]): { diagnostics: LSPDiagnostic[] } {
  expect(pubs.length).toBeGreaterThan(0);
  const last = pubs[pubs.length - 1];
  expect(last).toBeDefined();
  return last!;
}

describe("ts-diagnostics", () => {
  let tempDir: string;
  let client: LSPClient;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ganko-ts-diag-test-"));

    const fixtureNodeModules = join(__dirname, "../fixtures/node_modules");
    try {
      symlinkSync(fixtureNodeModules, join(tempDir, "node_modules"), "dir");
    } catch {
      cpSync(fixtureNodeModules, join(tempDir, "node_modules"), { recursive: true });
    }

    writeFileSync(join(tempDir, "tsconfig.json"), TSCONFIG);
  });

  afterEach(async () => {
    if (client) await client.shutdown();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  describe("feature gate", () => {
    it("disabled by default — no source:ts diagnostics", async () => {
      writeFileSync(join(tempDir, "App.tsx"), TSX_TYPE_ERROR);

      client = new LSPClient(tempDir);
      await client.initialize();

      const appPath = join(tempDir, "App.tsx");
      client.openFile(appPath, TSX_TYPE_ERROR);

      const last = lastPublication(await client.collectDiagnostics(appPath, 8000));
      const tsDiags = filterBySource(last.diagnostics, "ts");
      expect(tsDiags).toHaveLength(0);
    }, 30000);
  });

  describe("Tier 2 — semantic diagnostics on open/edit", () => {
    it("TS type errors appear when enabled", async () => {
      writeFileSync(join(tempDir, "App.tsx"), TSX_TYPE_ERROR);

      client = new LSPClient(tempDir);
      await client.initialize({ enableTypeScriptDiagnostics: true });

      const appPath = join(tempDir, "App.tsx");
      client.openFile(appPath, TSX_TYPE_ERROR);

      const last = lastPublication(await client.collectDiagnostics(appPath, 8000));
      const tsDiags = filterBySource(last.diagnostics, "ts");
      expect(tsDiags.length).toBeGreaterThan(0);

      const typeError = tsDiags.find(d => d.code === 2322);
      expect(typeError).toBeDefined();
      expect(typeError?.source).toBe("ts");
    }, 30000);

    it("TS and ganko diagnostics merge in the same publication", async () => {
      writeFileSync(join(tempDir, "App.tsx"), TSX_BOTH_ERRORS);

      client = new LSPClient(tempDir);
      await client.initialize({ enableTypeScriptDiagnostics: true });

      const appPath = join(tempDir, "App.tsx");
      client.openFile(appPath, TSX_BOTH_ERRORS);

      const last = lastPublication(await client.collectDiagnostics(appPath, 8000));
      const tsDiags = filterBySource(last.diagnostics, "ts");
      const gankoDiags = filterBySource(last.diagnostics, "ganko");

      expect(tsDiags.find(d => d.code === 2322)).toBeDefined();
      expect(gankoDiags.find(d => d.code === "signal-call")).toBeDefined();
    }, 30000);

    it("TS diagnostics update after edit introduces type error", async () => {
      writeFileSync(join(tempDir, "App.tsx"), TSX_CLEAN);

      client = new LSPClient(tempDir);
      await client.initialize({ enableTypeScriptDiagnostics: true });

      const appPath = join(tempDir, "App.tsx");
      client.openFile(appPath, TSX_CLEAN);

      const initialLast = lastPublication(await client.collectDiagnostics(appPath, 8000));
      const initialTs = filterBySource(initialLast.diagnostics, "ts");
      expect(initialTs.filter(d => d.code === 2322)).toHaveLength(0);

      client.changeFile(appPath, TSX_TYPE_ERROR, 2);

      const updatedLast = lastPublication(await client.collectDiagnostics(appPath, 5000));
      const updatedTs = filterBySource(updatedLast.diagnostics, "ts");
      expect(updatedTs.find(d => d.code === 2322)).toBeDefined();
    }, 30000);
  });

  describe("Phase 5 — async propagation to dependents", () => {
    it("TS diagnostics propagate to dependent files after edit", async () => {
      writeFileSync(join(tempDir, "types.ts"), TYPES_V1);
      writeFileSync(join(tempDir, "App.tsx"), TSX_IMPORTS_FOO);

      client = new LSPClient(tempDir);
      await client.initialize({ enableTypeScriptDiagnostics: true });

      const appPath = join(tempDir, "App.tsx");
      const typesPath = join(tempDir, "types.ts");

      client.openFile(appPath, TSX_IMPORTS_FOO);
      client.openFile(typesPath, TYPES_V1);

      const initialLast = lastPublication(await client.collectDiagnostics(appPath, 8000));
      const initialTs = filterBySource(initialLast.diagnostics, "ts");
      expect(initialTs.filter(d => d.code === 2322)).toHaveLength(0);

      // Change Foo from number to string — App.tsx should get TS2322
      client.changeFile(typesPath, TYPES_V2, 2);
      writeFileSync(typesPath, TYPES_V2);

      // Wait for Phase 5 propagation to App.tsx
      const propagated = await client.waitForNextDiagnostics(appPath, 10000);
      const propagatedTs = filterBySource(propagated.diagnostics, "ts");
      const typeError = propagatedTs.find(d => d.code === 2322);
      expect(typeError).toBeDefined();
    }, 30000);
  });

  describe("Tier 1 — syntactic diagnostics during startup", () => {
    it("TS syntax errors appear in first publication", async () => {
      writeFileSync(join(tempDir, "App.tsx"), TSX_SYNTAX_ERROR);

      client = new LSPClient(tempDir);
      await client.initialize({ enableTypeScriptDiagnostics: true });

      const appPath = join(tempDir, "App.tsx");
      client.openFile(appPath, TSX_SYNTAX_ERROR);

      const pubs = await client.collectDiagnostics(appPath, 8000);
      expect(pubs.length).toBeGreaterThan(0);

      // The FIRST publication must contain TS syntax errors (Tier 1)
      const firstPub = pubs[0]!;
      const tsDiags = filterBySource(firstPub.diagnostics, "ts");
      expect(tsDiags.length).toBeGreaterThan(0);
    }, 30000);
  });

  describe("save path", () => {
    it("TS diagnostics survive save with fresh collection", async () => {
      writeFileSync(join(tempDir, "App.tsx"), TSX_TYPE_ERROR);

      client = new LSPClient(tempDir);
      await client.initialize({ enableTypeScriptDiagnostics: true });

      const appPath = join(tempDir, "App.tsx");
      client.openFile(appPath, TSX_TYPE_ERROR);

      // Wait for initial diagnostics with TS errors
      const initialLast = lastPublication(await client.collectDiagnostics(appPath, 8000));
      expect(filterBySource(initialLast.diagnostics, "ts").find(d => d.code === 2322)).toBeDefined();

      // Save the file — should re-publish with fresh TS diagnostics
      client.saveFile(appPath, TSX_TYPE_ERROR, 2);

      const saved = await client.waitForNextDiagnostics(appPath, 10000);
      const savedTs = filterBySource(saved.diagnostics, "ts");
      expect(savedTs.find(d => d.code === 2322)).toBeDefined();
    }, 30000);
  });

  describe("cached TS diagnostics survive cross-file rediagnosis", () => {
    it("TS diagnostics preserved when publishFileDiagnostics called without content", async () => {
      writeFileSync(join(tempDir, "App.tsx"), TSX_TYPE_ERROR);

      client = new LSPClient(tempDir);
      await client.initialize({ enableTypeScriptDiagnostics: true });

      const appPath = join(tempDir, "App.tsx");
      client.openFile(appPath, TSX_TYPE_ERROR);

      // Wait for initial diagnostics with TS errors
      const initialLast = lastPublication(await client.collectDiagnostics(appPath, 8000));
      expect(filterBySource(initialLast.diagnostics, "ts").find(d => d.code === 2322)).toBeDefined();

      // Save the file — triggers rediagnoseAffected which calls
      // publishFileDiagnostics without content for affected files.
      // TS diagnostics must survive from cache.
      client.saveFile(appPath, TSX_TYPE_ERROR, 2);

      const saved = await client.waitForNextDiagnostics(appPath, 10000);
      const savedTs = filterBySource(saved.diagnostics, "ts");
      expect(savedTs.find(d => d.code === 2322)).toBeDefined();
    }, 30000);
  });
});
