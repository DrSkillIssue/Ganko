/**
 * TypeScript Integration Module
 *
 * This module provides TypeScript type resolution for the program graph.
 * When TypeScript parser services are available, we can:
 * - Get the type of any expression
 * - Detect Solid-specific types (Accessor, Signal, Store, Component)
 * - Mark variables as reactive based on their types
 */

import { TSESTree as T, type ParserServices } from "@typescript-eslint/utils";
import ts from "typescript";
import type { Logger } from "@ganko/shared";
import { noopLogger } from "@ganko/shared";

import type { ReactiveKind } from "../entities/variable";

/**
 * Type information for a node resolved from TypeScript.
 *
 * Provides reactive kind detection, type flags, and serialized type representation.
 * The `flags` field contains TypeScript's TypeFlags bitmask for the type.
 */
export interface TypeInfo {
  raw: string;
  flags: number;
  isAccessor: boolean;
  isSignal: boolean;
  isStore: boolean;
  isComponent: boolean;
}

/**
 * Information about a property on an object type.
 * Used for expanding object spreads into explicit property assignments.
 */
export interface ObjectPropertyInfo {
  /** The property name */
  readonly name: string;
  /** Whether the property is optional (has ? modifier) */
  readonly optional: boolean;
  /** The TypeScript type as a string */
  readonly type: string;
}

/**
 * TypeScript's internal type properties that exist at runtime but aren't
 * in the public type definitions.
 */
export type TSTypeWithInternals = ts.Type & {
  /** Type arguments for generic types */
  typeArguments?: readonly ts.Type[];
  /** Target type for instantiated generics (e.g., Array<T> -> Array) */
  target?: TSObjectTypeWithInternals;
  /** Resolved type arguments for tuples */
  resolvedTypeArguments?: readonly ts.Type[];
};

export type TSObjectTypeWithInternals = ts.ObjectType & {
  /** Type arguments on the target type */
  typeArguments?: readonly ts.Type[];
};

const NULL_REACTIVE_RESULT: { kind: null; type: null } = Object.freeze({ kind: null, type: null });
const COMPONENT_TYPE_NAMES = new Set([
  "Component",
  "ParentComponent",
  "FlowComponent",
  "VoidComponent",
]);

/**
 * Parser services with type information
 */
interface TypedParserServices {
  program: ts.Program;
  getTypeAtLocation: (node: T.Node) => ts.Type;
  getSymbolAtLocation: (node: T.Node) => ts.Symbol | undefined;
}

/**
 * Service for resolving TypeScript types from ESLint parser services.
 */
export class TypeResolver {
  private services: TypedParserServices | null = null;
  private typeChecker: ts.TypeChecker | null = null;
  private typeCache = new WeakMap<T.Node, TypeInfo | null>();
  private solidSymbolCache = new Map<ts.Symbol, boolean>();
  readonly logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? noopLogger;
  }

  /**
   * Configure the type resolver with ESLint parser services.
   *
   * Returns true if TypeScript services are available, false otherwise.
   * When false, all type queries will return null/false gracefully.
   */
  initialize(parserServices: Partial<ParserServices> | undefined): boolean {
    const typedServices = getTypedParserServices(parserServices);
    if (!typedServices) {
      this.services = null;
      this.typeChecker = null;
      return false;
    }

    this.services = typedServices;
    this.typeChecker = typedServices.program.getTypeChecker();
    this.solidSymbolCache.clear();
    return true;
  }


  private isSymbolFromSolid(symbol: ts.Symbol | undefined): boolean {
    if (!symbol) return false;

    const cached = this.solidSymbolCache.get(symbol);
    if (cached !== undefined) return cached;

    const declarations = symbol.getDeclarations();
    if (!declarations?.length) {
      this.solidSymbolCache.set(symbol, false);
      return false;
    }

    const firstDecl = declarations[0];
    if (!firstDecl) {
      this.solidSymbolCache.set(symbol, false);
      return false;
    }
    const fileName = firstDecl.getSourceFile().fileName;
    const result = fileName.includes("/solid-js/") || fileName.includes("\\solid-js\\");
    this.solidSymbolCache.set(symbol, result);
    return result;
  }


  private isSolidSymbol(symbol: ts.Symbol | undefined, name: string): boolean {
    if (!symbol) return false;
    if (symbol.getName() !== name) return false;
    return this.isSymbolFromSolid(symbol);
  }

  /**
   * Check if TypeScript services are available.
   */
  hasTypeInfo(): boolean {
    return this.services !== null;
  }

  /**
   * Get the type info for a node.
   *
   * Returns null if TypeScript services are not available or if the type
   * cannot be determined.
   */
  getType(node: T.Node): TypeInfo | null {
    if (!this.services || !this.typeChecker) {
      return null;
    }

    const cached = this.typeCache.get(node);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const tsType = this.services.getTypeAtLocation(node);
      const typeInfo = this.analyzeType(tsType, this.typeChecker);

      this.typeCache.set(node, typeInfo);
      return typeInfo;
    } catch {
      this.typeCache.set(node, null);
      return null;
    }
  }

  /**
   * Check if a node's type is an Accessor type (Accessor<T>).
   */
  isAccessorType(node: T.Node): boolean {
    const typeInfo = this.getType(node);
    return typeInfo?.isAccessor ?? false;
  }

  /**
   * Check if a node's type is a Signal type (Signal<T>).
   */
  isSignalType(node: T.Node): boolean {
    const typeInfo = this.getType(node);
    return typeInfo?.isSignal ?? false;
  }

  /**
   * Check if a node's type is a Store type (Store<T>).
   */
  isStoreType(node: T.Node): boolean {
    const typeInfo = this.getType(node);
    return typeInfo?.isStore ?? false;
  }

  /**
   * Check if a node's type is a Component type (Component<P>).
   */
  isComponentType(node: T.Node): boolean {
    const typeInfo = this.getType(node);
    return typeInfo?.isComponent ?? false;
  }

  /**
   * Determine the reactive kind of a variable based on its type.
   *
   * Returns null if the type is not reactive.
   */
  getReactiveKind(node: T.Node): ReactiveKind | null {
    const typeInfo = this.getType(node);
    if (!typeInfo) return null;

    if (typeInfo.isSignal) return "signal";
    if (typeInfo.isStore) return "store";
    if (typeInfo.isAccessor) return "accessor";

    return null;
  }

  /**
   * Get both reactive kind AND type info in a single call.
   */
  getReactiveKindWithType(node: T.Node): { kind: ReactiveKind | null; type: TypeInfo | null } {
    const typeInfo = this.getType(node);
    if (!typeInfo) return NULL_REACTIVE_RESULT;

    let kind: ReactiveKind | null = null;
    if (typeInfo.isSignal) kind = "signal";
    else if (typeInfo.isStore) kind = "store";
    else if (typeInfo.isAccessor) kind = "accessor";

    return { kind, type: typeInfo };
  }

  /**
   * Classify the element type of an array expression.
   * Uses TypeScript's type system directly.
   *
   * @param node The array expression node (e.g., props.users in `<For each={props.users}>`)
   * @returns "primitive" | "object" | "unknown"
   */
  getArrayElementKind(node: T.Node): "primitive" | "object" | "unknown" {
    if (!this.services || !this.typeChecker) {
      return "unknown";
    }

    try {
      const tsType = this.services.getTypeAtLocation(node);
      const elementType = getArrayElementType(tsType, this.typeChecker);

      if (!elementType) {
        return "unknown";
      }

      return classifyTypeKind(elementType);
    } catch {
      return "unknown";
    }
  }

  /**
   * Check if a node's type is an array type.
   * Detects Array<T>, T[], ReadonlyArray<T>, and tuple types.
   */
  isArrayType(node: T.Node): boolean {
    if (!this.services || !this.typeChecker) {
      return false;
    }

    try {
      const tsType = this.services.getTypeAtLocation(node);
      return this.checkIsArrayType(tsType);
    } catch {
      return false;
    }
  }

  private checkIsArrayType(tsType: ts.Type): boolean {
    // Check if it's an object type first
    if (tsType.flags & 524288) { // TypeFlags.Object
      const objFlags = getObjectFlags(tsType);

      // Tuple type (ObjectFlags.Tuple = 8)
      if (objFlags & 8) return true;

      // Reference type like Array<T> (ObjectFlags.Reference = 4)
      if (objFlags & 4) {
        const symbol = tsType.getSymbol();
        const name = symbol?.getName();
        if (name === "Array" || name === "ReadonlyArray") return true;
      }

      // Check for array-like via type checker
      if (this.typeChecker) {
        const indexType = this.typeChecker.getIndexTypeOfType(tsType, ts.IndexKind.Number);
        if (indexType) return true;
      }
    }

    // Union types - check if any constituent is array
    if (tsType.isUnion()) {
      for (const t of tsType.types) {
        if (this.checkIsArrayType(t)) return true;
      }
    }

    return false;
  }

  /**
   * Check if a node's type is callable (has call signatures).
   * Detects functions, arrow functions, and callable objects.
   */
  isCallableType(node: T.Node): boolean {
    if (!this.services || !this.typeChecker) {
      return false;
    }

    try {
      const tsType = this.services.getTypeAtLocation(node);
      const signatures = tsType.getCallSignatures();
      return signatures.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Check if a type assertion is unnecessary because the expression
   * is already assignable to the target type.
   *
   * Detects AI slop patterns like:
   * - `node.left as T.Expression` when node.left is already Expression
   * - `node.expression as T.Expression` when it's already Expression
   *
   * @param expression - The expression being cast
   * @param targetType - The TypeNode being cast to
   * @returns true if the cast is unnecessary, false otherwise
   */
  isUnnecessaryCast(expression: T.Expression, targetType: T.TypeNode): boolean {
    if (!this.services || !this.typeChecker) {
      return false;
    }

    try {
      const exprTsType = this.services.getTypeAtLocation(expression);
      const targetTsType = this.services.getTypeAtLocation(targetType);

      // `any` is assignable to everything — casting FROM `any` is a narrowing
      // operation that adds type safety, and casting TO `any` makes every
      // expression look assignable. Neither direction is "unnecessary".
      if (exprTsType.flags & ts.TypeFlags.Any) return false;
      if (targetTsType.flags & ts.TypeFlags.Any) return false;

      // Check if expression type is assignable to target type
      // If assignable, the cast is unnecessary
      const result = this.typeChecker.isTypeAssignableTo(exprTsType, targetTsType);

      if (this.logger.enabled) {
        const exprStr = this.typeChecker.typeToString(exprTsType);
        const targetStr = this.typeChecker.typeToString(targetTsType);
        this.logger.debug(`isUnnecessaryCast: expr="${exprStr.slice(0, 120)}" target="${targetStr.slice(0, 120)}" assignable=${result} exprFlags=${exprTsType.flags} targetFlags=${targetTsType.flags}`);
      }

      return result;
    } catch {
      return false;
    }
  }

  /**
   * Get a human-readable string for a TypeScript type at a node.
   * Returns null if type info is unavailable.
   */
  getTypeString(node: T.Node): string | null {
    if (!this.services || !this.typeChecker) {
      return null;
    }

    try {
      const tsType = this.services.getTypeAtLocation(node);
      return this.typeChecker.typeToString(tsType);
    } catch {
      return null;
    }
  }

  /**
   * Check if a property exists on an object's type.
   * Handles union types by checking the non-null/undefined constituents.
   *
   * @param objectNode The object expression to check
   * @param propertyName The property name to look for
   * @returns true if property exists on type, false otherwise
   */
  hasPropertyOnType(objectNode: T.Node, propertyName: string): boolean {
    if (!this.services || !this.typeChecker) {
      return false;
    }

    try {
      const tsType = this.services.getTypeAtLocation(objectNode);
      return this.checkPropertyOnType(tsType, propertyName);
    } catch {
      // When type resolution fails (ESTree↔TSNode mapping gaps, stale program state),
      // assume the property exists — false negatives are acceptable, false positives are not.
      return true;
    }
  }

  /**
   * Check if a property exists on a type, handling unions specially.
   */
  private checkPropertyOnType(tsType: ts.Type, propertyName: string): boolean {
    const property = tsType.getProperty(propertyName);
    if (property !== undefined) return true;

    if (tsType.isUnion()) {
      for (const constituent of tsType.types) {
        const flags = constituent.flags;
        if (flags & ts.TypeFlags.Null || flags & ts.TypeFlags.Undefined) {
          continue;
        }
        if (this.checkPropertyOnType(constituent, propertyName)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get properties of an object type for spread expansion.
   * Returns null if the type cannot be safely expanded.
   *
   * @param node The AST node to analyze
   * @param maxProperties Maximum properties to return (default 10)
   * @param includeCallable Include function-typed properties (for JSX props)
   * @returns Array of property info or null if not expandable
   */
  getObjectProperties(node: T.Node, maxProperties = 10, includeCallable = false): readonly ObjectPropertyInfo[] | null {
    if (!this.services || !this.typeChecker) {
      return null;
    }

    try {
      const tsType = this.services.getTypeAtLocation(node);
      return this.extractObjectProperties(tsType, maxProperties, includeCallable);
    } catch {
      return null;
    }
  }



  /**
   * Extract properties from a TypeScript type.
   * Returns null for types that can't be safely expanded.
   *
   * @param tsType The TypeScript type to extract from
   * @param maxProperties Maximum number of properties
   * @param includeCallable Whether to include function-typed properties
   */
  private extractObjectProperties(tsType: ts.Type, maxProperties: number, includeCallable: boolean): readonly ObjectPropertyInfo[] | null {
    if (!this.typeChecker) return null;

    // Skip union types - too complex to expand safely
    if (tsType.isUnion()) return null;

    // Intersection types: getProperties() returns the merged property set,
    // so the extraction logic below handles them correctly.

    // Must be an object type (or intersection of object types)
    if (!(tsType.flags & (524288 | 2097152))) return null; // TypeFlags.Object | TypeFlags.Intersection

    // Check for index signatures - can't expand dynamic keys
    const stringIndex = this.typeChecker.getIndexTypeOfType(tsType, ts.IndexKind.String);
    const numberIndex = this.typeChecker.getIndexTypeOfType(tsType, ts.IndexKind.Number);
    if (stringIndex || numberIndex) return null;

    // Get declared properties
    const properties = tsType.getProperties();
    if (properties.length === 0) return null;
    if (properties.length > maxProperties) return null;

    const result: ObjectPropertyInfo[] = [];
    const checker = this.typeChecker;

    for (const prop of properties) {
      const name = prop.getName();

      // Skip internal/private properties
      if (name.startsWith("_") || name.startsWith("#")) continue;

      // Get declaration for type lookup
      const declaration = prop.valueDeclaration ?? prop.declarations?.[0];
      if (!declaration) continue;

      const propType = checker.getTypeOfSymbolAtLocation(prop, declaration);

      // Skip methods unless including callable properties (JSX props)
      if (!includeCallable && propType.getCallSignatures().length > 0) continue;

      // Check if optional
      const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;

      // Get type string
      const type = checker.typeToString(propType);

      result.push({ name, optional, type });
    }

    return result.length > 0 ? result : null;
  }

  /**
   * Get the props properties of a Solid component from its JSX tag identifier.
   *
   * Resolves the component function's type, gets its first call signature's
   * first parameter type, and extracts properties from that. This is the
   * fallback path when the spread argument type itself is unresolvable (e.g.
   * `any` inside a Show callback) but the component's props type is known.
   *
   * @param tagNode - The JSX identifier node (e.g. the `ConfirmActionDialog` in `<ConfirmActionDialog>`)
   * @returns Property info or null if not resolvable
   */
  getComponentPropsProperties(tagNode: T.Node): readonly ObjectPropertyInfo[] | null {
    if (!this.services || !this.typeChecker) return null;

    try {
      const componentType = this.services.getTypeAtLocation(tagNode);
      const signatures = componentType.getCallSignatures();
      if (signatures.length === 0) return null;

      // Use the first call signature's first parameter
      const sig = signatures[0];
      if (!sig) return null;
      const params = sig.getParameters();
      if (params.length === 0) return null;

      const propsParam = params[0];
      if (!propsParam) return null;
      const declaration = propsParam.valueDeclaration ?? propsParam.declarations?.[0];
      if (!declaration) return null;

      const propsType = this.typeChecker.getTypeOfSymbolAtLocation(propsParam, declaration);
      return this.extractObjectProperties(propsType, 20, true);
    } catch {
      return null;
    }
  }

  private analyzeType(tsType: ts.Type, typeChecker: ts.TypeChecker): TypeInfo {
    const raw = typeChecker.typeToString(tsType);
    const flags = this.getAggregatedFlags(tsType);

    // Check for Solid-specific types using structural and symbol-based detection
    const isAccessor = this.isSolidAccessorType(tsType);
    const isSignal = this.isSolidSignalType(tsType);
    const isStore = this.isSolidStoreType(tsType);
    const isComponent = this.isSolidComponentType(tsType);

    return {
      raw,
      flags,
      isAccessor,
      isSignal,
      isStore,
      isComponent,
    };
  }

  /**
   * Get aggregated TypeFlags for a type.
   * For union/intersection types, combines flags from all constituent types.
   */
  private getAggregatedFlags(tsType: ts.Type): number {
    const baseFlags = tsType.getFlags();

    // For unions, aggregate flags from all constituent types
    if (tsType.isUnion()) {
      let unionFlags = baseFlags;
      for (const t of tsType.types) {
        unionFlags |= t.getFlags();
      }
      return unionFlags;
    }

    // For intersections, aggregate flags similarly
    if (tsType.isIntersection()) {
      let intersectionFlags = baseFlags;
      for (const t of tsType.types) {
        intersectionFlags |= t.getFlags();
      }
      return intersectionFlags;
    }

    return baseFlags;
  }

  /**
   * Check if a type is a Solid Accessor type.
   *
   * An Accessor<T> is structurally () => T - a zero-parameter callable.
   * Only uses symbol-based detection to avoid false positives on regular functions.
   */
  private isSolidAccessorType(tsType: ts.Type): boolean {
    const symbol = tsType.aliasSymbol ?? tsType.getSymbol();
    return this.isSolidSymbol(symbol, "Accessor");
  }

  /**
   * Check if a type is a Solid Signal type.
   * Detects Signal<T> via symbol or [Accessor<T>, Setter<T>] tuple structure.
   */
  private isSolidSignalType(tsType: ts.Type): boolean {
    // Check for explicit Signal<T> type from solid-js
    const symbol = tsType.getSymbol() ?? tsType.aliasSymbol;
    if (this.isSolidSymbol(symbol, "Signal")) {
      return true;
    }

    // Structural check: [Accessor<T>, Setter<T>] tuple from createSignal
    if (this.typeChecker && isTupleType(tsType)) {
      const typeArgs = getTypeArguments(tsType);
      if (typeArgs?.length === 2) {
        const first = typeArgs[0];
        const second = typeArgs[1];
        if (!first || !second) return false;
        const firstSymbol = first.aliasSymbol ?? first.getSymbol();
        const secondSymbol = second.aliasSymbol ?? second.getSymbol();

        if (
          this.isSolidSymbol(firstSymbol, "Accessor") &&
          this.isSolidSymbol(secondSymbol, "Setter")
        ) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if a type is a Solid Store type (for reactive reads).
   * Excludes SetStoreFunction which is a setter, not a reactive read.
   */
  private isSolidStoreType(tsType: ts.Type): boolean {
    const symbol = tsType.getSymbol() ?? tsType.aliasSymbol;
    if (!symbol) return false;

    const name = symbol.getName();

    // Exclude SetStoreFunction - it's a setter, not a reactive store
    if (name === "SetStoreFunction") return false;

    // Check for Store<T> from solid-js
    if (name === "Store" && this.isSymbolFromSolid(symbol)) {
      return true;
    }

    return false;
  }

  /**
   * Check if a type is a Solid Component type.
   */
  private isSolidComponentType(tsType: ts.Type): boolean {
    const symbol = tsType.getSymbol() ?? tsType.aliasSymbol;
    if (!symbol) return false;

    const name = symbol.getName();
    if (!COMPONENT_TYPE_NAMES.has(name)) return false;

    return this.isSymbolFromSolid(symbol);
  }
}

/**
 * Check if parser services have type information available and extract typed services.
 *
 * @param services - The parser services object to check
 * @returns Typed parser services if available, null otherwise
 */
function getTypedParserServices(services: Partial<ParserServices> | undefined): TypedParserServices | null {
  if (
    !services ||
    !("program" in services) ||
    !services.program ||
    !("getTypeAtLocation" in services) ||
    typeof services.getTypeAtLocation !== "function"
  ) {
    return null;
  }

  return {
    program: services.program,
    getTypeAtLocation: services.getTypeAtLocation,
    getSymbolAtLocation: "getSymbolAtLocation" in services && typeof services.getSymbolAtLocation === "function"
      ? services.getSymbolAtLocation
      : () => undefined,
  };
}

/**
 * Check if a type is a tuple type.
 *
 * @param type - The TypeScript type to check
 * @returns True if the type is a tuple type
 */
function isTupleType(type: ts.Type): boolean {
  const internals = getTypeInternals(type);
  // TypeScript's internal check for tuple types
  const target = internals.target;
  return !!(
    type.flags & 1 /* TypeFlags.Any */ ||
    (target && (target.objectFlags ?? 0) & 8) /* ObjectFlags.Tuple */
  );
}

/**
 * Check if a type is an array type and get its element type.
 *
 * @param type - The TypeScript type to check
 * @param typeChecker - The TypeScript type checker instance
 * @returns The element type if array, null otherwise
 */
function getArrayElementType(type: ts.Type, typeChecker: ts.TypeChecker): ts.Type | null {
  // Check for Array<T> or T[] via type reference
  const internals = getTypeInternals(type);

  // Array types have a symbol named "Array" and type arguments
  const symbol = type.getSymbol();
  if (symbol) {
    const name = symbol.getName();
    if (name === "Array" || name === "ReadonlyArray") {
      const typeArgs = getTypeArguments(type);
      if (typeArgs && typeArgs.length === 1) {
         return typeArgs[0] ?? null;
      }
    }
  }

  // Check target for instantiated generics (handles User[] syntax)
  const target = internals.target;
  if (target) {
    const targetSymbol = type.getSymbol?.();
    if (targetSymbol) {
      const targetName = targetSymbol.getName();
      if (targetName === "Array" || targetName === "ReadonlyArray") {
        const typeArgs = getTypeArguments(type);
        if (typeArgs && typeArgs.length === 1) {
          return typeArgs[0] ?? null;
        }
      }
    }
  }

  // Try getNumberIndexType for array-like types
  const indexType = typeChecker.getIndexTypeOfType(type, 1 /* IndexKind.Number */);
  if (indexType) {
    return indexType;
  }

  return null;
}

// TypeScript type flag constants (from ts.TypeFlags)
const TS_STRING_LIKE = 402653316; // String | StringLiteral | TemplateLiteral
const TS_NUMBER_LIKE = 296; // Number | NumberLiteral
const TS_BIGINT_LIKE = 2112; // BigInt | BigIntLiteral
const TS_BOOLEAN_LIKE = 528; // Boolean | BooleanLiteral
const TS_ES_SYMBOL_LIKE = 12288; // ESSymbol | UniqueESSymbol
const TS_VOID = 16384;
const TS_UNDEFINED = 32768;
const TS_NULL = 65536;
const TS_NEVER = 131072;
const TS_UNKNOWN = 2;
const TS_ANY = 1;

const TS_PRIMITIVE_FLAGS =
  TS_STRING_LIKE |
  TS_NUMBER_LIKE |
  TS_BIGINT_LIKE |
  TS_BOOLEAN_LIKE |
  TS_ES_SYMBOL_LIKE |
  TS_VOID |
  TS_UNDEFINED |
  TS_NULL |
  TS_NEVER;

// Flags that indicate ambiguous types (shouldn't warn)
const TS_AMBIGUOUS_FLAGS = TS_UNKNOWN | TS_ANY;

/**
 * Classify a type as primitive, object, or unknown.
 *
 * @param type - The TypeScript type to classify
 * @returns The type classification
 */
function classifyTypeKind(type: ts.Type): "primitive" | "object" | "unknown" {
  const flags = type.flags;

  // Check for ambiguous types first (any, unknown)
  if (flags & TS_AMBIGUOUS_FLAGS) {
    return "unknown";
  }

  if (flags & TS_PRIMITIVE_FLAGS) {
    return "primitive";
  }

  // Handle union types - check all constituents
  if (type.isUnion()) {
    const types = type.types;
    let hasPrimitive = false;
    let hasObject = false;

    for (let i = 0, len = types.length; i < len; i++) {
      const memberType = types[i];
      if (!memberType) continue;
      const memberKind = classifyTypeKind(memberType);
      if (memberKind === "unknown") {
        return "unknown";
      }
      if (memberKind === "primitive") {
        hasPrimitive = true;
      } else {
        hasObject = true;
      }
    }

    // Mixed union - can't make a recommendation
    if (hasPrimitive && hasObject) {
      return "unknown";
    }

    return hasPrimitive ? "primitive" : "object";
  }

  // Object types (interfaces, classes, object literals, etc.)
  // TypeFlags.Object = 524288
  if (flags & 524288) {
    return "object";
  }

  return "unknown";
}

/**
 * Get type arguments from a type reference.
 *
 * @param type - The TypeScript type to extract arguments from
 * @returns The type arguments if present, undefined otherwise
 */
function getTypeArguments(type: ts.Type): readonly ts.Type[] | undefined {
  const internals = getTypeInternals(type);

  if (internals.typeArguments) {
    return internals.typeArguments;
  }

  if (internals.target?.typeArguments) {
    return internals.target.typeArguments;
  }

  if (internals.resolvedTypeArguments) {
    return internals.resolvedTypeArguments;
  }
  return undefined;
}

/**
 * Get objectFlags from a type safely.
 *
 * @param type - TypeScript type
 * @returns The objectFlags value or 0
 */
function getObjectFlags(type: ts.Type): number {
  if ("objectFlags" in type && typeof type.objectFlags === "number") {
    return type.objectFlags;
  }
  return 0;
}

/**
 * Get internal type properties safely.
 *
 * @param type - TypeScript type
 * @returns Object with internal properties
 */
function getTypeInternals(type: ts.Type): {
  typeArguments?: readonly ts.Type[];
  target?: { objectFlags?: number; typeArguments?: readonly ts.Type[] };
  resolvedTypeArguments?: readonly ts.Type[];
} {
  const result: {
    typeArguments?: readonly ts.Type[];
    target?: { objectFlags?: number; typeArguments?: readonly ts.Type[] };
    resolvedTypeArguments?: readonly ts.Type[];
  } = {};

  if ("typeArguments" in type && Array.isArray(type.typeArguments)) {
    result.typeArguments = type.typeArguments;
  }

  if ("target" in type && typeof type.target === "object" && type.target !== null) {
    const target = type.target;
    result.target = {};
    if ("objectFlags" in target && typeof target.objectFlags === "number") {
      result.target.objectFlags = target.objectFlags;
    }
    if ("typeArguments" in target && Array.isArray(target.typeArguments)) {
      result.target.typeArguments = target.typeArguments;
    }
  }

  if ("resolvedTypeArguments" in type && Array.isArray(type.resolvedTypeArguments)) {
    result.resolvedTypeArguments = type.resolvedTypeArguments;
  }

  return result;
}

/**
 * Create a new TypeResolver instance.
 *
 * @param logger - Logger for debug output
 * @returns New TypeResolver
 */
export function createTypeResolver(logger?: Logger): TypeResolver {
  return new TypeResolver(logger);
}
