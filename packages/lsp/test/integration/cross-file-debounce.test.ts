/**
 * Cross-File Debounce Integration Test
 *
 * Tests that the debounce flow (processChangesCallback) correctly publishes
 * cross-file diagnostics for changed files. Exercises the real LSP server
 * over stdio to catch cache invalidation bugs that the simplified TestServer
 * cannot reach.
 *
 * The bug: processChangesCallback publishes changed files with
 * includeCrossFile=false, invalidates the changed file's cached cross-file
 * slice, then excludes the changed file from affected-file republishing.
 * If no other open file triggers a cross-file rebuild, the changed file's
 * final publish permanently loses its cross-file diagnostics until save.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LSPClient } from "../helpers/lsp-client";
import type { Diagnostic as LSPDiagnostic } from "vscode-languageserver";

function findByCode(list: LSPDiagnostic[], code: string | number | undefined): LSPDiagnostic | undefined {
  for (let i = 0, len = list.length; i < len; i++) {
    if (list[i]?.code === code) return list[i];
  }
  return undefined;
}

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

/**
 * CSS with a transition on a layout property. The cross-file rule
 * css-layout-transition-layout-property fires on the CSS file when
 * a TSX file uses the class in a layout context.
 */
const CSS_V1 = `.box {
  width: 200px;
  transition: width 300ms ease;
}
`;

/** Same CSS with a blank line prepended — shifts line numbers by 1. */
const CSS_V2 = `
.box {
  width: 200px;
  transition: width 300ms ease;
}
`;

/** TSX that imports the CSS and uses .box. */
const TSX_CONTENT = `import "./styles.css";

export function App() {
  return <div class="box">Hello</div>;
}
`;

const TSX_WITH_UNDEFINED_CLASS_V1 = `import "./styles.css";

export function App() {
  return <div class="missing">Hello</div>;
}
`;

const TSX_WITH_UNDEFINED_CLASS_V2 = `
import "./styles.css";

export function App() {
  return <div class="missing">Hello</div>;
}
`;

describe("cross-file debounce", () => {
  let tempDir: string;
  let client: LSPClient;
  let tsxPath: string;
  let cssPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ganko-debounce-test-"));

    const fixtureNodeModules = join(__dirname, "../fixtures/node_modules");
    try {
      symlinkSync(fixtureNodeModules, join(tempDir, "node_modules"), "dir");
    } catch {
      cpSync(fixtureNodeModules, join(tempDir, "node_modules"), { recursive: true });
    }

    writeFileSync(join(tempDir, "tsconfig.json"), TSCONFIG);
    writeFileSync(join(tempDir, "styles.css"), CSS_V1);
    writeFileSync(join(tempDir, "App.tsx"), TSX_CONTENT);

    tsxPath = join(tempDir, "App.tsx");
    cssPath = join(tempDir, "styles.css");
  });

  afterEach(async () => {
    if (client) await client.shutdown();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("preserves CSS cross-file diagnostics after whitespace-only debounce edits with only the changed file open", async () => {
    client = new LSPClient(tempDir);
    await client.initialize();

    // Open only the changed CSS file. The Solid file remains on disk in the file index.
    client.openFile(cssPath, CSS_V1);

    // Wait for initial diagnostics on the CSS file to settle.
    // The cross-file rule css-layout-transition-layout-property fires on CSS.
    const initialPubs = await client.collectDiagnostics(cssPath, 5000);
    expect(initialPubs.length).toBeGreaterThan(0);

    const initial = initialPubs[initialPubs.length - 1];
    expect(initial).toBeDefined();

    const initialCrossFile = initial?.diagnostics.filter(
      d => typeof d.code === "string" && d.code.startsWith("css-layout-"),
    ) ?? [];

    // The fixture must produce cross-file diagnostics on initial open.
    expect(initialCrossFile.length).toBeGreaterThan(0);

    // Now simulate typing in the CSS file: insert a blank line at the top.
    // This triggers processChangesCallback (debounce path), not save.
    // The bug: Phase 2 publishes with includeCrossFile=false → zero cross-file
    // diagnostics. Without the fix, they never come back.
    client.changeFile(cssPath, CSS_V2, 2);

    // Collect ALL diagnostic publications for the CSS file over 2 seconds.
    // The debounce is 150ms, cross-file rebuild happens after.
    const publications = await client.collectDiagnostics(cssPath, 2000);

    // The final publication must include cross-file diagnostics
    const finalPublication = publications[publications.length - 1];
    expect(finalPublication).toBeDefined();

    const finalCrossFile = finalPublication?.diagnostics.filter(
      d => typeof d.code === "string" && d.code.startsWith("css-layout-"),
    ) ?? [];

    expect(finalCrossFile.length).toBeGreaterThan(0);

    // Verify line numbers shifted by 1 (blank line inserted at top of CSS)
    for (const diag of finalCrossFile) {
      const code = diag.code;
      const initialMatch = findByCode(initialCrossFile, code);
      if (initialMatch) {
        expect(diag.range.start.line).toBe(initialMatch.range.start.line + 1);
      }
    }
  }, 30000);

  it("preserves Solid cross-file diagnostics after whitespace-only debounce edits with only the changed file open", async () => {
    writeFileSync(join(tempDir, "App.tsx"), TSX_WITH_UNDEFINED_CLASS_V1);

    client = new LSPClient(tempDir);
    await client.initialize();

    // Open only the changed Solid file. The CSS file remains on disk in the file index.
    client.openFile(tsxPath, TSX_WITH_UNDEFINED_CLASS_V1);

    const initialPubs = await client.collectDiagnostics(tsxPath, 5000);
    expect(initialPubs.length).toBeGreaterThan(0);

    const initial = initialPubs[initialPubs.length - 1];
    expect(initial).toBeDefined();

    const initialUndefinedClass = initial?.diagnostics.filter(
      d => d.code === "jsx-no-undefined-css-class",
    ) ?? [];
    expect(initialUndefinedClass.length).toBeGreaterThan(0);

    client.changeFile(tsxPath, TSX_WITH_UNDEFINED_CLASS_V2, 2);

    const publications = await client.collectDiagnostics(tsxPath, 2000);
    const finalPublication = publications[publications.length - 1];
    expect(finalPublication).toBeDefined();

    const finalUndefinedClass = finalPublication?.diagnostics.filter(
      d => d.code === "jsx-no-undefined-css-class",
    ) ?? [];
    expect(finalUndefinedClass.length).toBeGreaterThan(0);

    for (const diag of finalUndefinedClass) {
      const initialMatch = findByCode(initialUndefinedClass, diag.code);
      if (initialMatch) {
        expect(diag.range.start.line).toBe(initialMatch.range.start.line + 1);
      }
    }
  }, 30000);
});
