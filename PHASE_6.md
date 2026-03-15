# Phase 6: Parse Result Cache (Content Hash → ESTree)

**Estimated Impact**: Skip parse entirely for unchanged files (~40-60% of per-file cost)
**Files touched**: `packages/ganko/src/solid/parse.ts`, new `packages/lsp/src/core/parse-cache.ts`
**Risk**: Low (parse is pure — same input always produces same output)
**Depends on**: Phase 1 (to know how file content is accessed)

## Problem

`parseForESLint` is called for every file on every lint run. For unchanged files, the parse result (AST, scope manager, parser services) is identical. The parse cost includes:

- Lexing and parsing TypeScript/JSX source text
- Building the ESTree AST from TypeScript's internal AST
- Constructing the scope manager
- Building visitor keys
- Wrapping in `SourceCode`

For a 230-file project, this adds up to significant CPU time even when no files have changed.

## Solution

### Content-Addressed Parse Cache

Hash the file content and cache the parse result. On subsequent runs, if the hash matches, return the cached result without re-parsing.

```typescript
interface ParseCache {
  /** Get cached parse result if content hash matches */
  get(path: string, contentHash: string): CachedParseResult | null

  /** Store parse result for a content hash */
  set(path: string, contentHash: string, result: CachedParseResult): void

  /** Evict a file from the cache */
  evict(path: string): void

  /** Clear all cached results */
  clear(): void
}

interface CachedParseResult {
  readonly sourceCode: TSESLint.SourceCode
  readonly parserServices: Partial<ParserServices> | null
}
```

### Hash Function

Use a fast non-cryptographic hash for content addressing. Options:

- `xxhash` via Bun's native implementation — fastest
- `crypto.createHash('sha256')` — available everywhere, fast enough for this use case
- Content length + first/last 64 bytes as a cheap pre-filter (avoid hashing large unchanged files)

**Decision**: Use `crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)` — 16 hex chars (64 bits) is sufficient for collision resistance across <1000 files. Already used in `daemon.ts:368` for version hashing.

### Cache Scope

**In-process cache** (Map in memory):
- Daemon: persists across lint requests → most files hit cache on repeat runs
- LSP: persists across file changes → unchanged files stay cached
- CLI: per-invocation only → no benefit for cold runs (but combined with `.tsbuildinfo` from Phase 5, the TS parse portion is already cached)

**On-disk cache** (optional, future):
- Serialize `SourceCode` + `parserServices` to disk
- Load on cold start instead of re-parsing
- Complexity: `SourceCode` contains closures and scope manager references — serialization is non-trivial
- **Decision**: Defer on-disk cache. In-process cache covers the high-value cases (daemon, LSP).

### What Can Be Cached

| Component | Cacheable? | Notes |
|-----------|-----------|-------|
| ESTree AST | Yes | Pure transform of source text |
| Scope Manager | Yes | Derived from AST, deterministic |
| Visitor Keys | Yes | Derived from AST node types |
| `SourceCode` wrapper | Yes | Wraps AST + scope manager |
| Parser Services (non-typed) | Yes | ESTree node maps |
| Parser Services (typed) | **No** | Contains `ts.Program` references — invalidated when program changes |
| TypeChecker | **No** | Comes from `ts.Program`, not from parse |

**Key insight**: The `parseContent` path (no type info) is fully cacheable. The `parseContentWithProgram` path produces a `SourceCode` that is cacheable, but the `parserServices` with typed node maps are tied to the specific `ts.Program` instance.

For the typed path, cache the AST/SourceCode portion and re-derive the typed services from the current program. This still saves the expensive lexing/parsing/AST-construction work.

### Integration Points

#### `parse.ts` — Add Cache Parameter

```typescript
export function parseContent(
  path: string,
  content: string,
  logger?: Logger,
  cache?: ParseCache,
): SolidInput {
  if (cache) {
    const hash = contentHash(content);
    const cached = cache.get(path, hash);
    if (cached) {
      return { file: path, sourceCode: cached.sourceCode, parserServices: cached.parserServices, checker: null };
    }
  }

  const result = parseForESLint(content, { ... });
  // ... build SourceCode ...

  if (cache) {
    cache.set(path, hash, { sourceCode, parserServices: result.services ?? null });
  }

  return input;
}
```

#### `daemon.ts` — Use Persistent Cache

The daemon maintains a `ParseCache` instance across requests. On warm runs, most files hit the cache.

#### `connection.ts` (LSP) — Use Persistent Cache

The LSP maintains a `ParseCache` per session. On `didChange`, evict the changed file. All other files stay cached.

#### `lint.ts` (CLI) — Use Per-Invocation Cache

For CLI, a per-invocation cache still helps if cross-file analysis re-parses files (currently it does in `rebuildGraphsAndRunCrossFileRules` via `buildSolidGraphForPath`). With the cache, the second parse hits the cache.

## Changes

### New: `packages/lsp/src/core/parse-cache.ts`

```typescript
import { createHash } from "node:crypto";

interface CachedParseResult { ... }

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function createParseCache(): ParseCache {
  const cache = new Map<string, { hash: string; result: CachedParseResult }>();

  return {
    get(path, hash) {
      const entry = cache.get(path);
      if (entry && entry.hash === hash) return entry.result;
      return null;
    },
    set(path, hash, result) {
      cache.set(path, { hash, result });
    },
    evict(path) {
      cache.delete(path);
    },
    clear() {
      cache.clear();
    },
  };
}
```

### Modified: `packages/ganko/src/solid/parse.ts`

Add optional `cache` parameter to `parseContent` and `parseContentWithProgram`.

### Modified: `daemon.ts`, `connection.ts`, `lint.ts`

Pass `parseCache` instance to parse functions.

## Verification

1. `bun run test` — all tests pass
2. Daemon: first lint → cache miss. Second lint (no changes) → all cache hits, measurably faster
3. Daemon: edit one file → that file misses cache, all others hit
4. LSP: open file, change, save → only changed file re-parsed
5. Verify diagnostic equivalence: cached parse produces identical diagnostics to uncached
