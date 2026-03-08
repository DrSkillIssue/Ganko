/**
 * Avoid Type Casting Rule
 *
 * Flags various type casting methods that bypass TypeScript's type safety:
 *
 * 1. Unnecessary casts: `node.left as Expression` when node.left is already Expression
 *    - Common AI slop pattern - casting to a type the value already has
 *    - Shows lack of understanding of the type system
 *
 * 2. Double assertions: `x as unknown as Type`
 *    - Bypasses type checking by casting through unknown/any
 *
 * 3. Discriminated union casting: `apiCall() as Response`
 *    - Assumes API response type without runtime validation
 *
 * 4. Type predicates (`is` keyword): `value is string`
 *    - User-defined type guards can lie to the compiler
 *
 * 5. Casting to `any`: `x as any`
 *    - Completely disables type checking
 *
 * 6. Casting in loops: `item as ComplexType` inside for/while
 *    - Repeated unsafe casts without validation
 *
 * 7. Unsafe generic assertions: `return x as T`
 *    - Generic type parameters used without constraints
 *
 * 8. Import assertions: `import type { TSESTree as T }`
 *    - Because why not
 *
 * All checks are individually configurable via rule options.
 */

import type { TypeAssertionEntity, TypePredicateEntity, UnsafeGenericAssertionEntity } from "../../entities/type-assertion"
import type { Diagnostic, Fix } from "../../../diagnostic"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getExpressionName, getTypeName } from "../../util/expression"
import { getSourceCode, getTypeAssertions, getTypePredicates, getUnsafeGenericAssertions } from "../../queries"

interface Options extends Record<string, unknown> {
  doubleAssertion: boolean
  castToAny: boolean
  simpleAssertion: boolean
  assertionInLoop: boolean
  importAssertion: boolean
  typePredicate: boolean
  unsafeGeneric: boolean
  unnecessaryCast: boolean
}

const messages = {
  unnecessaryCast:
    "Unnecessary type assertion: \"{{name}}\" is already of type \"{{exprType}}\", " +
    "which is assignable to \"{{type}}\". Remove the cast - it adds noise and suggests you don't understand the types.",
  doubleAssertion:
    "Double assertion detected: \"{{name}}\" is cast through unknown/any to \"{{type}}\". " +
    "This bypasses type safety. You are creating sloppy architecture.",
  castToAny:
    "Casting \"{{name}}\" to `any` disables all type checking. " +
    "Use `unknown` with proper type guards, or fix the underlying type issue.",
  castToUnknown:
    "Casting to `unknown` requires runtime type checks before use. " +
    "You are creating sloppy architecture.",
  simpleAssertion:
    "Type assertion on \"{{name}}\" to \"{{type}}\" bypasses type checking. " +
    "Why are you doing this? Do you EVEN need this? This is sloppy architecture.",
  assertionInLoop:
    "Type assertion on \"{{name}}\" inside a loop. " +
    "Repeated casts to \"{{type}}\" without validation can mask type errors. " +
    "Consider validating the type once before the loop.",
  importAssertion:
    "Type assertion on dynamic import to \"{{type}}\". " +
    "Import types should be validated at runtime or use proper module type declarations.",
  typePredicate:
    "Type predicate function asserts \"{{param}}\" is \"{{type}}\". " +
    "Why are you doing this? Do you EVEN need this? This is sloppy architecture.",
  unsafeGeneric:
    "Casting to generic type parameter \"{{typeParam}}\" without runtime validation. " +
    "The function returns an unverified type. This is sloppy architecture.",
} as const

/**
 * Create a fix that removes the type assertion, keeping only the expression.
 * @param assertion - The type assertion entity
 * @param sourceText - The full source code text
 * @returns A fix that replaces the assertion with just the expression
 */
function createRemoveCastFix(assertion: TypeAssertionEntity, sourceText: string): Fix {
  const expr = assertion.expression
  const exprText = sourceText.slice(expr.range[0], expr.range[1])
  return [{
    range: [assertion.node.range[0], assertion.node.range[1]],
    text: exprText,
  }]
}

/**
 * Check a type assertion entity and generate diagnostics if needed.
 * May return multiple diagnostics for a single assertion (e.g., cast-to-any inside a loop).
 * @param assertion - The type assertion entity to check
 * @param options - Rule options controlling which assertions to flag
 * @param sourceText - The full source code text for generating fixes
 * @returns Array of diagnostics for this assertion
 */
function checkTypeAssertion(
  assertion: TypeAssertionEntity,
  options: Options,
  sourceText: string,
  file: string,
): Diagnostic[] {
  const results: Diagnostic[] = []
  const name = getExpressionName(assertion.expression)
  const typeName = getTypeName(assertion.typeAnnotation)

  // Check for unnecessary cast first - this is the most common AI slop pattern
  if (assertion.isUnnecessary && options.unnecessaryCast) {
    const exprType = assertion.expressionType ?? "inferred type"
    const fix = createRemoveCastFix(assertion, sourceText)
    results.push(createDiagnostic(
      file,
      assertion.node,
      "avoid-type-casting",
      "unnecessaryCast",
      resolveMessage(messages.unnecessaryCast, { name, type: typeName, exprType }),
      "error",
      fix,
    ))
    // Don't report other issues if it's an unnecessary cast
    return results
  }

  if (assertion.kind === "double" && options.doubleAssertion) {
    results.push(createDiagnostic(
      file,
      assertion.node,
      "avoid-type-casting",
      "doubleAssertion",
      resolveMessage(messages.doubleAssertion, { name, type: typeName }),
      "error",
    ))
  }

  if (assertion.kind === "cast-to-any" && options.castToAny) {
    results.push(createDiagnostic(
      file,
      assertion.node,
      "avoid-type-casting",
      "castToAny",
      resolveMessage(messages.castToAny, { name }),
      "error",
    ))
  }

  // Skip const-assertion for loop check - `as const` in loops is type-safe
  if (assertion.inLoop && options.assertionInLoop && assertion.kind !== "const-assertion") {
    results.push(createDiagnostic(
      file,
      assertion.node,
      "avoid-type-casting",
      "assertionInLoop",
      resolveMessage(messages.assertionInLoop, { name, type: typeName }),
      "error",
    ))
  }

  if (assertion.onImport && options.importAssertion) {
    results.push(createDiagnostic(
      file,
      assertion.node,
      "avoid-type-casting",
      "importAssertion",
      resolveMessage(messages.importAssertion, { type: typeName }),
      "error",
    ))
  }

  if (assertion.kind === "simple" && options.simpleAssertion && !assertion.inLoop) {
    results.push(createDiagnostic(
      file,
      assertion.node,
      "avoid-type-casting",
      "simpleAssertion",
      resolveMessage(messages.simpleAssertion, { name, type: typeName }),
      "error",
    ))
  }

  return results
}

/**
 * Check a type predicate function and generate diagnostic if needed.
 * @param predicate - The type predicate entity to check
 * @param options - Rule options controlling whether to flag predicates
 * @returns A diagnostic or null if no issue
 */
function checkTypePredicate(
  predicate: TypePredicateEntity,
  options: Options,
  file: string,
): Diagnostic | null {
  if (!options.typePredicate) return null

  const typeName = getTypeName(predicate.typeAnnotation)

  return createDiagnostic(
    file,
    predicate.node,
    "avoid-type-casting",
    "typePredicate",
    resolveMessage(messages.typePredicate, { param: predicate.parameterName, type: typeName }),
    "error",
  )
}

/**
 * Check an unsafe generic assertion and generate diagnostic if needed.
 * @param unsafeGeneric - The unsafe generic assertion entity to check
 * @param options - Rule options controlling whether to flag generics
 * @returns A diagnostic or null if no issue
 */
function checkUnsafeGeneric(
  unsafeGeneric: UnsafeGenericAssertionEntity,
  options: Options,
  file: string,
): Diagnostic | null {
  if (!options.unsafeGeneric) return null

  return createDiagnostic(
    file,
    unsafeGeneric.assertion,
    "avoid-type-casting",
    "unsafeGeneric",
    resolveMessage(messages.unsafeGeneric, { typeParam: unsafeGeneric.typeParameterName }),
    "error",
  )
}

const options: Options = {
  doubleAssertion: true,
  castToAny: true,
  simpleAssertion: false,
  assertionInLoop: true,
  importAssertion: true,
  typePredicate: true,
  unsafeGeneric: true,
  unnecessaryCast: true,
}

export const avoidTypeCasting = defineSolidRule({
  id: "avoid-type-casting",
  severity: "error",
  messages,
  meta: {
    description:
      "Disallow type casting methods that bypass TypeScript's type safety. " +
      "Includes unnecessary casts, double assertions, casting to any, type predicates, and unsafe generic assertions.",
    fixable: true,
    category: "correctness",
  },
  options,
  check(graph, emit) {
    const sourceText = getSourceCode(graph).text
    const file = graph.file

    const typeAssertions = getTypeAssertions(graph)
    for (let i = 0, len = typeAssertions.length; i < len; i++) {
      const assertion = typeAssertions[i];
      if (!assertion) continue;
      const issues = checkTypeAssertion(assertion, options, sourceText, file)
      for (let j = 0, jlen = issues.length; j < jlen; j++) {
        const issue = issues[j];
        if (!issue) continue;
        emit(issue)
      }
    }

    const typePredicates = getTypePredicates(graph)
    for (let i = 0, len = typePredicates.length; i < len; i++) {
      const predicate = typePredicates[i]
      if (!predicate) return;
      const issue = checkTypePredicate(predicate, options, file)
      if (issue) {
        emit(issue)
      }
    }

    const unsafeGenerics = getUnsafeGenericAssertions(graph)
    for (let i = 0, len = unsafeGenerics.length; i < len; i++) {
      const unsafeGeneric = unsafeGenerics[i]
      if (!unsafeGeneric) return;
      const issue = checkUnsafeGeneric(unsafeGeneric, options, file)
      if (issue) {
        emit(issue)
      }
    }
  },
})
