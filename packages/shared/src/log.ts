/** Canonical list of log level names, most verbose to least verbose. */
export const LOG_LEVELS = ["trace", "debug", "info", "warning", "error", "critical", "off"] as const;

/** String log level name — used for configuration, parsing, and display. */
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Numeric log level constants for hot-path level checks.
 *
 * Lower numbers are more verbose. Use with `isLevelEnabled`:
 *
 * ```ts
 * if (log.isLevelEnabled(Level.Debug)) log.debug(`rebuilt ${count} graphs`);
 * ```
 */
export const Level = {
  Trace: 0,
  Debug: 1,
  Info: 2,
  Warning: 3,
  Error: 4,
  Critical: 5,
  Off: 6,
} as const;

/** Numeric log level value (0–6). */
export type LevelValue = (typeof Level)[keyof typeof Level];

/** Numeric ordering for log levels — lower numbers are more verbose. */
export const LOG_LEVEL_ORDER: Readonly<Record<LogLevel, LevelValue>> = {
  trace: Level.Trace,
  debug: Level.Debug,
  info: Level.Info,
  warning: Level.Warning,
  error: Level.Error,
  critical: Level.Critical,
  off: Level.Off,
};

/**
 * Logger — shared logging interface for all packages.
 *
 * Levels match VS Code's LogLevel enum: Trace, Debug, Info, Warning, Error, Critical, Off.
 *
 * Backends are environment-specific (LSP connection, CLI stderr, noop for tests).
 * The interface lives here so ganko and @drskillissue/ganko-shared consumers can log
 * without depending on ganko.
 *
 * Use `isLevelEnabled` to guard expensive log argument computation:
 *
 * ```ts
 * if (log.isLevelEnabled(Level.Debug)) log.debug(`rebuilt ${count} graphs in ${elapsed}ms`);
 * ```
 *
 * This checks against the actual log level threshold — a single integer
 * comparison with no lookup table. Template literals and function calls
 * inside the guard are never evaluated when the level is disabled.
 */
export interface Logger {
  /** The active log level threshold. Messages below this level are suppressed. */
  readonly level: LogLevel
  /** Check whether a specific level would produce output at the current threshold. */
  isLevelEnabled(level: LevelValue): boolean
  trace(message: string): void
  debug(message: string): void
  info(message: string): void
  warning(message: string): void
  error(message: string, err?: Error): void
  critical(message: string, err?: Error): void
}

/** Logger with a mutable level threshold for runtime configuration. */
export interface LeveledLogger extends Logger {
  /** Update the minimum severity at runtime. */
  setLevel(level: LogLevel): void
}

/** Silent logger for tests and contexts where logging is unwanted. */
export const noopLogger: LeveledLogger = {
  level: "off",
  isLevelEnabled() { return false; },
  trace() {},
  debug() {},
  info() {},
  warning() {},
  error() {},
  critical() {},
  setLevel() {},
};

/**
 * Validate a raw string into a LogLevel, falling back if unrecognized.
 *
 * @param raw - Candidate log level string (e.g. from VS Code settings or CLI args)
 * @param fallback - Level to use when `raw` is not a valid LogLevel
 * @returns Validated LogLevel
 */
export function parseLogLevel(raw: string, fallback: LogLevel): LogLevel {
  return LOG_LEVEL_LOOKUP[raw] ?? fallback;
}

const LOG_LEVEL_LOOKUP: Readonly<Record<string, LogLevel>> = {
  trace: "trace",
  debug: "debug",
  info: "info",
  warning: "warning",
  error: "error",
  critical: "critical",
  off: "off",
};

/**
 * Format an Error for logging output.
 *
 * Prefers the stack trace (includes the message) when available,
 * otherwise falls back to the message alone. Returns empty string
 * for undefined input.
 *
 * @param err - Error to format, or undefined
 * @returns Formatted error string, or empty string if err is undefined
 */
export function formatError(err: Error | undefined): string {
  if (err === undefined) return "";
  return err.stack ?? err.message;
}

/**
 * Create a read-only Logger that prepends a tag to every message.
 *
 * Delegates all calls to the underlying logger — `isLevelEnabled` and
 * `level` reflect the underlying logger's state, so `setLevel()` on
 * the root propagates automatically.
 *
 * @param logger - Underlying logger to delegate to
 * @param prefix - Component name (e.g. "analyzer", "gc", "memory")
 * @returns A Logger that prepends `[prefix] ` to all messages
 */
export function prefixLogger(logger: Logger, prefix: string): Logger {
  const tag = `[${prefix}] `;
  return {
    get level() { return logger.level; },
    isLevelEnabled(level: LevelValue) { return logger.isLevelEnabled(level); },
    trace(message: string) { logger.trace(tag + message); },
    debug(message: string) { logger.debug(tag + message); },
    info(message: string) { logger.info(tag + message); },
    warning(message: string) { logger.warning(tag + message); },
    error(message: string, err?: Error) { logger.error(tag + message, err); },
    critical(message: string, err?: Error) { logger.critical(tag + message, err); },
  };
}

/** Adapter for environment-specific log output. */
export interface LogWriter {
  trace(message: string): void
  debug(message: string): void
  info(message: string): void
  warning(message: string): void
  error(message: string): void
  critical(message: string): void
}

/**
 * Create a LeveledLogger that delegates output to a LogWriter.
 *
 * @param writer - Environment-specific output adapter
 * @param level - Initial minimum severity threshold
 * @returns A LeveledLogger with runtime-adjustable level
 */
export function createLogger(writer: LogWriter, level: LogLevel = "info"): LeveledLogger {
  let threshold = LOG_LEVEL_ORDER[level];
  let currentLevel = level;
  return {
    get level() { return currentLevel; },
    isLevelEnabled(target: LevelValue) { return threshold <= target; },
    setLevel(next: LogLevel) { threshold = LOG_LEVEL_ORDER[next]; currentLevel = next; },
    trace(message: string) { if (threshold <= Level.Trace) writer.trace(message); },
    debug(message: string) { if (threshold <= Level.Debug) writer.debug(message); },
    info(message: string) { if (threshold <= Level.Info) writer.info(message); },
    warning(message: string) { if (threshold <= Level.Warning) writer.warning(message); },
    error(message: string, err?: Error) {
      if (threshold <= Level.Error) {
        writer.error(err !== undefined ? `${message}: ${formatError(err)}` : message);
      }
    },
    critical(message: string, err?: Error) {
      if (threshold <= Level.Critical) {
        writer.critical(err !== undefined ? `${message}: ${formatError(err)}` : message);
      }
    },
  };
}
