/** File extensions recognized as Solid/TypeScript/JavaScript source files. */
export const SOLID_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js", ".mts", ".cts", ".mjs", ".cjs"] as const;

/** File extensions recognized as CSS/preprocessor stylesheet files. */
export const CSS_EXTENSIONS = [".css", ".scss", ".sass", ".less"] as const;

/** All extensions the analysis engine handles (solid + css). */
export const ALL_EXTENSIONS = [...SOLID_EXTENSIONS, ...CSS_EXTENSIONS] as const;

/** Discriminant for file classification within the analysis engine. */
export type FileKind = "solid" | "css" | "unknown";

/**
 * Compiled pattern matching tooling config files that share a supported
 * extension but must never be analysed as source code.
 *
 * Matches basenames like `eslint.config.mjs`, `vite.config.ts`,
 * `vitest.config.mts`, `webpack.config.js`, etc. — any file whose
 * basename is `<name>.config.<supported-ext>` or `<name>.setup.<supported-ext>`.
 *
 * Using a regex pattern instead of an exhaustive set ensures new
 * tooling configs are excluded automatically.
 */
const TOOLING_CONFIG_RE = /(?:^|[\\/])[\w.-]+\.(?:config|setup)\.(?:ts|js|mts|cts|mjs|cjs)$/;

/**
 * Check whether a path refers to a tooling config file that should
 * be excluded from analysis despite having a supported extension.
 *
 * Matches any file whose basename follows the `<name>.config.<ext>` or
 * `<name>.setup.<ext>` convention (e.g. `eslint.config.mjs`,
 * `vitest.setup.ts`, `webpack.config.js`).
 *
 * @param path - File path to check
 * @returns `true` if the file matches a tooling config pattern
 */
export function isToolingConfig(path: string): boolean {
  return TOOLING_CONFIG_RE.test(path);
}

/**
 * Check if a file path ends with one of the given extensions.
 *
 * @param path - File path to check
 * @param extensions - Extension array to match against
 * @returns True if path ends with any extension in the list
 */
export function matchesExtension(path: string, extensions: readonly string[]): boolean {
  for (let i = 0; i < extensions.length; i++) {
    const ext = extensions[i];
    if (ext && path.endsWith(ext)) return true;
  }
  return false;
}

/**
 * Classify a file path by its extension.
 *
 * Returns `"solid"` for Solid/TS/JS source files, `"css"` for stylesheet
 * files, or `"unknown"` for anything else. TypeScript declaration files
 * (`.d.ts`) are classified as `"unknown"` since they are not analysed.
 *
 * @param path - File path to classify
 * @returns The file's kind
 */
export function classifyFile(path: string): FileKind {
  if (path.endsWith(".d.ts")) return "unknown";
  if (isToolingConfig(path)) return "unknown";
  if (matchesExtension(path, SOLID_EXTENSIONS)) return "solid";
  if (matchesExtension(path, CSS_EXTENSIONS)) return "css";
  return "unknown";
}

/**
 * Build an ESLint glob array from extension constants.
 *
 * Converts `[".ts", ".tsx"]` to `["**\/*.ts", "**\/*.tsx"]`.
 *
 * @param extensions - Extension array to convert
 * @returns Array of glob patterns
 */
export function extensionsToGlobs(extensions: readonly string[]): string[] {
  const globs = new Array<string>(extensions.length);
  for (let i = 0; i < extensions.length; i++) {
    const ext = extensions[i];
    if (!ext) continue;
    globs[i] = "**/*" + ext;
  }
  return globs;
}

/**
 * Build a VS Code file watcher glob from extensions.
 *
 * Converts `[".ts", ".tsx", ".css"]` to `"**\/*.{ts,tsx,css}"`.
 *
 * @param extensions - Extension array to convert
 * @returns Single glob string with brace expansion
 */
export function extensionsToWatcherGlob(extensions: readonly string[]): string {
  const stripped = new Array<string>(extensions.length);
  for (let i = 0; i < extensions.length; i++) {
    const ext = extensions[i];
    if (!ext) continue;
    stripped[i] = ext.substring(1);
  }
  return "**/*.{" + stripped.join(",") + "}";
}
