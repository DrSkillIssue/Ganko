import { RULES, RULES_BY_CATEGORY, RULE_CATEGORIES, type RuleCategory, type RuleEntry } from "../src/generated/rules-manifest"
import { fileURLToPath } from "node:url"

const ROOT_README_PATH = fileURLToPath(new URL("../../../README.md", import.meta.url))
const PACKAGE_README_PATH = fileURLToPath(new URL("../README.md", import.meta.url))

const ROOT_SECTION_MARKER = "solid-rule-descriptions"
const CATALOG_SECTION_MARKER = "rule-catalog"

const ALL_CATEGORIES = RULE_CATEGORIES

/** Derive a display title from a category ID. */
function categoryTitle(cat: RuleCategory): string {
  const ACRONYMS: Readonly<Record<string, string>> = { css: "CSS", jsx: "JSX", a11y: "A11y" }
  return cat
    .split("-")
    .map((w) => ACRONYMS[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

function escapeMarkdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ").trim()
}

function buildSolidRuleTables(): string {
  const lines: string[] = []

  for (let i = 0; i < ALL_CATEGORIES.length; i++) {
    const category = ALL_CATEGORIES[i]
    const entries = RULES_BY_CATEGORY[category] ?? []

    lines.push(`### ${categoryTitle(category)} Rules (${entries.length})`)
    lines.push("")
    lines.push("| Rule | Description | Recommended |")
    lines.push("|------|-------------|:-----------:|")

    for (let j = 0; j < entries.length; j++) {
      const entry = entries[j]
      lines.push(`| \`solid/${entry.id}\` | ${escapeMarkdownCell(entry.description)} | ${entry.severity} |`)
    }

    if (i < ALL_CATEGORIES.length - 1) lines.push("")
    lines.push("")
  }

  return lines.join("\n").trimEnd()
}

function countByPlugin(entries: readonly RuleEntry[]): Readonly<Record<RuleEntry["plugin"], number>> {
  let solid = 0
  let css = 0
  let crossFile = 0

  for (let i = 0; i < entries.length; i++) {
    const plugin = entries[i].plugin
    if (plugin === "solid") {
      solid++
      continue
    }

    if (plugin === "css") {
      css++
      continue
    }

    crossFile++
  }

  return {
    solid,
    css,
    "cross-file": crossFile,
  }
}

function buildCatalogSection(): string {
  const lines: string[] = []
  const byPlugin = countByPlugin(RULES)

  let fixable = 0
  for (let i = 0; i < RULES.length; i++) {
    if (RULES[i].fixable) fixable++
  }

  lines.push("Totals:")
  lines.push("")
  lines.push(`- ${RULES.length} rules total`)
  lines.push(`- ${byPlugin.solid} Solid rules, ${byPlugin.css} CSS rules, ${byPlugin["cross-file"]} cross-file rules`)
  lines.push(`- ${fixable} fixable rules`)
  lines.push("")
  lines.push("Category breakdown:")
  lines.push("")
  lines.push("| Category | Count |")
  lines.push("|----------|:-----:|")

  for (let i = 0; i < ALL_CATEGORIES.length; i++) {
    const category = ALL_CATEGORIES[i]
    const count = RULES_BY_CATEGORY[category]?.length ?? 0
    lines.push(`| \`${category}\` | ${count} |`)
  }

  lines.push("")
  lines.push("For full, up-to-date rule IDs and descriptions, read the generated manifest via API:")
  lines.push("")
  lines.push("```ts")
  lines.push('import { RULES, RULES_BY_CATEGORY } from "ganko/rules-manifest"')
  lines.push("")
  lines.push("const allRules = RULES")
  lines.push('const cssLayoutRules = RULES_BY_CATEGORY["css-layout"]')
  lines.push("")
  lines.push("for (const rule of cssLayoutRules) {")
  lines.push("  console.log(`${rule.id} [${rule.plugin}/${rule.severity}] - ${rule.description}`)")
  lines.push("}")
  lines.push("```")

  return lines.join("\n")
}

function replaceMarkedSection(content: string, marker: string, replacement: string): string {
  const startMarker = `<!-- BEGIN AUTO-GENERATED:${marker} -->`
  const endMarker = `<!-- END AUTO-GENERATED:${marker} -->`

  const startIndex = content.indexOf(startMarker)
  if (startIndex === -1) {
    throw new Error(`missing marker: ${startMarker}`)
  }

  const endIndex = content.indexOf(endMarker)
  if (endIndex === -1 || endIndex < startIndex) {
    throw new Error(`missing marker: ${endMarker}`)
  }

  const before = content.slice(0, startIndex + startMarker.length)
  const after = content.slice(endIndex)
  return `${before}\n${replacement.trimEnd()}\n${after}`
}

async function writeIfChanged(path: string, content: string): Promise<boolean> {
  const current = await Bun.file(path).text()
  if (current === content) return false
  await Bun.write(path, content)
  return true
}

const rootReadme = await Bun.file(ROOT_README_PATH).text()
const rootUpdated = replaceMarkedSection(rootReadme, ROOT_SECTION_MARKER, buildSolidRuleTables())

const packageReadme = await Bun.file(PACKAGE_README_PATH).text()
const packageUpdated = replaceMarkedSection(packageReadme, CATALOG_SECTION_MARKER, buildCatalogSection())

const rootChanged = await writeIfChanged(ROOT_README_PATH, rootUpdated)
const packageChanged = await writeIfChanged(PACKAGE_README_PATH, packageUpdated)

const changed: string[] = []
if (rootChanged) changed.push(ROOT_README_PATH)
if (packageChanged) changed.push(PACKAGE_README_PATH)

if (changed.length === 0) {
  console.log("Readme rule sections already up to date")
} else {
  console.log(`Updated ${changed.length} README file(s):`)
  for (let i = 0; i < changed.length; i++) {
    console.log(`- ${changed[i]}`)
  }
}
