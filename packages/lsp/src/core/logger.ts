/**
 * Logger — LSP and CLI backends for the shared Logger interface.
 *
 * The Logger interface itself lives in @drskillissue/ganko-shared so that ganko
 * can log without depending on ganko. This module provides the
 * environment-specific backends:
 * - LSP mode: routes through connection.console → VS Code Output panel
 * - CLI mode: routes through process.stderr (keeps stdout for lint output)
 *
 * Both factories accept a LogLevel threshold. Messages below the threshold
 * are silently dropped. Both loggers support runtime level changes via
 * `setLevel()` so the server can react to workspace/didChangeConfiguration.
 */
import type { Connection } from "vscode-languageserver/node";
export type { Logger, LeveledLogger } from "@drskillissue/ganko-shared";
export { noopLogger } from "@drskillissue/ganko-shared";
import { createLogger } from "@drskillissue/ganko-shared";
import type { LeveledLogger, LogLevel, LogWriter } from "@drskillissue/ganko-shared";

/**
 * Create a logger backed by the LSP connection's RemoteConsole.
 *
 * Messages appear in the VS Code "Solid Language Server" output channel.
 * Trace/debug messages use `connection.console.log` since RemoteConsole
 * has no trace/debug level — they're prefixed with `[trace]`/`[debug]`.
 *
 * The returned logger exposes `setLevel()` so that the server can
 * update the threshold when initializationOptions or
 * didChangeConfiguration arrive.
 */
export function createLspLogger(connection: Connection, level: LogLevel = "info"): LeveledLogger {
  const writer: LogWriter = {
    trace(message: string) { connection.console.log(`[trace] ${message}`); },
    debug(message: string) { connection.console.log(`[debug] ${message}`); },
    info(message: string) { connection.console.info(message); },
    warning(message: string) { connection.console.warn(message); },
    error(message: string) { connection.console.error(message); },
    critical(message: string) { connection.console.error(`[CRITICAL] ${message}`); },
  };
  return createLogger(writer, level);
}

/**
 * Create a logger that writes to stderr.
 *
 * Used by the CLI lint command where stdout is reserved for
 * diagnostic output (text or JSON).
 */
export function createCliLogger(level: LogLevel = "info"): LeveledLogger {
  function write(tag: string, message: string): void {
    process.stderr.write(`${new Date().toISOString()} [${tag}] ${message}\n`);
  }

  const writer: LogWriter = {
    trace(message: string) { write("trace", message); },
    debug(message: string) { write("debug", message); },
    info(message: string) { write("info", message); },
    warning(message: string) { write("warning", message); },
    error(message: string) { write("error", message); },
    critical(message: string) { write("CRITICAL", message); },
  };
  return createLogger(writer, level);
}
