# Phase 5: Content-Addressed `SolidGraph` Cache

**Effort**: M (1-2 days)
**Depends on**: Phase 1 (graph is `ts.Node`-based, version comes from content hash)
**Independent value**: Skip graph building for unchanged files. Daemon warm lint drops to sub-second.

---

## Critical issue: `ts.Node` identity across program rebuilds

Post-Phase 1, `SolidGraph` contains `ts.Node` references from the `ts.Program` that created it. When the program rebuilds (watch program update, new `ts.createProgram` call), ALL `ts.Node` object references from the old program become stale — they point to a dead AST tree.

This means:
- Cached `SolidGraph` instances hold `ts.Node` pointers from the OLD program
- Cross-file rules that traverse `ts.Node` from cached graphs will read stale data
- `WeakMap<ts.Node, ...>` caches on the graph become unreachable (old nodes are GC'd)

### Impact analysis

**Where `ts.Node` references from cached graphs are accessed:**

1. **Cross-file rules** (`cross-file/rules/*.ts`): Access `entity.node` on entities from cached graphs. These entity nodes are from the old program's AST.
2. **Rule execution** (`runSolidRules`): Always runs fresh — takes a freshly-built graph. Not affected.
3. **LayoutGraph construction** (`buildLayoutGraph`): Reads entities from cached SolidGraphs. Entity nodes are stale.
4. **HandlerContext.getSolidGraph**: Returns cached graph. Handlers that access `.node` properties get stale nodes.

### Resolution: content-addressed graphs are valid when content is identical

When file content is identical (same hash), the `ts.Node` tree structure is identical. The only difference is object identity — the new program creates new `ts.Node` objects with the same shapes.

For cross-file rules:
- Rules read `.node.getText(sourceFile)` → the text is the same (content didn't change)
- Rules read `.node.kind` / `ts.is*()` → identical (same AST structure)
- Rules read `.node.getStart(sf)` / `.node.end` → depends on which `sourceFile` is passed

The issue is NOT structural correctness — it's which `ts.SourceFile` the node belongs to. If a rule calls `node.getSourceFile()`, it returns the OLD sourceFile. If a rule calls `node.getText(oldSourceFile)`, it works because the old sourceFile has the same text.

**The real danger**: functions that do `checker.getTypeAtLocation(cachedNode)`. The new `TypeChecker` from the new program does NOT recognize nodes from the old program. TypeChecker operates on object identity.

### Decision: cached graphs are ONLY used for diagnostic output, NOT for type checking

After Phase 1:
- `buildSolidGraph(input)` → runs phases, builds entities, resolves types → writes results into the graph
- `runSolidRules(graph, sourceFile, emit)` → reads graph data, emits diagnostics

The graph already contains the resolved results of type checking (entity types, reactivity classifications, etc.). Rules read these results from entities — they do NOT call the TypeChecker on cached nodes. The TypeChecker is used during `buildSolidGraph` (phases), not during `runSolidRules`.

Therefore: **cached graphs can be safely reused for rule execution as long as the content hash matches.** The TypeChecker is only needed during graph construction, and graph construction is skipped on cache hit.

For cross-file analysis: `buildLayoutGraph` reads entity data (classifications, names, scopes) — not types. Safe to use cached graphs.

---

## Version key: content hash

Current: `project.getScriptVersion(path)` from `ProjectService` internals.

Post-Phase 1: `ProjectService` is gone. Version comes from content hash:

```typescript
import { createHash } from "node:crypto";

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
```

16 hex chars = 64 bits of entropy. Collision probability: negligible for ~10^3 files.

---

## `packages/ganko/src/cache.ts` changes

### Version source change

No structural change to `GraphCache`. The version string is already a `string` parameter — callers just pass a different value:

Before: `project.getScriptVersion(path)` → returns ProjectService-internal string like `"1"`, `"2"`
After: `contentHash(sourceFile.text)` → returns `"a1b2c3d4e5f6g7h8"`

### `runSolidRules` on cached graph (daemon optimization)

Post-Phase 1, the daemon's cache-hit path (daemon.ts:383-401) no longer calls `parseWithOptionalProgram`. The optimized path:

```typescript
const version = contentHash(sourceFile.text);
const needsRebuild = !cache.hasSolidGraph(key, version);

if (needsRebuild) {
  const input = createSolidInput(key, program, log);
  const graph = buildSolidGraph(input);
  cache.setSolidGraph(key, version, graph);

  const { results, emit } = createEmit(eslintResult.overrides);
  runSolidRules(graph, sourceFile, emit);
  // ... collect diagnostics
} else {
  // Cache hit: re-run rules on cached graph with CURRENT sourceFile
  const graph = cache.getCachedSolidGraph(key, version)!;

  const { results, emit } = createEmit(eslintResult.overrides);
  runSolidRules(graph, sourceFile, emit);
  // ... collect diagnostics
}
```

The cache-hit path:
1. Skips `buildSolidGraph` (~5-13ms savings per file)
2. Still runs `runSolidRules` (rules may have changed between runs)
3. Passes the CURRENT `sourceFile` — rules that compute locations use the current file's positions

---

## `packages/lsp/src/cli/lint.ts` changes

Replace `project.getScriptVersion(key)` with `contentHash`:

```typescript
import { createHash } from "node:crypto";

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// In the per-file loop:
const version = contentHash(sourceFile.text);
cache.setSolidGraph(key, version, graph);
```

---

## `packages/lsp/src/cli/daemon.ts` changes

### Content sync + version computation

Replace `project.getScriptVersion` with content hash:

```typescript
// In the per-file lint loop:
const version = contentHash(content);
const needsRebuild = !cache.hasSolidGraph(key, version);
```

### Eliminate the cache-hit re-parse bug

Current code (daemon.ts:383-401):

```typescript
} else {
  // File unchanged — re-run single-file rules from cached graph.
  // Parse is still needed for sourceCode, but graph build is skipped.
  const cachedGraph = cache.getCachedSolidGraph(key, version);
  // ...
  const input = parseWithOptionalProgram(key, content, program, log);  // BUG: re-parses
  const graphToUse = cachedGraph ?? buildSolidGraph(input);
  // ...
  runSolidRules(graphToUse, input.sourceCode, emit);  // uses re-parsed sourceCode
}
```

Post-Phase 1 + Phase 5:

```typescript
} else {
  // File unchanged — re-run rules on cached graph, no re-parse needed
  const graph = cache.getCachedSolidGraph(key, version)!;
  const sourceFile = program.getSourceFile(key)!;  // O(1) from program cache
  const { results, emit } = createEmit(eslintResult.overrides);
  runSolidRules(graph, sourceFile, emit);
  // ... collect diagnostics
}
```

Zero re-parsing. Zero graph rebuilding. Only rule execution on the cached graph.

---

## `packages/lsp/src/core/analyze.ts` changes

### `buildSolidGraphForPath` (used by cross-file analysis)

Replace version source:

```typescript
import { createHash } from "node:crypto";

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
```

In `rebuildGraphsAndRunCrossFileRules`:

```typescript
for (const solidPath of fileIndex.solidFiles) {
  const sourceFile = program.getSourceFile(solidPath);
  if (!sourceFile) continue;
  const version = contentHash(sourceFile.text);
  if (!cache.hasSolidGraph(solidPath, version)) {
    const input = createSolidInput(solidPath, program, log);
    const graph = buildSolidGraph(input);
    cache.setSolidGraph(solidPath, version, graph);
  }
}
```

---

## `packages/lsp/src/server/connection.ts` changes

### `getSolidGraph` in HandlerContext

Replace version source:

```typescript
getSolidGraph(path) {
  if (classifyFile(path) !== "solid") return null;
  const sourceFile = project.getSourceFile(path);
  if (!sourceFile) return null;
  const version = contentHash(sourceFile.text);
  return graphCache.getSolidGraph(path, version, () => {
    const input = createSolidInput(path, program);
    return buildSolidGraph(input);
  });
},
```

---

## Shared `contentHash` utility

Create `packages/shared/src/content-hash.ts`:

```typescript
import { createHash } from "node:crypto";

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
```

Export from `packages/shared/src/index.ts`.

Import in: `lint.ts`, `daemon.ts`, `analyze.ts`, `connection.ts`.

---

## What is NOT cached on disk

`SolidGraph` contains `ts.Node` references (pointers into the program's AST). These cannot be serialized/deserialized. Graph caching is in-memory only.

This is correct because:
- The CLI creates a fresh program each run → graphs must be rebuilt regardless
- The daemon keeps the program in memory → graphs persist naturally
- The LSP keeps the watch program in memory → same
- Disk serialization would require converting all `ts.Node` references to position-based identifiers and back — more expensive than rebuilding

---

## Verification

1. **Daemon warm lint**: Run `ganko lint` twice via daemon. Second run should show ~0 graph rebuilds in debug log (`getSolidGraph HIT` for all files, `hasSolidGraph: ... hit=true`).
2. **Content hash stability**: Same file content → same hash → cache hit. Modify a file → different hash → cache miss → rebuild.
3. **No re-parse on cache hit**: Debug log should NOT show `parseWithOptionalProgram` or `createSolidInput` on cache-hit files.
4. **Cross-file reuse**: Cross-file analysis uses cached graphs. Debug log shows `crossFile: rebuilt 0/230 SolidGraphs` on no-change run.
5. **Diagnostic correctness**: `ganko lint` output identical whether cache is warm or cold.
