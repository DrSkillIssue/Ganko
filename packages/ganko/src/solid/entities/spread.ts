/**
 * Spread Entity
 *
 * Represents spread patterns in the program graph.
 */

import type { TSESTree as T } from "@typescript-eslint/utils";

/**
 * JSX attribute context for specialized handling.
 * Computed during registration from AST parent structure.
 */
export type SpreadAttributeContext =
  | "classList"       // Inside classList={{...}}
  | "style"           // Inside style={{...}}
  | "props"           // Top-level JSX spread {...props}
  | "other";          // Other object context

/**
 * Kind of expression being spread.
 * Computed during registration from spread argument.
 */
export type SpreadSourceKind =
  | "identifier"      // {...props}, {...rest}
  | "member"          // {...props.classList}, {...local.style}
  | "call"            // {...signal()}, {...getData()}
  | "literal"         // {...{ a: 1 }}
  | "logical"         // {...(x ?? {})}, {...(x || {})}
  | "conditional"     // {...(cond ? a : b)}
  | "other";          // Unknown expression type

/**
 * Classification of spread source reactivity.
 * Used by rules to determine if spreading breaks reactivity.
 */
export type SpreadSourceReactivity =
  | "props"           // Component props parameter
  | "store"           // From createStore
  | "signal"          // Signal value (called accessor)
  | "accessor"        // Accessor type (uncalled)
  | "splitPropsRest"  // Result of splitProps (safe)
  | "mergePropsResult"// Result of mergeProps (safe)
  | "plainObject"     // Non-reactive plain object / literal (safe)
  | "unknown";        // Cannot determine

/**
 * Information about a single property in a fixable spread pattern.
 * Computed during graph building for autofix support.
 */
export interface FixableSpreadProperty {
  /** The key text - identifier name or computed expression source */
  readonly key: string;
  /** Range of the key expression for source extraction */
  readonly keyRange: readonly [number, number];
  /** Whether key is computed [expr] vs static identifier */
  readonly computed: boolean;
  /** The value text */
  readonly value: string;
  /** Range of the value expression for source extraction */
  readonly valueRange: readonly [number, number];
  /** Whether value is literal `true` (common classList pattern) */
  readonly isBooleanTrue: boolean;
}

/**
 * Pattern info for fixable conditional spreads.
 * Only populated when the spread has a simple single-property pattern.
 */
export interface FixableSpreadPattern {
  /** Which branch has the non-empty object (true = consequent, false = alternate) */
  readonly truthyBranch: boolean;
  /** Single property info (only populated if exactly one property) */
  readonly property: FixableSpreadProperty;
  /** Range of the condition expression for source extraction */
  readonly conditionRange: readonly [number, number];
  /**
   * Whether condition text matches key text (for computed keys).
   * When true, `local.class ? { [local.class]: true } : {}` can become `[local.class ?? ""]: true`
   * instead of `[local.class ?? ""]: !!local.class`.
   */
  readonly conditionMatchesKey: boolean;
}

/**
 * Represents a conditional spread pattern in the SolidGraph.
 *
 * This includes spreads in any object expression, whether in JSX or standalone.
 * Patterns detected:
 * - ...(condition ? {...} : {}) - ternary with empty object fallback
 * - ...(condition && {...}) - logical AND spread pattern
 *
 * For JSX spreads, the node is a JSXSpreadAttribute and parentContext provides
 * access to the JSX opening element.
 */
export interface ConditionalSpreadEntity {
  readonly id: number;
  /** The spread node - SpreadElement for object spreads, JSXSpreadAttribute for JSX */
  readonly node: T.SpreadElement | T.JSXSpreadAttribute;
  readonly spreadType: "ternary" | "logical-and";
  /** The parent object expression (null for JSX spreads) */
  readonly parentObject: T.ObjectExpression | null;
  /** For JSX spreads, the opening element containing the spread attribute */
  readonly parentJSXElement: T.JSXOpeningElement | null;
  readonly isInJSX: boolean;

  /**
   * Context where this spread appears.
   * Enables specialized fix strategies for classList vs style vs generic objects.
   */
  readonly attributeContext: SpreadAttributeContext;

  /**
   * Fixable pattern info. Null if not a simple fixable pattern.
   * Only populated for single-property ternary patterns.
   */
  readonly fixablePattern: FixableSpreadPattern | null;
}

/**
 * Type of object spread pattern detected.
 */
export type ObjectSpreadKind =
  | "object-copy"        // const copy = { ...original };
  | "object-merge"       // const merged = { ...a, ...b };
  | "object-update"      // const updated = { ...original, prop: value };
  | "jsx-spread"         // <div {...props} />
  | "rest-destructure";  // const { a, ...rest } = obj;

/**
 * Represents any object spread pattern in the SolidGraph.
 *
 * This captures all uses of object spread operator, including:
 * - Object copying: const copy = { ...original };
 * - Object merging: const merged = { ...a, ...b };
 * - Object updating: const updated = { ...obj, prop: value };
 * - JSX spreads: <div {...props} />
 * - Rest destructuring: const { a, ...rest } = obj;
 */
export interface ObjectSpreadEntity {
  readonly id: number;
  /** The spread node - SpreadElement, JSXSpreadAttribute, or RestElement */
  readonly node: T.SpreadElement | T.JSXSpreadAttribute | T.RestElement;
  /** The kind of spread pattern */
  readonly kind: ObjectSpreadKind;
  /** The parent object expression (null for JSX spreads and rest patterns) */
  readonly parentObject: T.ObjectExpression | null;
  /** For JSX spreads, the opening element containing the spread attribute */
  readonly parentJSXElement: T.JSXOpeningElement | null;
  /** The parent pattern for rest destructuring (null otherwise) */
  readonly parentPattern: T.ObjectPattern | null;
  /** True if inside a JSX element */
  readonly isInJSX: boolean;
  /** Number of spreads in the same object (for merge detection) */
  readonly spreadCount: number;
  /** Number of regular properties in the same object (for update detection) */
  readonly propertyCount: number;

  // ===== NEW FIELDS (computed during registration) =====

  /**
   * For spreads inside JSX attribute values, which attribute.
   * Enables specialized messages for classList, style, etc.
   * Computed from parent chain during registration.
   */
  readonly attributeContext: SpreadAttributeContext;

  /**
   * Target JSX element tag name if this is a JSX spread.
   * Examples: "div", "button", "MyComponent"
   * Computed from parentJSXElement during registration.
   */
  readonly targetTag: string | null;

  /**
   * Whether target is a native DOM element (lowercase tag).
   * Used to detect forwarding patterns to native elements.
   * Computed from targetTag during registration.
   */
  readonly targetIsDom: boolean;

  /**
   * Name of the spread source for error messages.
   * Examples: "props", "rest", "store", "local.classList", "signal()"
   * Computed from spread argument during registration.
   */
  readonly sourceName: string | null;

  /**
   * Kind of expression being spread.
   * Used for quick filtering without re-analyzing AST.
   * Computed from spread argument type during registration.
   */
  readonly sourceKind: SpreadSourceKind;
}
