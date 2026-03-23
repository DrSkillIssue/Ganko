/**
 * Diagnostic Pipeline Deep Integration Tests
 *
 * Tests the FULL diagnostic pipeline end-to-end via the real LSP server
 * over stdio. Uses beforeAll/afterAll with UNIQUE file names per test
 * to share a single server process without state leakage.
 *
 * Pattern (from ts-diagnostics.test.ts):
 * - Write ALL files to disk BEFORE client.initialize()
 * - Each test uses a UNIQUE file name
 * - Register wait listener BEFORE sending didOpen (openAndWaitForDiags)
 * - No closeFile between tests — files stay open
 */

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, unlinkSync, symlinkSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LSPClient, type PublishedDiagnostics } from "../helpers/lsp-client";

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

const FIXTURE_NODE_MODULES = join(__dirname, "../fixtures/node_modules");

function createTempDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ganko-pipeline-test-"));
  try {
    symlinkSync(FIXTURE_NODE_MODULES, join(dir, "node_modules"), "dir");
  } catch {
    cpSync(FIXTURE_NODE_MODULES, join(dir, "node_modules"), { recursive: true });
  }
  writeFileSync(join(dir, "tsconfig.json"), TSCONFIG);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

async function openAndWaitForDiags(client: LSPClient, filePath: string, content: string, timeoutMs = 10000) {
  const promise = client.waitForNextDiagnostics(filePath, timeoutMs);
  client.openFile(filePath, content);
  return promise;
}

function diagCodes(pub: PublishedDiagnostics): string[] {
  return pub.diagnostics.map(d => typeof d.code === "string" ? d.code : String(d.code)).filter(Boolean);
}

// ── Single-file solid diagnostics ─────────────────────────────────

describe("pipeline: single-file solid", () => {
  let dir: string;
  let client: LSPClient;

  beforeAll(async () => {
    dir = createTempDir({
      "SignalError.tsx": `import { createSignal } from "solid-js";
function App() { const [count] = createSignal(0); return <div>{count}</div>; }`,
      "SignalOk.tsx": `import { createSignal } from "solid-js";
function App() { const [count] = createSignal(0); return <div>{count()}</div>; }`,
      "AsyncEffect.tsx": `import { createEffect } from "solid-js";
function App() { createEffect(async () => { await fetch("/api"); }); return <div />; }`,
      "MultiError.tsx": `import { createSignal, createEffect } from "solid-js";
function App() { const [a] = createSignal(0); const [b] = createSignal(0); createEffect(async () => { await fetch("/api"); }); return <div>{a}{b}</div>; }`,
      "Empty.tsx": "",
      "ImportsOnly.tsx": `import { createSignal } from "solid-js";`,
      "SyntaxErr.tsx": `function App() { const x = `,
    });
    client = new LSPClient(dir);
    await client.initialize();
  }, 15000);

  afterAll(async () => {
    await client.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports signal-call on didOpen", async () => {
    const pub = await openAndWaitForDiags(client, join(dir, "SignalError.tsx"), `import { createSignal } from "solid-js";
function App() { const [count] = createSignal(0); return <div>{count}</div>; }`);
    expect(diagCodes(pub)).toContain("signal-call");
  }, 15000);

  it("no signal-call when called correctly", async () => {
    const pub = await openAndWaitForDiags(client, join(dir, "SignalOk.tsx"), `import { createSignal } from "solid-js";
function App() { const [count] = createSignal(0); return <div>{count()}</div>; }`);
    expect(diagCodes(pub)).not.toContain("signal-call");
  }, 15000);

  it("reports async-tracked in createEffect", async () => {
    const pub = await openAndWaitForDiags(client, join(dir, "AsyncEffect.tsx"), `import { createEffect } from "solid-js";
function App() { createEffect(async () => { await fetch("/api"); }); return <div />; }`);
    expect(diagCodes(pub)).toContain("async-tracked");
  }, 15000);

  it("reports multiple diagnostics in same file", async () => {
    const pub = await openAndWaitForDiags(client, join(dir, "MultiError.tsx"), `import { createSignal, createEffect } from "solid-js";
function App() { const [a] = createSignal(0); const [b] = createSignal(0); createEffect(async () => { await fetch("/api"); }); return <div>{a}{b}</div>; }`);
    expect(pub.diagnostics.length).toBeGreaterThanOrEqual(3);
  }, 15000);

  it("handles empty file", async () => {
    const pub = await openAndWaitForDiags(client, join(dir, "Empty.tsx"), "");
    expect(Array.isArray(pub.diagnostics)).toBe(true);
  }, 15000);

  it("handles file with only imports", async () => {
    const pub = await openAndWaitForDiags(client, join(dir, "ImportsOnly.tsx"), `import { createSignal } from "solid-js";`);
    expect(diagCodes(pub)).not.toContain("signal-call");
  }, 15000);

  it("handles syntax error gracefully", async () => {
    const pub = await openAndWaitForDiags(client, join(dir, "SyntaxErr.tsx"), `function App() { const x = `);
    expect(Array.isArray(pub.diagnostics)).toBe(true);
  }, 15000);

  it("diagnostic has correct source field", async () => {
    const pub = client.getPublishedDiagnostics(join(dir, "SignalError.tsx"));
    expect(pub).toBeDefined();
    const signal = pub!.diagnostics.find(d => d.code === "signal-call");
    expect(signal).toBeDefined();
    expect(signal!.source).toBe("ganko");
  }, 5000);

  it("diagnostic has valid range", async () => {
    const pub = client.getPublishedDiagnostics(join(dir, "SignalError.tsx"));
    const signal = pub?.diagnostics.find(d => d.code === "signal-call");
    expect(signal).toBeDefined();
    expect(signal!.range.start.line).toBeGreaterThanOrEqual(0);
    expect(signal!.range.start.character).toBeGreaterThanOrEqual(0);
    expect(signal!.range.end.line).toBeGreaterThanOrEqual(signal!.range.start.line);
  }, 5000);
});

// ── Cross-file diagnostics ────────────────────────────────────────

describe("pipeline: cross-file", () => {
  let dir: string;
  let client: LSPClient;

  beforeAll(async () => {
    dir = createTempDir({
      "styles.css": `.card { width: 100%; }\n.unused { color: red; }`,
      "important.css": `.btn { color: red !important; }`,
      "ids.css": `#main { color: red; }`,
      "emptyRule.css": `.empty { }`,
      "dup.css": `.card { width: 100%; }\n.card { height: 50%; }`,
      "transAll.css": `.card { transition: all 300ms ease; }`,
      "clean.css": `.card { width: 100%; color: blue; }`,
      "MissingClass.tsx": `import "./styles.css";
export function MissingClass() { return <div class="nonexistent">Hello</div>; }`,
      "ValidClass.tsx": `import "./styles.css";
export function ValidClass() { return <div class="card">Hello</div>; }`,
      "CleanApp.tsx": `import "./clean.css";
export function CleanApp() { return <div class="card">Hello</div>; }`,
    });
    client = new LSPClient(dir);
    await client.initialize();
  }, 15000);

  afterAll(async () => {
    await client.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports jsx-no-undefined-css-class for missing class", async () => {
    const pub = await openAndWaitForDiags(client, join(dir, "MissingClass.tsx"), `import "./styles.css";
export function MissingClass() { return <div class="nonexistent">Hello</div>; }`);
    expect(diagCodes(pub)).toContain("jsx-no-undefined-css-class");
  }, 15000);

  it("no jsx-no-undefined-css-class for defined class", async () => {
    const pub = await openAndWaitForDiags(client, join(dir, "ValidClass.tsx"), `import "./styles.css";
export function ValidClass() { return <div class="card">Hello</div>; }`);
    expect(diagCodes(pub)).not.toContain("jsx-no-undefined-css-class");
  }, 15000);

  it("reports css-no-unreferenced-component-class", async () => {
    const pub = await openAndWaitForDiags(client, join(dir, "styles.css"), `.card { width: 100%; }\n.unused { color: red; }`);
    expect(diagCodes(pub)).toContain("css-no-unreferenced-component-class");
  }, 15000);

  it("reports no-important", async () => {
    const pub = await openAndWaitForDiags(client, join(dir, "important.css"), `.btn { color: red !important; }`);
    expect(diagCodes(pub)).toContain("no-important");
  }, 15000);

  it("reports no-id-selectors", async () => {
    const pub = await openAndWaitForDiags(client, join(dir, "ids.css"), `#main { color: red; }`);
    expect(diagCodes(pub)).toContain("no-id-selectors");
  }, 15000);

  it("reports css-no-empty-rule", async () => {
    const pub = await openAndWaitForDiags(client, join(dir, "emptyRule.css"), `.empty { }`);
    expect(diagCodes(pub)).toContain("css-no-empty-rule");
  }, 15000);

  it("reports no-duplicate-selectors", async () => {
    const pub = await openAndWaitForDiags(client, join(dir, "dup.css"), `.card { width: 100%; }\n.card { height: 50%; }`);
    expect(diagCodes(pub)).toContain("no-duplicate-selectors");
  }, 15000);

  it("reports no-transition-all", async () => {
    const pub = await openAndWaitForDiags(client, join(dir, "transAll.css"), `.card { transition: all 300ms ease; }`);
    expect(diagCodes(pub)).toContain("no-transition-all");
  }, 15000);

  it("clean CSS has no syntax issues", async () => {
    const pub = await openAndWaitForDiags(client, join(dir, "clean.css"), `.card { width: 100%; color: blue; }`);
    const bad = pub.diagnostics.filter(d =>
      d.code === "no-important" || d.code === "css-no-empty-rule" ||
      d.code === "no-id-selectors" || d.code === "no-duplicate-selectors"
    );
    expect(bad).toHaveLength(0);
  }, 15000);

  it("CSS diagnostic has correct location on !important", async () => {
    const pub = await client.waitForDiagnostics(join(dir, "important.css"), 10000);
    const imp = pub.diagnostics.find(d => d.code === "no-important");
    expect(imp).toBeDefined();
    expect(imp!.range.start.line).toBeGreaterThanOrEqual(0);
  }, 15000);
});

// ── didChange re-diagnosis ────────────────────────────────────────

describe("pipeline: didChange", () => {
  let dir: string;
  let client: LSPClient;

  beforeAll(async () => {
    dir = createTempDir({
      "Fix.tsx": `import { createSignal } from "solid-js";
function App() { const [count] = createSignal(0); return <div>{count}</div>; }`,
      "Break.tsx": `import { createSignal } from "solid-js";
function App() { const [count] = createSignal(0); return <div>{count()}</div>; }`,
      "Rapid.tsx": `import { createSignal } from "solid-js";
function App() { const [count] = createSignal(0); return <div>{count()}</div>; }`,
    });
    client = new LSPClient(dir);
    await client.initialize();
  }, 15000);

  afterAll(async () => {
    await client.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("clears signal-call after fixing code", async () => {
    const initial = await openAndWaitForDiags(client, join(dir, "Fix.tsx"), `import { createSignal } from "solid-js";
function App() { const [count] = createSignal(0); return <div>{count}</div>; }`);
    expect(diagCodes(initial)).toContain("signal-call");

    client.changeFile(join(dir, "Fix.tsx"), `import { createSignal } from "solid-js";
function App() { const [count] = createSignal(0); return <div>{count()}</div>; }`, 2);
    const after = await client.waitForNextDiagnostics(join(dir, "Fix.tsx"), 10000);
    expect(after.diagnostics.filter(d => d.code === "signal-call")).toHaveLength(0);
  }, 15000);

  it("introduces signal-call after breaking code", async () => {
    const initial = await openAndWaitForDiags(client, join(dir, "Break.tsx"), `import { createSignal } from "solid-js";
function App() { const [count] = createSignal(0); return <div>{count()}</div>; }`);
    expect(diagCodes(initial)).not.toContain("signal-call");

    client.changeFile(join(dir, "Break.tsx"), `import { createSignal } from "solid-js";
function App() { const [count] = createSignal(0); return <div>{count}</div>; }`, 2);
    const after = await client.waitForNextDiagnostics(join(dir, "Break.tsx"), 10000);
    expect(after.diagnostics.filter(d => d.code === "signal-call").length).toBeGreaterThan(0);
  }, 15000);

  it("handles rapid sequential changes", async () => {
    await openAndWaitForDiags(client, join(dir, "Rapid.tsx"), `import { createSignal } from "solid-js";
function App() { const [count] = createSignal(0); return <div>{count()}</div>; }`);
    for (let i = 2; i <= 6; i++) {
      client.changeFile(join(dir, "Rapid.tsx"), `import { createSignal } from "solid-js";
function App() { const [count] = createSignal(0); return <div>{count()}</div>; }\n// v${i}`, i);
    }
    const final = await client.waitForNextDiagnostics(join(dir, "Rapid.tsx"), 10000);
    expect(Array.isArray(final.diagnostics)).toBe(true);
  }, 15000);
});

// ── didSave ───────────────────────────────────────────────────────

describe("pipeline: didSave", () => {
  let dir: string;
  let client: LSPClient;

  beforeAll(async () => {
    dir = createTempDir({
      "saveStyles.css": `.card { width: 100%; }`,
      "SaveApp.tsx": `import "./saveStyles.css";
export function SaveApp() { return <div class="card">Hello</div>; }`,
    });
    client = new LSPClient(dir);
    await client.initialize();
  }, 15000);

  afterAll(async () => {
    await client.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("save triggers cross-file re-diagnosis", async () => {
    await openAndWaitForDiags(client, join(dir, "SaveApp.tsx"), `import "./saveStyles.css";
export function SaveApp() { return <div class="card">Hello</div>; }`);

    const broken = `import "./saveStyles.css";
export function SaveApp() { return <div class="missing">Hello</div>; }`;
    client.changeFile(join(dir, "SaveApp.tsx"), broken, 2);
    client.saveFile(join(dir, "SaveApp.tsx"), broken, 2);
    const after = await client.waitForNextDiagnostics(join(dir, "SaveApp.tsx"), 10000);
    expect(after.diagnostics.map(d => d.code)).toContain("jsx-no-undefined-css-class");
  }, 15000);
});

// ── didClose ──────────────────────────────────────────────────────

describe("pipeline: didClose", () => {
  let dir: string;
  let client: LSPClient;

  beforeAll(async () => {
    dir = createTempDir({
      "closeStyles.css": `.card { width: 100%; }\n.unused { color: red; }`,
      "CloseApp.tsx": `import "./closeStyles.css";
export function CloseApp() { return <div class="card">Hello</div>; }`,
      "CloseReopen.tsx": `import { createSignal } from "solid-js";
function App() { const [c] = createSignal(0); return <div>{c}</div>; }`,
    });
    client = new LSPClient(dir);
    await client.initialize();
  }, 15000);

  afterAll(async () => {
    await client.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reopen after close still produces diagnostics", async () => {
    const initial = await openAndWaitForDiags(client, join(dir, "CloseReopen.tsx"), `import { createSignal } from "solid-js";
function App() { const [c] = createSignal(0); return <div>{c}</div>; }`);
    expect(diagCodes(initial)).toContain("signal-call");

    client.closeFile(join(dir, "CloseReopen.tsx"));
    client.openFile(join(dir, "CloseReopen.tsx"), `import { createSignal } from "solid-js";
function App() { const [c] = createSignal(0); return <div>{c}</div>; }`);
    const pubs = await client.collectDiagnostics(join(dir, "CloseReopen.tsx"), 10000);
    const last = pubs[pubs.length - 1];
    expect(last).toBeDefined();
    expect(last!.diagnostics.filter(d => d.code === "signal-call").length).toBeGreaterThan(0);
  }, 15000);

  it("CSS reopen after close still produces diagnostics", async () => {
    const initial = await openAndWaitForDiags(client, join(dir, "closeStyles.css"), `.card { width: 100%; }\n.unused { color: red; }`);
    expect(initial.diagnostics.length).toBeGreaterThan(0);

    client.closeFile(join(dir, "closeStyles.css"));
    client.openFile(join(dir, "closeStyles.css"), `.card { width: 100%; }\n.unused { color: red; }`);
    const pubs = await client.collectDiagnostics(join(dir, "closeStyles.css"), 10000);
    const last = pubs[pubs.length - 1];
    expect(last).toBeDefined();
    expect(last!.diagnostics.length).toBeGreaterThan(0);
  }, 15000);
});

// ── Watched files ─────────────────────────────────────────────────

describe("pipeline: watched files", () => {
  let dir: string;
  let client: LSPClient;

  beforeAll(async () => {
    dir = createTempDir({
      "watchStyles.css": `.btn { color: red !important; }`,
      "WatchApp.tsx": `import "./watchStyles.css";
export function WatchApp() { return <div class="card">Hello</div>; }`,
    });
    client = new LSPClient(dir);
    await client.initialize();
  }, 15000);

  afterAll(async () => {
    await client.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("deleted file produces empty diagnostics", async () => {
    const initial = await openAndWaitForDiags(client, join(dir, "watchStyles.css"), `.btn { color: red !important; }`);
    expect(initial.diagnostics.length).toBeGreaterThan(0);

    unlinkSync(join(dir, "watchStyles.css"));
    client.sendWatchedFilesChanged([{ filePath: join(dir, "watchStyles.css"), type: 3 }]);
    const after = await client.collectDiagnostics(join(dir, "watchStyles.css"), 5000);
    const cleared = after.find(pub => pub.diagnostics.length === 0);
    expect(cleared).toBeDefined();
  }, 15000);
});

// ── Server stability ──────────────────────────────────────────────

describe("pipeline: stability", () => {
  let dir: string;
  let client: LSPClient;

  beforeAll(async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 10; i++) {
      files[`Batch${i}.tsx`] = `import { createSignal } from "solid-js";
function Batch${i}() { const [c] = createSignal(${i}); return <div>{c${i % 2 === 0 ? "" : "()"}}</div>; }`;
    }
    dir = createTempDir(files);
    client = new LSPClient(dir);
    await client.initialize();
  }, 15000);

  afterAll(async () => {
    await client.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("handles 10 files opened simultaneously", async () => {
    for (let i = 0; i < 10; i++) {
      client.openFile(join(dir, `Batch${i}.tsx`), `import { createSignal } from "solid-js";
function Batch${i}() { const [c] = createSignal(${i}); return <div>{c${i % 2 === 0 ? "" : "()"}}</div>; }`);
    }
    const pub = await client.waitForDiagnostics(join(dir, "Batch0.tsx"), 15000);
    expect(pub.diagnostics.length).toBeGreaterThan(0);
  }, 20000);

  it("even-indexed files have signal-call, odd do not", async () => {
    // Batch0 has {c} (no call), Batch1 has {c()} (called)
    const pub0 = client.getPublishedDiagnostics(join(dir, "Batch0.tsx"));
    const pub1 = client.getPublishedDiagnostics(join(dir, "Batch1.tsx"));
    if (pub0) expect(diagCodes(pub0)).toContain("signal-call");
    if (pub1) expect(diagCodes(pub1)).not.toContain("signal-call");
  }, 5000);
});

// ── Configuration ─────────────────────────────────────────────────

describe("pipeline: configuration", () => {
  it("logLevel trace does not crash", async () => {
    const dir = createTempDir({ "TraceApp.tsx": `export function TraceApp() { return <div>Hello</div>; }` });
    const client = new LSPClient(dir);
    await client.initialize({ logLevel: "trace" });
    const pub = await openAndWaitForDiags(client, join(dir, "TraceApp.tsx"), `export function TraceApp() { return <div>Hello</div>; }`);
    expect(Array.isArray(pub.diagnostics)).toBe(true);
    await client.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }, 20000);

  it("shutdown with no files opened", async () => {
    const dir = createTempDir({});
    const client = new LSPClient(dir);
    await client.initialize();
    const pub = client.getPublishedDiagnostics(join(dir, "nonexistent.tsx"));
    expect(pub).toBeUndefined();
    await client.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }, 15000);

  it("shutdown completes within 5s", async () => {
    const dir = createTempDir({ "ShutdownApp.tsx": `export function X() { return <div>X</div>; }` });
    const client = new LSPClient(dir);
    await client.initialize();
    await openAndWaitForDiags(client, join(dir, "ShutdownApp.tsx"), `export function X() { return <div>X</div>; }`);
    const start = Date.now();
    await client.shutdown();
    expect(Date.now() - start).toBeLessThan(5000);
    rmSync(dir, { recursive: true, force: true });
  }, 15000);
});
