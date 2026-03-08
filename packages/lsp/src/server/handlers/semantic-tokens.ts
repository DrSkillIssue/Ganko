/**
 * Semantic Tokens Handler
 *
 * Emits semantic tokens exclusively for Solid.js reactive constructs.
 * TypeScript's built-in semantic tokens (variables, functions, types, etc.)
 * are left to vscode-typescript — this handler only highlights what
 * TypeScript cannot: signals, stores, memos, effects, and other
 * reactive primitives from the SolidGraph.
 */
import type {
  SemanticTokensParams,
  SemanticTokens,
} from "vscode-languageserver";
import type { HandlerContext } from "./handler-context";
import type { SolidGraph, ReactiveKind, VariableEntity, ReadEntity } from "@drskillissue/ganko";
import { uriToPath } from "@drskillissue/ganko-shared";

/**
 * Token type legend — Solid-specific types only.
 *
 * Each maps to a `semanticTokenTypes` contribution in the VS Code extension.
 * The superType (declared in package.json) determines fallback coloring when
 * no theme rule targets the custom type directly.
 *
 * Indices in this array are the token type IDs used in the encoded response.
 */
export const TOKEN_TYPES: string[] = [
  "solidSignal",     // 0 — createSignal()
  "solidStore",      // 1 — createStore(), createMutable()
  "solidMemo",       // 2 — createMemo()
  "solidDerived",    // 3 — derived reactive value
  "solidProps",      // 4 — component props parameter
  "solidResource",   // 5 — createResource()
  "solidAccessor",   // 6 — createDeferred, createSelector, children, from, etc.
  "solidEffect",     // 7 — createEffect, createRenderEffect, createComputed, createReaction
];

/**
 * Token modifier legend — Solid-specific modifiers only.
 *
 * Bit positions in the modifier bitmask.
 */
export const TOKEN_MODIFIERS: string[] = [
  "reactive",        // bit 0 — the token represents a reactive value
  "tracked",         // bit 1 — the read occurs inside a tracked context
  "declaration",     // bit 2 — the token is a declaration site
];

/** Bitmask constants for modifier encoding. */
const MOD_REACTIVE = 1 << 0;
const MOD_TRACKED = 1 << 1;
const MOD_DECLARATION = 1 << 2;

/** Maps ReactiveKind to token type index in TOKEN_TYPES. */
const REACTIVE_KIND_TO_TYPE: Readonly<Record<ReactiveKind, number>> = {
  signal: 0,
  store: 1,
  memo: 2,
  derived: 3,
  props: 4,
  resource: 5,
  accessor: 6,
};

/** Token type index for effects/computations. */
const TYPE_EFFECT = 7;

/**
 * A pending semantic token before delta-encoding.
 *
 * Collected into an array, sorted by position, then delta-encoded
 * into the LSP SemanticTokens response.
 */
interface RawToken {
  readonly line: number;
  readonly character: number;
  readonly length: number;
  readonly type: number;
  readonly modifiers: number;
}

/**
 * Handle textDocument/semanticTokens/full request.
 *
 * Builds (or retrieves from cache) a SolidGraph for the file, then
 * emits semantic tokens for reactive variable declarations, reads,
 * and computation call sites.
 */
export function handleSemanticTokens(
  params: SemanticTokensParams,
  ctx: HandlerContext,
): SemanticTokens | null {
  const path = uriToPath(params.textDocument.uri);
  const graph = ctx.getSolidGraph(path);
  if (!graph) return null;

  const tokens: RawToken[] = [];

  emitReactiveVariables(graph.reactiveVariables, tokens);
  emitReactiveVariables(graph.propsVariables, tokens);
  emitComputations(graph, tokens);

  if (tokens.length === 0) return null;

  tokens.sort(compareTokens);
  return { data: deltaEncode(tokens) };
}

/**
 * Emits tokens for reactive variable declarations and all their reads.
 */
function emitReactiveVariables(
  variables: readonly VariableEntity[],
  tokens: RawToken[],
): void {
  for (let i = 0, len = variables.length; i < len; i++) {
    const v = variables[i];
    if (!v) continue;
    if (!v.reactiveKind) continue;

    const type = REACTIVE_KIND_TO_TYPE[v.reactiveKind];
    if (type === undefined) continue;

    emitDeclarations(v, type, tokens);
    emitReads(v.reads, type, tokens);
  }
}

/**
 * Emits declaration-site tokens for a reactive variable.
 */
function emitDeclarations(
  v: VariableEntity,
  type: number,
  tokens: RawToken[],
): void {
  const modifiers = MOD_REACTIVE | MOD_DECLARATION;
  const declarations = v.declarations;
  for (let i = 0, len = declarations.length; i < len; i++) {
    const decl = declarations[i];
    if (!decl) continue;
    const loc = decl.loc;
    if (!loc) continue;
    tokens.push({
      line: loc.start.line - 1,
      character: loc.start.column,
      length: v.name.length,
      type,
      modifiers,
    });
  }
}

/**
 * Emits read-site tokens for a reactive variable.
 *
 * Reads inside a tracked scope get the `tracked` modifier in addition
 * to `reactive`, signaling that these are live dependency subscriptions.
 */
function emitReads(
  reads: readonly ReadEntity[],
  type: number,
  tokens: RawToken[],
): void {
  for (let i = 0, len = reads.length; i < len; i++) {
    const read = reads[i];
    if (!read) continue;
    const loc = read.node.loc;
    if (!loc) continue;

    const ctx = read.scope._resolvedContext;
    const tracked = ctx !== null
      && (ctx.type === "tracked" || ctx.type === "jsx-expression");
    const modifiers = tracked
      ? MOD_REACTIVE | MOD_TRACKED
      : MOD_REACTIVE;

    tokens.push({
      line: loc.start.line - 1,
      character: loc.start.column,
      length: loc.end.column - loc.start.column,
      type,
      modifiers,
    });
  }
}

/**
 * Emits tokens for computation call sites (createEffect, createMemo, etc.).
 *
 * The callee identifier (e.g. "createEffect") gets the solidEffect token type.
 */
function emitComputations(
  graph: SolidGraph,
  tokens: RawToken[],
): void {
  const computations = graph.computations;
  for (let i = 0, len = computations.length; i < len; i++) {
    const comp = computations[i];
    if (!comp) continue;
    const callee = comp.call.node.callee;
    const loc = callee.loc;
    if (!loc) continue;
    // Skip multi-line callees — LSP semantic tokens require length on a single line
    if (loc.start.line !== loc.end.line) continue;

    tokens.push({
      line: loc.start.line - 1,
      character: loc.start.column,
      length: loc.end.column - loc.start.column,
      type: TYPE_EFFECT,
      modifiers: MOD_REACTIVE,
    });
  }
}

/**
 * Sort comparator for raw tokens (by line, then character).
 */
function compareTokens(a: RawToken, b: RawToken): number {
  return a.line - b.line || a.character - b.character;
}

/**
 * Delta-encodes sorted tokens into the LSP SemanticTokens data format.
 *
 * Each token becomes 5 integers:
 *   [deltaLine, deltaChar, length, tokenType, tokenModifiers]
 */
function deltaEncode(tokens: readonly RawToken[]): number[] {
  const data = new Array<number>(tokens.length * 5);
  let prevLine = 0;
  let prevChar = 0;

  for (let i = 0, len = tokens.length; i < len; i++) {
    const t = tokens[i];
    if (!t) continue;
    const deltaLine = t.line - prevLine;
    const deltaChar = deltaLine === 0 ? t.character - prevChar : t.character;

    const base = i * 5;
    data[base] = deltaLine;
    data[base + 1] = deltaChar;
    data[base + 2] = t.length;
    data[base + 3] = t.type;
    data[base + 4] = t.modifiers;

    prevLine = t.line;
    prevChar = t.character;
  }

  return data;
}
