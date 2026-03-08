/**
 * ESLint Config Reader
 *
 * Loads ESLint flat config files and extracts ganko rule overrides
 * that differ from the RULES manifest defaults, plus global ignore patterns.
 */
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { RuleOverrides, RuleSeverityOverride, ESLintConfigResult } from "@ganko/shared";
import { ESLINT_CONFIG_FILENAMES, NUMERIC_SEVERITY, SEVERITY_LOOKUP } from "@ganko/shared";
import { getRule } from "ganko";

/** ESLint flat config severity: string or numeric */
type ESLintSeverity = "error" | "warn" | "off" | 0 | 1 | 2;

/** ESLint flat config rule value: severity alone or [severity, ...options] */
type ESLintRuleEntry = ESLintSeverity | readonly [ESLintSeverity, ...unknown[]];

/** A single ESLint flat config object */
interface FlatConfigObject {
  readonly rules?: Readonly<Record<string, ESLintRuleEntry>>
  readonly files?: unknown
  readonly plugins?: unknown
  readonly ignores?: readonly string[]
}

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
function normalizeSeverity(entry: ESLintRuleEntry): RuleSeverityOverride | null {
  const raw = Array.isArray(entry) ? entry[0] : entry;
  if (typeof raw === "number") return NUMERIC_SEVERITY[raw] ?? null;
  if (typeof raw === "string") return SEVERITY_LOOKUP[raw] ?? null;
  return null;
}

/**
 * A config object is a "global ignores" entry when it has ONLY `ignores` —
 * no `files`, `rules`, or `plugins`. This is ESLint's flat config semantic
 * for unconditional file exclusion.
 */
function isGlobalIgnoresOnly(config: FlatConfigObject): boolean {
  if (!config.ignores || config.ignores.length === 0) return false;
  if (config.files !== undefined) return false;
  if (config.rules !== undefined) return false;
  if (config.plugins !== undefined) return false;
  return true;
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
function findConfigFile(rootPath: string, explicitPath?: string): string | null {
  if (explicitPath) {
    const resolved = resolve(rootPath, explicitPath);
    return existsSync(resolved) ? resolved : null;
  }

  for (const filename of ESLINT_CONFIG_FILENAMES) {
    const candidate = join(rootPath, filename);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Coerce a dynamic import result into a FlatConfigObject array.
 *
 * ESLint flat config exports either an array of config objects or a single
 * config object. This function normalizes both forms and filters out
 * non-object entries (primitives, nulls) that may appear in the array.
 */
function coerceToConfigArray(exported: Record<string, FlatConfigObject>): readonly FlatConfigObject[] {
  if (Array.isArray(exported)) {
    const configs: FlatConfigObject[] = [];
    for (let i = 0; i < exported.length; i++) {
      const entry = exported[i];
      if (entry !== null && typeof entry === "object") {
        configs.push(entry);
      }
    }
    return configs;
  }

  if ("rules" in exported) {
    return [exported];
  }

  return [];
}

/**
 * Process a dynamically imported ESLint config export into overrides and ignores.
 *
 * Handles both array exports (standard flat config) and single-object exports.
 */
function processExport(exported: Record<string, FlatConfigObject>): ESLintConfigResult {
  const configs = coerceToConfigArray(exported);
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
): Promise<ESLintConfigResult> {
  const configPath = findConfigFile(rootPath, explicitPath);
  if (!configPath) return EMPTY_ESLINT_RESULT;

  const url = pathToFileURL(configPath).href + `?t=${Date.now()}`;
  const mod = await import(url);
  const exported = mod.default ?? mod;

  return processExport(exported);
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
