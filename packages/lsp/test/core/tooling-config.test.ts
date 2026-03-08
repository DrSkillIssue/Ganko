/**
 * Tooling Config Detection Tests
 *
 * Verifies that isToolingConfig() and classifyFile() correctly identify
 * tooling config files (eslint.config.mjs, vite.config.ts, etc.) and
 * classify them as "unknown" despite having supported extensions.
 *
 * These tests exist to prevent the infinite loop regression where
 * eslint.config.mjs was classified as a "solid" file, entered the
 * file index, and caused a re-diagnose → config reload cycle.
 */
import { describe, it, expect } from "vitest";
import { isToolingConfig, classifyFile } from "@drskillissue/ganko-shared";

const CONFIG_FILES = [
  "eslint.config.mjs",
  "eslint.config.js",
  "eslint.config.ts",
  "eslint.config.cjs",
  "eslint.config.mts",
  "eslint.config.cts",
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mts",
  "vitest.config.ts",
  "vitest.config.mts",
  "webpack.config.js",
  "webpack.config.cjs",
  "rollup.config.js",
  "rollup.config.mjs",
  "tailwind.config.ts",
  "tailwind.config.js",
  "postcss.config.js",
  "postcss.config.cjs",
  "jest.config.ts",
  "jest.config.js",
  "tsup.config.ts",
  "unocss.config.ts",
  "drizzle.config.ts",
  "playwright.config.ts",
  "nuxt.config.ts",
  "next.config.js",
  "next.config.mjs",
  "svelte.config.js",
  "astro.config.mjs",
] as const;

const SETUP_FILES = [
  "vitest.setup.ts",
  "vitest.setup.mts",
  "jest.setup.ts",
  "jest.setup.js",
  "test.setup.ts",
  "testing.setup.js",
] as const;

const SOURCE_FILES = [
  "index.ts",
  "App.tsx",
  "component.jsx",
  "utils.js",
  "helper.mjs",
  "module.cjs",
  "types.mts",
  "constants.cts",
  "styles.css",
  "theme.scss",
] as const;

describe("isToolingConfig", () => {
  describe("matches tooling config files", () => {
    it.each(CONFIG_FILES)("matches bare basename: %s", (file) => {
      expect(isToolingConfig(file)).toBe(true);
    });

    it("matches with unix directory prefix", () => {
      expect(isToolingConfig("/home/user/project/eslint.config.mjs")).toBe(true);
    });

    it("matches with windows directory prefix", () => {
      expect(isToolingConfig("C:\\Users\\project\\eslint.config.mjs")).toBe(true);
    });

    it("matches deeply nested paths", () => {
      expect(isToolingConfig("/a/b/c/d/vite.config.ts")).toBe(true);
    });
  });

  describe("matches setup files", () => {
    it.each(SETUP_FILES)("matches setup file: %s", (file) => {
      expect(isToolingConfig(file)).toBe(true);
    });
  });

  describe("does not match source files", () => {
    it.each(SOURCE_FILES)("rejects source file: %s", (file) => {
      expect(isToolingConfig(file)).toBe(false);
    });
  });

  describe("does not match non-script config files", () => {
    it("rejects .json config files", () => {
      expect(isToolingConfig("tsconfig.json")).toBe(false);
    });

    it("rejects .yaml config files", () => {
      expect(isToolingConfig("eslint.config.yaml")).toBe(false);
    });

    it("rejects dotfiles", () => {
      expect(isToolingConfig(".eslintrc.js")).toBe(false);
    });
  });

  describe("does not match files with config-like names but wrong structure", () => {
    it("rejects 'config.ts' without a prefix", () => {
      expect(isToolingConfig("config.ts")).toBe(false);
    });

    it("rejects 'setup.ts' without a prefix", () => {
      expect(isToolingConfig("setup.ts")).toBe(false);
    });

    it("rejects files that contain 'config' as a directory segment", () => {
      expect(isToolingConfig("/config/index.ts")).toBe(false);
    });
  });
});

describe("classifyFile", () => {
  describe("tooling configs classified as unknown", () => {
    it("eslint.config.mjs → unknown (regression: was 'solid')", () => {
      expect(classifyFile("eslint.config.mjs")).toBe("unknown");
    });

    it("vite.config.ts → unknown", () => {
      expect(classifyFile("vite.config.ts")).toBe("unknown");
    });

    it("vitest.setup.ts → unknown", () => {
      expect(classifyFile("vitest.setup.ts")).toBe("unknown");
    });

    it("nested eslint.config.mjs → unknown", () => {
      expect(classifyFile("/home/user/project/eslint.config.mjs")).toBe("unknown");
    });

    it("tailwind.config.js → unknown", () => {
      expect(classifyFile("tailwind.config.js")).toBe("unknown");
    });
  });

  describe("source files still classified correctly", () => {
    it("index.ts → solid", () => {
      expect(classifyFile("index.ts")).toBe("solid");
    });

    it("App.tsx → solid", () => {
      expect(classifyFile("App.tsx")).toBe("solid");
    });

    it("module.mjs → solid", () => {
      expect(classifyFile("module.mjs")).toBe("solid");
    });

    it("styles.css → css", () => {
      expect(classifyFile("styles.css")).toBe("css");
    });

    it("theme.scss → css", () => {
      expect(classifyFile("theme.scss")).toBe("css");
    });

    it("types.d.ts → unknown", () => {
      expect(classifyFile("types.d.ts")).toBe("unknown");
    });

    it("README.md → unknown", () => {
      expect(classifyFile("README.md")).toBe("unknown");
    });
  });
});
