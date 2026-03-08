/**
 * Bump the unified version across all package.json files.
 *
 * Usage:
 *   bun run version:bump 0.2.0
 *   bun run version:bump patch   # 0.1.0 → 0.1.1
 *   bun run version:bump minor   # 0.1.0 → 0.2.0
 *   bun run version:bump major   # 0.1.0 → 1.0.0
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PACKAGE_DIRS = ["packages/ganko", "packages/lsp", "packages/shared", "packages/vscode"];

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path: string, data: Record<string, unknown>): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function bumpVersion(current: string, bump: string): string {
  const [major, minor, patch] = current.split(".").map(Number);
  switch (bump) {
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "major":
      return `${major + 1}.0.0`;
    default:
      // Explicit version string — validate format
      if (!/^\d+\.\d+\.\d+$/.test(bump)) {
        throw new Error(`Invalid version: "${bump}". Use semver (e.g. 0.2.0) or patch/minor/major.`);
      }
      return bump;
  }
}

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: bun run version:bump <patch|minor|major|x.y.z>");
  process.exit(1);
}

const root = resolve(import.meta.dirname, "..");
const rootPkg = readJson(resolve(root, "packages/ganko/package.json"));
const currentVersion = rootPkg.version as string;
const nextVersion = bumpVersion(currentVersion, arg);

console.log(`${currentVersion} → ${nextVersion}`);

for (const dir of PACKAGE_DIRS) {
  const pkgPath = resolve(root, dir, "package.json");
  const pkg = readJson(pkgPath);
  pkg.version = nextVersion;
  writeJson(pkgPath, pkg);
  console.log(`  ${dir}/package.json`);
}

console.log(`\nDone. Run: git add -A && git commit -m "v${nextVersion}" && git tag v${nextVersion}`);
