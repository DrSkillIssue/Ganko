/**
 * Flags property access on parameters typed as `any` or very wide unions.
 */

import ts from "typescript"
import { getMemberAccessesOnIdentifier } from "../../queries/entity";
import { getTypeInfo } from "../../queries/type";
import type { TypeInfo } from "../../typescript";
import { defineSolidRule } from "../../rule";
import { createDiagnostic } from "../../../diagnostic";

/** TypeFlags.Any = 1 */
const TYPE_FLAG_ANY = 1;

/** TypeFlags.Union = 1048576 */
const TYPE_FLAG_UNION = 1048576;

/** TypeFlags.StringLiteral = 128 */
const TYPE_FLAG_STRING_LITERAL = 128;

/** TypeFlags.NumberLiteral = 256 */
const TYPE_FLAG_NUMBER_LITERAL = 256;

/** TypeFlags.BooleanLiteral = 512 */
const TYPE_FLAG_BOOLEAN_LITERAL = 512;

/** Mask for homogeneous literal unions (string | number | boolean literals) */
const HOMOGENEOUS_LITERAL_MASK = TYPE_FLAG_STRING_LITERAL | TYPE_FLAG_NUMBER_LITERAL | TYPE_FLAG_BOOLEAN_LITERAL;

/** Threshold for union types considered "wide" */
const WIDE_UNION_THRESHOLD = 4;

/**
 * Check if a parameter's type annotation is literally the `any` keyword.
 *
 * Returns false for named type references (e.g. `Foo`) that happen to
 * resolve to `any` due to unresolved conditional types or generics — those
 * are type resolution artifacts, not genuine `any` declarations.
 *
 * @param node - The parameter AST node
 * @returns True only if the annotation is literally `: any`
 */
function hasLiteralAnyAnnotation(node: ts.ParameterDeclaration): boolean {
  const typeNode = node.type
  if (!typeNode) return false
  return typeNode.kind === ts.SyntaxKind.AnyKeyword
}

/**
 * Check if a parameter type is problematic for V8 inline caches.
 *
 * Only flags parameters with a literal `: any` annotation or wide union types.
 * Named types that resolve to `any` at the checker level (e.g. from unresolved
 * conditional types) are skipped — the developer wrote a concrete type, the
 * checker just couldn't resolve it.
 *
 * @param typeInfo - Type information for the parameter
 * @param node - The parameter AST node
 * @returns True if the type is literally `any` or a heterogeneous wide union
 */
function isProblematicParamType(typeInfo: TypeInfo | null, node: ts.ParameterDeclaration): boolean {
  if (!typeInfo) return false;

  // Only flag `any` when the developer literally wrote `: any`.
  // Inferred `any` or named types resolving to `any` are not actionable.
  if (typeInfo.flags & TYPE_FLAG_ANY) return hasLiteralAnyAnnotation(node);

  // Skip unions of homogeneous literals (e.g., "foo" | "bar" | "baz")
  if (typeInfo.flags & TYPE_FLAG_UNION) {
    const hasLiteralTypes = typeInfo.flags & HOMOGENEOUS_LITERAL_MASK;
    if (hasLiteralTypes && !(typeInfo.flags & ~(TYPE_FLAG_UNION | HOMOGENEOUS_LITERAL_MASK))) {
      return false;
    }
  }

  const raw = typeInfo.raw;
  let pipeCount = 0;
  let depth = 0;
  for (let i = 0, len = raw.length; i < len; i++) {
    const ch = raw.charCodeAt(i);
    // Track nesting depth for { } [ ] < > ( )
    if (ch === 123 || ch === 91 || ch === 60 || ch === 40) { depth++; continue; }
    if (ch === 125 || ch === 93 || ch === 62 || ch === 41) { depth--; continue; }
    // Only count pipes at the top level of the type string
    if (ch === 124 && depth === 0) pipeCount++;
  }

  return pipeCount > WIDE_UNION_THRESHOLD;
}

const messages = {
  megamorphicAccess:
    "Property access on `any` or wide union type causes V8 deoptimization. Consider narrowing the type.",
} as const;

const options = {};

export const avoidMegamorphicPropertyAccess = defineSolidRule({
  id: "avoid-megamorphic-property-access",
  severity: "warn",
  messages,
  meta: {
    description: "Avoid property access on `any` or wide union types to prevent V8 deoptimization.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    for (const fn of graph.functions) {
      const params = fn.params;
      if (params.length === 0) continue;

      for (let i = 0, plen = params.length; i < plen; i++) {
        const param = params[i];
        if (!param) continue;
        if (!param.name) continue;

        const typeInfo = getTypeInfo(graph, param.node);
        if (!isProblematicParamType(typeInfo, param.node)) continue;

        const accesses = getMemberAccessesOnIdentifier(fn, param.name);
        if (accesses.length === 0) continue;

        for (let j = 0, alen = accesses.length; j < alen; j++) {
          const access = accesses[j];
          if (!access) continue;
          emit(
            createDiagnostic(
              graph.file,
              access,
              graph.sourceFile,
              "avoid-megamorphic-property-access",
              "megamorphicAccess",
              messages.megamorphicAccess,
              "warn",
            ),
          );
        }
      }
    }
  },
});
