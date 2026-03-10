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
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
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

  describe("symlink handling", () => {
    it("follows symlinked files to their real path", () => {
      const root = createTempProject({
        "src/App.tsx": "export default function App() { return <div />; }",
      });
      /* Create a file outside src/ and symlink it into src/.
         canonicalPath resolves symlinks, so the real path is indexed. */
      mkdirSync(join(root, "lib"), { recursive: true });
      writeFileSync(join(root, "lib/utils.ts"), "export const x = 1;");
      symlinkSync(join(root, "lib/utils.ts"), join(root, "src/linked-utils.ts"));

      const index = createFileIndex(root);
      const names = fileNames(index.solidFiles);

      expect(names).toContain("App.tsx");
      /* The real file is found via both the direct scan and the symlink.
         canonicalPath deduplicates to the real path. */
      expect(names).toContain("utils.ts");
      expect(index.solidFiles.size).toBe(2);
    });

    it("follows symlinked directories", () => {
      const root = createTempProject({
        "src/App.tsx": "<div />",
        "external/components/Button.tsx": "<button />",
      });
      symlinkSync(join(root, "external/components"), join(root, "src/components"));

      const index = createFileIndex(root);
      const names = fileNames(index.solidFiles);

      expect(names).toContain("App.tsx");
      expect(names).toContain("Button.tsx");
    });

    it("handles broken symlinks gracefully", () => {
      const root = createTempProject({
        "src/App.tsx": "<div />",
      });
      symlinkSync(join(root, "nonexistent.tsx"), join(root, "src/broken-link.tsx"));

      const index = createFileIndex(root);
      const names = fileNames(index.solidFiles);

      expect(names).toContain("App.tsx");
      expect(names).not.toContain("broken-link.tsx");
    });

    it("prevents symlink cycles", () => {
      const root = createTempProject({
        "src/App.tsx": "<div />",
      });
      /* Create a cycle: src/loop → src */
      symlinkSync(join(root, "src"), join(root, "src/loop"));

      const index = createFileIndex(root);
      const names = fileNames(index.solidFiles);

      expect(names).toContain("App.tsx");
      /* Should not hang or crash — cycle is detected and skipped. */
    });
  });

  describe("gitignore support", () => {
    it("respects root .gitignore patterns", () => {
      const root = createTempProject({
        ".gitignore": "generated/\n",
        "src/App.tsx": "<div />",
        "generated/output.ts": "export const x = 1;",
      });

      const index = createFileIndex(root);
      const names = fileNames(index.solidFiles);

      expect(names).toContain("App.tsx");
      expect(names).not.toContain("output.ts");
    });

    it("respects nested .gitignore files", () => {
      const root = createTempProject({
        "src/App.tsx": "<div />",
        "packages/ui/src/Button.tsx": "<button />",
        "packages/ui/.gitignore": "*.generated.ts\n",
        "packages/ui/src/types.generated.ts": "export type X = string;",
      });

      const index = createFileIndex(root);
      const names = fileNames(index.solidFiles);

      expect(names).toContain("App.tsx");
      expect(names).toContain("Button.tsx");
      expect(names).not.toContain("types.generated.ts");
    });

    it("handles negation patterns", () => {
      const root = createTempProject({
        ".gitignore": "*.generated.ts\n!important.generated.ts\n",
        "src/types.generated.ts": "export type X = string;",
        "src/important.generated.ts": "export const KEEP = true;",
        "src/App.tsx": "<div />",
      });

      const index = createFileIndex(root);
      const names = fileNames(index.solidFiles);

      expect(names).toContain("App.tsx");
      expect(names).toContain("important.generated.ts");
      expect(names).not.toContain("types.generated.ts");
    });

    it("handles directory-only patterns (trailing slash)", () => {
      const root = createTempProject({
        ".gitignore": "temp/\n",
        "src/App.tsx": "<div />",
        "temp/scratch.ts": "export const x = 1;",
        /* A file named 'temp' (not a directory) should NOT be ignored */
      });
      writeFileSync(join(root, "src/temp"), "not a directory");

      const index = createFileIndex(root);
      const names = fileNames(index.solidFiles);

      expect(names).toContain("App.tsx");
      expect(names).not.toContain("scratch.ts");
    });

    it("handles comments and blank lines in .gitignore", () => {
      const root = createTempProject({
        ".gitignore": "# This is a comment\n\nignored.ts\n\n# Another comment\n",
        "src/App.tsx": "<div />",
        "src/ignored.ts": "export const x = 1;",
        "src/kept.ts": "export const y = 2;",
      });

      const index = createFileIndex(root);
      const names = fileNames(index.solidFiles);

      expect(names).toContain("App.tsx");
      expect(names).toContain("kept.ts");
      expect(names).not.toContain("ignored.ts");
    });

    it("gitignore patterns do not override explicit exclude patterns", () => {
      const root = createTempProject({
        ".gitignore": "!src/excluded.ts\n",
        "src/App.tsx": "<div />",
        "src/excluded.ts": "export const x = 1;",
      });

      const index = createFileIndex(root, ["**/excluded.ts"]);
      const names = fileNames(index.solidFiles);

      expect(names).toContain("App.tsx");
      /* Explicit excludes take priority — the file is excluded even though
         gitignore tries to negate it. */
      expect(names).not.toContain("excluded.ts");
    });

    it("works when no .gitignore exists", () => {
      const root = createTempProject({
        "src/App.tsx": "<div />",
        "src/utils.ts": "export const x = 1;",
      });

      const index = createFileIndex(root);
      const names = fileNames(index.solidFiles);

      expect(names).toContain("App.tsx");
      expect(names).toContain("utils.ts");
    });
  });
});
