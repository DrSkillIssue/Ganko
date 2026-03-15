# Phase 2: Remove `simpleTraverse` No-Op

**Estimated Impact**: -200-400ms (230 files × ~1-2ms each)
**Files touched**: `packages/ganko/src/solid/parse.ts`
**Risk**: Low (must verify `runPreparePhase` sets parent pointers)

## Problem

Both `parseContent` and `parseContentWithProgram` call:

```typescript
simpleTraverse(result.ast, { enter: () => { } }, true)
```

(`parse.ts:75` and `parse.ts:123`)

This walks the entire AST with an empty `enter` callback. The third argument `true` tells `simpleTraverse` to set `parent` pointers on every node. This is a full tree traversal of every AST node in every file — for 230 files, that's hundreds of thousands of nodes traversed with no analysis work.

## Analysis

The `parent` pointers set by `simpleTraverse` are consumed by:

1. **`runPreparePhase`** (`phases/prepare.ts`) — the first phase in graph building. It validates parent links and may set them itself.
2. **`SourceCode` methods** — ESLint's `SourceCode` object uses parent pointers for `getAncestors()` and similar utilities.
3. **Graph phases and rules** — any code that walks `node.parent` chains.

If `simpleTraverse` is the only thing setting parent pointers, removing it breaks everything. But `@typescript-eslint/parser`'s `parseForESLint` with the `preserveNodeMaps: true` option (used in `parseContentWithProgram`) already sets parent pointers as part of the ESTree conversion. The question is whether the non-program path (`parseContent`) also sets them.

## Investigation Required

Before removing, verify:

1. Does `parseForESLint` (without `programs` option) set `parent` pointers on AST nodes?
2. Does `runPreparePhase` independently set parent pointers?
3. Are there any rules or phases that rely on `parent` being set before `runPreparePhase` runs?

If `parseForESLint` does NOT set parent pointers in the non-program path, and `runPreparePhase` does, then `simpleTraverse` is still redundant — `runPreparePhase` runs before any rules. If neither sets parents, `simpleTraverse` must stay.

## Solution

**If redundant** (expected): Remove both `simpleTraverse` calls and the `import { simpleTraverse }` line.

**If partially needed**: Remove only from `parseContentWithProgram` (where `preserveNodeMaps: true` guarantees parent pointers), keep in `parseContent` if needed.

## Changes

### `packages/ganko/src/solid/parse.ts`

Remove:
```typescript
import { simpleTraverse } from "@typescript-eslint/typescript-estree"
```

Remove from `parseContent` (line 75):
```typescript
simpleTraverse(result.ast, { enter: () => { } }, true)
```

Remove from `parseContentWithProgram` (line 123):
```typescript
simpleTraverse(result.ast, { enter: () => { } }, true)
```

## Verification

1. `bun run test` — all 1476 tests pass (tests exercise every rule, which exercises parent pointer access)
2. Specifically verify tests that walk `node.parent` chains (reactivity rules, JSX hierarchy rules)
3. Run `ganko lint` on bor-web/web — identical output to before
4. Measure time difference on a 230-file project
