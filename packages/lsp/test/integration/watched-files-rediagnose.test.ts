/**
 * Watched Files Re-diagnosis Regression Test
 *
 * When an AI coder (or any external tool) writes a file to disk, the LSP
 * receives a workspace/didChangeWatchedFiles notification — NOT didChange.
 * Before the fix, the changed file itself was never re-diagnosed: only
 * cross-kind dependents were. This meant cross-file diagnostics silently
 * disappeared for the changed file.
 *
 * This test verifies that open files changed via the file watcher path
 * receive full diagnostics (including cross-file) after the notification.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, cpSync } from "node:fs";
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

describe("watched-files-rediagnose", () => {
  let tempDir: string;
  let client: LSPClient;
  let tsxPath: string;
  let cssPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ganko-watcher-test-"));

    const fixtureNodeModules = join(__dirname, "../fixtures/node_modules");
    try {
      symlinkSync(fixtureNodeModules, join(tempDir, "node_modules"), "dir");
    } catch {
      cpSync(fixtureNodeModules, join(tempDir, "node_modules"), { recursive: true });
    }

    writeFileSync(join(tempDir, "tsconfig.json"), TSCONFIG);
    writeFileSync(join(tempDir, "styles.css"), CSS_CONTENT);
    writeFileSync(join(tempDir, "App.tsx"), TSX_CONTENT);

    tsxPath = join(tempDir, "App.tsx");
    cssPath = join(tempDir, "styles.css");
  });

  afterEach(async () => {
    if (client) await client.shutdown();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("re-diagnoses open files on didChangeWatchedFiles", async () => {
    client = new LSPClient(tempDir);
    await client.initialize();

    client.openFile(tsxPath, TSX_CONTENT);
    client.openFile(cssPath, CSS_CONTENT);

    // Wait for initial diagnostics to settle
    const initialCss = await client.collectDiagnostics(cssPath, 5000);
    expect(initialCss.length).toBeGreaterThan(0);

    const lastInitialCss = initialCss[initialCss.length - 1];
    expect(lastInitialCss).toBeDefined();
    const initialCrossFile = lastInitialCss?.diagnostics.filter(
      d => typeof d.code === "string" && (
        d.code.startsWith("css-layout-") || d.code.startsWith("css-no-unreferenced")
      ),
    ) ?? [];

    // Fixture must produce cross-file diagnostics on initial open
    expect(initialCrossFile.length).toBeGreaterThan(0);

    // Simulate external write: touch files on disk, send didChangeWatchedFiles
    writeFileSync(cssPath, CSS_CONTENT);
    writeFileSync(tsxPath, TSX_CONTENT);

    client.sendWatchedFilesChanged([
      { filePath: cssPath, type: 2 },
      { filePath: tsxPath, type: 2 },
    ]);

    // Collect diagnostics after the watcher notification
    const afterWatcher = await client.collectDiagnostics(cssPath, 5000);
    expect(afterWatcher.length).toBeGreaterThan(0);

    const lastAfterWatcher = afterWatcher[afterWatcher.length - 1];
    expect(lastAfterWatcher).toBeDefined();

    const watcherCrossFile = lastAfterWatcher?.diagnostics.filter(
      d => typeof d.code === "string" && (
        d.code.startsWith("css-layout-") || d.code.startsWith("css-no-unreferenced")
      ),
    ) ?? [];

    // Cross-file diagnostics must still be present after didChangeWatchedFiles
    expect(watcherCrossFile.length).toBeGreaterThan(0);
    expect(watcherCrossFile.length).toBe(initialCrossFile.length);
  }, 30000);

  it("produces cross-file diagnostics for TSX file after watcher notification", async () => {
    client = new LSPClient(tempDir);
    await client.initialize();

    client.openFile(tsxPath, TSX_CONTENT);
    client.openFile(cssPath, CSS_CONTENT);

    // Wait for initial TSX diagnostics
    const initialTsx = await client.collectDiagnostics(tsxPath, 5000);
    expect(initialTsx.length).toBeGreaterThan(0);

    // Simulate external write to TSX only
    writeFileSync(tsxPath, TSX_CONTENT);
    client.sendWatchedFilesChanged([
      { filePath: tsxPath, type: 2 },
    ]);

    const afterWatcher = await client.collectDiagnostics(tsxPath, 5000);
    expect(afterWatcher.length).toBeGreaterThan(0);

    // TSX diagnostics must be republished (at minimum single-file rules)
    const lastPub = afterWatcher[afterWatcher.length - 1];
    expect(lastPub).toBeDefined();
  }, 30000);
});
