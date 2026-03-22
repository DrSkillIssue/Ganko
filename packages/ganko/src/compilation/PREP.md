# PREP: Eliminate SolidGraph and CSSGraph Classes

## Problem

Phase 11 says delete `SolidGraph` class from `solid/impl.ts` and `CSSGraph` class from `css/impl.ts`. The classes are mutable accumulators — phases call `graph.addScope()`, `graph.addVariable()`, etc. After phases complete, nothing mutates them. Rules and the compilation system only read.

## Target Architecture

No class. No rename. No shim. The mutable accumulation becomes local state inside a build function. The output is directly `SolidSyntaxTree` / `CSSSyntaxTree[]`.

```
// Before (class-based)
SolidInput → new SolidGraph(input) → runPhases(graph, input) → solidGraphToSyntaxTree(graph) → SolidSyntaxTree

// After (function-based)
SolidInput → buildSolidSyntaxTree(input) → SolidSyntaxTree
             ├── creates local mutable SolidBuildContext
             ├── runPhases(context, input)
             └── freezes context into SolidSyntaxTree
```

## Solid Side

### New type: `SolidBuildContext`

**File: `solid/build-context.ts` (NEW)**

Contains:
- Every mutable array (scopes, variables, functions, calls, jsxElements, imports, exports, etc.)
- Every index map (variablesByName, functionsByNode, jsxByTag, etc.)
- Every mutation method (addScope, addVariable, addFunction, addCall, addJSXElement, etc.)
- ID counters (nextScopeId, nextVariableId, etc.)
- WeakMap caches (scopeForCache, jsxContextCache, etc.)
- Logger, sourceFile, typeResolver, fileEntity, comments

This is the exact same shape as the current SolidGraph class body — extracted into a plain interface + factory function. NOT a class. NOT exported as a public type. It's internal to the build pipeline.

```typescript
export interface SolidBuildContext {
  // Identity
  readonly file: string
  readonly sourceFile: ts.SourceFile
  readonly typeResolver: TypeResolver
  readonly logger: Logger
  readonly fileEntity: FileEntity
  readonly comments: readonly CommentEntry[]

  // Mutable entity arrays
  scopes: ScopeEntity[]
  variables: VariableEntity[]
  functions: FunctionEntity[]
  // ... all arrays

  // Mutable index maps
  variablesByName: Map<string, VariableEntity[]>
  functionsByNode: Map<ts.Node, FunctionEntity>
  // ... all maps

  // Mutation methods
  addScope(scope: ScopeEntity): void
  addVariable(variable: VariableEntity): void
  // ... all add* methods

  // ID generation
  nextScopeId(): number
  nextVariableId(): number
  // ... all next*Id methods

  // Caches
  scopeForCache: WeakMap<ts.Node, ScopeEntity>
  jsxContextCache: WeakMap<ts.Node, JSXContext | null>
  // ... all caches

  // Derived (built after phases)
  buildReactiveIndex(): void
}

export function createSolidBuildContext(input: SolidInput): SolidBuildContext { ... }
```

### Updated build function

**File: `solid/impl.ts`**

Delete the `SolidGraph` class. Replace `buildSolidGraph` with:

```typescript
import { createSolidBuildContext } from "./build-context"
import type { SolidSyntaxTree } from "../compilation/core/solid-syntax-tree"

export function buildSolidSyntaxTree(input: SolidInput, version: string): SolidSyntaxTree {
  const ctx = createSolidBuildContext(input)
  runPhases(ctx, input)
  return freezeToSyntaxTree(ctx, version)
}

function freezeToSyntaxTree(ctx: SolidBuildContext, version: string): SolidSyntaxTree {
  return {
    kind: "solid",
    filePath: ctx.file,
    version,
    sourceFile: ctx.sourceFile,
    scopes: ctx.scopes,
    variables: ctx.variables,
    functions: ctx.functions,
    // ... every field from SolidSyntaxTree, referencing ctx arrays/maps
  }
}
```

### Phase file changes

**Files: `solid/phases/*.ts` (9 phases + entities/*.ts)**

Every phase signature changes from:
```typescript
export function runScopesPhase(graph: SolidGraph, input: SolidInput): void
```
to:
```typescript
export function runScopesPhase(ctx: SolidBuildContext, input: SolidInput): void
```

Every `graph.addScope(...)` → `ctx.addScope(...)`. Same calls. Same logic. Parameter type changes.

### Rule file changes

**File: `solid/rule.ts`**

Change rule interface:
```typescript
// Before
check(graph: SolidGraph, emit: Emit): void
// After
check(tree: SolidSyntaxTree, emit: Emit): void
```

**Files: `solid/rules/**/*.ts` (41 files)**

Each rule:
```typescript
// Before
import type { SolidGraph } from "../../impl"
// After
import type { SolidSyntaxTree } from "../../../compilation/core/solid-syntax-tree"
```

Parameter type change in `check`. Zero logic change — rules only read, SolidSyntaxTree has every field rules access.

### Plugin/eslint changes

**Files: `solid/plugin.ts`, `solid/eslint-plugin.ts`**

Replace `buildSolidGraph` call with `buildSolidSyntaxTree`. Rules receive `SolidSyntaxTree`.

### Query file changes

**Files: `solid/queries/*.ts`**

Already done — they import `SolidSyntaxTree as SolidGraph`.

Remove the alias: `import type { SolidSyntaxTree } from "../../compilation/core/solid-syntax-tree"` and update parameter names from `graph` to `tree` (or keep as `graph` — doesn't matter, structural typing).

### Compilation bridge

**File: `compilation/core/solid-syntax-tree.ts`**

Delete `solidGraphToSyntaxTree` — no longer needed. `buildSolidSyntaxTree` returns SolidSyntaxTree directly.

**File: `compilation/binding/element-builder.ts`**

Currently imports `SolidGraph` to construct graphs for component host resolution (parsing external component files). Change to import `buildSolidSyntaxTree` and use `SolidSyntaxTree`.

---

## CSS Side

### New type: `CSSBuildContext`

**File: `css/build-context.ts` (NEW)**

Same pattern as Solid. Contains:
- Every mutable array (files, rules, selectors, declarations, variables, atRules, etc.)
- Every index map (filesByPath, variablesByName, rulesBySelector, classNameIndex, etc.)
- Every mutation method (addFile, addRule, addSelector, addDeclaration, etc.)
- ID generation (nextFileId, nextRuleId, etc.)
- Options, interner, logger
- `buildDerivedIndexes()` for post-phase derived data
- `buildUnusedIndexes()` for unused entity detection

```typescript
export interface CSSBuildContext { ... }
export function createCSSBuildContext(input: CSSInput): CSSBuildContext { ... }
```

### Updated build function

**File: `css/impl.ts`**

Delete the `CSSGraph` class. Replace `buildCSSGraph` with:

```typescript
export function buildCSSSyntaxTrees(input: CSSInput): readonly CSSSyntaxTree[] {
  const ctx = createCSSBuildContext(input)
  runPhases(ctx, input)
  ctx.buildDerivedIndexes()
  return freezeToSyntaxTrees(ctx)
}
```

BUT: CSS single-file rules operate on the FULL graph (all files), not per-file CSSSyntaxTree. The `CSSRule` interface's `check(graph, emit)` receives the whole graph. CSSSyntaxTree is per-file.

**Resolution:** CSS single-file rules need a read-only view of the full graph. Create `CSSWorkspaceView` — a readonly interface covering what rules access (declarationsByProperty, classNameIndex, selectorsBySubjectTag, etc.). The build function returns both:

```typescript
export interface CSSBuildResult {
  readonly trees: readonly CSSSyntaxTree[]
  readonly workspace: CSSWorkspaceView
}

export function buildCSSResult(input: CSSInput): CSSBuildResult {
  const ctx = createCSSBuildContext(input)
  runPhases(ctx, input)
  ctx.buildDerivedIndexes()
  return {
    trees: freezeToSyntaxTrees(ctx),
    workspace: freezeToWorkspaceView(ctx),
  }
}
```

### Phase file changes

**Files: `css/phases/*.ts` (6 phases)**

Same pattern: `graph: CSSGraph` → `ctx: CSSBuildContext`. Same calls. Same logic.

### Rule file changes

**File: `css/rule.ts`**

```typescript
// Before
check(graph: CSSGraph, emit: Emit): void
// After
check(workspace: CSSWorkspaceView, emit: Emit): void
```

**Files: `css/rules/**/*.ts`**

Import rename + parameter type change. Zero logic change.

### Query file changes

**Files: `css/queries/*.ts` (8 files)**

`CSSGraph` → `CSSWorkspaceView` in parameter types.

---

## Deletion

After Phase A (Solid) and Phase B (CSS) complete:

1. `SolidGraph` class — GONE from `solid/impl.ts`
2. `CSSGraph` class — GONE from `css/impl.ts`
3. `solidGraphToSyntaxTree` — GONE from `compilation/core/solid-syntax-tree.ts`
4. `cssGraphToSyntaxTrees` — GONE from `compilation/core/css-syntax-tree.ts` (logic moved to `css/impl.ts`)
5. `cross-file/` — ENTIRE DIRECTORY DELETED
6. `cache.ts` — DELETED
7. LSP files — rewritten to use CompilationTracker + AnalysisDispatcher

---

## File Change Summary

| Action | Files | Description |
|--------|-------|-------------|
| **CREATE** | `solid/build-context.ts` | SolidBuildContext interface + factory |
| **CREATE** | `css/build-context.ts` | CSSBuildContext interface + factory |
| **CREATE** | `css/workspace-view.ts` | CSSWorkspaceView readonly interface |
| **REWRITE** | `solid/impl.ts` | Delete class, new buildSolidSyntaxTree |
| **REWRITE** | `css/impl.ts` | Delete class, new buildCSSResult |
| **UPDATE** | `solid/phases/*.ts` (11 files) | SolidGraph → SolidBuildContext |
| **UPDATE** | `solid/rules/**/*.ts` (41 files) | SolidGraph → SolidSyntaxTree |
| **UPDATE** | `solid/rule.ts` | Rule interface type change |
| **UPDATE** | `solid/plugin.ts`, `solid/eslint-plugin.ts` | Build function change |
| **UPDATE** | `solid/queries/*.ts` (13 files) | Remove alias, use SolidSyntaxTree directly |
| **UPDATE** | `css/phases/*.ts` (6 files) | CSSGraph → CSSBuildContext |
| **UPDATE** | `css/rules/**/*.ts` (~15 files) | CSSGraph → CSSWorkspaceView |
| **UPDATE** | `css/rule.ts` | Rule interface type change |
| **UPDATE** | `css/plugin.ts`, `css/eslint-plugin.ts` | Build function change |
| **UPDATE** | `css/queries/*.ts` (8 files) | CSSGraph → CSSWorkspaceView |
| **UPDATE** | `compilation/core/solid-syntax-tree.ts` | Delete solidGraphToSyntaxTree |
| **UPDATE** | `compilation/core/css-syntax-tree.ts` | Delete cssGraphToSyntaxTrees |
| **UPDATE** | `compilation/binding/element-builder.ts` | Use buildSolidSyntaxTree |
| **DELETE** | `cross-file/` | Entire directory |
| **DELETE** | `cache.ts` | Replaced by CompilationTracker |
| **UPDATE** | `packages/lsp/src/` (~8 files) | GraphCache → CompilationTracker |
| **UPDATE** | `packages/ganko/src/index.ts` | Remove old exports, add new |
| **UPDATE** | Test files | Import updates |
