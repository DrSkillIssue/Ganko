# LSP Layer Redesign Specification

## Preamble

The StyleCompilation engine follows Roslyn's architecture: immutable compilations, merged symbol table, lazy FileSemanticModel, tiered AnalysisDispatcher, CompilationTracker with dependency graph pruning. The LSP layer that consumes this engine was adapted but never redesigned. This specification replaces the LSP layer's mutable ServerContext bag, three-phase startup with degraded capabilities, manual cache eviction ordering, debounce-and-drain document management, separate diagnostic caches with manual merging, and parallel daemon caching with an architecture worthy of the engine it consumes.

---

## 1. Server State Model

### Problem

`ServerContext` is a mutable bag of ~20 fields. `LifecyclePhase` is a discriminated union but the surrounding context is not — `diagCache`, `graphCache`, `tsPropagationCancel`, `phase` are all mutable on one object. Handlers receive the full bag. The three phases (`initializing` → `running` → `enriched`) expose different capabilities, and every handler must check which phase it's in.

### Design

Replace `ServerContext` with a `ServerSession` — an immutable snapshot that handlers receive. Document changes produce new sessions. The lifecycle phase is encoded in the session type, not in a tag field that handlers switch on.

```typescript
// ═══════════════════════════════════════════════════════════════════
// server/session.ts — Immutable server session
// ═══════════════════════════════════════════════════════════════════

/**
 * ServerSession — immutable snapshot of server state.
 *
 * Like Roslyn's Solution: document changes produce new sessions.
 * Handlers receive a typed session, never a mutable bag.
 * The compilation tracker is the session's compilation state —
 * it holds ALL cached analysis, ALL dependency tracking.
 */
interface ServerSession {
  readonly id: number
  readonly rootPath: string
  readonly config: Readonly<ServerConfig>
  readonly compilation: CompilationTracker
  readonly tsProgram: TsProgramState
  readonly workspace: WorkspaceState
  readonly diagnosticState: DiagnosticSnapshot
}

/**
 * TsProgramState — discriminated union for TypeScript availability.
 *
 * Replaces the nullable tsService + tier checks.
 * Quick tier is always available after initialize.
 * Incremental tier is available after program build.
 */
type TsProgramState =
  | { readonly tier: "quick"; readonly host: QuickProgramHost }
  | { readonly tier: "incremental"; readonly service: IncrementalTypeScriptService; readonly project: Project }

interface QuickProgramHost {
  createProgram(path: string, content: string): ts.Program | null
  getCompilerOptions(): ts.CompilerOptions | null
}

/**
 * WorkspaceState — discriminated union for workspace enrichment.
 *
 * Replaces the phase.tag === "enriched" checks.
 * Before enrichment: no registry, no tailwind.
 * After enrichment: registry, tailwind, evaluator all guaranteed.
 */
type WorkspaceState =
  | { readonly enriched: false }
  | {
      readonly enriched: true
      readonly registry: FileRegistry
      readonly layout: WorkspaceLayout
      readonly tailwindValidator: TailwindValidator | null
      readonly batchableValidator: BatchableTailwindValidator | null
      readonly externalCustomProperties: ReadonlySet<string> | undefined
      readonly evaluator: WorkspaceEvaluator | null
    }

/**
 * DiagnosticSnapshot — immutable diagnostic state derived from compilation.
 *
 * Replaces diagCache + graphCache + tsDiagCache as three separate caches.
 * ONE snapshot per session, automatically consistent because it's derived
 * from the compilation snapshot.
 */
interface DiagnosticSnapshot {
  readonly version: number
  get(path: string): FileDiagnosticState
}

interface FileDiagnosticState {
  readonly ganko: readonly Diagnostic[]
  readonly crossFile: readonly Diagnostic[]
  readonly typescript: readonly LspDiagnostic[]
}
```

### Server Infrastructure

```typescript
// ═══════════════════════════════════════════════════════════════════
// server/server.ts — Server infrastructure (mutable, NOT passed to handlers)
// ═══════════════════════════════════════════════════════════════════

/**
 * Server — the mutable infrastructure shell.
 *
 * Like Roslyn's Workspace: holds ONE mutable reference to the current
 * session. Handlers never see this object. They see ServerSession.
 *
 * The server transitions between lifecycle states via an explicit
 * state machine. Each transition produces a new session.
 */
interface Server {
  readonly connection: Connection
  readonly documents: FilteredTextDocuments
  readonly log: LeveledLogger
  readonly gcTimer: GcTimer
  readonly memoryWatcher: MemoryWatcher
  readonly identity: ResourceIdentity
  readonly documentTracker: DocumentTracker
  readonly diagnosticsPublisher: DiagnosticsPublisher

  /** Current session — the ONLY mutable field. */
  session: ServerSession | null

  /** Lifecycle state machine. */
  lifecycle: ServerLifecycle
}

/**
 * ServerLifecycle — discriminated union for server lifecycle.
 *
 * Like typescript-language-server's ServerState (None | Running | Errored).
 * Not a bag of nullable fields.
 */
type ServerLifecycle =
  | { readonly state: "created" }
  | { readonly state: "initializing"; readonly rootPath: string; readonly config: ServerConfig }
  | { readonly state: "running"; readonly session: ServerSession }
  | { readonly state: "shutting-down" }
  | { readonly state: "errored"; readonly error: Error }
```

### Handler Context

```typescript
// ═══════════════════════════════════════════════════════════════════
// server/handler-context.ts — Typed, minimal handler contexts
// ═══════════════════════════════════════════════════════════════════

/**
 * FeatureContext — what feature handlers (hover, definition, etc.) receive.
 *
 * Non-nullable. If the server is in a state where feature handlers
 * can't run, the routing layer returns fallback — handlers never
 * receive null context.
 *
 * Handlers don't know about phases. They call getSourceFile(),
 * getSolidTree(), getSemanticModel(). The context returns what's
 * available from the current session.
 */
interface FeatureContext {
  readonly log: Logger
  readonly session: ServerSession

  getSourceFile(path: string): ts.SourceFile | null
  getLanguageService(): ts.LanguageService | null
  getSolidSyntaxTree(path: string): SolidSyntaxTree | null
  getSemanticModel(path: string): FileSemanticModel | null
  getDiagnostics(path: string): readonly Diagnostic[]
  getContent(path: string): string | null
}

/**
 * DiagnosticContext — what diagnostic producers receive.
 *
 * Encapsulates everything needed to produce diagnostics for a file
 * without knowing about phases, caches, or publication.
 */
interface DiagnosticContext {
  readonly session: ServerSession
  readonly log: Logger
  readonly resolveContent: (path: string) => string | null
  readonly overrides: RuleOverrides
  readonly warningsAsErrors: boolean
}
```

---

## 2. Document Management

### Problem

`DocumentManager` queues pending changes with a 300ms debounce timer, then drains them in `processChangesCallback`. This is a manual implementation of what should be request cancellation + re-queuing. The four-phase debounce flow (evict → single-file → cross-file → merge) is ordering-dependent and fragile.

### Design

Replace debounce-and-drain with a `DocumentTracker` that produces new sessions on change. Request cancellation replaces debouncing — when a new change arrives, the pending diagnostic computation is cancelled and restarted with the new compilation snapshot.

```typescript
// ═══════════════════════════════════════════════════════════════════
// server/document-tracker.ts — Document lifecycle state machine
// ═══════════════════════════════════════════════════════════════════

/**
 * DocumentTracker — coherent document lifecycle.
 *
 * Like typescript-language-server's LspDocuments: document open/close/change
 * flows through a single path. Each change produces a new compilation
 * snapshot via tracker.applyChange().
 *
 * No debounce timer. No pending changes to drain. Cancellation tokens
 * replace debouncing — stale diagnostic computations are cancelled
 * when new changes arrive.
 */
interface DocumentTracker {
  open(uri: string, path: string, version: number, content: string): DocumentChangeResult
  change(uri: string, version: number, content: string): DocumentChangeResult
  save(uri: string): void
  close(uri: string): string | null

  getByUri(uri: string): TrackedDocument | null
  getByPath(path: string): TrackedDocument | null
  openPaths(): readonly string[]
  readonly openCount: number
}

interface TrackedDocument {
  readonly uri: string
  readonly path: string
  readonly version: number
  readonly content: string
}

/**
 * DocumentChangeResult — what a document change produces.
 *
 * Contains the new compilation snapshot and the set of files
 * that need re-diagnosis. The caller doesn't need to know about
 * cache eviction — the compilation tracker handled it.
 */
interface DocumentChangeResult {
  readonly path: string
  readonly content: string
  readonly affectedPaths: readonly string[]
  readonly cancellationToken: CancellationToken
}

/**
 * CancellationToken — request cancellation instead of debouncing.
 *
 * Like typescript-language-server's GetErrRequest cancellation.
 * When a new document change arrives, the previous token is cancelled.
 * Diagnostic producers check the token between phases.
 */
interface CancellationToken {
  readonly isCancelled: boolean
  onCancelled(callback: () => void): void
}

interface CancellationSource {
  readonly token: CancellationToken
  cancel(): void
}

declare function createCancellationSource(): CancellationSource
```

### Change Flow

```
document change arrives
  → DocumentTracker.change(uri, version, content)
    → cancel previous CancellationSource
    → create new CancellationSource
    → server.session.compilation.applyFileChange(path, tree)
      → CompilationTracker produces new compilation
      → dependency graph identifies affected files
    → return DocumentChangeResult { path, content, affectedPaths, token }
  → DiagnosticPipeline.run(result)
    → for each affected file:
      → if token.isCancelled: abort
      → produce diagnostics from current compilation
      → publish via DiagnosticsPublisher
```

---

## 3. Unified Diagnostic State

### Problem

`diagCache` (ResourceMap of ganko Diagnostic[]), cross-file results cached in `CompilationTracker.getCachedCrossFileResults()`, and TS diagnostics in `DiagnosticsManager` by kind — three separate stores with manual merging for publication. `republishMergedDiagnostics` exists because single-file and cross-file results are produced at different times and must be manually combined.

### Design

One `DiagnosticsPublisher` that owns all diagnostic state per file. Diagnostics are derived from the compilation snapshot — they're not cached separately from the compilation. Publication is automatic when state changes.

```typescript
// ═══════════════════════════════════════════════════════════════════
// server/diagnostics-publisher.ts — Unified diagnostic state
// ═══════════════════════════════════════════════════════════════════

/**
 * DiagnosticsPublisher — single owner of diagnostic state per file.
 *
 * Like typescript-language-server's DiagnosticsManager: one place,
 * one invalidation, one publish path. No separate caches.
 *
 * Replaces: diagCache + graphCache.getCachedCrossFileDiagnostics + DiagnosticsManager
 */
interface DiagnosticsPublisher {
  /**
   * Run diagnostics for a file and publish results.
   *
   * Produces ganko single-file + cross-file + TypeScript diagnostics
   * in one call. No manual merging. No separate cache eviction.
   * Checks cancellation token between phases.
   */
  diagnoseAndPublish(
    path: string,
    context: DiagnosticContext,
    token: CancellationToken,
  ): void

  /**
   * Publish diagnostics for multiple affected files.
   *
   * Used after a document change when the dependency graph
   * identifies transitively affected files.
   */
  diagnoseAffected(
    paths: readonly string[],
    context: DiagnosticContext,
    token: CancellationToken,
  ): void

  /** Get current diagnostics for a file (for pull diagnostics). */
  getDiagnostics(path: string): FileDiagnosticState

  /** Clear diagnostics for a closed file. */
  clear(path: string): void

  /** Clear all diagnostics. */
  clearAll(): void
}

/**
 * FileDiagnosticEntry — per-file diagnostic state.
 *
 * Like typescript-language-server's FileDiagnostics: stores diagnostics
 * by kind, publishes merged results on any update. Batch mode
 * coalesces multiple kind updates into a single publish.
 */
interface FileDiagnosticEntry {
  update(kind: DiagnosticKind, diagnostics: readonly LspDiagnostic[]): void
  clear(kind: DiagnosticKind): void
  getDiagnostics(): readonly LspDiagnostic[]
  getDiagnosticsByKind(kind: DiagnosticKind): readonly LspDiagnostic[]
  publish(): void
  close(): void
}

const enum DiagnosticKind {
  Ganko = 0,
  CrossFile = 1,
  TypeScript = 2,
}
```

### Diagnostic Pipeline

```typescript
// ═══════════════════════════════════════════════════════════════════
// server/diagnostic-pipeline.ts — Diagnostic production pipeline
// ═══════════════════════════════════════════════════════════════════

/**
 * DiagnosticPipeline — orchestrates diagnostic production.
 *
 * Replaces the scattered publishFileDiagnostics / publishTier1Diagnostics /
 * republishMergedDiagnostics / propagateTsDiagnostics functions with a
 * single pipeline that checks cancellation between phases.
 *
 * Phase 1: Single-file ganko diagnostics (always)
 * Phase 2: Cross-file ganko diagnostics (if workspace enriched)
 * Phase 3: TypeScript diagnostics (if enabled)
 *
 * Each phase checks token.isCancelled before starting.
 * If cancelled, previous results remain — the next change will
 * produce fresh results.
 */
interface DiagnosticPipeline {
  /**
   * Run all diagnostic phases for a file.
   *
   * @param path - File to diagnose
   * @param content - Current content (from editor buffer or disk)
   * @param session - Current server session
   * @param token - Cancellation token (cancelled on next document change)
   */
  run(
    path: string,
    content: string | undefined,
    session: ServerSession,
    token: CancellationToken,
  ): void

  /**
   * Run diagnostics for a batch of affected files.
   * Checks cancellation between files.
   */
  runBatch(
    paths: readonly string[],
    session: ServerSession,
    token: CancellationToken,
  ): void
}
```

---

## 4. CompilationTracker as the Single Cache

### Problem

The LSP maintains `diagCache` (ResourceMap), cross-file results in `CompilationTracker`, CSS content in `FileRegistry.cssContentCache`, and solid trees in the daemon's `solidTrees` Map — four separate caches with separate invalidation. When a file changes, the LSP must manually evict each one in the correct order via `evictCachesForPath`.

### Design

The `CompilationTracker` (already built) becomes the SOLE cache. File changes flow through it. No separate caches in the LSP layer.

```typescript
// ═══════════════════════════════════════════════════════════════════
// The compilation tracker IS the cache — no separate LSP caches
// ═══════════════════════════════════════════════════════════════════

/**
 * Change flow — how the LSP layer uses the compilation tracker.
 *
 * Document change arrives:
 *   1. Parse file → SolidSyntaxTree or CSSSyntaxTree
 *   2. compilation = compilation.withFile(path, tree)
 *      → CompilationTracker produces new compilation
 *      → symbol table lazily recomputed (DeclarationTable caches old contributions)
 *      → dependency graph updated
 *   3. affected = compilation.dependencyGraph.getTransitivelyAffected(path)
 *   4. For each affected file:
 *      → model = compilation.getSemanticModel(file)
 *      → diagnostics = dispatcher.runFile(model)
 *   5. Publish diagnostics
 *
 * No diagCache. No graphCache. No manual eviction.
 * The compilation IS the cache. New compilations automatically
 * invalidate stale data via structural sharing.
 */

/**
 * SessionMutator — produces new sessions from file changes.
 *
 * Like Roslyn's Workspace.ApplyDocumentTextChanged():
 * takes the current session, applies a change, returns a new session.
 * The old session remains valid (any in-progress handler using it
 * sees a consistent snapshot).
 */
interface SessionMutator {
  /**
   * Apply a file change to the current session.
   *
   * Parses the file, updates the compilation, identifies affected files,
   * returns a new session. The old session is not modified.
   */
  applyFileChange(
    session: ServerSession,
    path: string,
    content: string,
  ): SessionChangeResult

  /**
   * Apply a workspace-level change (config, excludes, etc.).
   */
  applyWorkspaceChange(
    session: ServerSession,
    config: ServerConfig,
  ): ServerSession

  /**
   * Apply workspace enrichment results.
   */
  applyEnrichment(
    session: ServerSession,
    enrichment: EnrichmentResult,
  ): ServerSession
}

interface SessionChangeResult {
  readonly session: ServerSession
  readonly affectedPaths: readonly string[]
}
```

---

## 5. Incremental Cross-File Analysis

### Problem

`refreshCrossFileCache()` rebuilds the entire cross-file result set atomically via `rebuildAndRunDispatcher` — creates a new `StyleCompilation` from scratch, adds ALL solid trees, ALL CSS trees, runs ALL rules. The CompilationTracker's `getTransitivelyAffected()` exists but the LSP doesn't use it for cross-file analysis.

### Design

Cross-file analysis uses the dependency graph to re-analyze only affected files. The tiered computation model ensures only required analysis tiers run.

```typescript
// ═══════════════════════════════════════════════════════════════════
// core/incremental-analysis.ts — Incremental cross-file analysis
// ═══════════════════════════════════════════════════════════════════

/**
 * IncrementalAnalyzer — replaces monolithic refreshCrossFileCache.
 *
 * Uses compilation.dependencyGraph.getTransitivelyAffected() to
 * identify which files need re-analysis after a change. Only those
 * files' semantic models are recomputed. The dispatcher runs only
 * the rules whose inputs changed.
 *
 * The compilation is NOT rebuilt from scratch. The immutable compilation
 * with structural sharing means unchanged trees are reused. Only the
 * changed tree is replaced, and only affected semantic models are
 * recomputed (they're lazy — untouched models retain their cached
 * binding results).
 */
interface IncrementalAnalyzer {
  /**
   * Analyze a single file using the current compilation.
   *
   * Returns ganko diagnostics (single-file + cross-file combined).
   * The compilation's semantic model handles the cross-file resolution
   * transparently — the caller doesn't need to know about scopes,
   * component hosts, or cascade binding.
   */
  analyzeFile(
    path: string,
    compilation: StyleCompilation,
    overrides: RuleOverrides,
  ): readonly Diagnostic[]

  /**
   * Analyze a batch of affected files.
   *
   * Used after a document change to re-analyze transitively affected files.
   * The compilation is the same snapshot — only the semantic models
   * for affected files are recomputed.
   */
  analyzeAffected(
    paths: readonly string[],
    compilation: StyleCompilation,
    overrides: RuleOverrides,
  ): ReadonlyMap<string, readonly Diagnostic[]>
}

/**
 * CompilationDiagnosticProducer — bridges compilation to LSP diagnostics.
 *
 * Takes a compilation snapshot, runs the dispatcher, returns per-file
 * diagnostics. The dispatcher already knows about tiers — Tier 0 CSS-only
 * rules run on CSS trees alone, Tier 1-5 on semantic models.
 *
 * For incremental updates, only re-runs rules whose input files
 * are in the affected set.
 */
interface CompilationDiagnosticProducer {
  /**
   * Run all cross-file rules on the compilation.
   * Returns diagnostics grouped by file path.
   */
  runAll(
    compilation: StyleCompilation,
    overrides: RuleOverrides,
  ): ReadonlyMap<string, readonly Diagnostic[]>

  /**
   * Run cross-file rules for a subset of files.
   * Only files in `paths` produce diagnostics.
   * Rules that don't touch any file in `paths` are skipped.
   */
  runSubset(
    paths: readonly string[],
    compilation: StyleCompilation,
    overrides: RuleOverrides,
  ): ReadonlyMap<string, readonly Diagnostic[]>
}
```

---

## 6. Daemon Consolidation

### Problem

The daemon maintains its own `solidTrees` Map, `cssContentMap` Map, `crossFileDiagnostics` cache, `fileIndex`, `tailwind`, `externalCustomProperties` — all separate from the LSP's caching. It reimplements compilation construction (`createStyleCompilation` → `withSolidTree` → `withCSSTrees` → `createAnalysisDispatcher`). The daemon IS a headless LSP server but doesn't use the LSP's infrastructure.

### Design

The daemon uses the same `SessionMutator` and `CompilationDiagnosticProducer` as the LSP. No parallel caching. The daemon is a thin IPC shell around a `ServerSession`.

```typescript
// ═══════════════════════════════════════════════════════════════════
// cli/daemon.ts — Thin IPC shell around ServerSession
// ═══════════════════════════════════════════════════════════════════

/**
 * DaemonState — daemon holds a single ServerSession, not parallel caches.
 *
 * The daemon IS a headless server. It holds the same session type as
 * the LSP. File changes go through the same SessionMutator. Diagnostics
 * come from the same CompilationDiagnosticProducer. The compilation
 * tracker handles all caching.
 */
interface DaemonState {
  readonly startTime: number
  readonly projectRoot: string
  readonly server: NetServer
  readonly log: Logger

  /** The daemon's session — same type as the LSP's. */
  session: ServerSession | null

  /** Session mutator — same as the LSP's. */
  readonly mutator: SessionMutator

  /** Diagnostic producer — same as the LSP's. */
  readonly diagnosticProducer: CompilationDiagnosticProducer

  idleTimer: ReturnType<typeof setTimeout> | null
  pending: Promise<void>
  shutdownStarted: boolean
}

/**
 * handleLintRequest — uses session infrastructure, not parallel caches.
 *
 * 1. Ensure session exists for project root
 * 2. Apply file changes via mutator.applyFileChange()
 * 3. Run diagnostics via diagnosticProducer.runAll()
 * 4. Return results
 *
 * No solidTrees Map. No cssContentMap. No crossFileDiagnostics cache.
 * The session's compilation tracker handles all of this.
 */
declare function handleLintRequest(
  state: DaemonState,
  request: LintRequest,
): Promise<DaemonResponse>
```

---

## 7. CLI/LSP Unification

### Problem

CLI uses `createProject` → `project.getProgram()` → `createSolidInput` → `buildSolidSyntaxTree` → `createStyleCompilation` → `withSolidTree` → `buildCSSResult` → `withCSSTrees` → `createAnalysisDispatcher` → `dispatcher.run()`. LSP uses `runSingleFileDiagnostics` → `runCrossFileDiagnostics` → `rebuildAndRunDispatcher` which does the same thing differently. The daemon does it a third way. Three paths to the same compilation.

### Design

One `CompilationBuilder` that all three consumers use. It takes a project root and file set, returns a `StyleCompilation`. The builder handles TypeScript program creation, solid tree parsing, CSS parsing, and tailwind resolution — all in one path.

```typescript
// ═══════════════════════════════════════════════════════════════════
// core/compilation-builder.ts — Single compilation construction path
// ═══════════════════════════════════════════════════════════════════

/**
 * CompilationBuilder — one way to construct a StyleCompilation.
 *
 * Used by CLI, LSP, and daemon. No consumer assembles compilations
 * manually. The builder handles:
 *   - TypeScript program creation (from tsconfig)
 *   - Solid tree parsing (from source files)
 *   - CSS tree parsing (from CSS files)
 *   - Tailwind resolution (from CSS entry points)
 *   - External custom property scanning
 *
 * For the LSP, the builder is called incrementally via
 * SessionMutator.applyFileChange(). For CLI, it's called once
 * with the full file set. For the daemon, it's called once on
 * first request and then incrementally.
 */
interface CompilationBuilder {
  /**
   * Build a full compilation from a project root.
   * Used by CLI and daemon initial build.
   */
  buildFull(options: FullBuildOptions): CompilationBuildResult

  /**
   * Apply a single file change to an existing compilation.
   * Used by LSP and daemon incremental updates.
   */
  applyChange(
    compilation: StyleCompilation,
    path: string,
    content: string,
    tsProgram: ts.Program,
    logger?: Logger,
  ): CompilationChangeResult
}

interface FullBuildOptions {
  readonly rootPath: string
  readonly solidFiles: ReadonlySet<string>
  readonly cssFiles: ReadonlySet<string>
  readonly tsProgram: ts.Program
  readonly tailwindValidator: TailwindValidator | null
  readonly externalCustomProperties: ReadonlySet<string> | undefined
  readonly logger?: Logger
  readonly resolveContent: (path: string) => string | null
}

interface CompilationBuildResult {
  readonly compilation: StyleCompilation
}

interface CompilationChangeResult {
  readonly compilation: StyleCompilation
  readonly affectedPaths: readonly string[]
}

/**
 * ProjectFactory — single way to find a project root and create a Project.
 *
 * Replaces: CLI's findProjectRoot + createProject, daemon's createProject,
 * LSP's createProject in handleInitialized.
 */
interface ProjectFactory {
  /**
   * Find the project root from a starting path.
   * Walks up looking for tsconfig.json or package.json.
   */
  findRoot(from: string): string

  /**
   * Create a Project for a root path.
   * Handles tsconfig resolution, plugin loading, ESLint config.
   */
  create(options: ProjectCreateOptions): Project
}

interface ProjectCreateOptions {
  readonly rootPath: string
  readonly plugins: readonly Plugin<string>[]
  readonly overrides?: RuleOverrides
  readonly logger?: Logger
}
```

---

## 8. Handler Interface

### Problem

Every handler receives `FeatureHandlerContext` which is created from the mutable `ServerContext` via `createFeatureHandlerContext`. The context is nullable (`getCtx()` returns null when not in running/enriched phase). Handlers must null-check. The routing layer in `feature.ts` has a `createGuardedHandler` wrapper that returns fallback on null — functional but the type system doesn't enforce safety.

### Design

Handlers receive a non-nullable `FeatureContext` that provides queries against the current session snapshot. The routing layer constructs the context from the current session. If no session exists, the routing layer returns fallback without calling the handler.

```typescript
// ═══════════════════════════════════════════════════════════════════
// server/routing.ts — Handler routing with typed contexts
// ═══════════════════════════════════════════════════════════════════

/**
 * Handler registration — typed, non-nullable contexts.
 *
 * The routing layer resolves the context from the current session.
 * Handlers are never called with null context. The type system
 * enforces this — handlers take FeatureContext, not FeatureContext | null.
 */
interface HandlerRouter {
  /**
   * Register a feature handler.
   *
   * The router extracts FeatureContext from the current session.
   * If no session is available (server not ready), returns fallback
   * without calling the handler.
   */
  feature<P, R>(
    name: string,
    handler: (params: P, ctx: FeatureContext) => R,
    fallback: R,
  ): (params: P) => R

  /**
   * Register a handler that needs workspace enrichment.
   *
   * Like feature(), but the context includes workspace data.
   * Returns fallback if workspace is not enriched yet.
   */
  enriched<P, R>(
    name: string,
    handler: (params: P, ctx: EnrichedFeatureContext) => R,
    fallback: R,
  ): (params: P) => R
}

/**
 * EnrichedFeatureContext — FeatureContext + workspace data.
 *
 * For handlers that need cross-file information (e.g., definition
 * across files, workspace symbol search).
 */
interface EnrichedFeatureContext extends FeatureContext {
  readonly workspace: {
    readonly registry: FileRegistry
    readonly layout: WorkspaceLayout
    readonly tailwindValidator: TailwindValidator | null
  }
}

/**
 * FeatureContext implementation.
 *
 * Constructed from a ServerSession. All queries delegate to
 * the session's compilation and TypeScript state.
 */
declare function createFeatureContext(session: ServerSession, log: Logger): FeatureContext
```

### Handler Signatures (unchanged logic, new context)

```typescript
// Existing handler signatures remain. Only the context type changes.
// The LOGIC stays — only the context they receive changes.

declare function handleHover(params: HoverParams, ctx: FeatureContext): Hover | null
declare function handleDefinition(params: DefinitionParams, ctx: FeatureContext): Definition | null
declare function handleCompletion(params: CompletionParams, ctx: FeatureContext): CompletionList | null
declare function handleReferences(params: ReferenceParams, ctx: FeatureContext): Location[] | null
declare function handleRename(params: RenameParams, ctx: FeatureContext): WorkspaceEdit | null
declare function handleCodeAction(params: CodeActionParams, ctx: FeatureContext): CodeAction[] | null
declare function handleDocumentSymbol(params: DocumentSymbolParams, ctx: FeatureContext): DocumentSymbol[] | null
declare function handleSemanticTokens(params: SemanticTokensParams, ctx: FeatureContext): SemanticTokens | null
declare function handleInlayHint(params: InlayHintParams, ctx: FeatureContext): InlayHint[] | null
// ... all other handlers follow the same pattern
```

---

## 9. TypeScript Service Integration

### Problem

Three tiers exist: Quick (Tier 1, per-file createProgram), Incremental (LanguageService-backed), and the compilation's own type resolver. The LSP manually routes between them based on phase. `publishTier1Diagnostics` creates a one-off program, runs rules, caches results separately. `publishFileDiagnostics` uses the incremental program through `Project`. The session should hold the best available TypeScript state transparently.

### Design

`TsProgramState` is a discriminated union on the session. The session always provides the best available program. Handlers don't choose tiers — they call `session.tsProgram` and get what's available.

```typescript
// ═══════════════════════════════════════════════════════════════════
// core/ts-program-state.ts — TypeScript program availability
// ═══════════════════════════════════════════════════════════════════

/**
 * TsProgramState — discriminated union for TypeScript availability.
 *
 * Quick tier: per-file program, no cross-module types.
 *   Available immediately after initialize.
 *   Used for Tier 1 single-file diagnostics during startup.
 *
 * Incremental tier: full LanguageService with project-wide types.
 *   Available after watchProgramReady().
 *   Used for all diagnostics after startup completes.
 *
 * The session holds ONE of these. Callers use getSourceFile() /
 * getProgram() — they don't choose tiers.
 */
type TsProgramState =
  | { readonly tier: "quick"; readonly host: QuickProgramHost }
  | { readonly tier: "incremental"; readonly service: IncrementalTypeScriptService; readonly project: Project }

/**
 * Unified access — hides tier selection.
 */
interface TsProgramAccess {
  /** Get the best available program. Quick tier returns a per-file program. */
  getProgram(path?: string, content?: string): ts.Program | null

  /** Get a source file from the best available program. */
  getSourceFile(path: string): ts.SourceFile | null

  /** Get language service (null at Quick tier). */
  getLanguageService(): ts.LanguageService | null

  /** Update in-memory file content. */
  updateFile(path: string, content: string): void

  /** The current tier. */
  readonly tier: "quick" | "incremental"
}

declare function createTsProgramAccess(state: TsProgramState): TsProgramAccess
```

### Tier Transition

```
initialize →
  create QuickProgramHost (compile options from tsconfig)
  session.tsProgram = { tier: "quick", host }

  → didOpen arrives before program build
    → DiagnosticPipeline uses host.createProgram(path, content) for Tier 1
    → publishes single-file diagnostics immediately

watchProgramReady() resolves →
  create IncrementalTypeScriptService
  session = session with { tsProgram: { tier: "incremental", service, project } }

  → subsequent didOpen/didChange uses service.getProgram()
  → re-diagnose all open files with full type information
```

---

## 10. Migration Path

### Phase 1: CancellationToken + DiagnosticPipeline

**Files changed:** `diagnostics-push.ts`, `routing/document.ts`
**Files created:** `server/cancellation.ts`, `server/diagnostic-pipeline.ts`
**Files deleted:** none

Replace the debounce flow with cancellation:
1. Create `CancellationSource` / `CancellationToken` types
2. Create `DiagnosticPipeline` that runs phases with cancellation checks
3. Rewire `processChangesCallback` to cancel previous token + start new pipeline run
4. Remove debounce timer from `DocumentManager`

**Validation:** Open file → get diagnostics. Edit file rapidly → only final edit's diagnostics appear. No flicker from intermediate results.

### Phase 2: Unified DiagnosticsPublisher

**Files changed:** `diagnostics-manager.ts`, `diagnostics-push.ts`, `routing/document.ts`, `routing/feature.ts`
**Files deleted:** `diagnostics-push.ts` (absorbed into pipeline)

Merge `diagCache` (ResourceMap) into `DiagnosticsManager`:
1. `DiagnosticsManager` stores ganko `Diagnostic[]` alongside `LspDiagnostic[]`
2. Remove `diagCache` from `ServerContext`
3. Remove `republishMergedDiagnostics` — the pipeline publishes complete results
4. Update pull diagnostics handler to read from `DiagnosticsManager`

**Validation:** Open file → single-file + cross-file diagnostics appear. Edit file → updated diagnostics. Close file → diagnostics cleared.

### Phase 3: ServerSession + SessionMutator

**Files changed:** `connection.ts`, `routing/lifecycle.ts`, `routing/document.ts`, `routing/feature.ts`, `handlers/lifecycle.ts`
**Files created:** `server/session.ts`, `server/session-mutator.ts`
**Files deleted:** none (old context preserved as adapter during migration)

Extract immutable `ServerSession` from `ServerContext`:
1. Create `ServerSession` type with compilation, ts program, workspace state
2. Create `SessionMutator` that produces new sessions from changes
3. `ServerContext` holds `session: ServerSession | null`
4. Feature handlers receive `FeatureContext` created from current session
5. Lifecycle handlers transition session state

**Validation:** Full LSP test suite passes. Initialize → get diagnostics → edit → updated diagnostics → workspace scan → cross-file diagnostics.

### Phase 4: CompilationBuilder Unification

**Files changed:** `core/analyze.ts`, `cli/lint.ts`, `cli/daemon.ts`
**Files created:** `core/compilation-builder.ts`
**Files deleted:** none (old analyze functions kept as thin wrappers initially)

Extract shared compilation construction:
1. Create `CompilationBuilder` with `buildFull` and `applyChange`
2. CLI `runLint` uses `builder.buildFull()`
3. LSP `SessionMutator` uses `builder.applyChange()`
4. `rebuildAndRunDispatcher` calls through to builder

**Validation:** `ganko lint` produces identical diagnostics. LSP cross-file diagnostics unchanged.

### Phase 5: Daemon Consolidation

**Files changed:** `cli/daemon.ts`
**Files deleted:** none

Replace daemon's parallel caches with session infrastructure:
1. `DaemonState` holds `session: ServerSession | null`
2. `handleLintRequest` uses `SessionMutator` for file changes
3. `handleLintRequest` uses `CompilationDiagnosticProducer` for diagnostics
4. Remove `solidTrees`, `cssContentMap`, `crossFileDiagnostics` from `DaemonState`

**Validation:** `ganko lint --daemon` produces identical diagnostics. Warm daemon reuses compilation across invocations.

### Phase 6: Incremental Cross-File Analysis

**Files changed:** `core/analyze.ts`, `server/diagnostic-pipeline.ts`
**Files created:** `core/incremental-analysis.ts`

Replace monolithic cross-file rebuild with incremental:
1. Create `IncrementalAnalyzer` using `compilation.dependencyGraph.getTransitivelyAffected()`
2. Pipeline uses `IncrementalAnalyzer.analyzeAffected()` instead of `rebuildAndRunDispatcher()`
3. Only affected files' semantic models recomputed

**Validation:** Change a CSS file → only solid files that import it get re-diagnosed. Unchanged files retain cached results.

### Phase 7: DocumentTracker (replace DocumentManager)

**Files changed:** `routing/document.ts`, `connection.ts`
**Files created:** `server/document-tracker.ts`
**Files deleted:** `server/document-manager.ts`, `server/change-processor.ts`

Replace debounce + drain with cancellation-based document tracking:
1. Create `DocumentTracker` with open/change/save/close
2. Each change cancels previous diagnostic run, starts new one
3. Remove `DocumentManager` with its debounce timer
4. Remove `ChangeProcessor` — the pipeline handles change propagation

**Validation:** Rapid typing → diagnostics appear after typing stops (natural latency from compilation, no artificial debounce). Single keystroke → diagnostics within 100ms.

### Phase 8: Cleanup

**Files deleted:**
- `server/change-processor.ts` (absorbed into pipeline)
- `server/diagnostics-push.ts` (absorbed into pipeline)
- `core/tier1-program.ts` (absorbed into TsProgramState)

**Files changed:**
- `connection.ts` → `server.ts` (renamed, simplified)
- `server-state.ts` → deleted (absorbed into session.ts)
- `handlers/handler-context.ts` → simplified to FeatureContext only

---

## 11. What Stays

These components are architecturally correct and do not change:

- **CompilationTracker and StyleCompilation** — the immutable compilation with structural sharing, dependency graph, DeclarationTable. The LSP redesign makes the LSP *worthy* of consuming this engine; the engine itself is complete.

- **AnalysisDispatcher and tiered rule execution** — Tier 0 CSS-only, Tier 1-5 cross-file with SemanticModel queries. 65 rules registered, dispatched by tier.

- **FileSemanticModel with lazy cascade binding** — per-file lazy view into the compilation's symbol table. Cross-file resolution delegates to the compilation.

- **FilteredTextDocuments** — URI predicate gating that prevents memory growth from irrelevant file types. Clean, stable, no coupling to server state.

- **GcTimer** — debounced GC after idle timeout. Adapted from tsserver's pattern. The `scheduleCollect()` call moves from handlers to the routing layer.

- **MemoryWatcher** — periodic memory monitoring with high-water-mark gating. Standalone infrastructure.

- **Worker pool for CLI parallelization** (`worker-pool.ts`, `lint-worker.ts`) — stable CLI infrastructure unrelated to the LSP state model.

- **ESLint config loading** (`eslint-config.ts`) — config resolution and override merging. Consumed by the session, not coupled to server state.

- **All 65 rule implementations** — already migrated to the compilation/dispatch architecture. Rules consume `FileSemanticModel` and `SymbolTable` queries. The LSP redesign doesn't touch rule logic.

- **LSP handler implementations for IDE features** — the LOGIC of hover, definition, completion, references, rename, code-action, signature-help, document-highlight, document-symbol, workspace-symbol, semantic-tokens, folding-ranges, selection-range, linked-editing, inlay-hint stays. Only the context they receive changes from `FeatureHandlerContext` to `FeatureContext`.

- **Server capabilities** (`capabilities.ts`) — capability negotiation is stable and independent of server state.

- **Resource identity and resource map** — URI↔path conversion and canonical path keying. Utility infrastructure.

- **Incremental TypeScript service** (`incremental-program.ts`) — LanguageService with file version tracking. Moves into `TsProgramState.incremental` but the implementation is unchanged.

- **Batch TypeScript service** (`batch-program.ts`) — CLI TypeScript program creation. Unchanged.

- **Output formatting** (`format.ts`) — CLI output formatting. Unrelated to LSP state.

- **Daemon protocol** (`daemon-protocol.ts`) — IPC message types. Unchanged.

- **Daemon client** (`daemon-client.ts`) — client-side daemon connection. Unchanged.

- **Logger infrastructure** (`logger.ts`) — logging backends. Unchanged.

- **Tailwind state** (`tailwind-state.ts`) — Tailwind resolver state tracking. Moves into WorkspaceState but implementation unchanged.

- **Workspace evaluator** (`workspace-eval.ts`) — subprocess for Tailwind v4 evaluation. Unchanged.
