import { z } from "zod/v4";
import { LOG_LEVELS, type LogLevel } from "./log";
import type { FileKind } from "./extensions";

/** Canonical list of rule severity override values. */
export const RULE_SEVERITIES = ["error", "warn", "off"] as const;

/** Per-rule severity override sent from client to server. */
export type RuleSeverityOverride = (typeof RULE_SEVERITIES)[number];

/** Map of rule ID to severity override. Rules absent from the map use their default. */
export type RuleOverrides = Readonly<Record<string, RuleSeverityOverride>>;

/**
 * Result of loading and processing an ESLint flat config file.
 *
 * Contains only rule overrides that differ from the manifest default
 * severities, plus any global ignore patterns from the config.
 */
export interface ESLintConfigResult {
  readonly overrides: RuleOverrides
  readonly globalIgnores: readonly string[]
}

/** Canonical list of accessibility policy values. */
export const ACCESSIBILITY_POLICIES = ["wcag-aa", "wcag-aaa", "mobile-first", "dense-ui", "large-text"] as const;

/** Named accessibility policy templates. */
export type AccessibilityPolicy = (typeof ACCESSIBILITY_POLICIES)[number];

/** Zod schema for AccessibilityPolicy validation. */
export const AccessibilityPolicySchema = z.enum(ACCESSIBILITY_POLICIES);

/** Canonical list of trace level values. */
export const TRACE_LEVELS = ["off", "messages", "verbose"] as const;

/** Trace level for LSP protocol tracing. */
export type TraceLevel = (typeof TRACE_LEVELS)[number];

/** Settings sent from the VS Code extension to the LSP server. */
export interface ServerSettings {
  readonly trace: TraceLevel
  readonly logLevel: LogLevel
  readonly rules: RuleOverrides
  readonly useESLintConfig: boolean
  readonly eslintConfigPath?: string
  readonly accessibilityPolicy: AccessibilityPolicy
  /** Glob patterns to exclude from file indexing and analysis. */
  readonly exclude: readonly string[]
}

/**
 * Zod schema for validating ServerSettings at initialization boundaries.
 *
 * All fields have defaults so partial payloads produce valid settings.
 */
export const ServerSettingsSchema = z.object({
  trace: z.enum(TRACE_LEVELS).default("off"),
  logLevel: z.enum(LOG_LEVELS).default("info"),
  rules: z.record(z.string(), z.enum(RULE_SEVERITIES)).default({}),
  useESLintConfig: z.boolean().default(true),
  eslintConfigPath: z.string().optional(),
  accessibilityPolicy: AccessibilityPolicySchema.default("wcag-aa"),
  exclude: z.array(z.string()).default([]),
});

/**
 * Payload shape for workspace/didChangeConfiguration notifications.
 *
 * The VS Code extension wraps ServerSettings under `settings.solid`.
 */
export interface ConfigurationChangePayload {
  readonly settings: {
    readonly solid?: ServerSettings
  }
}

/** VS Code settings UI option — extends RuleSeverityOverride with "default" (use manifest severity). */
export type RuleSeveritySettingValue = RuleSeverityOverride | "default";

/** Maps string severity names to validated RuleSeverityOverride values. */
export const SEVERITY_LOOKUP: Readonly<Record<string, RuleSeverityOverride>> = {
  error: "error",
  warn: "warn",
  off: "off",
};

/** Maps numeric ESLint severity to RuleSeverityOverride. */
export const NUMERIC_SEVERITY: Readonly<Record<number, RuleSeverityOverride>> = {
  0: "off",
  1: "warn",
  2: "error",
};

/** Candidate filenames for ESLint flat config, checked in order. */
export const ESLINT_CONFIG_FILENAMES = [
  "eslint.config.mjs",
  "eslint.config.js",
  "eslint.config.cjs",
] as const;

export type { FileKind };
