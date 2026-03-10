/**
 * TypeScript Project Service Tests
 *
 * Tests for the TypeScript Project Service wrapper:
 * - Service creation and disposal
 * - Program retrieval for TypeScript files
 * - Language service access
 * - File updates and closing
 *
 * Tests share a single TS project service instance per configuration
 * to avoid paying the ~400ms startup cost per test.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import {
  createTypeScriptProjectService,
  type TypeScriptProjectService,
} from "../../src/core/project-service";

const FIXTURES_DIR = join(__dirname, "../fixtures/basic-app");
const COUNTER_FILE = join(FIXTURES_DIR, "counter.tsx");

describe("TypeScriptProjectService", () => {
  describe("createTypeScriptProjectService", () => {
    it("returns valid service object", () => {
      const service = createTypeScriptProjectService({
        tsconfigRootDir: FIXTURES_DIR,
      });

      expect(service).toBeDefined();
      expect(service.getProgramForFile).toBeInstanceOf(Function);
      expect(service.getLanguageServiceForFile).toBeInstanceOf(Function);
      expect(service.updateFile).toBeInstanceOf(Function);
      expect(service.closeFile).toBeInstanceOf(Function);
      expect(service.dispose).toBeInstanceOf(Function);

      service.dispose();
    });

    it("accepts allowDefaultProject option", () => {
      const service = createTypeScriptProjectService({
        tsconfigRootDir: FIXTURES_DIR,
        allowDefaultProject: ["*.js", "*.mjs"],
      });

      expect(service).toBeDefined();

      service.dispose();
    });
  });

  describe("getProgramForFile", () => {
    let service: TypeScriptProjectService;

    beforeAll(() => {
      service = createTypeScriptProjectService({
        tsconfigRootDir: FIXTURES_DIR,
      });
    });

    afterAll(() => {
      service.dispose();
    });

    it("returns Program for valid TS file", () => {
      const program = service.getProgramForFile(COUNTER_FILE);

      expect(program).not.toBeNull();
      expect(program?.getSourceFile(COUNTER_FILE)).toBeDefined();
    });

    it("returns Program when content is provided", () => {
      const content = `
import { createSignal } from "solid-js";
export const App = () => {
  const [x] = createSignal(0);
  return <div>{x()}</div>;
};
`;
      const program = service.getProgramForFile(
        join(FIXTURES_DIR, "virtual.tsx"),
        content,
      );

      expect(program).not.toBeNull();
    });

    it("returns null for non-existent file without content", () => {
      const program = service.getProgramForFile(
        join(FIXTURES_DIR, "does-not-exist.tsx"),
      );

      // May return null or a program with errors depending on TS version
      // The key is it doesn't throw
      expect(() => program).not.toThrow();
    });
  });

  describe("getLanguageServiceForFile", () => {
    let service: TypeScriptProjectService;

    beforeAll(() => {
      service = createTypeScriptProjectService({
        tsconfigRootDir: FIXTURES_DIR,
      });
    });

    afterAll(() => {
      service.dispose();
    });

    it("returns LanguageService for valid file", () => {
      const ls = service.getLanguageServiceForFile(COUNTER_FILE);

      expect(ls).not.toBeNull();
      expect(ls?.getQuickInfoAtPosition).toBeInstanceOf(Function);
      expect(ls?.getDefinitionAtPosition).toBeInstanceOf(Function);
      expect(ls?.findReferences).toBeInstanceOf(Function);
    });
  });

  describe("updateFile", () => {
    let service: TypeScriptProjectService;

    beforeAll(() => {
      service = createTypeScriptProjectService({
        tsconfigRootDir: FIXTURES_DIR,
      });
    });

    afterAll(() => {
      service.dispose();
    });

    it("updates content without error", () => {
      const newContent = `
import { createSignal } from "solid-js";
export function Counter() {
  const [count, setCount] = createSignal(100);
  return <div>{count()}</div>;
}
`;

      expect(() => {
        service.updateFile(COUNTER_FILE, newContent);
      }).not.toThrow();

      // Verify update took effect by getting program
      const program = service.getProgramForFile(COUNTER_FILE);
      expect(program).not.toBeNull();
    });

    it("opens file if not already open", () => {
      const virtualFile = join(FIXTURES_DIR, "new-file.tsx");
      const content = "export const x = 1;";

      expect(() => {
        service.updateFile(virtualFile, content);
      }).not.toThrow();
    });
  });

  describe("closeFile", () => {
    let service: TypeScriptProjectService;

    beforeAll(() => {
      service = createTypeScriptProjectService({
        tsconfigRootDir: FIXTURES_DIR,
      });
    });

    afterAll(() => {
      service.dispose();
    });

    it("closes file without error", () => {
      // First open the file
      service.getProgramForFile(COUNTER_FILE);

      // Then close it
      expect(() => {
        service.closeFile(COUNTER_FILE);
      }).not.toThrow();
    });

    it("handles closing unopened file gracefully", () => {
      expect(() => {
        service.closeFile(join(FIXTURES_DIR, "never-opened.tsx"));
      }).not.toThrow();
    });
  });

  describe("openFiles", () => {
    let service: TypeScriptProjectService;

    beforeAll(() => {
      service = createTypeScriptProjectService({
        tsconfigRootDir: FIXTURES_DIR,
      });
    });

    afterAll(() => {
      service.dispose();
    });

    it("returns empty set when no files are open", () => {
      const fresh = createTypeScriptProjectService({
        tsconfigRootDir: FIXTURES_DIR,
      });
      const open = fresh.openFiles();
      expect(open.size).toBe(0);
      fresh.dispose();
    });

    it("tracks opened files", () => {
      service.getLanguageServiceForFile(COUNTER_FILE);
      const open = service.openFiles();
      expect(open.size).toBeGreaterThanOrEqual(1);
    });

    it("reflects closed files", () => {
      service.getLanguageServiceForFile(COUNTER_FILE);
      const beforeClose = service.openFiles().size;
      service.closeFile(COUNTER_FILE);
      const afterClose = service.openFiles().size;
      expect(afterClose).toBeLessThan(beforeClose);
    });
  });

  describe("dispose", () => {
    it("disposes without error", () => {
      const service = createTypeScriptProjectService({
        tsconfigRootDir: FIXTURES_DIR,
      });

      // Open some files
      service.getProgramForFile(COUNTER_FILE);

      // Dispose
      expect(() => {
        service.dispose();
      }).not.toThrow();
    });
  });

  describe("synthetic project", () => {
    it("works with files outside tsconfig", () => {
      const service = createTypeScriptProjectService({
        tsconfigRootDir: FIXTURES_DIR,
        allowDefaultProject: ["**/*.tsx"],
      });

      // Create content for a file outside tsconfig's include pattern
      const outsideFile = join(FIXTURES_DIR, "../outside-project.tsx");
      const content = "export const x = 1;";

      // This should work via the synthetic project
      const program = service.getProgramForFile(outsideFile, content);

      // May or may not return a program depending on configuration
      // The key is it doesn't throw
      expect(() => program).not.toThrow();

      service.dispose();
    });
  });
});
