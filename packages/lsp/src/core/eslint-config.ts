/**
 * ESLint Config Reader
 *
 * Loads ESLint flat config files and extracts ganko rule overrides
 * that differ from the RULES manifest defaults, plus global ignore patterns.
 *
 * Config evaluation is delegated to the WorkspaceEvaluator subprocess so
 * `import "@drskillissue/ganko/eslint-plugin"` resolves against the project's
 * own node_modules. This module handles config file discovery, result parsing,
 * and ganko-specific override extraction.
 */
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import type { RuleOverrides, RuleSeverityOverride, ESLintConfigResult, Logger } from "@drskillissue/ganko-shared";
import { ESLINT_CONFIG_FILENAMES, numericSeverity, SEVERITY_LOOKUP, Level } from "@drskillissue/ganko-shared";
import { getRule } from "@drskillissue/ganko";
import { evaluateWorkspace } from "./workspace-eval";

/** Shared empty result — returned when no config is found or config is empty. */
export const EMPTY_ESLINT_RESULT: ESLintConfigResult = { overrides: {}, globalIgnores: [] };

/** Prefix for ganko rules in ESLint config */
const RULE_PREFIX = "solid/";

/** ESLint rule values: severity, array, or arbitrary plugin values. */
type ESLintRuleValue = string | number | boolean | null | readonly (string | number | boolean | null | Record<string, unknown>)[];

interface FlatConfigObject {
  rules?: Record<string, unknown>
  files?: unknown
  plugins?: unknown
  ignores?: string[]
}

/**
 * Normalize an ESLint severity value to a RuleSeverityOverride.
 *
 * Handles: "error", "warn", "off", 0, 1, 2, and array format [severity, ...options].
 * Returns null if the value is unrecognizable.
 *
 * @param entry - ESLint rule value
 * @returns Normalized severity, or null
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
 * no `files`, `rules`, or `plugins`.
 *
 * @param config - Flat config object
 * @returns true if this is a global ignores-only entry
 */
function isGlobalIgnoresOnly(config: FlatConfigObject): boolean {
  if (!config.ignores || config.ignores.length === 0) return false;
  const keys = Object.keys(config);
  return keys.length === 1 && keys[0] === "ignores";
}

/**
 * Collect global ignore patterns from all config objects.
 *
 * @param configs - Flat config objects from subprocess
 * @returns Global ignore patterns
 */
export function extractGlobalIgnores(configs: readonly FlatConfigObject[]): readonly string[] {
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
 * Extract ganko rule overrides from flat config objects.
 *
 * Collects rules prefixed with "solid/", normalizes severity, strips prefix.
 * Later config objects override earlier ones (ESLint merge semantics).
 * Filters out entries matching the RULES manifest default severity.
 *
 * @param configs - Flat config objects from subprocess
 * @returns Rule overrides (non-default only)
 */
export function extractOverrides(configs: readonly FlatConfigObject[]): RuleOverrides {
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
 * @param log - Logger
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
 * Load an ESLint flat config and extract ganko rule overrides plus
 * global ignore patterns.
 *
 * Delegates config evaluation to the WorkspaceEvaluator subprocess so
 * module resolution uses the project's node_modules. Extracts ganko-specific
 * overrides and global ignores from the structured result.
 *
 * @param rootPath - Workspace root directory
 * @param explicitPath - Optional user-specified config path
 * @param log - Logger
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

  const response = await evaluateWorkspace(rootPath, { type: "eslint", eslintConfigPath: configPath }, log);
  if (response === null || response.eslint === undefined) {
    return EMPTY_ESLINT_RESULT;
  }

  const configs = response.eslint.configs;
  const result: ESLintConfigResult = {
    overrides: extractOverrides(configs),
    globalIgnores: extractGlobalIgnores(configs),
  };

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
