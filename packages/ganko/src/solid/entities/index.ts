/**
 * Graph Entities Index
 *
 * This module re-exports all entity types for the program graph.
 * Only entity types and constants - utilities are in ../utils
 */

// File
export type { FileEntity } from "./file";

// Scope
export type { ScopeEntity, TrackingContext } from "./scope";
export { UNKNOWN_CONTEXT } from "./scope";

// Variable
export type { VariableEntity, ReactiveKind, AssignmentEntity, AssignmentOperator, ReadEntity } from "./variable";

// Function
export type { FunctionEntity, ParameterEntity, FunctionNode } from "./function";

// Call
export type {
  CallEntity,
  ArgumentEntity,
  ArgumentSemantic,
  ParameterSemantic,
  PrimitiveInfo,
  PrimitiveReturn,
} from "./call";

// JSX
export type {
  JSXElementEntity,
  JSXAttributeEntity,
  JSXChildEntity,
  JSXContext,
  SpreadProp,
  SpreadInfo,
  StyleComplexityInfo,
} from "./jsx";

// Import
export type { ImportEntity, ImportSpecifierEntity } from "./import";

// Inline Import
export type { InlineImportEntity } from "./inline-import";

// Spread
export type {
  ConditionalSpreadEntity,
  FixableSpreadPattern,
  FixableSpreadProperty,
  ObjectSpreadEntity,
  ObjectSpreadKind,
  SpreadAttributeContext,
  SpreadSourceKind,
  SpreadSourceReactivity,
} from "./spread";

// Non-null assertion
export type { NonNullAssertionEntity } from "./non-null-assertion";

// Type assertion
export type {
  TypeAssertionEntity,
  TypeAssertionKind,
  TypePredicateEntity,
  UnsafeGenericAssertionEntity,
  UnsafeTypeAnnotationEntity,
  UnsafeAnnotationPosition,
  UnsafeAnnotationKind,
} from "./type-assertion";

// Export
export type { ExportEntity } from "./export";
export { EMPTY_EXPORTS, ExportKind } from "./export";

// Class
export type { ClassEntity, ClassNode } from "./class";

// Property
export type { PropertyEntity } from "./property";

// Return Statement
export type { ReturnStatementEntity } from "./return-statement";

// Computation (reactive dependency graph)
export type { ComputationEntity, ComputationKind, DependencyEdge, OwnershipEdge } from "./computation";
export { computationKindFor } from "./computation";
