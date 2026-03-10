/**
 * Cross-File Debounce Integration Test
 *
 * Tests that the debounce flow (processChangesCallback) correctly publishes
 * cross-file diagnostics for changed files. Exercises the real LSP server
 * over stdio to catch cache invalidation bugs that the simplified TestServer
 * cannot reach.
 *
 * The bug: processChangesCallback Phase 2 publishes changed files with
 * includeCrossFile=false (zero cross-file diagnostics). Phase 3 rebuilds
 * cross-file results but excludes the changed files. Without the fix
 * (Phase 4: republishMergedDiagnostics), changed files permanently lose
 * their cross-file diagnostics until the next save.
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

  it("publishes cross-file diagnostics for changed files after debounce", async () => {
    client = new LSPClient(tempDir);
    await client.initialize();

    // Open both files — server needs both for cross-file analysis
    client.openFile(tsxPath, TSX_CONTENT);
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

    // The fix (republishMergedDiagnostics) ensures cross-file diagnostics
    // are present after the debounce
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
});
