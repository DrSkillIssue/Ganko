/** Canonical list of log levels, most verbose to least verbose. */
export const LOG_LEVELS = ["trace", "debug", "info", "warning", "error", "critical", "off"] as const;

/** Log severity levels matching VS Code's LogLevel enum. */
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Numeric ordering for log levels — lower numbers are more verbose. */
export const LOG_LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  trace: 0,
  debug: 1,
  info: 2,
  warning: 3,
  error: 4,
  critical: 5,
  off: 6,
};

/**
 * Logger — shared logging interface for all packages.
 *
 * Levels match VS Code's LogLevel enum: Trace, Debug, Info, Warning, Error, Critical, Off.
 *
 * Backends are environment-specific (LSP connection, CLI stderr, noop for tests).
 * The interface lives here so ganko and @ganko/shared consumers can log
 * without depending on ganko.
 *
 * Use the `enabled` flag to guard expensive log argument computation:
 *
 * ```ts
 * if (log.enabled) log.debug(`rebuilt ${count} graphs in ${elapsed}ms`);
 * ```
 *
 * When the logger is a noop, `enabled` is `false` and the entire template
 * literal + any function calls inside it are never evaluated — true zero-cost.
 */
export interface Logger {
  /** Whether this logger actually writes output. Guard expensive calls with this. */
  readonly enabled: boolean
  /** The active log level threshold. Messages below this level are suppressed. */
  readonly level: LogLevel
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
  enabled: false,
  level: "off",
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
    get enabled() { return threshold < LOG_LEVEL_ORDER.off; },
    get level() { return currentLevel; },
    setLevel(next: LogLevel) { threshold = LOG_LEVEL_ORDER[next]; currentLevel = next; },
    trace(message: string) { if (threshold <= LOG_LEVEL_ORDER.trace) writer.trace(message); },
    debug(message: string) { if (threshold <= LOG_LEVEL_ORDER.debug) writer.debug(message); },
    info(message: string) { if (threshold <= LOG_LEVEL_ORDER.info) writer.info(message); },
    warning(message: string) { if (threshold <= LOG_LEVEL_ORDER.warning) writer.warning(message); },
    error(message: string, err?: Error) {
      if (threshold <= LOG_LEVEL_ORDER.error) {
        writer.error(err !== undefined ? `${message}: ${formatError(err)}` : message);
      }
    },
    critical(message: string, err?: Error) {
      if (threshold <= LOG_LEVEL_ORDER.critical) {
        writer.critical(err !== undefined ? `${message}: ${formatError(err)}` : message);
      }
    },
  };
}
