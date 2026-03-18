/**
 * ESLint Config Reader
 *
 * Loads ESLint flat config files and extracts ganko rule overrides
 * that differ from the RULES manifest defaults, plus global ignore patterns.
 */
import { existsSync, copyFileSync, unlinkSync } from "node:fs";
import { resolve, join, extname, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod/v4";
import type { RuleOverrides, RuleSeverityOverride, ESLintConfigResult, Logger } from "@drskillissue/ganko-shared";
import { ESLINT_CONFIG_FILENAMES, numericSeverity, SEVERITY_LOOKUP, Level } from "@drskillissue/ganko-shared";
import { getRule } from "@drskillissue/ganko";

let importCounter = 0;

/**
 * Import an ESM module bypassing the runtime's module cache.
 *
 * Both Node.js and Bun cache `import()` results by URL. Node respects
 * query-string differences (`?t=123`), but Bun does not — it resolves
 * to the same filesystem path and returns the cached module.
 *
 * This function copies the file to a unique temporary path, imports
 * that copy, and deletes it afterward. Each call produces a fresh
 * module regardless of runtime.
 */
async function importFresh(filePath: string): Promise<unknown> {
  const ext = extname(filePath);
  const tmpPath = join(dirname(filePath), `.ganko-eslint-${process.pid}-${++importCounter}${ext}`);
  copyFileSync(filePath, tmpPath);
  try {
    const mod = await import(pathToFileURL(tmpPath).href);
    return mod.default ?? mod;
  } finally {
    try { unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
  }
}

/** ESLint rule values: severity, array, or arbitrary plugin values (boolean, object, etc.).
 * Covers all values ESLint allows in flat config `rules` records. */
type ESLintRuleValue = string | number | boolean | null | readonly (string | number | boolean | null | Record<string, unknown>)[];

/** Zod schema for a single ESLint flat config object.
 * Rules use z.unknown() because non-ganko plugins may use arbitrary
 * value shapes (booleans, strings, etc.). Filtering happens in
 * normalizeSeverity which already handles unrecognizable entries. */
const FlatConfigObjectSchema = z.object({
  rules: z.record(z.string(), z.unknown()).optional(),
  files: z.unknown().optional(),
  plugins: z.unknown().optional(),
  ignores: z.array(z.string()).optional(),
}).passthrough();

type FlatConfigObject = z.infer<typeof FlatConfigObjectSchema>;

/** Zod schema for the ESLint config export: array of config objects, or a single object. */
const ESLintConfigExportSchema = z.union([
  z.array(FlatConfigObjectSchema),
  FlatConfigObjectSchema,
]);

/** Shared empty result — returned when no config is found or config is empty. */
export const EMPTY_ESLINT_RESULT: ESLintConfigResult = { overrides: {}, globalIgnores: [] };

/** Prefix for ganko rules in ESLint config */
const RULE_PREFIX = "solid/";


/**
 * Normalize an ESLint severity value to a RuleSeverityOverride.
 *
 * Handles: "error", "warn", "off", 0, 1, 2, and array format [severity, ...options].
 * Returns null if the value is unrecognizable.
 */
function normalizeSeverity(entry: ESLintRuleValue): RuleSeverityOverride | null {
  if (Array.isArray(entry)) {
    const [first] = entry;
    if (typeof first === "number") return numericSeverity(first) ?? null;
    if (typeof first === "string") return SEVERITY_LOOKUP[first] ?? null;
    return null;
  }
  if (typeof entry === "number") return numericSeverity(entry) ?? null;
  if (typeof entry === "string") return SEVERITY_LOOKUP[entry] ?? null;
  return null;
}

/**
 * A config object is a "global ignores" entry when it has ONLY `ignores` —
 * no `files`, `rules`, or `plugins`. This is ESLint's flat config semantic
 * for unconditional file exclusion.
 */
function isGlobalIgnoresOnly(config: FlatConfigObject): boolean {
  if (!config.ignores || config.ignores.length === 0) return false;
  const keys = Object.keys(config);
  return keys.length === 1 && keys[0] === "ignores";
}

/**
 * Collect global ignore patterns from all config objects.
 *
 * Only config objects that contain ONLY an `ignores` array (no `files`,
 * `rules`, or `plugins`) contribute patterns. This matches ESLint's
 * flat config semantics where ignores-only objects act as unconditional
 * file exclusion.
 */
function extractGlobalIgnores(configs: readonly FlatConfigObject[]): readonly string[] {
  const ignores: string[] = [];
  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    if (!config) continue;
    if (!isGlobalIgnoresOnly(config)) continue;
    const patterns = config.ignores;
    if (!patterns) continue;
    for (let j = 0; j < patterns.length; j++) {
      const pattern = patterns[j];
      if (!pattern) continue;
      ignores.push(pattern);
    }
  }
  return ignores;
}

/**
 * Extract ganko rule overrides from a loaded ESLint flat config.
 *
 * Iterates all config objects, collects rules prefixed with "solid/",
 * normalizes severity, and strips the prefix. Later config objects
 * override earlier ones (ESLint's merge semantics).
 *
 * After computing the final severity for each rule, filters out entries
 * whose severity matches the RULES manifest default. This prevents
 * `solid.configs.recommended` from flooding the override map with 163
 * entries that are identical to the built-in defaults.
 *
 * Rules not found in the manifest (unknown rule IDs) are kept as
 * overrides unconditionally — they may be user-defined extensions.
 */
function extractOverrides(configs: readonly FlatConfigObject[]): RuleOverrides {
  const raw = new Map<string, RuleSeverityOverride>();

  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    if (!config) continue;
    const rules = config.rules;
    if (!rules) continue;

    for (const key in rules) {
      if (!key.startsWith(RULE_PREFIX)) continue;
      const entry = rules[key];
      if (entry === undefined) continue;
      if (typeof entry !== "string" && typeof entry !== "number" && !Array.isArray(entry)) continue;
      const severity = normalizeSeverity(entry);
      if (severity === null) continue;
      raw.set(key.slice(RULE_PREFIX.length), severity);
    }
  }

  const overrides: Record<string, RuleSeverityOverride> = {};
  for (const [ruleId, severity] of raw) {
    const manifest = getRule(ruleId);
    if (manifest === undefined || manifest.severity !== severity) {
      overrides[ruleId] = severity;
    }
  }

  return overrides;
}

/**
 * Find the ESLint config file in a workspace root.
 *
 * @param rootPath - Workspace root directory
 * @param explicitPath - User-specified config path (takes priority)
 * @returns Absolute path to config file, or null if not found
 */
function findConfigFile(rootPath: string, explicitPath?: string, log?: Logger): string | null {
  if (explicitPath) {
    const resolved = resolve(rootPath, explicitPath);
    const found = existsSync(resolved);
    if (log?.isLevelEnabled(Level.Trace)) log.trace(`eslintConfig: explicit path ${resolved} → ${found ? "found" : "NOT found"}`);
    return found ? resolved : null;
  }

  for (const filename of ESLINT_CONFIG_FILENAMES) {
    const candidate = join(rootPath, filename);
    if (existsSync(candidate)) {
      if (log?.isLevelEnabled(Level.Trace)) log.trace(`eslintConfig: found config ${candidate}`);
      return candidate;
    }
    if (log?.isLevelEnabled(Level.Trace)) log.trace(`eslintConfig: tried ${candidate} → not found`);
  }

  return null;
}

/**
 * Process a dynamically imported ESLint config export into overrides and ignores.
 *
 * Parses the export through a zod schema, handling both array exports
 * (standard flat config) and single-object exports.
 */
function processExport(exported: FlatConfigObject[] | FlatConfigObject): ESLintConfigResult {
  const configs = Array.isArray(exported) ? exported : [exported];
  if (configs.length === 0) return EMPTY_ESLINT_RESULT;

  return {
    overrides: extractOverrides(configs),
    globalIgnores: extractGlobalIgnores(configs),
  };
}

/**
 * Load an ESLint flat config file and extract ganko rule overrides
 * (filtered against manifest defaults) plus global ignore patterns.
 *
 * Uses dynamic import() with cache-busting query parameter to ensure
 * the module is re-evaluated on each call (for config file changes).
 *
 * @param rootPath - Workspace root directory
 * @param explicitPath - Optional user-specified config path
 * @returns Rule overrides (non-default only) and global ignore patterns
 */
export async function loadESLintConfig(
  rootPath: string,
  explicitPath?: string,
  log?: Logger,
): Promise<ESLintConfigResult> {
  const configPath = findConfigFile(rootPath, explicitPath, log);
  if (!configPath) {
    if (log?.isLevelEnabled(Level.Debug)) log.debug(`eslintConfig: no config file found in ${rootPath}`);
    return EMPTY_ESLINT_RESULT;
  }

  if (log?.isLevelEnabled(Level.Debug)) log.debug(`eslintConfig: loading ${configPath}`);
  try {
    const raw = await importFresh(configPath);
    const parsed = ESLintConfigExportSchema.safeParse(raw);
    if (!parsed.success) {
      if (log?.isLevelEnabled(Level.Warning)) log.warning(`eslintConfig: ${configPath} export did not match expected schema`);
      return EMPTY_ESLINT_RESULT;
    }
    const result = processExport(parsed.data);
    if (log?.isLevelEnabled(Level.Trace)) {
      log.debug(`eslintConfig: ${Object.keys(result.overrides).length} overrides, ${result.globalIgnores.length} ignores`);
      if (Object.keys(result.overrides).length > 0) {
        log.trace(`eslintConfig: overrides: ${JSON.stringify(result.overrides)}`);
      }
      if (result.globalIgnores.length > 0) {
        log.trace(`eslintConfig: globalIgnores: ${JSON.stringify(result.globalIgnores)}`);
      }
    }
    return result;
  } catch (e) {
    if (log?.isLevelEnabled(Level.Warning)) log.warning(`eslintConfig: failed to load ${configPath}: ${e instanceof Error ? e.message : String(e)}`);
    return EMPTY_ESLINT_RESULT;
  }
}

/**
 * Merge ESLint config overrides with VS Code settings overrides.
 *
 * VS Code settings take priority — if a rule is configured in both,
 * the VS Code setting wins.
 *
 * @param eslintOverrides - Overrides from ESLint config (lower priority)
 * @param vscodeOverrides - Overrides from VS Code settings (higher priority)
 * @returns Merged overrides
 */
export function mergeOverrides(
  eslintOverrides: RuleOverrides,
  vscodeOverrides: RuleOverrides,
): RuleOverrides {
  const eslintKeys = Object.keys(eslintOverrides);
  if (eslintKeys.length === 0) return vscodeOverrides;

  const vscodeKeys = Object.keys(vscodeOverrides);
  if (vscodeKeys.length === 0) return eslintOverrides;

  const merged: Record<string, RuleSeverityOverride> = {};

  for (const key of eslintKeys) {
    const val = eslintOverrides[key];
    if (val !== undefined) merged[key] = val;
  }
  for (const key of vscodeKeys) {
    const val = vscodeOverrides[key];
    if (val !== undefined) merged[key] = val;
  }

  return merged;
}
