import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { readTsConfig } from "../../src/core/tsconfig";

describe("readTsConfig", () => {
  it("reads compiler options and file names from the project tsconfig", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ganko-tsconfig-test-"));
    try {
      writeFileSync(join(tempDir, "tsconfig.json"), JSON.stringify({
        compilerOptions: {
          strict: true,
          jsx: "react-jsx",
        },
        include: ["src/**/*.tsx"],
      }));
      mkdirSync(join(tempDir, "src"));
      writeFileSync(join(tempDir, "src", "App.tsx"), "export const App = () => <div />;\n");

      const result = readTsConfig(tempDir);

      expect(result.tsconfigPath).toBe(join(tempDir, "tsconfig.json"));
      expect(result.directory).toBe(tempDir);
      expect(result.fileNames).toContain(join(tempDir, "src", "App.tsx"));
      expect(result.options.strict).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("uses the explicit tsconfig path relative to its own directory", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ganko-tsconfig-test-"));
    try {
      const packageDir = join(tempDir, "packages", "app");
      mkdirSync(join(packageDir, "src"), { recursive: true });
      writeFileSync(join(packageDir, "src", "index.ts"), "export const value = 1;\n");
      writeFileSync(join(packageDir, "tsconfig.json"), JSON.stringify({
        compilerOptions: {
          strict: true,
        },
        include: ["src/**/*.ts"],
      }));

      const result = readTsConfig(tempDir, join(packageDir, "tsconfig.json"));

      expect(result.tsconfigPath).toBe(join(packageDir, "tsconfig.json"));
      expect(result.directory).toBe(packageDir);
      expect(result.fileNames).toEqual([join(packageDir, "src", "index.ts")]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws when no tsconfig exists", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ganko-tsconfig-test-"));
    try {
      expect(() => readTsConfig(tempDir)).toThrow(`No tsconfig.json found in ${tempDir}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws a parse error for invalid tsconfig JSON", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ganko-tsconfig-test-"));
    try {
      writeFileSync(join(tempDir, "tsconfig.json"), "{ invalid json }");

      expect(() => readTsConfig(tempDir)).toThrow(`Failed to read ${join(tempDir, "tsconfig.json")}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
