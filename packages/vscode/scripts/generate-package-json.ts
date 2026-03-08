/**
 * VS Code Package.json Generator
 *
 * Reads the rules manifest from ganko and injects explicit per-rule
 * configuration properties into the extension's package.json. This replaces
 * the generic patternProperties blob with named, documented settings that
 * appear in the VS Code settings UI with descriptions, defaults, and
 * category grouping.
 *
 * Run: bun run scripts/generate-package-json.ts
 */

import { resolve } from "path";
import type { RuleEntry } from "@drskillissue/ganko/rules-manifest";
import { RULES_BY_CATEGORY, RULE_CATEGORIES } from "@drskillissue/ganko/rules-manifest";
import type {
  RuleConfigProperty,
  VSCodeConfigProperty,
  ExtensionPackageJson,
} from "../src/vscode-types";

const PACKAGE_PATH = resolve(import.meta.dirname, "..", "package.json");

const ALL_CATEGORIES = RULE_CATEGORIES;

/**
 * Build the rule configuration property for a single rule.
 * Each rule gets a `solid.rules.<id>` setting that is a string enum.
 */
function buildRuleProperty(rule: RuleEntry): RuleConfigProperty {
  return {
    type: "string",
    enum: ["error", "warn", "off", "default"],
    default: "default",
    markdownDescription: `${rule.description}${rule.fixable ? " *(fixable)*" : ""}\n\nDefault severity: \`${rule.severity}\`\n\n*Editor-only override. For CLI/CI, configure in \`eslint.config.mjs\`.*`,
    enumDescriptions: [
      "Report as error",
      "Report as warning",
      "Disable this rule",
      `Use default severity (${rule.severity})`,
    ],
  };
}

/**
 * Build all rule properties grouped by category.
 * Properties are namespaced under solid.rules.<id>.
 */
function buildRuleProperties(): Record<string, RuleConfigProperty> {
  const properties: Record<string, RuleConfigProperty> = {};

  for (const category of ALL_CATEGORIES) {
    const rules = RULES_BY_CATEGORY[category];
    if (rules.length === 0) continue;

    for (const rule of rules) {
      properties[`solid.rules.${rule.id}`] = buildRuleProperty(rule);
    }
  }

  return properties;
}

const raw = await Bun.file(PACKAGE_PATH).text();
const pkg: ExtensionPackageJson = JSON.parse(raw);

const existing = pkg.contributes.configuration.properties;

const ruleProperties = buildRuleProperties();

/** Remove old generic solid.rules blob and any existing solid.rules.* entries */
const cleaned: Record<string, VSCodeConfigProperty> = {};
for (const [key, value] of Object.entries(existing)) {
  if (key === "solid.rules" || key.startsWith("solid.rules.")) continue;
  cleaned[key] = value;
}

/** Merge: non-rule settings first, then rule settings */
pkg.contributes.configuration.properties = { ...cleaned, ...ruleProperties };

await Bun.write(PACKAGE_PATH, JSON.stringify(pkg, null, 2) + "\n");

console.log(`Updated ${PACKAGE_PATH} with ${Object.keys(ruleProperties).length} rule settings`);
