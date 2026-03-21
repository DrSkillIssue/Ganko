/**
 * Extract all class fields, methods, indexes, getters, and type information
 * from SolidGraph, CSSGraph, and LayoutGraph using the TypeScript compiler API.
 *
 * Usage: bun run scripts/extract-types.ts
 */
import ts from "typescript";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");

interface FieldInfo {
  name: string;
  type: string;
  kind: "property" | "readonly-property" | "method" | "getter" | "setter";
  modifiers: string[];
  initializer: string | null;
  jsdoc: string | null;
}

interface ClassInfo {
  name: string;
  file: string;
  fields: FieldInfo[];
}

interface InterfaceInfo {
  name: string;
  file: string;
  fields: FieldInfo[];
}

function extractFromFile(filePath: string, targetNames: string[]): (ClassInfo | InterfaceInfo)[] {
  const absPath = resolve(ROOT, filePath);
  const source = readFileSync(absPath, "utf-8");
  const sourceFile = ts.createSourceFile(absPath, source, ts.ScriptTarget.Latest, true);
  const results: (ClassInfo | InterfaceInfo)[] = [];

  function getTypeText(node: ts.TypeNode | undefined): string {
    if (!node) return "inferred";
    return source.slice(node.pos, node.end).trim();
  }

  function getInitializerText(node: ts.Expression | undefined): string | null {
    if (!node) return null;
    const text = source.slice(node.pos, node.end).trim();
    // Truncate long initializers
    return text.length > 120 ? text.slice(0, 117) + "..." : text;
  }

  function getJSDoc(node: ts.Node): string | null {
    const jsdocs = ts.getJSDocCommentsAndTags(node);
    if (jsdocs.length === 0) return null;
    const first = jsdocs[0];
    if (!first) return null;
    const text = source.slice(first.pos, first.end).trim();
    // Extract just the comment text, not the full JSDoc block
    const match = text.match(/\/\*\*\s*(.*?)\s*\*\//s);
    if (match && match[1]) {
      return match[1].replace(/\s*\*\s*/g, " ").trim().slice(0, 200);
    }
    return text.slice(0, 200);
  }

  function getModifiers(node: ts.Node): string[] {
    const mods: string[] = [];
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    if (modifiers) {
      for (const mod of modifiers) {
        mods.push(ts.tokenToString(mod.kind) ?? String(mod.kind));
      }
    }
    return mods;
  }

  function processClass(node: ts.ClassDeclaration) {
    const name = node.name?.text;
    if (!name || !targetNames.includes(name)) return;

    const fields: FieldInfo[] = [];

    for (const member of node.members) {
      if (ts.isPropertyDeclaration(member)) {
        const propName = member.name?.getText(sourceFile) ?? "<unknown>";
        const mods = getModifiers(member);
        const isReadonly = mods.includes("readonly") || member.modifiers?.some(m => m.kind === ts.SyntaxKind.ReadonlyKeyword) || false;
        fields.push({
          name: propName,
          type: member.type ? getTypeText(member.type) : (member.initializer ? inferTypeFromInit(member.initializer) : "unknown"),
          kind: isReadonly ? "readonly-property" : "property",
          modifiers: mods,
          initializer: getInitializerText(member.initializer),
          jsdoc: getJSDoc(member),
        });
      } else if (ts.isMethodDeclaration(member)) {
        const methodName = member.name?.getText(sourceFile) ?? "<unknown>";
        const params = member.parameters.map(p => {
          const pName = p.name.getText(sourceFile);
          const pType = p.type ? getTypeText(p.type) : "unknown";
          return `${pName}: ${pType}`;
        }).join(", ");
        const retType = member.type ? getTypeText(member.type) : "void";
        fields.push({
          name: methodName,
          type: `(${params}) => ${retType}`,
          kind: "method",
          modifiers: getModifiers(member),
          initializer: null,
          jsdoc: getJSDoc(member),
        });
      } else if (ts.isGetAccessorDeclaration(member)) {
        const getterName = member.name?.getText(sourceFile) ?? "<unknown>";
        fields.push({
          name: getterName,
          type: member.type ? getTypeText(member.type) : "unknown",
          kind: "getter",
          modifiers: getModifiers(member),
          initializer: null,
          jsdoc: getJSDoc(member),
        });
      } else if (ts.isConstructorDeclaration(member)) {
        // Extract constructor parameter properties
        for (const param of member.parameters) {
          const paramMods = getModifiers(param);
          if (paramMods.includes("readonly") || paramMods.includes("private") || paramMods.includes("public") || paramMods.includes("protected")) {
            fields.push({
              name: param.name.getText(sourceFile),
              type: param.type ? getTypeText(param.type) : "unknown",
              kind: "readonly-property",
              modifiers: paramMods,
              initializer: null,
              jsdoc: null,
            });
          }
        }
      }
    }

    results.push({ name, file: filePath, fields });
  }

  function processInterface(node: ts.InterfaceDeclaration) {
    const name = node.name?.text;
    if (!name || !targetNames.includes(name)) return;

    const fields: FieldInfo[] = [];

    for (const member of node.members) {
      if (ts.isPropertySignature(member)) {
        const propName = member.name?.getText(sourceFile) ?? "<unknown>";
        const isReadonly = member.modifiers?.some(m => m.kind === ts.SyntaxKind.ReadonlyKeyword) || false;
        fields.push({
          name: propName,
          type: member.type ? getTypeText(member.type) : "unknown",
          kind: isReadonly ? "readonly-property" : "property",
          modifiers: isReadonly ? ["readonly"] : [],
          initializer: null,
          jsdoc: getJSDoc(member),
        });
      } else if (ts.isMethodSignature(member)) {
        const methodName = member.name?.getText(sourceFile) ?? "<unknown>";
        const params = member.parameters.map(p => {
          const pName = p.name.getText(sourceFile);
          const pType = p.type ? getTypeText(p.type) : "unknown";
          return `${pName}: ${pType}`;
        }).join(", ");
        const retType = member.type ? getTypeText(member.type) : "void";
        fields.push({
          name: methodName,
          type: `(${params}) => ${retType}`,
          kind: "method",
          modifiers: [],
          initializer: null,
          jsdoc: getJSDoc(member),
        });
      }
    }

    results.push({ name, file: filePath, fields });
  }

  function inferTypeFromInit(init: ts.Expression): string {
    const text = source.slice(init.pos, init.end).trim();
    if (text.startsWith("new Map")) return extractGenericArgs(text, "Map");
    if (text.startsWith("new Set")) return extractGenericArgs(text, "Set");
    if (text.startsWith("new WeakMap")) return extractGenericArgs(text, "WeakMap");
    if (text === "[]") return "unknown[]";
    if (text === "0") return "number";
    if (text === "null") return "null";
    if (text === "false" || text === "true") return "boolean";
    if (text.startsWith('"') || text.startsWith("'") || text.startsWith('`')) return "string";
    return text.length > 80 ? text.slice(0, 77) + "..." : text;
  }

  function extractGenericArgs(text: string, base: string): string {
    const match = text.match(new RegExp(`new ${base}<([^>]+)>`));
    if (match && match[1]) return `${base}<${match[1]}>`;
    return `${base}<unknown>`;
  }

  ts.forEachChild(sourceFile, node => {
    if (ts.isClassDeclaration(node)) processClass(node);
    if (ts.isInterfaceDeclaration(node)) processInterface(node);
  });

  return results;
}

function extractEnumsAndTypes(filePath: string, targetNames: string[]): string[] {
  const absPath = resolve(ROOT, filePath);
  const source = readFileSync(absPath, "utf-8");
  const sourceFile = ts.createSourceFile(absPath, source, ts.ScriptTarget.Latest, true);
  const results: string[] = [];

  ts.forEachChild(sourceFile, node => {
    if (ts.isTypeAliasDeclaration(node) && targetNames.includes(node.name.text)) {
      results.push(source.slice(node.pos, node.end).trim());
    }
    if (ts.isEnumDeclaration(node) && targetNames.includes(node.name.text)) {
      results.push(source.slice(node.pos, node.end).trim());
    }
  });

  return results;
}

function formatAsMarkdown(info: ClassInfo | InterfaceInfo): string {
  const kind = "fields" in info ? ("file" in info ? "class/interface" : "unknown") : "unknown";
  let md = `### ${info.name} (${info.file})\n\n`;
  md += `| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |\n`;
  md += `|---|------|------|------|-----------|-------------|-------|\n`;

  let i = 1;
  for (const f of info.fields) {
    const type = f.type.replace(/\|/g, "\\|").replace(/\n/g, " ");
    const init = (f.initializer ?? "—").replace(/\|/g, "\\|").replace(/\n/g, " ");
    const jsdoc = (f.jsdoc ?? "—").replace(/\|/g, "\\|").replace(/\n/g, " ");
    md += `| ${i++} | \`${f.name}\` | ${f.kind} | \`${type}\` | ${f.modifiers.join(", ") || "—"} | \`${init}\` | ${jsdoc} |\n`;
  }

  return md;
}

// ═══════════════════════════════════════════════════════════════
// Extract everything
// ═══════════════════════════════════════════════════════════════

const output: string[] = ["# Extracted Type Information\n\n"];

// 1. SolidGraph
output.push("## 1. SolidGraph\n\n");
const solidResults = extractFromFile("packages/ganko/src/solid/impl.ts", ["SolidGraph"]);
for (const r of solidResults) output.push(formatAsMarkdown(r) + "\n");

// 2. CSSGraph
output.push("## 2. CSSGraph\n\n");
const cssResults = extractFromFile("packages/ganko/src/css/impl.ts", ["CSSGraph"]);
for (const r of cssResults) output.push(formatAsMarkdown(r) + "\n");

// 3. LayoutGraph interface
output.push("## 3. LayoutGraph\n\n");
const layoutResults = extractFromFile("packages/ganko/src/cross-file/layout/graph.ts", [
  "LayoutGraph", "LayoutElementNode", "LayoutElementRecord", "LayoutElementRef",
  "LayoutStyleRuleNode", "LayoutMatchEdge", "LayoutCascadedDeclaration",
  "LayoutReservedSpaceFact", "LayoutScrollContainerFact", "LayoutFlowParticipationFact",
  "LayoutContainingBlockFact", "LayoutConditionalSignalDeltaFact", "LayoutStatefulSelectorEntry",
  "LayoutNormalizedRuleDeclaration",
]);
for (const r of layoutResults) output.push(formatAsMarkdown(r) + "\n");

// 4. Signal model types
output.push("## 4. Signal Model\n\n");
const signalResults = extractFromFile("packages/ganko/src/cross-file/layout/signal-model.ts", [
  "LayoutSignalSnapshot", "LayoutKnownSignalValue", "LayoutUnknownSignalValue",
  "LayoutSnapshotHotSignals", "AlignmentElementEvidence", "AlignmentCohort",
  "AlignmentCohortSignals", "AlignmentCohortProfile", "AlignmentCohortFactSummary",
  "LayoutCohortSubjectStats", "LayoutCohortStats", "AlignmentCase", "AlignmentEvaluation",
  "ContentCompositionFingerprint", "AlignmentSignalFinding",
  "EvidenceProvenance", "EvidenceAtom", "PosteriorInterval",
  "SignalConflictEvidence", "CohortIdentifiability", "HotEvidenceWitness",
  "EvidenceWitness", "LogOddsInterval",
]);
for (const r of signalResults) output.push(formatAsMarkdown(r) + "\n");

// Signal enums and type aliases
const signalEnums = extractEnumsAndTypes("packages/ganko/src/cross-file/layout/signal-model.ts", [
  "LayoutSignalName", "LayoutSignalSource", "LayoutSignalGuard", "LayoutSignalUnit",
  "SignalValueKind", "SignalQuality", "LayoutTextualContentState",
  "AlignmentTextContrast", "SignalConflictValue", "CohortSubjectMembership",
  "ContentCompositionClassification", "EvidenceValueKind", "InlineReplacedKind",
  "AlignmentFindingKind", "AlignmentFactorId", "AlignmentFactorCoverage",
  "NumericEvidenceValue", "HotNumericSignalEvidence", "HotNormalizedSignalEvidence",
]);
if (signalEnums.length > 0) {
  output.push("### Signal Enums and Type Aliases\n\n```typescript\n");
  for (const e of signalEnums) output.push(e + "\n\n");
  output.push("```\n\n");
}

// 5. Guard model
output.push("## 5. Guard Model\n\n");
const guardResults = extractFromFile("packages/ganko/src/cross-file/layout/guard-model.ts", [
  "LayoutRuleGuard", "LayoutGuardConditionProvenance",
]);
for (const r of guardResults) output.push(formatAsMarkdown(r) + "\n");
const guardEnums = extractEnumsAndTypes("packages/ganko/src/cross-file/layout/guard-model.ts", [
  "LayoutSignalGuard", "LayoutRuleGuard",
]);
if (guardEnums.length > 0) {
  output.push("### Guard Enums\n\n```typescript\n");
  for (const e of guardEnums) output.push(e + "\n\n");
  output.push("```\n\n");
}

// 6. Context model (AlignmentContext)
output.push("## 6. Context Model (AlignmentContext)\n\n");
const contextResults = extractFromFile("packages/ganko/src/cross-file/layout/context-model.ts", [
  "AlignmentContext",
]);
for (const r of contextResults) output.push(formatAsMarkdown(r) + "\n");
const contextEnums = extractEnumsAndTypes("packages/ganko/src/cross-file/layout/context-model.ts", [
  "AlignmentContextKind", "ContextCertainty", "BaselineRelevance",
  "CrossAxisCertainty", "AxisLayout",
]);
if (contextEnums.length > 0) {
  output.push("### Context Enums\n\n```typescript\n");
  for (const e of contextEnums) output.push(e + "\n\n");
  output.push("```\n\n");
}

// 7. Signal names const tuple
output.push("## 7. Layout Signal Names\n\n");
{
  const absPath = resolve(ROOT, "packages/ganko/src/cross-file/layout/signal-model.ts");
  const src = readFileSync(absPath, "utf-8");
  const match = src.match(/export const layoutSignalNames = \[([\s\S]*?)\] as const/);
  if (match && match[1]) {
    output.push("```typescript\n");
    output.push(`export const layoutSignalNames = [${match[1]}] as const\n`);
    output.push("```\n\n");
  }
}

// 8. Cross-file rules list
output.push("## 8. Cross-File Rules\n\n");
{
  const absPath = resolve(ROOT, "packages/ganko/src/cross-file/rules/index.ts");
  const src = readFileSync(absPath, "utf-8");
  output.push("```typescript\n" + src + "\n```\n\n");
}

// 9. CrossRule and CrossRuleContext
output.push("## 9. CrossRule Interface\n\n");
{
  const absPath = resolve(ROOT, "packages/ganko/src/cross-file/rule.ts");
  const src = readFileSync(absPath, "utf-8");
  output.push("```typescript\n" + src + "\n```\n\n");
}

// 10. GraphCache
output.push("## 10. GraphCache\n\n");
const cacheResults = extractFromFile("packages/ganko/src/cache.ts", ["GraphCache"]);
for (const r of cacheResults) output.push(formatAsMarkdown(r) + "\n");

// 11. JSXAttributeKind
output.push("## 11. JSXAttributeKind\n\n");
{
  const absPath = resolve(ROOT, "packages/ganko/src/solid/util/jsx.ts");
  const src = readFileSync(absPath, "utf-8");
  const match = src.match(/export type JSXAttributeKind[\s\S]*?;/);
  if (match) {
    output.push("```typescript\n" + match[0] + "\n```\n\n");
  }
}

// 12. CSS-only rules (BaseRule<CSSGraph> and BaseRule<SolidGraph>)
output.push("## 12. Single-File Rules\n\n");
{
  const absPath = resolve(ROOT, "packages/ganko/src/graph.ts");
  const src = readFileSync(absPath, "utf-8");
  // Find BaseRule and runRules
  const match = src.match(/export interface BaseRule[\s\S]*?\}/);
  if (match) output.push("```typescript\n" + match[0] + "\n```\n\n");
}

// 13. TailwindValidator
output.push("## 13. TailwindValidator\n\n");
const twResults = extractFromFile("packages/ganko/src/css/tailwind.ts", ["TailwindValidator"]);
// It's an interface, not a class
if (twResults.length === 0) {
  const absPath = resolve(ROOT, "packages/ganko/src/css/tailwind.ts");
  const src = readFileSync(absPath, "utf-8");
  const match = src.match(/export interface TailwindValidator[\s\S]*?\}/);
  if (match) output.push("```typescript\n" + match[0] + "\n```\n\n");
}
for (const r of twResults) output.push(formatAsMarkdown(r) + "\n");

// Write output
const outPath = resolve(ROOT, "packages/ganko/src/compilation/extracted-types.md");
writeFileSync(outPath, output.join(""));
console.log(`Written to ${outPath} (${output.join("").length} chars)`);
