/**
 * Path Aliases Integration Tests
 *
 * Tests that file paths normalize correctly and files are
 * tracked regardless of path format (relative, absolute, URI).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestServer } from "../helpers";

describe("path-aliases", () => {
  let server: ReturnType<typeof createTestServer>;

  beforeEach(() => {
    server = createTestServer();
  });

  it("normalizes relative paths to /test/ prefix", () => {
    server.addFile("component.tsx", `export function C() { return <div />; }`);
    expect(server.hasFile("component.tsx")).toBe(true);
    expect(server.getFileContent("component.tsx")).toContain("function C");
  });

  it("preserves absolute paths", () => {
    server.addFile("/src/app.tsx", `export function App() { return <div />; }`);
    expect(server.hasFile("/src/app.tsx")).toBe(true);
  });

  it("tracks deeply nested paths", () => {
    server.addFile("/a/b/c/d/e/f.tsx", `export function F() { return <div />; }`);
    expect(server.hasFile("/a/b/c/d/e/f.tsx")).toBe(true);
    expect(server.getFileContent("/a/b/c/d/e/f.tsx")).toContain("function F");
  });

  it("distinguishes case-sensitive paths", () => {
    server.addFile("/test/lower.ts", "export const lower = 1;");
    server.addFile("/test/Lower.ts", "export const Upper = 2;");

    expect(server.hasFile("/test/lower.ts")).toBe(true);
    expect(server.hasFile("/test/Lower.ts")).toBe(true);
    expect(server.getFileContent("/test/lower.ts")).toContain("lower");
    expect(server.getFileContent("/test/Lower.ts")).toContain("Upper");
  });

  it("handles files with various import alias patterns", () => {
    server.addFile("/test/src/utils.ts", `export function util() { return 42; }`);
    server.addFile("/test/src/App.tsx", `import { util } from "@/utils";\nexport function App() { return <div>{util()}</div>; }`);

    expect(server.getAllFiles().length).toBe(2);
    expect(server.hasFile("/test/src/utils.ts")).toBe(true);
    expect(server.hasFile("/test/src/App.tsx")).toBe(true);
  });

  it("handles special characters in file names", () => {
    server.addFile("/test/my-component.tsx", `export function X() { return <div />; }`);
    server.addFile("/test/my_component.tsx", `export function Y() { return <div />; }`);
    server.addFile("/test/my.component.tsx", `export function Z() { return <div />; }`);

    expect(server.hasFile("/test/my-component.tsx")).toBe(true);
    expect(server.hasFile("/test/my_component.tsx")).toBe(true);
    expect(server.hasFile("/test/my.component.tsx")).toBe(true);
  });

  it("diagnostics work on aliased paths", () => {
    server.addFile(
      "/test/src/app.tsx",
      `import { createSignal } from "solid-js";\nfunction App() {\n  const [c] = createSignal(0);\n  return <div>{c}</div>;\n}`,
    );

    const diags = server.getDiagnostics("/test/src/app.tsx");
    expect(diags.find((d) => d.code === "signal-call")).toBeDefined();
  });
});
