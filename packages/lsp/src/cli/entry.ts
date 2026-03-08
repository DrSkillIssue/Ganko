/**
 * ganko CLI entry point.
 *
 * Dispatches to the language server (stdio) or the lint subcommand.
 * Built by tsup as a separate entry — no unbundled JS shim needed.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HELP = `ganko - Solid.js Language Server & Linter

Usage:
  ganko                          Start in stdio mode (default)
  ganko --stdio                  Explicit stdio mode
  ganko lint [files] [options]   Lint project or specific files
  ganko --version                Print version
  ganko --help                   Print this help

Lint Options:
  --format <text|json>     Output format (default: text)
  --no-cross-file          Skip cross-file analysis
  --eslint-config <path>   Path to ESLint config file
  --no-eslint-config       Skip reading ESLint config
  --max-warnings <n>       Exit with error if warnings exceed n
  --exclude <glob>         Glob pattern to exclude (repeatable)
  --log-level <level>      Log level: trace, debug, info, warning, error, critical, off (default: off)
  --verbose, -v            Shorthand for --log-level debug

The language server communicates via JSON-RPC over stdio.
Configure your editor to use this as an external language server.`;

function getVersion(): string {
  const selfDir = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(selfDir, "..", "package.json");
  const raw = readFileSync(pkgPath, "utf-8");
  const pkg: { version: string } = JSON.parse(raw);
  return pkg.version;
}

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

if (args.includes("--version")) {
  console.log(`ganko ${getVersion()}`);
  process.exit(0);
}

if (args[0] === "lint") {
  const { runLint } = await import("./lint");
  await runLint(args.slice(1));
} else {
  const { main } = await import("../server/connection");
  main();
}
