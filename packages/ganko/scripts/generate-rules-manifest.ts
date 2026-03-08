/**
 * Rule Manifest Generator
 *
 * Imports rule definitions from ganko source and generates a typed
 * manifest file containing all rule metadata. This decouples metadata
 * consumers (VS Code extension, docs, config generators) from rule
 * implementations — they get compile-time types and zero runtime
 * dependency on the analysis engine.
 *
 * Run: bun run scripts/generate-rules-manifest.ts
 */

import { rules as solidRules } from "../src/solid/rules"
import { rules as cssRules } from "../src/css/rules"
import { rules as crossFileRules } from "../src/cross-file/rules"
import type { RuleCategory } from "../src/graph"
import { fileURLToPath } from "node:url"

interface ManifestEntry {
  readonly id: string
  readonly severity: "error" | "warn" | "off"
  readonly description: string
  readonly fixable: boolean
  readonly category: RuleCategory
  readonly plugin: "solid" | "css" | "cross-file"
  readonly messages: Record<string, string>
}

function collectEntries(): readonly ManifestEntry[] {
  const entries: ManifestEntry[] = []

  for (const rule of solidRules) {
    entries.push({
      id: rule.id,
      severity: rule.severity,
      description: rule.meta.description,
      fixable: rule.meta.fixable,
      category: rule.meta.category,
      plugin: "solid",
      messages: rule.messages,
    })
  }

  for (const rule of cssRules) {
    entries.push({
      id: rule.id,
      severity: rule.severity,
      description: rule.meta.description,
      fixable: rule.meta.fixable,
      category: rule.meta.category,
      plugin: "css",
      messages: rule.messages,
    })
  }

  for (const rule of crossFileRules) {
    entries.push({
      id: rule.id,
      severity: rule.severity,
      description: rule.meta.description,
      fixable: rule.meta.fixable,
      category: rule.meta.category,
      plugin: "cross-file",
      messages: rule.messages,
    })
  }

  entries.sort((a, b) => {
    const cat = a.category.localeCompare(b.category)
    if (cat !== 0) return cat
    return a.id.localeCompare(b.id)
  })

  return entries
}

function generateSource(entries: readonly ManifestEntry[]): string {
  const lines: string[] = []

  const categories = Array.from(new Set(entries.map((e) => e.category))).toSorted()
  const plugins = Array.from(new Set(entries.map((e) => e.plugin))).toSorted()

  lines.push("/**")
  lines.push(" * AUTO-GENERATED — DO NOT EDIT")
  lines.push(" *")
  lines.push(" * Rule metadata manifest for all ganko rules.")
  lines.push(" * Regenerate: bun run scripts/generate-rules-manifest.ts")
  lines.push(" */")
  lines.push("")
  lines.push('import type { RuleSeverityOverride } from "@drskillissue/ganko-shared"')
  lines.push("")
  lines.push("/** Rule category for grouping in configuration UIs and documentation. */")
  lines.push("export type RuleCategory =")
  for (const cat of categories) {
    lines.push(`  | "${cat}"`)
  }
  lines.push("")
  lines.push("/** Plugin that owns the rule. */")
  lines.push("export type RulePlugin =")
  for (const plugin of plugins) {
    lines.push(`  | "${plugin}"`)
  }
  lines.push("")
  lines.push("/** Static metadata for a single lint rule. */")
  lines.push("export interface RuleEntry {")
  lines.push("  readonly id: string")
  lines.push("  readonly severity: RuleSeverityOverride")
  lines.push("  readonly description: string")
  lines.push("  readonly fixable: boolean")
  lines.push("  readonly category: RuleCategory")
  lines.push("  readonly plugin: RulePlugin")
  lines.push("  readonly messages: Record<string, string>")
  lines.push("}")
  lines.push("")

  const ids = entries.map((e) => `"${e.id}"`)
  lines.push("/** Union of all rule IDs. */")
  lines.push(`export type RuleId =`)
  for (let i = 0; i < ids.length; i++) {
    const sep = i < ids.length - 1 ? "" : ""
    lines.push(`  | ${ids[i]}${sep}`)
  }
  lines.push("")

  lines.push("/** All rule metadata entries, sorted by category then id. */")
  lines.push(`export const RULES: readonly RuleEntry[] = ${JSON.stringify(entries, null, 2)} as const`)
  lines.push("")

  const grouped = new Map<string, ManifestEntry[]>()
  for (const entry of entries) {
    const group = grouped.get(entry.category)
    if (group) {
      group.push(entry)
    } else {
      grouped.set(entry.category, [entry])
    }
  }
  lines.push("/** Rules grouped by category. */")
  lines.push("export const RULES_BY_CATEGORY: Readonly<Record<RuleCategory, readonly RuleEntry[]>> = {")
  for (const cat of categories) {
    lines.push(`  "${cat}": ${JSON.stringify(grouped.get(cat) ?? [])},`)
  }
  lines.push("} as const")
  lines.push("")

  lines.push("/** All rule categories, sorted alphabetically. */")
  lines.push(`export const RULE_CATEGORIES: readonly RuleCategory[] = ${JSON.stringify(categories)} as const`)
  lines.push("")

  lines.push("/** Lookup a rule by ID. Returns undefined if not found. */")
  lines.push("export function getRule(id: string): RuleEntry | undefined {")
  lines.push("  for (let i = 0; i < RULES.length; i++) {")
  lines.push("    const rule = RULES[i]")
  lines.push("    if (rule && rule.id === id) return rule")
  lines.push("  }")
  lines.push("  return undefined")
  lines.push("}")
  lines.push("")

  return lines.join("\n")
}

const entries = collectEntries()
const source = generateSource(entries)
const dest = fileURLToPath(new URL("../src/generated/rules-manifest.ts", import.meta.url))

if (process.argv.includes("--check")) {
  const existing = await Bun.file(dest).text()
  if (existing !== source) {
    process.stderr.write("Rules manifest is stale. Run: bun run generate\n")
    process.exit(1)
  }
  console.log(`Rules manifest is up to date (${entries.length} rules)`)
  process.exit(0)
}

await Bun.write(dest, source)

console.log(`Generated ${dest} with ${entries.length} rules`)
