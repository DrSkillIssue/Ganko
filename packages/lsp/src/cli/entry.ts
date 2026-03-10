/**
 * ganko CLI entry point.
 *
 * Dispatches to the language server (stdio) or the lint subcommand.
 * Built by tsup as a separate CJS entry — all bundled deps use require().
 */
import { getVersion } from "./daemon-protocol";

const HELP = `ganko - Solid.js Language Server & Linter

Usage:
  ganko                          Start in stdio mode (default)
  ganko --stdio                  Explicit stdio mode
  ganko lint [files] [options]   Lint project or specific files
  ganko daemon <command>         Manage the background daemon
  ganko --version                Print version
  ganko --help                   Print this help

Lint Options:
  --format <text|json>     Output format (default: text)
  --no-cross-file          Skip cross-file analysis
  --eslint-config <path>   Path to ESLint config file
  --no-eslint-config       Skip reading ESLint config
  --max-warnings <n>       Exit with error if warnings exceed n
  --exclude <glob>         Glob pattern to exclude (repeatable)
  --no-daemon              Skip daemon, run analysis in-process
  --log-level <level>      Log level: trace, debug, info, warning, error, critical, off (default: off)
  --log-file <path>        Write logs to file (in addition to stderr)
  --verbose, -v            Shorthand for --log-level debug

Daemon Commands:
  ganko daemon start             Start the background daemon
  ganko daemon stop              Stop the background daemon
  ganko daemon status            Show daemon status

  --project-root <path>    Project root (default: auto-detected)

Server Options:
  --log-file <path>        Write server logs to file (for debugging)

The daemon keeps the TypeScript project service warm between lint runs,
eliminating the startup cost on repeated invocations.

The language server communicates via JSON-RPC over stdio.
Configure your editor to use this as an external language server.`;

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

if (args.includes("--version")) {
  console.log(`ganko ${getVersion()}`);
  process.exit(0);
}

async function runDaemonCommand(subArgs: readonly string[]): Promise<void> {
  const command = subArgs[0];
  let projectRoot: string | undefined;
  for (let i = 1; i < subArgs.length; i++) {
    if (subArgs[i] === "--project-root" && subArgs[i + 1] !== undefined) {
      projectRoot = subArgs[i + 1];
      i++;
    }
  }
  const root = projectRoot ?? process.cwd();

  if (command === "start") {
    const { startDaemon } = await import("./daemon");
    await startDaemon(root);
    return;
  }

  if (command === "stop") {
    const { stopDaemon } = await import("./daemon-client");
    const stopped = await stopDaemon(root);
    if (stopped) {
      console.log("Daemon stopped.");
    } else {
      console.log("No daemon running.");
    }
    process.exit(0);
  }

  if (command === "status") {
    const { probeDaemon, requestStatus } = await import("./daemon-client");
    const socket = await probeDaemon(root);
    if (socket === null) {
      console.log("No daemon running.");
      process.exit(1);
    }
    const response = await requestStatus(socket);
    socket.destroy();
    if (response.kind === "status-response") {
      const uptimeSec = Math.round(response.uptime / 1000);
      console.log(`Daemon running (v${response.version}, uptime: ${uptimeSec}s, root: ${response.projectRoot})`);
      process.exit(0);
    }
    console.log("Daemon running but returned unexpected response.");
    process.exit(0);
  }

  process.stderr.write(`Unknown daemon command: ${command ?? "(none)"}. Use: start, stop, status.\n`);
  process.exit(2);
}

async function run(): Promise<void> {
  if (args[0] === "lint") {
    const { runLint } = await import("./lint");
    await runLint(args.slice(1));
  } else if (args[0] === "daemon") {
    await runDaemonCommand(args.slice(1));
  } else {
    const { main } = await import("../server/connection");
    main();
  }
}

void run().catch((err) => {
  process.stderr.write(`ganko: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
