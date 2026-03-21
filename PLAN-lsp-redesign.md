# LSP Architecture Redesign Specification

## Current State

ganko's LSP server is a mutable `ServerContext` bag with 18+ fields, nullable references that handlers blindly trust, string-keyed `Map<string, T>` scattered across `diagCache`, `tsDiagCache`, `graphCache`, and `DocumentState`. Cache invalidation is an implicit ordering dependency between `evictFileCache` → `rediagnoseAffected`. The three TypeScript tiers (Tier1/Incremental/Batch) have no common interface — callers must know which tier to use. Diagnostic publication mixes ganko and TS diagnostics in separate caches with manual merge.

typescript-language-server gets every one of these right. This specification transforms ganko's architecture to match.

---

## 1. Server State Machine

**What it replaces**: The mutable `ServerState` interface in `handlers/lifecycle.ts` (a bag of nullable fields) and the `handlerCtx: HandlerContext | null` on `ServerContext`.

### Design

```typescript
// packages/lsp/src/server/server-state.ts

export const enum ServerPhase {
  /** Connection established, no project. */
  Initializing = 0,
  /** Project loaded, Tier1 TS available, single-file diagnostics active. */
  Running = 1,
  /** Full program built, cross-file analysis active. */
  Enriched = 2,
  /** Unrecoverable error — server should be restarted. */
  Errored = 3,
  /** Shutdown requested. */
  ShutDown = 4,
}

export interface StateInitializing {
  readonly phase: ServerPhase.Initializing
  readonly connection: Connection
  readonly documents: FilteredTextDocuments
  readonly log: LeveledLogger
}

export interface StateRunning {
  readonly phase: ServerPhase.Running
  readonly connection: Connection
  readonly documents: FilteredTextDocuments
  readonly log: LeveledLogger
  readonly project: Project
  readonly fileIndex: FileIndex
  readonly handler: HandlerContext
  readonly diagnostics: DiagnosticsManager
  readonly ruleOverrides: RuleOverrides | null
}

export interface StateEnriched extends StateRunning {
  readonly phase: ServerPhase.Enriched
  readonly graphCache: GraphCache
  readonly tailwindValidator: TailwindValidator | null
}

export interface StateErrored {
  readonly phase: ServerPhase.Errored
  readonly error: Error
  readonly connection: Connection
  readonly log: LeveledLogger
}

export interface StateShutDown {
  readonly phase: ServerPhase.ShutDown
}

export type ServerState =
  | StateInitializing
  | StateRunning
  | StateEnriched
  | StateErrored
  | StateShutDown

/**
 * Typed state accessor. Handlers declare the minimum phase they require.
 * The guard narrows the union — no nullable fields, no runtime checks
 * scattered across handler bodies.
 */
export function requirePhase<P extends ServerPhase>(
  state: ServerState,
  ...phases: P[]
): Extract<ServerState, { phase: P }> | null
```

**Transitions**:
- `Initializing → Running` — on `initialized`, after project + fileIndex are built
- `Running → Enriched` — after background workspace enrichment completes (full program, graph cache, tailwind)
- `Running | Enriched → Errored` — on unrecoverable project/TS failure
- `Running | Enriched → ShutDown` — on shutdown request
- `Errored → Initializing` — on restart (new connection)

**What changes**: `ServerContext` is deleted. Its 18+ fields are distributed across the discriminated states. Each state only contains what's AVAILABLE in that phase. Handlers receive a narrowed state, not a god-object.

---

## 2. Resource Identity Layer

**What it replaces**: Raw `Map<string, T>` with ad-hoc `canonicalPath()` calls scattered across every consumer. `diagCache`, `tsDiagCache`, `DocumentState.openDocuments`, `DocumentState.pathIndex`, `graphCache` all use different string key conventions.

### Design

```typescript
// packages/lsp/src/server/resource-map.ts

/**
 * Type-safe resource-to-value map. All keys are canonical file paths.
 * Encapsulates the canonicalization so consumers never touch raw strings.
 */
export class ResourceMap<T> {
  constructor(private readonly caseSensitive: boolean)

  has(path: string): boolean
  get(path: string): T | undefined
  set(path: string, value: T): void
  delete(path: string): boolean
  clear(): void
  get size(): number
  keys(): IterableIterator<string>
  values(): IterableIterator<T>
  entries(): IterableIterator<[string, T]>
  forEach(fn: (value: T, key: string) => void): void

  /** Canonical key from a raw file path. Single source of truth. */
  private toKey(path: string): string
}

// packages/lsp/src/server/resource-identity.ts

/**
 * Bidirectional URI ↔ canonical-path conversion.
 * Every handler, cache, and diagnostic publisher uses this — never raw string ops.
 */
export interface ResourceIdentity {
  uriToPath(uri: string): string
  pathToUri(path: string): string
  /** Canonical path suitable for ResourceMap keys. */
  canonicalize(path: string): string
}

export function createResourceIdentity(rootPath: string): ResourceIdentity
```

**What changes**: Every `Map<string, Diagnostic[]>`, `Map<string, LSPDiagnostic[]>`, `Map<string, TextDocument>` is replaced with `ResourceMap<T>`. The ad-hoc `canonicalPath()` calls in connection.ts, document.ts, diagnostics-push.ts, lifecycle.ts are removed — `ResourceMap.toKey()` is the single canonicalization point.

---

## 3. Document Management

**What it replaces**: `DocumentState` with three separate Maps (`openDocuments`, `pathIndex`, `pendingChanges`) and a manual `debounceTimer` field with coordination between them in `handlers/document.ts`.

### Design

```typescript
// packages/lsp/src/server/document-manager.ts

export const enum DocumentStatus {
  Open = 0,
  PendingChange = 1,
  Closed = 2,
}

export interface TrackedDocument {
  readonly uri: string
  readonly path: string
  readonly version: number
  readonly status: DocumentStatus
  readonly contentHash: string
}

/**
 * Manages the open/change/close lifecycle as a single coherent state machine.
 * Replaces DocumentState + three Maps + manual debounce timer.
 */
export class DocumentManager {
  constructor(
    private readonly identity: ResourceIdentity,
    private readonly debounceMs: number,
  )

  /** Open a document. Transitions to Open status. */
  open(uri: string, content: string, version: number): TrackedDocument

  /** Buffer a change. Transitions to PendingChange, resets debounce. */
  change(uri: string, version: number): void

  /** Close a document. Transitions to Closed, removes from tracking. */
  close(uri: string): TrackedDocument | null

  /** Get a tracked document by canonical path. */
  getByPath(path: string): TrackedDocument | null

  /** Get a tracked document by URI. */
  getByUri(uri: string): TrackedDocument | null

  /** All currently open document paths. */
  openPaths(): readonly string[]

  /** Register callback for debounced change batches. */
  onDebouncedChanges(callback: (paths: readonly string[]) => void): void

  /** Flush pending changes immediately (for shutdown/testing). */
  flush(): void
}
```

**What changes**: `DocumentState` interface deleted. `createDocumentState()` deleted. `getOpenDocumentPaths()` deleted. The three Maps (`openDocuments`, `pathIndex`, `pendingChanges`) and the `debounceTimer` NodeJS.Timeout are encapsulated inside `DocumentManager`. The debounce callback (`processChangesCallback` in `routing/document.ts`) becomes a registered listener on `DocumentManager.onDebouncedChanges()`.

---

## 4. Diagnostic Pipeline

**What it replaces**: `diagCache: Map<string, readonly Diagnostic[]>` + `tsDiagCache: Map<string, readonly LSPDiagnostic[]>` + manual `republishMergedDiagnostics` in `diagnostics-push.ts` + implicit evict-before-rediagnose ordering.

### Design

```typescript
// packages/lsp/src/server/diagnostics-manager.ts

export const enum DiagnosticKind {
  /** Ganko single-file analysis (Solid rules). */
  Ganko = 0,
  /** Ganko cross-file analysis (layout, CSS cascade). */
  CrossFile = 1,
  /** TypeScript syntactic + semantic diagnostics. */
  TypeScript = 2,
}

/**
 * Per-file diagnostic state. Stores diagnostics by kind,
 * debounces publication to prevent rapid republish.
 */
class FileDiagnostics {
  constructor(
    private readonly path: string,
    private readonly publish: (path: string, diagnostics: readonly LSPDiagnostic[]) => void,
    private readonly debounceMs: number,
  )

  update(kind: DiagnosticKind, diagnostics: readonly LSPDiagnostic[]): void
  clear(kind: DiagnosticKind): void
  clearAll(): void
  getDiagnostics(): readonly LSPDiagnostic[]
  getDiagnosticsByKind(kind: DiagnosticKind): readonly LSPDiagnostic[]
}

/**
 * Aggregates diagnostics from all sources per file.
 * Replaces diagCache + tsDiagCache + manual merge logic.
 */
export class DiagnosticsManager {
  constructor(
    private readonly identity: ResourceIdentity,
    private readonly publishFn: (uri: string, diagnostics: readonly LSPDiagnostic[]) => void,
  )

  /** Update diagnostics for a file from a specific source. */
  update(path: string, kind: DiagnosticKind, diagnostics: readonly LSPDiagnostic[]): void

  /** Get merged diagnostics for a file (all kinds). */
  getDiagnostics(path: string): readonly LSPDiagnostic[]

  /** Evict all diagnostics for a file (on content change). */
  evict(path: string): void

  /** Clear diagnostics for closed file and publish empty. */
  onClose(path: string): void

  /** Re-publish current diagnostics for a file without re-computing. */
  republish(path: string): void
}
```

**What changes**: `diagCache` and `tsDiagCache` deleted from `ServerContext`. `publishFileDiagnostics`, `republishMergedDiagnostics`, `propagateTsDiagnostics` in `diagnostics-push.ts` are replaced by `DiagnosticsManager.update()` calls from each diagnostic source. The merge logic (ganko + TS) moves inside `FileDiagnostics.getDiagnostics()`. The implicit ordering dependency (`evictFileCache` must run before `rediagnoseAffected`) is eliminated — `DiagnosticsManager.evict()` clears stale data, and `update()` replaces it atomically.

---

## 5. TypeScript Service Unification

**What it replaces**: The three separate tiers (`Tier1` = quick `createProgram`, `Incremental` = watch program, `Batch` = full program in `ts-service.ts`) with no common interface. Callers in `diagnostics-push.ts` and `routing/document.ts` choose the tier manually.

### Design

```typescript
// packages/lsp/src/core/ts-service.ts

export const enum TsServiceTier {
  /** Fast startup: createProgram per request, no state. */
  Quick = 0,
  /** Incremental: WatchProgram with file-level caching. */
  Incremental = 1,
  /** Full: Complete program with all project files. */
  Full = 2,
}

/**
 * Unified TypeScript service. Consumer calls execute() — routing to the
 * appropriate tier is internal. Replaces manual tier selection in callers.
 */
export interface TsService {
  /** Current highest available tier. */
  readonly activeTier: TsServiceTier

  /** Get a SourceFile from the best available program. */
  getSourceFile(path: string): ts.SourceFile | null

  /** Get the LanguageService from the best available program. */
  getLanguageService(): ts.LanguageService | null

  /** Get compiler options from the project. */
  getCompilerOptions(): ts.CompilerOptions

  /** Notify that a file changed. Invalidates affected tier caches. */
  notifyFileChange(path: string): void

  /** Upgrade to incremental tier (background). */
  upgradeToIncremental(): Promise<void>

  /** Upgrade to full program tier (background). */
  upgradeToFull(): Promise<void>
}

export function createTsService(
  configPath: string,
  compilerHost: ts.CompilerHost,
  log: Logger,
): TsService
```

**What changes**: `Project.getTier1LanguageService()`, `Project.getLanguageService()`, `Project.createBatchProgram()` are unified behind `TsService`. The tier selection logic in `publishTier1Diagnostics` / `publishFileDiagnostics` moves inside `TsService`. Callers just call `getSourceFile()` / `getLanguageService()` — routing is transparent. The `cachedCompilerOptions`, `cachedTier1Host`, `watchProgramReady` fields on `ServerContext` move into `TsService` internals.

---

## 6. Handler Interface

**What it replaces**: The god-object `ServerContext` passed to every handler. Routing files (`routing/lifecycle.ts`, `routing/document.ts`, `routing/feature.ts`) all close over `ServerContext` and destructure what they need ad-hoc.

### Design

```typescript
// packages/lsp/src/server/handlers/handler-context.ts

/**
 * Minimal interface for feature handlers (definition, hover, completion, etc.).
 * Receives only what a feature handler needs — not the full server state.
 */
export interface FeatureHandlerContext {
  readonly identity: ResourceIdentity
  readonly ts: TsService
  readonly diagnostics: DiagnosticsManager
  readonly log: Logger
  getSolidGraph(path: string): SolidGraph | null
}

/**
 * Interface for document lifecycle handlers (open, change, close).
 * Needs document management and diagnostic triggering.
 */
export interface DocumentHandlerContext {
  readonly identity: ResourceIdentity
  readonly documents: DocumentManager
  readonly diagnostics: DiagnosticsManager
  readonly ts: TsService
  readonly log: Logger
  runDiagnostics(path: string): void
}

/**
 * Interface for lifecycle handlers (initialize, shutdown).
 * Needs state transitions and project setup.
 */
export interface LifecycleHandlerContext {
  readonly connection: Connection
  readonly log: LeveledLogger
  transition(state: ServerState): void
}
```

**What changes**: `HandlerContext` (the current god-object with `getLanguageService`, `getSourceFile`, `getTSFileInfo`, `getAST`, `getDiagnostics`, `getContent`, `getSolidGraph`) is split into three focused interfaces. Each handler category receives only what it needs. The `createGuardedHandler` in `routing/feature.ts` narrows the server state to the handler's required phase and constructs the appropriate context type.

---

## 7. Cache Invalidation

**What it replaces**: The current `evictFileCache` → `rediagnoseAffected` implicit ordering dependency. `evictFileCache` manually clears `diagCache`, `graphCache`, and TS info. `rediagnoseAffected` must run AFTER eviction or it reads stale data.

### Design

```typescript
// packages/lsp/src/server/invalidation.ts

/**
 * Change event describing what happened to a file.
 */
export interface FileChangeEvent {
  readonly path: string
  readonly kind: "created" | "changed" | "deleted"
}

/**
 * Processes file changes through the system. Replaces the manual
 * evictFileCache → rediagnoseAffected → rediagnoseAll sequence.
 *
 * Change propagation is a single atomic operation:
 * 1. Notify TsService of file changes (invalidates TS caches)
 * 2. Evict diagnostic caches for changed files
 * 3. Evict graph caches for changed files
 * 4. Compute affected files (cross-file dependents)
 * 5. Re-diagnose changed + affected files
 *
 * No implicit ordering — the pipeline runs steps in sequence internally.
 */
export class ChangeProcessor {
  constructor(
    private readonly ts: TsService,
    private readonly diagnostics: DiagnosticsManager,
    private readonly graphCache: GraphCache,
    private readonly documents: DocumentManager,
    private readonly log: Logger,
  )

  /** Process a batch of file changes. Single entry point. */
  processChanges(changes: readonly FileChangeEvent[]): void

  /** Full workspace invalidation (config change, etc.). */
  processWorkspaceChange(): void
}
```

**What changes**: `ServerContext.evictFileCache()`, `ServerContext.rediagnoseAffected()`, `ServerContext.rediagnoseAll()` are deleted. The manual call-site pattern `for (path of changed) evictFileCache(path); rediagnoseAffected(changed)` in `routing/lifecycle.ts` and `routing/document.ts` is replaced with a single `changeProcessor.processChanges(events)` call. The ordering is enforced by `ChangeProcessor` internals, not by callers.

---

## 8. Migration Path

### Phase 1: Foundation (no behavior change)
1. Create `ResourceMap<T>` and `ResourceIdentity` — pure additions
2. Create `DiagnosticsManager` with `DiagnosticKind` separation — wraps existing `diagCache` + `tsDiagCache`
3. Create `DocumentManager` — wraps existing `DocumentState` Maps

### Phase 2: State machine
4. Define `ServerPhase` discriminated union and state types
5. Create `requirePhase()` guard
6. Migrate `createServer()` to construct `StateInitializing` instead of `ServerContext`
7. Migrate lifecycle handlers to transition between phases

### Phase 3: Handler interface split
8. Split `HandlerContext` into `FeatureHandlerContext`, `DocumentHandlerContext`, `LifecycleHandlerContext`
9. Migrate each routing file to construct the appropriate context from the narrowed state
10. Delete old `HandlerContext` and `createHandlerContext`

### Phase 4: TsService unification
11. Create `TsService` interface and implementation wrapping the three tiers
12. Migrate callers from `project.getTier1LanguageService()` / `project.getLanguageService()` to `ts.getLanguageService()`
13. Move tier upgrade logic into `TsService.upgradeToIncremental()` / `upgradeToFull()`

### Phase 5: Change processor
14. Create `ChangeProcessor`
15. Migrate `evictFileCache` / `rediagnoseAffected` / `rediagnoseAll` callers to `ChangeProcessor`
16. Delete `evictFileCache`, `rediagnoseAffected`, `rediagnoseAll` from `ServerContext`
17. Delete `ServerContext` interface entirely

### Phase 6: Cleanup
18. Replace all `Map<string, T>` with `ResourceMap<T>` across remaining code
19. Delete `handlers/lifecycle.ts` `ServerState` interface (replaced by discriminated union)
20. Delete `handlers/document.ts` `DocumentState` interface (replaced by `DocumentManager`)

---

## 9. What Stays

These components are already correctly architected and should NOT change:

- **`FilteredTextDocuments`** — gated document allocation preventing unbounded memory. Clean event emitter pattern. Stays as-is.
- **`GcTimer`** — debounced GC scheduling. Simple, correct, no leaks. Stays.
- **`MemoryWatcher`** — periodic RSS monitoring with threshold-based logging. Stays.
- **Worker pool** (`worker-pool.ts`) — long-lived workers, queue dispatch, error recovery. Correct architecture for CLI parallelism. Stays.
- **CLI entry** (`entry.ts`, `lint.ts`) — argument parsing, file resolution, daemon-first-then-fallback pattern. Stays.
- **Daemon** (`daemon.ts`, `daemon-protocol.ts`, `daemon-client.ts`) — JSON-RPC with Content-Length framing, serialized requests, idle shutdown, version-keyed sockets. Production-quality IPC. Stays.
- **Format** (`format.ts`) — ESLint-style output + JSON for CI. Stays.
- **All handler implementations** — the actual logic in definition.ts, hover.ts, completion.ts, etc. is correct. Only their INTERFACE (what context they receive) changes, not their implementation bodies.
- **`capabilities.ts`** — server capability advertisement. Stays.
- **`project-wrapper.ts`** / `Project` abstraction — stays, but consumed through `TsService` rather than directly.
- **`tooling-config.ts`** — ESLint config resolution. Stays.
- **Ganko core** (`@drskillissue/ganko`) — the analysis engine, rules, CSS/layout graph. Completely independent of LSP layer. Stays.
