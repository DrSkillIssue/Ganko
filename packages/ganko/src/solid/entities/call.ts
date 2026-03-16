/**
 * Call Entity
 *
 * Represents a call expression in the program graph.
 */

import type ts from "typescript";
import type { FileEntity } from "./file";
import type { ScopeEntity } from "./scope";
import type { FunctionEntity } from "./function";
import type { VariableEntity } from "./variable";

/**
 * Represents a call expression in the SolidGraph.
 */
export interface CallEntity {
  id: number;
  node: ts.CallExpression | ts.NewExpression;
  file: FileEntity;
  callee: ts.Expression;
  arguments: ArgumentEntity[];
  scope: ScopeEntity;
  resolvedTarget: FunctionEntity | null;
  /**
   * The VariableEntity for the root identifier of the callee expression.
   *
   * Resolved during the wiring phase by walking the callee's MemberExpression
   * chain to the leftmost identifier and looking it up in scope.
   *
   * - `foo()` → VariableEntity for `foo` (or null if `foo` is a global)
   * - `obj.method()` → VariableEntity for `obj` (or null if `obj` is global like `console`)
   * - `a.b.c()` → VariableEntity for `a`
   * - `getObj().method()` → null (root is a CallExpression, not an Identifier)
   * - `console.log()` → null (`console` has no user-declared VariableEntity)
   */
  calleeRootVariable: VariableEntity | null;
  primitive: PrimitiveInfo | null;
  argumentSemantics: ArgumentSemantic[];
  /** @internal ID of resolved target for deferred resolution */
  _resolvedTargetId: number;
}

/**
 * Represents a single argument in a call expression.
 */
export interface ArgumentEntity {
  id: number;
  node: ts.Node;
  index: number;
  /** Semantic for this argument position, or null if unknown */
  semantic: ArgumentSemantic | null;
}

/**
 * Semantic information for an argument position.
 *
 * Describes how the argument affects reactivity tracking
 * (tracked, deferred, etc.) and what parameter information is available.
 */
export interface ArgumentSemantic {
  position: number;
  semantic:
    | { type: "tracked" }
    | { type: "deferred" }
    | { type: "passthrough" }
    | { type: "sync" }
    | { type: "untracked" }
    | { type: "value" }
    | { type: "unknown" };
  parameterSemantics?: ParameterSemantic[];
}

/**
 * Semantic information about a function parameter.
 */
export interface ParameterSemantic {
  index: number;
  isAccessor: boolean;
  isStore: boolean;
  description: string;
}

/**
 * Information about a Solid primitive call.
 */
export interface PrimitiveInfo {
  name: string;
  module: "solid-js" | "solid-js/store" | "solid-js/web";
  returns: PrimitiveReturn;
}

/**
 * Describes the return type of a Solid primitive.
 */
export type PrimitiveReturn =
  | { type: "signal"; writable: boolean }
  | { type: "accessor" }
  | { type: "store"; writable: boolean }
  | { type: "void" }
  | { type: "owner" }
  | { type: "context" }
  | { type: "resource" }
  | { type: "other" };

/**
 * Complete definition of a Solid primitive including its argument semantics.
 */
export interface PrimitiveDefinition {
  name: string;
  module: "solid-js" | "solid-js/store" | "solid-js/web";
  returns: PrimitiveReturn;
  argumentSemantics: ArgumentSemantic[];
}

/**
 * Creates an argument semantic for a tracked callback that runs in a tracking context.
 */
function tracked(position: number, parameterSemantics?: ParameterSemantic[]): ArgumentSemantic {
  const result: ArgumentSemantic = { position, semantic: { type: "tracked" } };
  if (parameterSemantics !== undefined) result.parameterSemantics = parameterSemantics;
  return result;
}

/**
 * Creates an argument semantic for a deferred callback that runs later, not during tracking.
 */
function deferred(position: number, parameterSemantics?: ParameterSemantic[]): ArgumentSemantic {
  const result: ArgumentSemantic = { position, semantic: { type: "deferred" } };
  if (parameterSemantics !== undefined) result.parameterSemantics = parameterSemantics;
  return result;
}

/**
 * Creates an argument semantic for a value passed through without calling.
 */
function passthrough(position: number): ArgumentSemantic {
  return { position, semantic: { type: "passthrough" } };
}

/**
 * Creates an argument semantic for a callback that runs synchronously, inheriting parent context.
 */
function sync(position: number): ArgumentSemantic {
  return { position, semantic: { type: "sync" } };
}

/**
 * Creates an argument semantic for a plain value with no special reactive handling.
 */
function value(position: number): ArgumentSemantic {
  return { position, semantic: { type: "value" } };
}

/**
 * Creates an argument semantic for a callback that explicitly disables tracking.
 */
function untracked(position: number, parameterSemantics?: ParameterSemantic[]): ArgumentSemantic {
  const result: ArgumentSemantic = { position, semantic: { type: "untracked" } };
  if (parameterSemantics !== undefined) result.parameterSemantics = parameterSemantics;
  return result;
}

/**
 * Creates a parameter semantic indicating the parameter is a reactive accessor.
 */
function accessor(index: number, description = "accessor"): ParameterSemantic {
  return { index, isAccessor: true, isStore: false, description };
}

/**
 * All Solid primitives with their complete semantic information.
 */
export const SOLID_PRIMITIVES: readonly PrimitiveDefinition[] = [
  // Signals & State
  {
    name: "createSignal",
    module: "solid-js",
    returns: { type: "signal", writable: true },
    argumentSemantics: [value(0), value(1)],
  },
  {
    name: "createMemo",
    module: "solid-js",
    returns: { type: "accessor" },
    argumentSemantics: [tracked(0), value(1), value(2)],
  },
  {
    name: "createDeferred",
    module: "solid-js",
    returns: { type: "accessor" },
    argumentSemantics: [passthrough(0), value(1)],
  },
  {
    name: "createSelector",
    module: "solid-js",
    returns: { type: "accessor" },
    argumentSemantics: [passthrough(0), value(1), value(2)],
  },
  {
    name: "useTransition",
    module: "solid-js",
    returns: { type: "signal", writable: false },
    argumentSemantics: [],
  },
  {
    name: "createEffect",
    module: "solid-js",
    returns: { type: "void" },
    argumentSemantics: [tracked(0), value(1)],
  },
  {
    name: "createRenderEffect",
    module: "solid-js",
    returns: { type: "void" },
    argumentSemantics: [tracked(0), value(1)],
  },
  {
    name: "createComputed",
    module: "solid-js",
    returns: { type: "void" },
    argumentSemantics: [tracked(0), value(1)],
  },
  {
    name: "createReaction",
    module: "solid-js",
    returns: { type: "other" },
    argumentSemantics: [deferred(0)],
  },
  {
    name: "on",
    module: "solid-js",
    returns: { type: "other" },
    argumentSemantics: [passthrough(0), untracked(1), value(2)],
  },
  {
    name: "batch",
    module: "solid-js",
    returns: { type: "other" },
    argumentSemantics: [sync(0)],
  },
  {
    name: "untrack",
    module: "solid-js",
    returns: { type: "other" },
    argumentSemantics: [untracked(0)],
  },
  {
    name: "runWithOwner",
    module: "solid-js",
    returns: { type: "other" },
    argumentSemantics: [value(0), sync(1)],
  },
  {
    name: "onMount",
    module: "solid-js",
    returns: { type: "void" },
    argumentSemantics: [deferred(0)],
  },
  {
    name: "onCleanup",
    module: "solid-js",
    returns: { type: "void" },
    argumentSemantics: [deferred(0)],
  },

  // Context & Ownership
  {
    name: "createContext",
    module: "solid-js",
    returns: { type: "context" },
    argumentSemantics: [value(0)],
  },
  {
    name: "useContext",
    module: "solid-js",
    returns: { type: "other" },
    argumentSemantics: [value(0)],
  },
  {
    name: "getOwner",
    module: "solid-js",
    returns: { type: "owner" },
    argumentSemantics: [],
  },
  {
    name: "createRoot",
    module: "solid-js",
    returns: { type: "other" },
    argumentSemantics: [untracked(0)],
  },
  {
    name: "catchError",
    module: "solid-js",
    returns: { type: "other" },
    argumentSemantics: [sync(0), deferred(1)],
  },
  {
    name: "children",
    module: "solid-js",
    returns: { type: "accessor" },
    argumentSemantics: [passthrough(0)],
  },
  {
    name: "createUniqueId",
    module: "solid-js",
    returns: { type: "other" },
    argumentSemantics: [],
  },
  {
    name: "lazy",
    module: "solid-js",
    returns: { type: "other" },
    argumentSemantics: [deferred(0)],
  },
  {
    name: "startTransition",
    module: "solid-js",
    returns: { type: "other" },
    argumentSemantics: [sync(0)],
  },
  {
    name: "mapArray",
    module: "solid-js",
    returns: { type: "accessor" },
    argumentSemantics: [
      passthrough(0),
      untracked(1, [
        { index: 0, isAccessor: false, isStore: false, description: "item" },
        accessor(1, "index"),
      ]),
      value(2),
    ],
  },
  {
    name: "indexArray",
    module: "solid-js",
    returns: { type: "accessor" },
    argumentSemantics: [
      passthrough(0),
      untracked(1, [
        accessor(0, "item"),
        { index: 1, isAccessor: false, isStore: false, description: "index" },
      ]),
      value(2),
    ],
  },
  {
    name: "createResource",
    module: "solid-js",
    returns: { type: "resource" },
    argumentSemantics: [passthrough(0), deferred(1), value(2)],
  },
  {
    name: "from",
    module: "solid-js",
    returns: { type: "accessor" },
    argumentSemantics: [value(0)],
  },
  {
    name: "observable",
    module: "solid-js",
    returns: { type: "other" },
    argumentSemantics: [passthrough(0)],
  },
  {
    name: "mergeProps",
    module: "solid-js",
    returns: { type: "store", writable: false },
    argumentSemantics: [
      passthrough(0), passthrough(1), passthrough(2), passthrough(3), passthrough(4),
      passthrough(5), passthrough(6), passthrough(7), passthrough(8), passthrough(9),
    ],
  },
  {
    name: "splitProps",
    module: "solid-js",
    returns: { type: "store", writable: false },
    argumentSemantics: [passthrough(0), value(1), value(2), value(3), value(4), value(5)],
  },

  // Store (solid-js/store)
  {
    name: "createStore",
    module: "solid-js/store",
    returns: { type: "store", writable: true },
    argumentSemantics: [value(0), value(1)],
  },
  {
    name: "createMutable",
    module: "solid-js/store",
    returns: { type: "store", writable: true },
    argumentSemantics: [value(0)],
  },
  {
    name: "produce",
    module: "solid-js/store",
    returns: { type: "other" },
    argumentSemantics: [sync(0)],
  },
  {
    name: "reconcile",
    module: "solid-js/store",
    returns: { type: "other" },
    argumentSemantics: [value(0), value(1)],
  },
  {
    name: "unwrap",
    module: "solid-js/store",
    returns: { type: "other" },
    argumentSemantics: [value(0)],
  },
  {
    name: "modifyMutable",
    module: "solid-js/store",
    returns: { type: "void" },
    argumentSemantics: [value(0), sync(1)],
  },

  // Web (solid-js/web)
  {
    name: "render",
    module: "solid-js/web",
    returns: { type: "other" },
    argumentSemantics: [value(0), value(1)],
  },
  {
    name: "hydrate",
    module: "solid-js/web",
    returns: { type: "other" },
    argumentSemantics: [value(0), value(1)],
  },
  {
    name: "isServer",
    module: "solid-js/web",
    returns: { type: "other" },
    argumentSemantics: [],
  },
  {
    name: "hydrationScript",
    module: "solid-js/web",
    returns: { type: "other" },
    argumentSemantics: [value(0)],
  },
  {
    name: "renderToString",
    module: "solid-js/web",
    returns: { type: "other" },
    argumentSemantics: [value(0), value(1)],
  },
  {
    name: "renderToStringAsync",
    module: "solid-js/web",
    returns: { type: "other" },
    argumentSemantics: [value(0), value(1)],
  },
  {
    name: "renderToStream",
    module: "solid-js/web",
    returns: { type: "other" },
    argumentSemantics: [value(0), value(1)],
  },
  {
    name: "DEV",
    module: "solid-js/web",
    returns: { type: "other" },
    argumentSemantics: [],
  },
  {
    name: "getRequestEvent",
    module: "solid-js/web",
    returns: { type: "other" },
    argumentSemantics: [],
  },
];

export interface CreateCallArgs {
  id: number;
  node: CallEntity["node"];
  file: FileEntity;
  callee: ts.Expression;
  arguments: ArgumentEntity[];
  scope: ScopeEntity;
  resolvedTargetId: number;
  primitive: PrimitiveInfo | null;
  argumentSemantics: ArgumentSemantic[];
}

/**
 * Creates a CallEntity from the provided arguments.
 */
export function createCall(args: CreateCallArgs): CallEntity {
  return {
    id: args.id,
    node: args.node,
    file: args.file,
    callee: args.callee,
    arguments: args.arguments,
    scope: args.scope,
    resolvedTarget: null,
    calleeRootVariable: null,
    primitive: args.primitive,
    argumentSemantics: args.argumentSemantics,
    _resolvedTargetId: args.resolvedTargetId,
  };
}
