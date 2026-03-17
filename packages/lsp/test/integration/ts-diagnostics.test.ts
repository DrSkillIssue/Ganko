/**
 * TypeScript Diagnostic Push Integration Tests
 *
 * Tests that TypeScript syntactic and semantic diagnostics are pushed
 * alongside ganko diagnostics when enableTypeScriptDiagnostics is true.
 * Exercises the real LSP server over stdio via LSPClient.
 *
 * Structure: 3 describe blocks sharing 2 LSP server processes.
 * - "feature gate": own server with TS diagnostics OFF
 * - "Tier 1": own server, tests startup-specific behavior
 * - "shared server": one server for all TS-enabled tests, unique file
 *   names per test to avoid state leakage
 */

import { describe, it, expect, afterAll, beforeAll } from "vitest";
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

const TSX_TYPE_ERROR = `export function App() {
  const x: number = "hello";
  return <div>{x}</div>;
}
`;

const TSX_CLEAN = `export function App() {
  const x: number = 42;
  return <div>{x}</div>;
}
`;

const TSX_BOTH_ERRORS = `import { createSignal } from "solid-js";

export function App() {
  const [count] = createSignal(0);
  const x: number = "hello";
  return <div>{count}</div>;
}
`;

const TSX_SYNTAX_ERROR = `export function App() {
  return <div>hello</div>;

`;

function filterBySource(diags: LSPDiagnostic[], source: string): LSPDiagnostic[] {
  return diags.filter(d => d.source === source);
}

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ganko-ts-diag-test-"));
  const fixtureNodeModules = join(__dirname, "../fixtures/node_modules");
  try {
    symlinkSync(fixtureNodeModules, join(dir, "node_modules"), "dir");
  } catch {
    cpSync(fixtureNodeModules, join(dir, "node_modules"), { recursive: true });
  }
  writeFileSync(join(dir, "tsconfig.json"), TSCONFIG);
  return dir;
}

/**
 * Open a file and wait for diagnostics. Registers the listener BEFORE
 * sending didOpen so fast-publishing servers don't race the listener.
 */
async function openAndWaitForDiags(
  client: LSPClient,
  filePath: string,
  content: string,
  timeoutMs = 10000,
) {
  const promise = client.waitForNextDiagnostics(filePath, timeoutMs);
  client.openFile(filePath, content);
  return promise;
}

describe("ts-diagnostics", () => {
  describe("feature gate", () => {
    let tempDir: string;
    let client: LSPClient;

    beforeAll(async () => {
      tempDir = createTempDir();
      writeFileSync(join(tempDir, "Gate.tsx"), TSX_TYPE_ERROR);
      client = new LSPClient(tempDir);
      await client.initialize();
    });

    afterAll(async () => {
      await client.shutdown();
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("disabled by default — no source:ts diagnostics", async () => {
      const appPath = join(tempDir, "Gate.tsx");
      const pub = await openAndWaitForDiags(client, appPath, TSX_TYPE_ERROR);
      const tsDiags = filterBySource(pub.diagnostics, "ts");
      expect(tsDiags).toHaveLength(0);
    }, 15000);
  });

  describe("Tier 1 — syntactic diagnostics during startup", () => {
    let tempDir: string;
    let client: LSPClient;

    beforeAll(async () => {
      tempDir = createTempDir();
      writeFileSync(join(tempDir, "Syntax.tsx"), TSX_SYNTAX_ERROR);
      client = new LSPClient(tempDir);
      await client.initialize({ enableTypeScriptDiagnostics: true });
    });

    afterAll(async () => {
      await client.shutdown();
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("TS syntax errors appear on open", async () => {
      const appPath = join(tempDir, "Syntax.tsx");
      const pub = await openAndWaitForDiags(client, appPath, TSX_SYNTAX_ERROR);
      const tsDiags = filterBySource(pub.diagnostics, "ts");
      expect(tsDiags.length).toBeGreaterThan(0);
    }, 15000);
  });

  describe("shared server — TS diagnostics enabled", () => {
    let tempDir: string;
    let client: LSPClient;

    beforeAll(async () => {
      tempDir = createTempDir();
      // Write ALL files BEFORE server init so they appear in tsconfig's
      // parsedConfig.fileNames (getScriptFileNames). Files created after
      // init are not in the TS program's root names.
      writeFileSync(join(tempDir, "Open.tsx"), TSX_TYPE_ERROR);
      writeFileSync(join(tempDir, "Merge.tsx"), TSX_BOTH_ERRORS);
      writeFileSync(join(tempDir, "Edit.tsx"), TSX_CLEAN);
      writeFileSync(join(tempDir, "dep-types.ts"), `export type Bar = number;\n`);
      writeFileSync(join(tempDir, "DepApp.tsx"), `import type { Bar } from "./dep-types";\n\nexport function DepApp() {\n  const x: Bar = 42;\n  return <div>{x}</div>;\n}\n`);
      writeFileSync(join(tempDir, "Save.tsx"), TSX_TYPE_ERROR);
      writeFileSync(join(tempDir, "Cache.tsx"), TSX_TYPE_ERROR);
      client = new LSPClient(tempDir);
      await client.initialize({ enableTypeScriptDiagnostics: true });
    });

    afterAll(async () => {
      await client.shutdown();
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("TS type errors appear when enabled", async () => {
      const appPath = join(tempDir, "Open.tsx");

      const pub = await openAndWaitForDiags(client, appPath, TSX_TYPE_ERROR);
      const tsDiags = filterBySource(pub.diagnostics, "ts");
      expect(tsDiags.length).toBeGreaterThan(0);

      const typeError = tsDiags.find(d => d.code === 2322);
      expect(typeError).toBeDefined();
      expect(typeError?.source).toBe("ts");
    }, 15000);

    it("TS and ganko diagnostics merge in the same publication", async () => {
      const appPath = join(tempDir, "Merge.tsx");

      const pub = await openAndWaitForDiags(client, appPath, TSX_BOTH_ERRORS);
      const tsDiags = filterBySource(pub.diagnostics, "ts");
      const gankoDiags = filterBySource(pub.diagnostics, "ganko");

      expect(tsDiags.find(d => d.code === 2322)).toBeDefined();
      expect(gankoDiags.find(d => d.code === "signal-call")).toBeDefined();
    }, 15000);

    it("TS diagnostics update after edit introduces type error", async () => {
      const appPath = join(tempDir, "Edit.tsx");

      const initial = await openAndWaitForDiags(client, appPath, TSX_CLEAN);
      const initialTs = filterBySource(initial.diagnostics, "ts");
      expect(initialTs.filter(d => d.code === 2322)).toHaveLength(0);

      client.changeFile(appPath, TSX_TYPE_ERROR, 2);

      const updated = await client.waitForNextDiagnostics(appPath, 10000);
      const updatedTs = filterBySource(updated.diagnostics, "ts");
      expect(updatedTs.find(d => d.code === 2322)).toBeDefined();
    }, 15000);

    it("TS diagnostics propagate to dependent files after edit", async () => {
      const typesV1 = `export type Bar = number;\n`;
      const typesV2 = `export type Bar = string;\n`;
      const app = `import type { Bar } from "./dep-types";\n\nexport function DepApp() {\n  const x: Bar = 42;\n  return <div>{x}</div>;\n}\n`;

      const appPath = join(tempDir, "DepApp.tsx");
      const typesPath = join(tempDir, "dep-types.ts");

      // Open types first, wait for processing
      await openAndWaitForDiags(client, typesPath, typesV1);

      // Open app — Bar is number, 42 is valid
      const initial = await openAndWaitForDiags(client, appPath, app);
      expect(filterBySource(initial.diagnostics, "ts").filter(d => d.code === 2322)).toHaveLength(0);

      // Change Bar from number to string
      client.changeFile(typesPath, typesV2, 2);

      // Phase 5 propagation to DepApp.tsx
      const propagated = await client.waitForNextDiagnostics(appPath, 10000);
      const propagatedTs = filterBySource(propagated.diagnostics, "ts");
      expect(propagatedTs.find(d => d.code === 2322)).toBeDefined();
    }, 20000);

    it("TS diagnostics survive save with fresh collection", async () => {
      const appPath = join(tempDir, "Save.tsx");

      const initial = await openAndWaitForDiags(client, appPath, TSX_TYPE_ERROR);
      expect(filterBySource(initial.diagnostics, "ts").find(d => d.code === 2322)).toBeDefined();

      client.saveFile(appPath, TSX_TYPE_ERROR, 2);

      const saved = await client.waitForNextDiagnostics(appPath, 10000);
      expect(filterBySource(saved.diagnostics, "ts").find(d => d.code === 2322)).toBeDefined();
    }, 15000);

    it("TS diagnostics preserved during cross-file rediagnosis", async () => {
      const appPath = join(tempDir, "Cache.tsx");

      const initial = await openAndWaitForDiags(client, appPath, TSX_TYPE_ERROR);
      expect(filterBySource(initial.diagnostics, "ts").find(d => d.code === 2322)).toBeDefined();

      client.saveFile(appPath, TSX_TYPE_ERROR, 2);

      const saved = await client.waitForNextDiagnostics(appPath, 10000);
      expect(filterBySource(saved.diagnostics, "ts").find(d => d.code === 2322)).toBeDefined();
    }, 15000);
  });
});
