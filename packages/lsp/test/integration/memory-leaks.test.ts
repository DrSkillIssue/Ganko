/**
 * Memory Leak Integration Tests
 *
 * Tests that adding and removing files does not leak state,
 * and that clear() properly resets the server.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServer, createServerPool } from "../helpers";

describe("memory-leaks", () => {
  let server: ReturnType<typeof createTestServer>;

  beforeEach(() => {
    server = createTestServer();
  });

  afterEach(() => {
    server.clear();
  });

  describe("file-cleanup", () => {
    it("clears file data on removal", () => {
      for (let i = 0; i < 20; i++) {
        server.addFile(`/test/f${i}.tsx`, `export function C${i}() { return <div>${i}</div>; }`);
      }
      expect(server.getAllFiles().length).toBe(20);

      for (let i = 0; i < 20; i++) {
        server.removeFile(`/test/f${i}.tsx`);
      }
      expect(server.getAllFiles().length).toBe(0);

      for (let i = 0; i < 20; i++) {
        expect(server.getFileContent(`/test/f${i}.tsx`)).toBeNull();
      }
    });

    it("handles repeated add/remove cycles", () => {
      for (let c = 0; c < 50; c++) {
        for (let i = 0; i < 10; i++) {
          server.addFile(`/test/c${i}.ts`, `export const x = ${c * 10 + i};`);
        }
        for (let i = 0; i < 10; i++) {
          server.removeFile(`/test/c${i}.ts`);
        }
      }
      expect(server.getAllFiles().length).toBe(0);
    });
  });

  describe("server-disposal", () => {
    it("clear() resets all state", () => {
      for (let i = 0; i < 30; i++) {
        server.addFile(`/test/f${i}.tsx`, `export function C${i}() { return <div>${i}</div>; }`);
      }
      expect(server.getAllFiles().length).toBe(30);

      server.clear();
      expect(server.getAllFiles().length).toBe(0);

      server.addFile("/test/new.ts", "export const fresh = true;");
      expect(server.getAllFiles().length).toBe(1);
    });

    it("pool cleans up servers on release", async () => {
      const pool = createServerPool(3);

      const s1 = await pool.acquire();
      s1.addFile("/test/a.ts", "export const a = 1;");
      expect(s1.getAllFiles().length).toBe(1);

      pool.release(s1);

      const s2 = await pool.acquire();
      expect(s2.getAllFiles().length).toBe(0);
      pool.release(s2);

      pool.dispose();
    });

    it("pool handles multiple dispose calls", () => {
      const pool = createServerPool(2);
      pool.dispose();
      pool.dispose();
    });
  });

  describe("long-running", () => {
    it("survives many file operations", () => {
      // Phase 1: bulk add — single program build on first getDiagnostics
      for (let i = 0; i < 100; i++) {
        server.addFile(`/test/op${i}.ts`, `export const v = ${i};`);
      }
      // Trigger analysis once for the full batch (1 program build, not 100)
      server.getDiagnostics(`/test/op0.ts`);

      // Phase 2: bulk update + spot-check analysis
      for (let i = 0; i < 100; i++) {
        server.updateFile(`/test/op${i}.ts`, `export const v = ${i * 2};`);
      }
      server.getDiagnostics(`/test/op50.ts`);

      // Phase 3: bulk remove
      for (let i = 0; i < 100; i++) {
        server.removeFile(`/test/op${i}.ts`);
      }
      expect(server.getAllFiles().length).toBe(0);
    });
  });

  describe("edge-cases", () => {
    it("handles empty string content", () => {
      server.addFile("/test/empty.ts", "");
      expect(server.getFileContent("/test/empty.ts")).toBe("");
      server.removeFile("/test/empty.ts");
      expect(server.hasFile("/test/empty.ts")).toBe(false);
    });

    it("handles very long file paths", () => {
      const path = "/test" + "/deep".repeat(20) + "/file.ts";
      server.addFile(path, "export const deep = true;");
      expect(server.hasFile(path)).toBe(true);
      server.removeFile(path);
      expect(server.hasFile(path)).toBe(false);
    });

    it("handles files with special characters in names", () => {
      const names = [
        "/test/file-with-dashes.ts",
        "/test/file_with_underscores.ts",
        "/test/file.multiple.dots.ts",
        "/test/UPPERCASE.ts",
      ];

      for (const name of names) {
        server.addFile(name, "export const x = 1;");
        expect(server.hasFile(name)).toBe(true);
      }

      for (const name of names) {
        server.removeFile(name);
        expect(server.hasFile(name)).toBe(false);
      }
    });

    it("handles unicode content", () => {
      server.addFile(
        "/test/unicode.tsx",
        `function C() {\n  const emoji = "🎉";\n  return <div>{emoji}</div>;\n}`,
      );
      expect(server.getFileContent("/test/unicode.tsx")).toContain("🎉");
      server.removeFile("/test/unicode.tsx");
      expect(server.hasFile("/test/unicode.tsx")).toBe(false);
    });
  });
});
