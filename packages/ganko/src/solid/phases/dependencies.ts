/**
 * Dependencies Phase (Phase 9)
 *
 * Builds the reactive dependency graph by composing information
 * from prior phases:
 *
 * 1. Creates ComputationEntity for each reactive primitive call
 *    (createEffect, createMemo, createComputed, createRenderEffect,
 *    createResource, createRoot, createReaction).
 *
 * 2. Derives dependency edges by finding reactive variable reads
 *    within each computation's callback. This is a static
 *    over-approximation — any syntactically reachable signal read
 *    is included regardless of runtime control flow.
 *
 * 3. Derives ownership edges by matching computation scopes to
 *    enclosing computation scopes (lexical nesting).
 *
 * Requires: scopes, entities, context, wiring, reactivity phases.
 */
import type { TSESTree as T } from "@typescript-eslint/utils";
import type { SolidGraph } from "../impl";
import type { SolidInput } from "../input";
import type { CallEntity } from "../entities/call";
import type { FunctionEntity } from "../entities/function";
import type { ScopeEntity } from "../entities/scope";
import type { VariableEntity, ReadEntity } from "../entities/variable";
import type { ComputationEntity, DependencyEdge, OwnershipEdge } from "../entities/computation";
import { computationKindFor } from "../entities/computation";

/** Store/props kinds that support per-property tracking. */
const PROPERTY_TRACKED_KINDS = new Set(["store", "props"]);

export function runDependenciesPhase(graph: SolidGraph, _input: SolidInput): void {
  buildComputations(graph);
  buildDependencyEdges(graph);
  buildOwnershipEdges(graph);
}

/**
 * Creates a ComputationEntity for each computation-creating primitive call.
 */
function buildComputations(graph: SolidGraph): void {
  const calls = graph.calls;
  let nextId = 0;

  for (let i = 0, len = calls.length; i < len; i++) {
    const call = calls[i];
    if (!call) continue;
    const primitive = call.primitive;
    if (!primitive) continue;

    const kind = computationKindFor(primitive.name);
    if (!kind) continue;

    const callback = resolveCallback(call);
    const variable = resolveVariable(graph, call);
    const isSource = kind === "memo" || kind === "resource";
    const isTracked = kind === "effect" || kind === "render-effect"
      || kind === "computed" || kind === "memo";

    const computation: ComputationEntity = {
      id: nextId++,
      kind,
      call,
      callback,
      scope: call.scope,
      variable,
      isSource,
      isTracked,
    };

    graph.addComputation(computation);
  }
}

/**
 * Resolves the callback FunctionEntity from a computation's arguments.
 *
 * For most primitives, the first argument is the callback.
 * We look for a function argument at position 0 (or 1 for createResource).
 */
function resolveCallback(call: CallEntity): FunctionEntity | null {
  const args = call.arguments;
  if (args.length === 0) return null;

  const name = call.primitive?.name;

  // createResource: fetcher is arg[1] (or arg[0] if only 1 arg)
  // createReaction: tracking fn is arg[0]
  // Everything else: arg[0]
  const targetIndex = name === "createResource" && args.length > 1 ? 1 : 0;
  const arg = args[targetIndex];
  if (!arg) return null;

  const node = arg.node;
  if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") {
    // The function entity is registered by the entities phase; resolve via scope
    // The resolvedTarget on the call won't help since this is an inline argument.
    // We need to find the FunctionEntity whose node matches.
    return findFunctionByNode(call, node);
  }

  return null;
}

/**
 * Finds the FunctionEntity for an inline function argument.
 * Uses the call's file's functions array for lookup.
 */
function findFunctionByNode(call: CallEntity, node: T.Node): FunctionEntity | null {
  const functions = call.file.functions;
  for (let i = 0, len = functions.length; i < len; i++) {
    const fn = functions[i];
    if (!fn) continue;
    if (fn.node === node) return fn;
  }
  return null;
}

/**
 * Resolves the variable a computation is assigned to.
 *
 * For `const [count, setCount] = createSignal(0)` or `const memo = createMemo(...)`,
 * finds the VariableEntity from the graph.
 */
function resolveVariable(graph: SolidGraph, call: CallEntity): VariableEntity | null {
  const parent = call.node.parent;
  if (!parent || parent.type !== "VariableDeclarator") return null;

  const id = parent.id;
  let name: string | null = null;

  if (id.type === "Identifier") {
    name = id.name;
  } else if (id.type === "ArrayPattern" && id.elements[0]?.type === "Identifier") {
    name = id.elements[0].name;
  }

  if (!name) return null;

  const vars = graph.variablesByName.get(name);
  if (!vars) return null;

  // Match by scope — find the variable in the same scope as the call
  for (let i = 0, len = vars.length; i < len; i++) {
    const v = vars[i];
    if (!v) continue;
    if (v.scope === call.scope) return v;
  }
  return vars[0] ?? null;
}

/**
 * Builds dependency edges by finding reactive variable reads
 * within each computation's callback scope and its descendants.
 *
 * A dependency edge is created when:
 * - A reactive variable has a ReadEntity
 * - That read's scope is the computation's callback scope or a descendant
 *
 * For computations without a resolved callback (e.g. passing a variable
 * reference), we fall back to the computation's captures.
 */
function buildDependencyEdges(graph: SolidGraph): void {
  const computations = graph.computations;
  if (computations.length === 0) return;

  // Build a map from scope -> computation (for the callback scope)
  const callbackScopes = new Map<ScopeEntity, ComputationEntity>();
  for (let i = 0, len = computations.length; i < len; i++) {
    const comp = computations[i];
    if (!comp) continue;
    if (comp.callback) {
      callbackScopes.set(comp.callback.scope, comp);
    }
  }

  // For each reactive variable read, find which computation it belongs to
  const reactive = graph.reactiveVariables;
  for (let i = 0, len = reactive.length; i < len; i++) {
    const variable = reactive[i];
    if (!variable) continue;
    const reads = variable.reads;

    for (let j = 0, rlen = reads.length; j < rlen; j++) {
      const read = reads[j];
      if (!read) continue;
      const comp = findEnclosingComputation(read.scope, callbackScopes);
      if (!comp) continue;

      const isUntracked = isReadInUntrackedScope(read, comp, callbackScopes);
      const propertyPath = PROPERTY_TRACKED_KINDS.has(variable.reactiveKind ?? "")
        ? extractPropertyPath(read.node)
        : null;

      const edge: DependencyEdge = {
        consumer: comp,
        source: variable,
        isProperAccess: read.isProperAccess,
        isUntracked,
        propertyPath,
      };

      graph.addDependencyEdge(edge);
    }
  }
}

/**
 * Walks up the scope chain to find the nearest computation whose
 * callback scope contains this read scope.
 */
function findEnclosingComputation(
  scope: ScopeEntity,
  callbackScopes: Map<ScopeEntity, ComputationEntity>,
): ComputationEntity | null {
  let current: ScopeEntity | null = scope;
  while (current) {
    const comp = callbackScopes.get(current);
    if (comp) return comp;
    current = current.parent;
  }
  return null;
}

/**
 * Checks if a read is inside an untrack() call within the computation.
 *
 * Walks from the read's scope up to the computation's callback scope,
 * checking if any intermediate scope has an "untracked" context.
 */
function isReadInUntrackedScope(
  read: ReadEntity,
  comp: ComputationEntity,
  _callbackScopes: Map<ScopeEntity, ComputationEntity>,
): boolean {
  const callbackScope = comp.callback?.scope;
  if (!callbackScope) return false;

  let current: ScopeEntity | null = read.scope;
  while (current && current !== callbackScope) {
    const ctx = current._resolvedContext;
    if (ctx && ctx.type === "untracked") return true;
    current = current.parent;
  }
  return false;
}

/**
 * Builds ownership edges by determining which computation is the
 * lexical parent of each other computation.
 *
 * A computation C is owned by computation P if C's call site scope
 * is within P's callback scope (or a descendant of it).
 */
function buildOwnershipEdges(graph: SolidGraph): void {
  const computations = graph.computations;
  if (computations.length < 2) return;

  // Build scope -> computation map for callback scopes
  const callbackScopes = new Map<ScopeEntity, ComputationEntity>();
  for (let i = 0, len = computations.length; i < len; i++) {
    const comp = computations[i];
    if (!comp) continue;
    if (comp.callback) {
      callbackScopes.set(comp.callback.scope, comp);
    }
  }

  for (let i = 0, len = computations.length; i < len; i++) {
    const child = computations[i];
    if (!child) continue;
    // Walk up from the child's call site scope to find the nearest parent computation
    const owner = findEnclosingComputation(child.call.scope, callbackScopes);
    if (!owner || owner === child) continue;

    const edge: OwnershipEdge = { owner, child };
    graph.addOwnershipEdge(edge);
  }
}

/**
 * Extracts the static property access path from a read node.
 *
 * Given `store.foo.bar`, the read node is the `store` identifier.
 * We walk up through MemberExpression parents collecting property names.
 * Returns null if any segment is computed/dynamic.
 *
 * @example
 * `store.foo.bar` → ["foo", "bar"]
 * `store[idx]` → null (dynamic)
 * `store.foo[0].bar` → null (dynamic segment)
 */
function extractPropertyPath(node: T.Node): readonly string[] | null {
  const first = node.parent;
  if (!first || first.type !== "MemberExpression") return null;
  if (first.object !== node) return null;

  const path: string[] = [];
  let member: T.MemberExpression = first;

  for (;;) {
    if (member.computed) return null;

    const prop = member.property;
    if (prop.type !== "Identifier") return null;
    path.push(prop.name);

    const next = member.parent;
    if (next && next.type === "MemberExpression" && next.object === member) {
      member = next;
    } else {
      break;
    }
  }

  return path.length > 0 ? path : null;
}
