/**
 * Logger — LSP and CLI backends for the shared Logger interface.
 *
 * The Logger interface itself lives in @drskillissue/ganko-shared so that ganko
 * can log without depending on ganko. This module provides the
 * environment-specific backends:
 * - LSP mode: routes through connection.console → VS Code Output panel
 * - CLI mode: routes through process.stderr (keeps stdout for lint output)
 * - File mode: appends to a file via write stream (for --log-file)
 * - Composite: fans out to multiple writers (e.g. stderr + file)
 *
 * Both factories accept a LogLevel threshold. Messages below the threshold
 * are silently dropped. Both loggers support runtime level changes via
 * `setLevel()` so the server can react to workspace/didChangeConfiguration.
 */
import { createWriteStream, type WriteStream } from "node:fs";
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
/**
 * Create a LogWriter backed by the LSP connection's RemoteConsole.
 *
 * Messages appear in the editor's output channel for the language server.
 */
export function createLspWriter(connection: Connection): LogWriter {
  return {
    trace(message: string) { connection.console.log(`[trace] ${message}`); },
    debug(message: string) { connection.console.log(`[debug] ${message}`); },
    info(message: string) { connection.console.info(message); },
    warning(message: string) { connection.console.warn(message); },
    error(message: string) { connection.console.error(message); },
    critical(message: string) { connection.console.error(`[CRITICAL] ${message}`); },
  };
}

export function createLspLogger(connection: Connection, level: LogLevel = "info"): LeveledLogger {
  return createLogger(createLspWriter(connection), level);
}

/**
 * Create a LogWriter that writes to stderr with ISO timestamps.
 *
 * Used as a building block for CLI logging. Combine with
 * `createCompositeWriter` and `createFileWriter` when `--log-file` is set.
 */
export function createStderrWriter(): LogWriter {
  function write(tag: string, message: string): void {
    process.stderr.write(`${new Date().toISOString()} [${tag}] ${message}\n`);
  }

  return {
    trace(message: string) { write("trace", message); },
    debug(message: string) { write("debug", message); },
    info(message: string) { write("info", message); },
    warning(message: string) { write("warning", message); },
    error(message: string) { write("error", message); },
    critical(message: string) { write("CRITICAL", message); },
  };
}

/**
 * Create a logger that writes to stderr.
 *
 * Used by the CLI lint command where stdout is reserved for
 * diagnostic output (text or JSON).
 */
export function createCliLogger(level: LogLevel = "info"): LeveledLogger {
  return createLogger(createStderrWriter(), level);
}

/**
 * Create a LogWriter that appends to a file via a write stream.
 *
 * Uses `fs.createWriteStream` with append mode to avoid synchronous I/O
 * latency on every log line. Call `close()` before process exit
 * to flush buffered writes.
 *
 * @param filePath - Absolute path to the log file
 * @returns The LogWriter and a close function that flushes and ends the stream
 */
export function createFileWriter(filePath: string): { writer: LogWriter; close: () => Promise<void> } {
  const stream: WriteStream = createWriteStream(filePath, { flags: "a" });

  function write(tag: string, message: string): void {
    stream.write(`${new Date().toISOString()} [${tag}] ${message}\n`);
  }

  const writer: LogWriter = {
    trace(message: string) { write("trace", message); },
    debug(message: string) { write("debug", message); },
    info(message: string) { write("info", message); },
    warning(message: string) { write("warning", message); },
    error(message: string) { write("error", message); },
    critical(message: string) { write("CRITICAL", message); },
  };

  function close(): Promise<void> {
    return new Promise((resolve) => {
      stream.end(() => { resolve(); });
    });
  }

  return { writer, close };
}

/**
 * Create a LogWriter that fans out each log call to multiple writers.
 *
 * @param writers - One or more LogWriter instances to delegate to
 * @returns A composite LogWriter
 */
export function createCompositeWriter(...writers: readonly LogWriter[]): LogWriter {
  return {
    trace(message: string) { for (const w of writers) w.trace(message); },
    debug(message: string) { for (const w of writers) w.debug(message); },
    info(message: string) { for (const w of writers) w.info(message); },
    warning(message: string) { for (const w of writers) w.warning(message); },
    error(message: string) { for (const w of writers) w.error(message); },
    critical(message: string) { for (const w of writers) w.critical(message); },
  };
}
