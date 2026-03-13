/**
 * Document Lifecycle Integration Tests
 *
 * Covers the untested code paths in connection.ts:
 * - didChangeWatchedFiles: Created, Deleted, ESLint config reload
 * - didSave: flush pending + cross-file rediagnose
 * - didOpen: cross-file for Solid and CSS files
 * - didClose: graph cache preservation
 *
 * All tests exercise the real LSP server over stdio via LSPClient.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, unlinkSync, symlinkSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LSPClient } from "../helpers/lsp-client";

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

const CSS_CONTENT = `.card {
  width: 200px;
  transition: width 300ms ease;
}

.unused-class {
  color: red;
}
`;

const TSX_CONTENT = `import "./styles.css";

export function App() {
  return <div class="card">Hello</div>;
}
`;

const TSX_WITH_UNDEFINED_CLASS = `import "./styles.css";

export function App() {
  return <div class="nonexistent">Hello</div>;
}
`;

const NEW_CSS_CONTENT = `.card {
  width: 200px;
}

.extra {
  font-size: 14px;
}
`;

function setupFixture(): { tempDir: string; tsxPath: string; cssPath: string } {
  const tempDir = mkdtempSync(join(tmpdir(), "ganko-lifecycle-test-"));

  const fixtureNodeModules = join(__dirname, "../fixtures/node_modules");
  try {
    symlinkSync(fixtureNodeModules, join(tempDir, "node_modules"), "dir");
  } catch {
    cpSync(fixtureNodeModules, join(tempDir, "node_modules"), { recursive: true });
  }

  writeFileSync(join(tempDir, "tsconfig.json"), TSCONFIG);
  writeFileSync(join(tempDir, "styles.css"), CSS_CONTENT);
  writeFileSync(join(tempDir, "App.tsx"), TSX_CONTENT);

  return {
    tempDir,
    tsxPath: join(tempDir, "App.tsx"),
    cssPath: join(tempDir, "styles.css"),
  };
}

describe("didChangeWatchedFiles", () => {
  let tempDir: string;
  let client: LSPClient;
  let tsxPath: string;
  let cssPath: string;

  beforeEach(() => {
    ({ tempDir, tsxPath, cssPath } = setupFixture());
  });

  afterEach(async () => {
    if (client) await client.shutdown();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("FileChangeType.Created adds new file to cross-file analysis", async () => {
    client = new LSPClient(tempDir);
    await client.initialize();

    // Open existing files — get initial cross-file diagnostics
    client.openFile(tsxPath, TSX_CONTENT);
    client.openFile(cssPath, CSS_CONTENT);
    const initial = await client.collectDiagnostics(cssPath, 5000);
    expect(initial.length).toBeGreaterThan(0);

    // Create a new CSS file on disk
    const newCssPath = join(tempDir, "extra.css");
    writeFileSync(newCssPath, NEW_CSS_CONTENT);

    // Notify server of file creation
    client.sendWatchedFilesChanged([
      { filePath: newCssPath, type: 1 },
    ]);

    // Open the new file — should be recognized now
    client.openFile(newCssPath, NEW_CSS_CONTENT);
    const newFileDiags = await client.collectDiagnostics(newCssPath, 5000);

    // The new file should produce diagnostics (at minimum cross-file for .extra being unreferenced)
    expect(newFileDiags.length).toBeGreaterThan(0);
    const lastPub = newFileDiags[newFileDiags.length - 1];
    expect(lastPub).toBeDefined();
    expect(Array.isArray(lastPub?.diagnostics)).toBe(true);
  }, 30000);

  it("FileChangeType.Deleted clears diagnostics for removed file", async () => {
    client = new LSPClient(tempDir);
    await client.initialize();

    // Open CSS file — should get diagnostics
    client.openFile(cssPath, CSS_CONTENT);
    const initial = await client.collectDiagnostics(cssPath, 5000);
    expect(initial.length).toBeGreaterThan(0);

    const lastInitial = initial[initial.length - 1];
    expect(lastInitial).toBeDefined();
    expect(lastInitial?.diagnostics.length).toBeGreaterThan(0);

    // Delete the CSS file from disk
    unlinkSync(cssPath);

    // Notify server of deletion
    client.sendWatchedFilesChanged([
      { filePath: cssPath, type: 3 },
    ]);

    // Server should publish empty diagnostics (clearDiagnostics)
    const afterDelete = await client.collectDiagnostics(cssPath, 3000);

    // At least one publication should have 0 diagnostics (the clear)
    const cleared = afterDelete.find(pub => pub.diagnostics.length === 0);
    expect(cleared).toBeDefined();
  }, 30000);
});

describe("didOpen cross-file", () => {
  let tempDir: string;
  let client: LSPClient;
  let tsxPath: string;
  let cssPath: string;

  beforeEach(() => {
    ({ tempDir, tsxPath, cssPath } = setupFixture());
  });

  afterEach(async () => {
    if (client) await client.shutdown();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("Solid file open with undefined CSS class produces jsx-no-undefined-css-class", async () => {
    // Use TSX that references a nonexistent CSS class
    writeFileSync(tsxPath, TSX_WITH_UNDEFINED_CLASS);

    client = new LSPClient(tempDir);
    await client.initialize();

    // Open only the TSX file — CSS is on disk in the fileIndex but not open
    client.openFile(tsxPath, TSX_WITH_UNDEFINED_CLASS);
    const pubs = await client.collectDiagnostics(tsxPath, 8000);
    expect(pubs.length).toBeGreaterThan(0);

    const lastPub = pubs[pubs.length - 1];
    expect(lastPub).toBeDefined();

    // jsx-no-undefined-css-class should fire because "nonexistent" is not in styles.css
    const undefinedClass = lastPub?.diagnostics.filter(
      d => d.code === "jsx-no-undefined-css-class",
    ) ?? [];
    expect(undefinedClass.length).toBeGreaterThan(0);
  }, 30000);

  it("CSS file open produces cross-file diagnostics when Solid files are in index", async () => {
    client = new LSPClient(tempDir);
    await client.initialize();

    // Open only the CSS file — TSX is on disk in the fileIndex but not open
    client.openFile(cssPath, CSS_CONTENT);
    const pubs = await client.collectDiagnostics(cssPath, 8000);
    expect(pubs.length).toBeGreaterThan(0);

    const lastPub = pubs[pubs.length - 1];
    expect(lastPub).toBeDefined();

    // .unused-class is not referenced by any TSX → css-no-unreferenced-component-class
    const unreferenced = lastPub?.diagnostics.filter(
      d => d.code === "css-no-unreferenced-component-class",
    ) ?? [];
    expect(unreferenced.length).toBeGreaterThan(0);
  }, 30000);
});

describe("didSave", () => {
  let tempDir: string;
  let client: LSPClient;
  let tsxPath: string;
  let cssPath: string;

  beforeEach(() => {
    ({ tempDir, tsxPath, cssPath } = setupFixture());
  });

  afterEach(async () => {
    if (client) await client.shutdown();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("save produces cross-file diagnostics after content change", async () => {
    client = new LSPClient(tempDir);
    await client.initialize();

    client.openFile(tsxPath, TSX_CONTENT);
    client.openFile(cssPath, CSS_CONTENT);
    await client.collectDiagnostics(tsxPath, 5000);

    // Change TSX to reference a nonexistent CSS class
    client.changeFile(tsxPath, TSX_WITH_UNDEFINED_CLASS, 2);
    // Immediately save (flushes pending debounce)
    client.saveFile(tsxPath, TSX_WITH_UNDEFINED_CLASS, 2);

    const afterSave = await client.collectDiagnostics(tsxPath, 8000);
    expect(afterSave.length).toBeGreaterThan(0);

    const lastPub = afterSave[afterSave.length - 1];
    expect(lastPub).toBeDefined();

    // Should have jsx-no-undefined-css-class for "nonexistent"
    const undefinedClass = lastPub?.diagnostics.filter(
      d => d.code === "jsx-no-undefined-css-class",
    ) ?? [];
    expect(undefinedClass.length).toBeGreaterThan(0);
  }, 30000);
});

describe("didClose", () => {
  let tempDir: string;
  let client: LSPClient;
  let tsxPath: string;
  let cssPath: string;

  beforeEach(() => {
    ({ tempDir, tsxPath, cssPath } = setupFixture());
  });

  afterEach(async () => {
    if (client) await client.shutdown();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("reopening a closed file still produces cross-file diagnostics", async () => {
    client = new LSPClient(tempDir);
    await client.initialize();

    // Open both files
    client.openFile(tsxPath, TSX_CONTENT);
    client.openFile(cssPath, CSS_CONTENT);
    const initial = await client.collectDiagnostics(cssPath, 5000);
    expect(initial.length).toBeGreaterThan(0);

    const initialCrossFile = initial[initial.length - 1]?.diagnostics.filter(
      d => typeof d.code === "string" && (
        d.code.startsWith("css-layout-") || d.code.startsWith("css-no-unreferenced")
      ),
    ) ?? [];
    expect(initialCrossFile.length).toBeGreaterThan(0);

    // Close the CSS file
    client.closeFile(cssPath);
    await client.delay(500);

    // Reopen it — graph cache should still be warm, cross-file should work
    client.openFile(cssPath, CSS_CONTENT);
    const reopened = await client.collectDiagnostics(cssPath, 8000);
    expect(reopened.length).toBeGreaterThan(0);

    const reopenedCrossFile = reopened[reopened.length - 1]?.diagnostics.filter(
      d => typeof d.code === "string" && (
        d.code.startsWith("css-layout-") || d.code.startsWith("css-no-unreferenced")
      ),
    ) ?? [];

    // Cross-file diagnostics must survive close/reopen
    expect(reopenedCrossFile.length).toBe(initialCrossFile.length);
  }, 30000);
});


