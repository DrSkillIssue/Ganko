/**
 * @drskillissue/ganko-shared
 *
 * Protocol types and constants shared between ganko-vscode (client),
 * ganko (server), and ganko (engine). These types define the
 * contract for configuration exchange — both at initialization and
 * during runtime config changes.
 *
 * Every export is explicit — no `export *`. New symbols must be
 * added here deliberately to become part of the public API.
 */

// Extensions & file classification
export {
  SOLID_EXTENSIONS,
  CSS_EXTENSIONS,
  ALL_EXTENSIONS,
  matchesExtension,
  classifyFile,
  extensionsToGlobs,
  extensionsToWatcherGlob,
  type FileKind,
} from "./extensions";

// URI/path utilities
export { canonicalPath, uriToPath, pathToUri } from "./path";

// Logging
export {
  noopLogger,
  parseLogLevel,
  createLogger,
  prefixLogger,
  type LogLevel,
  type Logger,
  type LeveledLogger,
  type LogWriter,
} from "./log";

// Configuration & settings
export {
  ACCESSIBILITY_POLICIES,
  ServerSettingsSchema,
  SEVERITY_LOOKUP,
  NUMERIC_SEVERITY,
  ESLINT_CONFIG_FILENAMES,
  type RuleSeverityOverride,
  type RuleOverrides,
  type ESLintConfigResult,
  type AccessibilityPolicy,
  type TraceLevel,
  type ServerSettings,
  type ConfigurationChangePayload,
  type RuleSeveritySettingValue,
} from "./config";

// Cross-file dependency model
export { CROSS_FILE_DEPENDENTS } from "./cross-file";

// Memory monitoring
export {
  takeMemorySnapshot,
  formatSnapshot,
  snapshotToLogLine,
  HighWaterMarkTracker,
  triggerGC,
  type MemorySnapshot,
  type MemorySnapshotFormatted,
} from "./memory";

// Shared utilities
export * from "./util";
