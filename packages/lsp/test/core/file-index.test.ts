/**
 * File Index Integration Tests
 *
 * Verifies that createFileIndex() correctly excludes tooling config
 * files from the solid and CSS file sets. This is the primary
 * regression test for the infinite loop where eslint.config.mjs
 * entered the file index as a "solid" file, triggering a
 * re-diagnose → config reload → re-diagnose cycle.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFileIndex } from "../../src/core/file-index";

describe("createFileIndex", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  function createTempProject(files: Record<string, string>): string {
    tempDir = mkdtempSync(join(tmpdir(), "ganko-fileindex-test-"));
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = join(tempDir, relativePath);
      const dir = filePath.substring(0, filePath.lastIndexOf("/"));
      if (dir !== tempDir) mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, content);
    }
    return tempDir;
  }

  function fileNames(paths: ReadonlySet<string>): string[] {
    return [...paths].map((p) => {
      const slash = p.lastIndexOf("/");
      return slash >= 0 ? p.substring(slash + 1) : p;
    });
  }

  describe("tooling config exclusion (infinite loop regression)", () => {
    it("excludes eslint.config.mjs from solidFiles", () => {
      const root = createTempProject({
        "src/App.tsx": "export default function App() { return <div />; }",
        "src/utils.ts": "export const x = 1;",
        "eslint.config.mjs": "export default [];",
      });

      const index = createFileIndex(root);

      const names = fileNames(index.solidFiles);
      expect(names).toContain("App.tsx");
      expect(names).toContain("utils.ts");
      expect(names).not.toContain("eslint.config.mjs");
    });

    it("excludes eslint.config.ts from solidFiles", () => {
      const root = createTempProject({
        "index.ts": "console.log('hello');",
        "eslint.config.ts": "export default [];",
      });

      const index = createFileIndex(root);

      const names = fileNames(index.solidFiles);
      expect(names).toContain("index.ts");
      expect(names).not.toContain("eslint.config.ts");
    });

    it("excludes vite.config.ts from solidFiles", () => {
      const root = createTempProject({
        "src/main.tsx": "render(() => <App />, document.getElementById('root'));",
        "vite.config.ts": "import { defineConfig } from 'vite'; export default defineConfig({});",
      });

      const index = createFileIndex(root);

      const names = fileNames(index.solidFiles);
      expect(names).toContain("main.tsx");
      expect(names).not.toContain("vite.config.ts");
    });

    it("excludes vitest.config.mts from solidFiles", () => {
      const root = createTempProject({
        "src/lib.ts": "export const add = (a: number, b: number) => a + b;",
        "vitest.config.mts": "export default {};",
      });

      const index = createFileIndex(root);

      expect(fileNames(index.solidFiles)).not.toContain("vitest.config.mts");
    });

    it("excludes vitest.setup.ts from solidFiles", () => {
      const root = createTempProject({
        "src/lib.ts": "export const x = 1;",
        "vitest.setup.ts": "import '@testing-library/jest-dom';",
      });

      const index = createFileIndex(root);

      expect(fileNames(index.solidFiles)).not.toContain("vitest.setup.ts");
    });

    it("excludes multiple config files simultaneously", () => {
      const root = createTempProject({
        "src/App.tsx": "<div />",
        "src/index.ts": "export {};",
        "eslint.config.mjs": "export default [];",
        "vite.config.ts": "export default {};",
        "vitest.config.ts": "export default {};",
        "tailwind.config.js": "module.exports = {};",
        "postcss.config.cjs": "module.exports = {};",
        "tsup.config.ts": "export default {};",
        "vitest.setup.ts": "import '@testing-library/jest-dom';",
      });

      const index = createFileIndex(root);

      const names = fileNames(index.solidFiles);
      expect(names).toContain("App.tsx");
      expect(names).toContain("index.ts");
      expect(names).toHaveLength(2);
    });

    it("excludes nested config files in subdirectories", () => {
      const root = createTempProject({
        "src/App.tsx": "<div />",
        "packages/ui/vite.config.ts": "export default {};",
        "packages/ui/src/Button.tsx": "<button />",
      });

      const index = createFileIndex(root);

      const names = fileNames(index.solidFiles);
      expect(names).toContain("App.tsx");
      expect(names).toContain("Button.tsx");
      expect(names).not.toContain("vite.config.ts");
    });
  });

  describe("css files are not affected by config exclusion", () => {
    it("still indexes CSS files alongside excluded configs", () => {
      const root = createTempProject({
        "src/styles.css": "body { margin: 0; }",
        "src/theme.scss": "$color: red;",
        "postcss.config.js": "module.exports = {};",
      });

      const index = createFileIndex(root);

      const cssNames = fileNames(index.cssFiles);
      expect(cssNames).toContain("styles.css");
      expect(cssNames).toContain("theme.scss");
    });
  });

  describe("add/remove respects config exclusion", () => {
    it("add() rejects tooling config files", () => {
      const root = createTempProject({
        "src/App.tsx": "<div />",
      });

      const index = createFileIndex(root);
      index.add(join(root, "eslint.config.mjs"));

      expect(fileNames(index.solidFiles)).not.toContain("eslint.config.mjs");
    });

    it("add() still accepts source files", () => {
      const root = createTempProject({
        "src/App.tsx": "<div />",
      });

      const index = createFileIndex(root);
      index.add(join(root, "src/NewFile.ts"));

      expect(fileNames(index.solidFiles)).toContain("NewFile.ts");
    });
  });

  describe("allFiles() reflects exclusion", () => {
    it("config files do not appear in allFiles()", () => {
      const root = createTempProject({
        "src/App.tsx": "<div />",
        "src/styles.css": "body {}",
        "eslint.config.mjs": "export default [];",
        "vite.config.ts": "export default {};",
      });

      const index = createFileIndex(root);
      const all = index.allFiles();

      expect(all).toHaveLength(2);
      for (const file of all) {
        expect(file).not.toContain("config");
      }
    });
  });
});
