import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = resolve(import.meta.dirname, "..");
const packageDir = resolve(rootDir, "packages/ganko");
const distPluginPath = resolve(packageDir, "dist/eslint-plugin.js");

if (!existsSync(distPluginPath)) {
  throw new Error(`Missing built package artifact at ${distPluginPath}. Run the build first.`);
}

const tempDir = mkdtempSync(join(tmpdir(), "ganko-pack-smoke-"));

try {
  const packOutputDir = join(tempDir, "pack");
  const appDir = join(tempDir, "app");

  mkdirSync(packOutputDir, { recursive: true });
  mkdirSync(appDir, { recursive: true });

  run("npm", ["pack", "--pack-destination", packOutputDir], packageDir);

  const tarballName = readdirSync(packOutputDir).find((entry) => entry.endsWith(".tgz"));
  if (!tarballName) {
    throw new Error(`Failed to locate packed tarball in ${packOutputDir}`);
  }

  const tarballPath = join(packOutputDir, tarballName);

  writeFileSync(
    join(appDir, "package.json"),
    JSON.stringify(
      {
        name: "ganko-pack-smoke",
        private: true,
        type: "module",
      },
      null,
      2,
    ),
  );

  run(
    "npm",
    [
      "install",
      "--no-package-lock",
      "--no-fund",
      "--no-audit",
      // Temporary until @typescript-eslint/utils publishes TS 6-compatible peers.
      "--legacy-peer-deps",
      tarballPath,
      "eslint@10.0.3",
      "typescript@6.0.2",
    ],
    appDir,
  );

  const verifyScriptPath = join(appDir, "verify.mjs");
  writeFileSync(
    verifyScriptPath,
    [
      'import plugin from "@drskillissue/ganko/eslint-plugin";',
      'if (plugin.meta.name !== "eslint-plugin-ganko") throw new Error(`Unexpected plugin name: ${plugin.meta.name}`);',
      'if (typeof plugin.rules !== "object" || plugin.rules === null) throw new Error("Expected plugin rules to be present");',
      'if (!("recommended" in plugin.configs)) throw new Error("Expected recommended config to be present");',
      '',
    ].join("\n"),
  );

  run("node", [verifyScriptPath], appDir);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function run(command: string, args: readonly string[], cwd: string): void {
  const parentDir = dirname(cwd);
  if (!existsSync(parentDir)) {
    throw new Error(`Missing parent directory for command: ${parentDir}`);
  }

  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status ?? "unknown"}`);
  }
}
