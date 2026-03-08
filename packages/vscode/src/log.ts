/**
 * OutputChannel-backed logger implementing the shared Logger interface.
 *
 * Supports runtime level changes via `setLevel()` so that the
 * config change handler can react to `solid.logLevel` without a restart.
 */
import type { OutputChannel } from "vscode";
import { createLogger as createSharedLogger } from "@ganko/shared";
import type { LeveledLogger, LogLevel, LogWriter } from "@ganko/shared";

export type { Logger, LeveledLogger } from "@ganko/shared";

/** Create a leveled logger backed by a VS Code OutputChannel. */
export function createLogger(channel: OutputChannel, level: LogLevel = "info"): LeveledLogger {
  function stamp(tag: string, message: string): string {
    return `${new Date().toISOString()} [${tag}] ${message}`;
  }

  const writer: LogWriter = {
    trace(message: string) { channel.appendLine(stamp("TRACE", message)); },
    debug(message: string) { channel.appendLine(stamp("DEBUG", message)); },
    info(message: string) { channel.appendLine(stamp("INFO", message)); },
    warning(message: string) { channel.appendLine(stamp("WARNING", message)); },
    error(message: string) { channel.appendLine(stamp("ERROR", message)); },
    critical(message: string) { channel.appendLine(stamp("CRITICAL", message)); },
  };
  return createSharedLogger(writer, level);
}
