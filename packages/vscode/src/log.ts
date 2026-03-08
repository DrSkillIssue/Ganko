/**
 * LogOutputChannel-backed logger implementing the shared Logger interface.
 *
 * Uses VS Code's native LogOutputChannel which provides level-aware methods,
 * automatic timestamps, and user-controlled log level via the command palette
 * (Developer: Set Log Level).
 *
 * Supports runtime level changes via `setLevel()` so that the config change
 * handler can react to `solid.logLevel` without a restart.
 */
import type { LogOutputChannel } from "vscode";
import { createLogger as createSharedLogger } from "@drskillissue/ganko-shared";
import type { LeveledLogger, LogLevel, LogWriter } from "@drskillissue/ganko-shared";

export type { Logger, LeveledLogger } from "@drskillissue/ganko-shared";

/** Create a leveled logger backed by a VS Code LogOutputChannel. */
export function createLogger(channel: LogOutputChannel, level: LogLevel = "info"): LeveledLogger {
  const writer: LogWriter = {
    trace(message: string) { channel.trace(message); },
    debug(message: string) { channel.debug(message); },
    info(message: string) { channel.info(message); },
    warning(message: string) { channel.warn(message); },
    error(message: string) { channel.error(message); },
    critical(message: string) { channel.error(`[CRITICAL] ${message}`); },
  };
  return createSharedLogger(writer, level);
}
