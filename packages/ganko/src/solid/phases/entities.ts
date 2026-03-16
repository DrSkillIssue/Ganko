/**
 * Entities Phase (Phase 3)
 *
 * Traverses AST to create semantic entities and build indexes.
 *
 * Entities created:
 * - FunctionEntity (declarations, expressions, arrows)
 * - CallEntity (calls + Solid primitive detection)
 * - JSXElementEntity (elements + fragments)
 * - ImportEntity / InlineImportEntity
 * - ClassEntity / PropertyEntity
 * - ReturnStatementEntity
 * - ObjectSpreadEntity / ConditionalSpreadEntity
 * - TypeAssertionEntity / NonNullAssertionEntity
 * - TypePredicateEntity / UnsafeGenericAssertionEntity
 * - PropertyAssignmentEntity (obj.prop = value)
 *
 * AST indexes built:
 * - unaryExpressionsByOperator
 * - spreadElements
 * - newExpressionsByCallee
 * - identifiersByName (via addIdentifierReference)
 * - positionIndex (via addToPositionIndex)
 *
 * Also identifies component functions (PascalCase naming).
 *
 * Implementation split into:
 * - entities/context.ts - VisitorContext + stack management
 * - entities/visitors/  - AST traversal (statement, expression, jsx, type)
 * - entities/handlers/  - Entity creation (function, call, jsx, class, etc.)
 * - entities/helpers.ts - Pure utility functions
 */
import type { SolidGraph } from "../impl";
import type { SolidInput } from "../input";
import { createVisitorContext } from "./entities/context";
import { visitProgram } from "./entities/visitors";

export function runEntitiesPhase(graph: SolidGraph, input: SolidInput): void {
  const ctx = createVisitorContext(graph);
  visitProgram(ctx, input.sourceFile);
  graph.componentFunctions = ctx.componentFunctions;
}
