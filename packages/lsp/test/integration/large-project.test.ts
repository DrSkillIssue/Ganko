/**
 * Large Project Integration Tests
 *
 * Tests that the TestServer handles many files without crashing
 * and completes operations in reasonable time.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestServer } from "../helpers";

describe("large-project", () => {
  let server: ReturnType<typeof createTestServer>;

  beforeEach(() => {
    server = createTestServer();
  });

  describe("file-scaling", () => {
    it("handles 50 component files", () => {
      for (let i = 0; i < 50; i++) {
        server.addFile(
          `/test/components/C${i}.tsx`,
          `export function C${i}() { return <div>C${i}</div>; }`,
        );
      }
      expect(server.getAllFiles().length).toBe(50);
      expect(server.hasFile("/test/components/C0.tsx")).toBe(true);
      expect(server.hasFile("/test/components/C49.tsx")).toBe(true);
    });

    it("handles 100 files with imports", () => {
      server.addFile("/test/utils.ts", `export function shared() { return 42; }`);

      for (let i = 0; i < 100; i++) {
        server.addFile(
          `/test/c/C${i}.tsx`,
          `import { shared } from "../utils";\nexport function C${i}() { return <div>{shared()}</div>; }`,
        );
      }
      expect(server.getAllFiles().length).toBe(101);
    });
  });

  describe("incremental-updates", () => {
    it("handles frequent file updates", () => {
      for (let i = 0; i < 20; i++) {
        server.addFile(`/test/f${i}.ts`, `export const v${i} = ${i};`);
      }

      for (let round = 0; round < 5; round++) {
        for (let i = 0; i < 20; i++) {
          server.updateFile(`/test/f${i}.ts`, `export const v${i} = ${i + round * 100};`);
        }
      }
      expect(server.getAllFiles().length).toBe(20);
    });

    it("handles add/remove cycles", () => {
      for (let i = 0; i < 30; i++) {
        server.addFile(`/test/t${i}.ts`, `export const t${i} = ${i};`);
      }
      expect(server.getAllFiles().length).toBe(30);

      for (let i = 0; i < 15; i++) {
        server.removeFile(`/test/t${i}.ts`);
      }
      expect(server.getAllFiles().length).toBe(15);

      for (let i = 30; i < 45; i++) {
        server.addFile(`/test/t${i}.ts`, `export const t${i} = ${i};`);
      }
      expect(server.getAllFiles().length).toBe(30);
    });
  });

  describe("diagnostics-at-scale", () => {
    it("returns diagnostics for all files", () => {
      for (let i = 0; i < 20; i++) {
        server.addFile(
          `/test/f${i}.tsx`,
          `import { createSignal } from "solid-js";\nexport function C${i}() {\n  const [s] = createSignal(${i});\n  return <div>{s}</div>;\n}`,
        );
      }

      for (let i = 0; i < 20; i++) {
        const diags = server.getDiagnostics(`/test/f${i}.tsx`);
        expect(diags.find((d) => d.code === "signal-call")).toBeDefined();
      }
    });

    it("completes diagnostics within reasonable time", () => {
      for (let i = 0; i < 20; i++) {
        server.addFile(
          `/test/f${i}.tsx`,
          `import { createSignal } from "solid-js";\nexport function C${i}() {\n  const [s] = createSignal(0);\n  return <div>{s()}</div>;\n}`,
        );
      }

      const start = performance.now();
      for (let i = 0; i < 20; i++) {
        server.getDiagnostics(`/test/f${i}.tsx`);
      }
      expect(performance.now() - start).toBeLessThan(3000);
    });
  });

  describe("stress-tests", () => {
    it("survives rapid file operations", () => {
      for (let cycle = 0; cycle < 10; cycle++) {
        for (let i = 0; i < 10; i++) {
          server.addFile(`/test/t${i}.ts`, `export const v = ${cycle * 10 + i};`);
        }
        for (let i = 0; i < 10; i++) {
          server.updateFile(`/test/t${i}.ts`, `export const v = ${cycle * 100 + i};`);
        }
        for (let i = 0; i < 10; i++) {
          server.removeFile(`/test/t${i}.ts`);
        }
      }

      server.addFile("/test/final.ts", "export const final = true;");
      expect(server.hasFile("/test/final.ts")).toBe(true);
    });

    it("handles large file content", () => {
      const lines: string[] = [`import { createSignal } from "solid-js";`, "", "export function Big() {"];
      for (let i = 0; i < 200; i++) {
        lines.push(`  const [s${i}] = createSignal(${i});`);
      }
      lines.push("  return (", "    <div>");
      for (let i = 0; i < 100; i++) {
        lines.push(`      <span>{s${i}()}</span>`);
      }
      lines.push("    </div>", "  );", "}");

      server.addFile("/test/Big.tsx", lines.join("\n"));
      expect(server.hasFile("/test/Big.tsx")).toBe(true);

      const diags = server.getDiagnostics("/test/Big.tsx");
      expect(Array.isArray(diags)).toBe(true);
    });
  });
});
