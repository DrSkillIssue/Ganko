/**
 * Concurrent Edits Integration Tests
 *
 * Tests that rapid add/update/remove operations do not crash
 * the TestServer and diagnostics remain correct after mutations.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestServer, createServerPool } from "../helpers";

describe("concurrent-edits", () => {
  let server: ReturnType<typeof createTestServer>;

  beforeEach(() => {
    server = createTestServer();
  });

  describe("sequential-mutations", () => {
    it("handles interleaved updates and queries", () => {
      server.addFile("/test/C.tsx", `export function C() { return <div>v0</div>; }`);

      for (let i = 1; i <= 10; i++) {
        server.updateFile("/test/C.tsx", `export function C() { return <div>v${i}</div>; }`);
        const diags = server.getDiagnostics("/test/C.tsx");
        expect(Array.isArray(diags)).toBe(true);
      }

      expect(server.getFileContent("/test/C.tsx")).toContain("v10");
    });

    it("handles removal during query cycle", () => {
      for (let i = 0; i < 10; i++) {
        server.addFile(`/test/t${i}.ts`, `export const x = ${i};`);
      }

      for (let i = 0; i < 10; i++) {
        if (i % 2 === 0) {
          server.getDiagnostics(`/test/t${i}.ts`);
        }
        server.removeFile(`/test/t${i}.ts`);
      }

      expect(server.getAllFiles().length).toBe(0);
    });
  });

  describe("rapid-state-changes", () => {
    it("handles rapid add/update/remove cycles", () => {
      for (let i = 0; i < 20; i++) {
        server.addFile(`/test/r${i}.ts`, `export const v = ${i};`);
        server.updateFile(`/test/r${i}.ts`, `export const v = ${i * 2};`);
        server.removeFile(`/test/r${i}.ts`);
      }

      for (let i = 0; i < 20; i++) {
        expect(server.hasFile(`/test/r${i}.ts`)).toBe(false);
      }
    });

    it("survives empty->full->empty transitions", () => {
      expect(server.getAllFiles().length).toBe(0);

      for (let i = 0; i < 50; i++) {
        server.addFile(`/test/f${i}.ts`, `export const x = ${i};`);
      }
      expect(server.getAllFiles().length).toBe(50);

      for (let i = 0; i < 50; i++) {
        server.removeFile(`/test/f${i}.ts`);
      }
      expect(server.getAllFiles().length).toBe(0);
    });

    it("handles same file toggled multiple times", () => {
      const path = "/test/toggle.ts";

      for (let i = 0; i < 10; i++) {
        server.addFile(path, `export const v = ${i};`);
        expect(server.hasFile(path)).toBe(true);
        server.removeFile(path);
        expect(server.hasFile(path)).toBe(false);
      }
    });

    it("handles back-to-back updates", () => {
      server.addFile("/test/timing.ts", "export const v = 0;");

      for (let i = 1; i <= 100; i++) {
        server.updateFile("/test/timing.ts", `export const v = ${i};`);
      }

      expect(server.getFileContent("/test/timing.ts")).toContain("= 100");
    });
  });

  describe("diagnostics-after-mutations", () => {
    it("diagnostics work after many mutations", () => {
      for (let i = 0; i < 10; i++) {
        server.addFile(`/test/f${i}.ts`, `export const x = ${i};`);
      }
      for (let i = 0; i < 5; i++) {
        server.removeFile(`/test/f${i}.ts`);
      }

      server.addFile(
        "/test/check.tsx",
        `import { createSignal } from "solid-js";\nfunction App() {\n  const [c] = createSignal(0);\n  return <div>{c}</div>;\n}`,
      );

      const diags = server.getDiagnostics("/test/check.tsx");
      expect(diags.find((d) => d.code === "signal-call")).toBeDefined();
    });
  });

  describe("server-pool", () => {
    it("handles multiple isolated servers", async () => {
      const pool = createServerPool(3);

      const s1 = await pool.acquire();
      const s2 = await pool.acquire();

      s1.addFile("/test/a.ts", "export const a = 1;");
      s2.addFile("/test/b.ts", "export const b = 2;");

      expect(s1.hasFile("/test/b.ts")).toBe(false);
      expect(s2.hasFile("/test/a.ts")).toBe(false);

      pool.release(s1);
      pool.release(s2);

      const reacquired = await pool.acquire();
      expect(reacquired.getAllFiles().length).toBe(0);
      pool.release(reacquired);

      pool.dispose();
    });

    it("withServer auto-releases", async () => {
      const pool = createServerPool(2);

      const count = await pool.withServer((s) => {
        s.addFile("/test/t.ts", "export const x = 1;");
        return s.getAllFiles().length;
      });

      expect(count).toBe(1);

      const fresh = await pool.acquire();
      expect(fresh.getAllFiles().length).toBe(0);
      pool.release(fresh);
      pool.dispose();
    });
  });

  describe("error-recovery", () => {
    it("recovers from invalid content", () => {
      server.addFile("/test/valid.ts", "export const v = 1;");
      server.addFile("/test/invalid.ts", "export const x = {{{");

      expect(server.hasFile("/test/valid.ts")).toBe(true);
      expect(server.hasFile("/test/invalid.ts")).toBe(true);
    });

    it("recovers from query on nonexistent file", () => {
      expect(server.definition("/test/ghost.ts", 0, 0)).toBeNull();

      server.addFile("/test/real.ts", "export const real = 1;");
      expect(server.hasFile("/test/real.ts")).toBe(true);
    });
  });
});
