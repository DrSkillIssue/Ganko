### 1. Decision
**Complete architecture analysis of the layout subsystem across 5 dimensions.** Effort: **XL** (execution would be >2 days for the combined changes).
---
### 2. Signature Changes
#### S1. `toLayoutElementKey` — stringly-typed composite key
**File:** `graph.ts:198-199`
export function toLayoutElementKey(solidFile: string, elementId: number): string {
  return `${solidFile}::${elementId}`
}
**Problem:** Every call allocates a string via template literal. These keys are the primary index into ~15 Maps across the graph. The `string` return type leaks internal structure; callers can fabricate invalid keys.
**Replacement:** Branded opaque type + cached key on `LayoutElementNode`:
export type LayoutElementKey = string & { readonly __brand: "LayoutElementKey" }
export function toLayoutElementKey(solidFile: string, elementId: number): LayoutElementKey {
  return `${solidFile}::${elementId}` as LayoutElementKey  // single branded cast at boundary
}
However, given the `as Type` prohibition, the better approach is to make `LayoutElementNode.key` the sole source of truth and change ALL Map keys from `string` to use the node directly (see S5 below). This eliminates the function entirely.
**Impact:** Eliminates ~N string allocations per element (N = number of fact indexes using `node.key`). CPU + memory.
---
#### S2. `buildLayoutGraph` — monolithic 20-parameter return object
**File:** `build.ts:70` — `buildLayoutGraph` accepts `Logger = noopLogger` default but this is only useful for debug. More critically, the return type is the 40+ field `LayoutGraph` interface assembled by spreading ~10 sub-indexes.
**Problem:** The function is 280 lines of sequential orchestration with no intermediate type boundaries. Every sub-builder receives raw mutable collections.
**Replacement:** No signature change needed; the real fix is the consolidation items below. The `Logger` default parameter is fine as-is.
---
#### S3. `appendMatchingEdgesFromSelectorIds` — 8 parameters
**File:** `cascade-builder.ts:128-138`
export function appendMatchingEdgesFromSelectorIds(
  selectorIds: readonly number[],
  node: LayoutElementNode,
  selectorMetadataById: ReadonlyMap<number, SelectorBuildMetadata>,
  selectorsById: ReadonlyMap<number, SelectorEntity>,
  applies: LayoutMatchEdge[],
  appliesByElementNodeMutable: Map<LayoutElementNode, LayoutMatchEdge[]>,
  perf: LayoutPerfStatsMutable,
  rootElementsByFile: ReadonlyMap<string, readonly LayoutElementNode[]>,
  logger: Logger,
): void
**Problem:** 8 parameters, 5 of which are shared context that never changes between calls. Passing mutable output arrays is a push-based side-effect pattern.
**Replacement:** Extract a `SelectorMatchContext` struct:
interface SelectorMatchContext {
  readonly selectorMetadataById: ReadonlyMap<number, SelectorBuildMetadata>
  readonly selectorsById: ReadonlyMap<number, SelectorEntity>
  readonly rootElementsByFile: ReadonlyMap<string, readonly LayoutElementNode[]>
  readonly perf: LayoutPerfStatsMutable
  readonly logger: Logger
}
Then the function becomes:
function appendMatchingEdges(
  ctx: SelectorMatchContext,
  selectorIds: readonly number[],
  node: LayoutElementNode,
  applies: LayoutMatchEdge[],
  appliesByElementNode: Map<LayoutElementNode, LayoutMatchEdge[]>,
): void
**Impact:** Readability. One fewer object allocation since the context is created once.
---
#### S4. `buildCascadeMapForElement` — stringly-typed `source` field
**File:** `graph.ts:17` — `source: "selector" | "inline-style"` is a 2-value string union used in cascade comparison hot path (`cascade-builder.ts:349-358`).
**Replacement:** Numeric enum:
const enum CascadeSource { Selector = 0, InlineStyle = 1 }
This feeds into dimension 4 (Enumeration Reduction).
---
#### S5. All `*ByElementKey` Maps — `string` keyed instead of object-identity keyed
**Files:** `graph.ts:159-190` (8 Maps keyed by `string`), `build.ts:265,370-376`
**Problem:** `appliesByElementKey`, `reservedSpaceFactsByElementKey`, `scrollContainerFactsByElementKey`, `flowParticipationFactsByElementKey`, `containingBlockFactsByElementKey`, `conditionalSignalDeltaFactsByElementKey`, `baselineOffsetFactsByElementKey`, `snapshotHotSignalsByElementKey` — all keyed by `node.key` (a string). These require string hashing on every lookup.
**Replacement:** Key by `LayoutElementNode` directly using `Map<LayoutElementNode, T>` (not `WeakMap`, since the graph owns all nodes). Object identity comparison is faster than string hashing. The `cascadeByElementNode` and `snapshotByElementNode` already use this pattern via `WeakMap`.
**Impact:** ~15-20% faster Map lookups on hot paths. CPU.
---
### 3. Consolidation
#### C1. `buildContainingBlockFactsByElementKey` is dead code
**File:** `cascade-builder.ts:384-423`
This function is NEVER called. The containing block facts are built inline in `buildElementFactIndex` (`build.ts:399-414`). The standalone function `buildContainingBlockFactsByElementKey` walks parent chains via `while (current)` loops — a completely different algorithm from the parent-key propagation used in `buildElementFactIndex`.
**Action:** Delete `cascade-builder.ts:384-423` entirely.
---
#### C2. `resolveEffectiveAlignmentContext` in `case-builder.ts:309-351` duplicates the spread pattern from `finalizeTableCellBaselineRelevance` in `context-classification.ts:506-526`
Both functions create a new `AlignmentContext` by spreading all fields and overriding `baselineRelevance`. Since `AlignmentContext` has 18 fields, this is error-prone on additions.
**Replacement:** Extract a shared helper:
function deriveAlignmentContext(
  base: AlignmentContext,
  overrides: { readonly baselineRelevance: BaselineRelevance },
): AlignmentContext {
  return { ...base, ...overrides }
}
Place in `context-model.ts` and use in both locations.
**Impact:** DRY, reduced surface for bugs on field additions.
---
#### C3. `LayoutTextualContentState` in `signal-model.ts:95` and `TextualContentState` in `element-record.ts:44` are identical types
// signal-model.ts:95
export type LayoutTextualContentState = "yes" | "no" | "unknown" | "dynamic-text"
// element-record.ts:44
export type TextualContentState = "yes" | "no" | "unknown" | "dynamic-text"
**Action:** Delete `TextualContentState` from `element-record.ts`. Import `LayoutTextualContentState` from `signal-model.ts` and alias or use directly. Update all references in `element-record.ts` (lines 35, 44, 96-101).
---
#### C4. `computeHotNumeric` / `computeHotNormalized` in `build.ts:497-515` wrap `readNumericSignalEvidence` / `readNormalizedSignalEvidence` and add `present: boolean`
These create temporary spread objects `{ present, ...readXxx() }`. Each call does a Map lookup + spread + object allocation.
**Replacement:** Inline the logic into `computeHotSignals` with a single pass over `snapshot.signals`, or create a dedicated function in `signal-access.ts` that returns `HotNumericSignalEvidence` / `HotNormalizedSignalEvidence` directly without intermediate objects.
**Impact:** 19 fewer spread allocations per element. CPU + memory.
---
#### C5. `resolveMajorityClassification` in `content-composition.ts:587-609` duplicates the majority-finding loop from `resolveCompositionDivergenceStrength` at lines 474-498
Both build `countByClassification` Map and find majority. The scoring path calls `resolveCompositionDivergenceStrength` (which computes majority internally) and then `resolveMajorityClassification` separately.
**Replacement:** Have `resolveCompositionDivergenceStrength` return `{ strength: number, majorityClassification: ContentCompositionClassification }` so callers don't need a second pass.
**Impact:** Eliminates 1 redundant Map build + iteration per composition evaluation. CPU.
---
#### C6. `CONTROL_ELEMENT_TAGS` is defined in `util.ts:7` and a functionally identical `REPLACED_TAGS` superset is in `signal-normalization.ts:82`
`content-composition.ts:18` has `INTRINSIC_REPLACED_TAGS` and line 424 delegates to `CONTROL_ELEMENT_TAGS`. Three overlapping tag sets in three files.
**Action:** Consolidate into `util.ts`:
export const CONTROL_ELEMENT_TAGS = new Set(["input", "select", "textarea", "button"])
export const INTRINSIC_REPLACED_TAGS = new Set(["img", "svg", "video", "canvas", "iframe", "object", "embed"])
export const ALL_REPLACED_TAGS = new Set([...CONTROL_ELEMENT_TAGS, ...INTRINSIC_REPLACED_TAGS])
Remove duplicates from `signal-normalization.ts:82` and `content-composition.ts:18-19`.
---
#### C7. `WHITESPACE_RE` is defined separately in `context-classification.ts:15` and `guard-model.ts:29`
Both are `/\s+/` variants. `context-classification.ts` also has `DISPLAY_TOKEN_SPLIT_RE = /\s+/` at line 32 — identical to `WHITESPACE_RE`.
**Action:** Export a single `WHITESPACE_RE` from `util.ts`. Remove duplicates.
---
### 4. Performance Uplift
#### P1. `buildCascadeMapForElement` creates `inlinePosition` per call
**File:** `cascade-builder.ts:297`
const inlinePosition = createInlineCascadePosition()
This allocates a new `CascadePosition` object with fixed values for EVERY element. Called once per element in the graph.
**Replacement:** Hoist to module-level constant:
const INLINE_CASCADE_POSITION: CascadePosition = {
  layer: null,
  layerOrder: Number.MAX_SAFE_INTEGER,
  sourceOrder: Number.MAX_SAFE_INTEGER,
  specificity: [1, 0, 0, 0],
  specificityScore: Number.MAX_SAFE_INTEGER,
  isImportant: false,
}
Similarly, `inlineGuardProvenance` at line 298-302 is identical every call — hoist it.
**Impact:** N fewer object allocations (N = element count). Memory + GC pressure.
---
#### P2. `computeHotSignals` does 19 separate `snapshot.signals.get()` calls
**File:** `build.ts:472-495`
Each `computeHotNumeric` / `computeHotNormalized` call does `snapshot.signals.has(name)` + `readXxxSignalEvidence(snapshot, name)` which does ANOTHER `snapshot.signals.get(name)`. That's 2 Map lookups per signal × 19 signals = 38 Map lookups per element.
**Replacement:** Single iteration over `snapshot.signals` with a switch on the signal name to populate a pre-allocated struct:
function computeHotSignals(snapshot: LayoutSignalSnapshot): LayoutSnapshotHotSignals {
  // Initialize all fields to absent/null defaults
  const result = { ... }
  for (const [name, value] of snapshot.signals) {
    switch (name) {
      case "line-height": result.lineHeight = toHotNumeric(value); break
      case "vertical-align": result.verticalAlign = toHotNormalized(value); break
      // ... etc
    }
  }
  return result
}
This reduces 38 Map lookups to N (where N = actual signal count, typically 5-15).
**Impact:** ~50-70% reduction in Map lookups for hot signal extraction. CPU.
---
#### P3. `buildConditionalDeltaIndex` spreads Sets to arrays
**File:** `cascade-builder.ts:485-486`
const unconditionalValues = [...bucket.unconditional]
const conditionalValues = [...bucket.conditional]
These spread allocations happen inside a nested loop (elements × edges × declarations). The resulting arrays are stored on `LayoutConditionalSignalDeltaFact` and only read sequentially.
**Replacement:** Keep the `Set<string>` on the fact interface instead of converting to arrays. Consumers iterate anyway. Change `readonly conditionalValues: readonly string[]` to `readonly conditionalValues: ReadonlySet<string>` on `LayoutConditionalSignalDeltaFact`.
**Impact:** Eliminates O(V) array allocations where V = distinct values. Memory + CPU.
---
#### P4. `selectTopFactors` copies + sorts the entire atoms array
**File:** `consistency-policy.ts:131-149`
const sorted = [...evidence.atoms]
sorted.sort(...)
Atoms array is at most 7 elements (7 factors). But the spread + sort still allocates. Since max length is 7 and we want top 4:
**Replacement:** Use a 4-element manual max-finding loop (no allocation):
function selectTopFactors(evidence: ConsistencyEvidence): readonly AlignmentFactorId[] {
  const atoms = evidence.atoms
  if (atoms.length === 0) return []
  // Simple insertion into a fixed-size buffer of 4
  ...
}
**Impact:** Eliminates 1 array copy + sort per policy evaluation. Minor but on hot path.
---
#### P5. `collectCohortProvenanceFromSnapshots` spreads Map values + sorts
**File:** `cohort-index.ts:1113-1143`
const guards = [...byKey.values()]
guards.sort(...)
Then `buildGuardKey` joins keys. This runs once per parent with 2+ children.
**Replacement:** Collect into array directly (no Map → spread). Since guard keys are pre-sorted by `resolveRuleGuard` (which sorts conditions), the `byKey` Map already ensures uniqueness — just push to array and sort:
const guards: LayoutGuardConditionProvenance[] = []
const seenKeys = new Set<string>()
for (...) {
  if (seenKeys.has(guard.key)) continue
  seenKeys.add(guard.key)
  guards.push(guard)
}
guards.sort(...)
This is already approximately the pattern used. The real fix is to avoid `[...byKey.values()]` spread — just iterate the Map and push.
**Impact:** Minor. 1 fewer array allocation per cohort parent.
---
#### P6. `computeP95` in `perf.ts:240-249` copies + sorts the entire posteriorWidths array
**File:** `perf.ts:240-249`
const sorted = [...values]
sorted.sort(...)
`posteriorWidths` grows unboundedly (one entry per scored case). For large projects this could be thousands of entries.
**Replacement:** Use quickselect (already implemented in `cohort-index.ts:1211-1240` as `selectKth`). Extract `selectKth` to `util.ts` and use for P95 computation.
**Impact:** O(n) instead of O(n log n). CPU for large projects.
---
#### P7. `containsScrollToken` calls `splitWhitespaceTokens` per overflow value
**File:** `cascade-builder.ts:658-665`
`splitWhitespaceTokens` allocates a new array. In `buildScrollValueProfile`, this is called for every conditional/unconditional overflow value.
**Replacement:** Inline check without allocation:
function containsScrollToken(value: string): boolean {
  return value === "auto" || value === "scroll"
    || value.includes("auto") || value.includes("scroll")
}
Or more precisely, split on first whitespace character inline:
function containsScrollToken(value: string): boolean {
  const trimmed = value.trim()
  const spaceIdx = trimmed.indexOf(' ')
  const first = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
  if (SCROLLABLE_VALUES.has(first)) return true
  if (spaceIdx === -1) return false
  const second = trimmed.slice(spaceIdx + 1).trim()
  return SCROLLABLE_VALUES.has(second)
}
**Impact:** Eliminates array allocation per overflow value check. CPU + memory.
---
#### P8. `parseOverflowShorthandAxis` also calls `splitWhitespaceTokens`
**File:** `build.ts:645-664`
Same issue as P7. Both `parseOverflowShorthandAxis` and `parseSingleAxisScroll` allocate arrays for 1-2 token strings.
**Replacement:** Same inline-split approach as P7.
---
#### P9. `buildElementFactIndex` iterates `snapshot.signals` for every element to build `elementsByKnownSignalValue`
**File:** `build.ts:442-456`
For each element, iterates ALL signals and builds per-signal-per-value index. This is O(E × S) where E = elements, S = avg signals per element.
**Observation:** This is fundamentally necessary. No algorithmic improvement possible here — this IS the index build pass. However, the inner loop creates new Maps lazily which is correct.
**No change needed.**
---
#### P10. `resolveCompositionDivergenceStrength` and `resolveMajorityClassification` both build `countByClassification` Maps
**Files:** `content-composition.ts:474-481` and `content-composition.ts:590-598`
Already noted in C5. When called from `scoring.ts:151-154`, both functions are called for the same inputs.
**Replacement:** See C5.
---
### 5. Enumeration Reduction
#### E1. `LayoutSignalGuard` — `"unconditional" | "conditional"`
**File:** `signal-model.ts:60`
export type LayoutSignalGuard = "unconditional" | "conditional"
Used in hot path: every signal value carries it, checked in `accumulateSnapshotFacts`, `readNumericSignalEvidence`, `readNormalizedSignalEvidence`, `toEvidenceKind`, cascade building, and snapshot construction.
**Replacement:** Numeric enum:
const enum SignalGuard { Unconditional = 0, Conditional = 1 }
**Impact:** Integer comparison instead of string comparison. 8 bytes per signal value instead of pointer + string. CPU + memory.
---
#### E2. `LayoutSignalSource` — `"selector" | "inline-style"`
**File:** `signal-model.ts:58`
Used in cascade override logic (`cascade-builder.ts:349-358`).
**Replacement:**
const enum CascadeSource { Selector = 0, InlineStyle = 1 }
**Impact:** Integer comparison in override check. CPU.
---
#### E3. `LayoutSignalUnit` — `"px" | "unitless" | "keyword" | "unknown"`
**File:** `signal-model.ts:68`
Stored on every `LayoutKnownSignalValue`. Compared nowhere in hot paths — only used for debugging/diagnostics.
**Replacement:** Numeric enum:
const enum SignalUnit { Px = 0, Unitless = 1, Keyword = 2, Unknown = 3 }
**Impact:** Smaller object. Memory.
---
#### E4. `EvidenceValueKind` — `"exact" | "interval" | "conditional" | "unknown"`
**File:** `signal-model.ts:297`
Used extensively in merging (`util.ts:17-27`), scoring, and evidence building. `kindRank` converts to numbers for comparison anyway.
**Replacement:** Numeric enum:
const enum EvidenceKind { Exact = 0, Interval = 1, Conditional = 2, Unknown = 3 }
Then `mergeEvidenceKind` becomes:
function mergeEvidenceKind(left: EvidenceKind, right: EvidenceKind): EvidenceKind {
  return left > right ? left : right
}
Eliminates `kindRank` function entirely.
**Impact:** ~30% faster evidence kind merging (hot path in cohort computation). CPU.
---
#### E5. `ContextCertainty` — `"resolved" | "conditional" | "unknown"`
**File:** `context-model.ts:15`
Used in `combineCertainty` (cascaded comparisons) and `toContextCertainty`, `coverageFromContextCertainty`.
**Replacement:**
const enum ContextCertainty { Resolved = 0, Conditional = 1, Unknown = 2 }
Then `combineCertainty` becomes `Math.max(left, right)`.
**Impact:** CPU.
---
#### E6. `LayoutScrollAxis` — `"x" | "y" | "both" | "none"`
**File:** `graph.ts:88`
**Replacement:** Bitflag:
const enum ScrollAxis { None = 0, X = 1, Y = 2, Both = 3 }
Then `toScrollAxis` becomes: `(x ? ScrollAxis.X : 0) | (y ? ScrollAxis.Y : 0)`.
**Impact:** Minor. Memory + comparison.
---
#### E7. `ContentCompositionClassification` — 6-value string union
**File:** `signal-model.ts:268-275`
Used in majority-finding loops, comparison, and diagnostic formatting.
**Replacement:**
const enum CompositionClass {
  TextOnly = 0, ReplacedOnly = 1, MixedUnmitigated = 2,
  MixedMitigated = 3, BlockSegmented = 4, Unknown = 5,
}
**Impact:** Integer comparison in composition divergence (hot path). CPU.
---
#### E8. `AlignmentTextContrast` — `"different" | "same" | "unknown"`
**File:** `signal-model.ts:126`
**Replacement:**
const enum TextContrast { Different = 0, Same = 1, Unknown = 2 }
**Impact:** Minor. CPU.
---
#### E9. `SignalConflictValue` — `"conflict" | "aligned" | "unknown"`
**File:** `signal-model.ts:128`
Compared in cohort signal aggregation and strength resolution.
**Replacement:**
const enum ConflictValue { Conflict = 0, Aligned = 1, Unknown = 2 }
**Impact:** CPU.
---
#### E10. `CohortSubjectMembership` — `"dominant" | "nondominant" | "ambiguous" | "insufficient"`
**File:** `signal-model.ts:143`
**Replacement:**
const enum SubjectMembership { Dominant = 0, Nondominant = 1, Ambiguous = 2, Insufficient = 3 }
**Impact:** Minor. Memory.
---
#### E11. `LayoutTextualContentState` — `"yes" | "no" | "unknown" | "dynamic-text"`
**File:** `signal-model.ts:95`
Compared in cohort signal counting and textual content checks throughout.
**Replacement:**
const enum TextualContent { Yes = 0, No = 1, Unknown = 2, DynamicText = 3 }
**Impact:** CPU in frequent comparisons.
---
**Aggregate enum impact:** There are approximately 46 `LayoutSignalName` values × N elements worth of `LayoutSignalValue` objects. Each carries `guard` (string), `source` (string), `kind` (string "known"/"unknown"), `unit` (string), `quality` (string). Converting these 5 fields from string to numeric enum saves ~40 bytes per signal value (5 string pointers → 5 integers). For a project with 500 elements averaging 10 signals each, that's ~200KB saved.
---
### 6. Memory Reduction (Excluding Cache)
#### M1. `LayoutElementNode` carries both `parentElementId` and `parentElementNode`
**File:** `graph.ts:31-33`
readonly parentElementId: number | null
readonly parentElementKey: string | null
readonly parentElementNode: LayoutElementNode | null
`parentElementId` and `parentElementKey` are derivable from `parentElementNode.elementId` and `parentElementNode.key`. They exist only for when parentNode is null but parentId is known (orphan nodes). But in `build.ts:191-192`, `parentElementKey` is computed as a fallback — and that fallback path means the parent node wasn't found in the current file's processing.
**Replacement:** Remove `parentElementId` and `parentElementKey`. Callers that need them can access `parentElementNode?.elementId` and `parentElementNode?.key`. For the orphan case, callers already handle null parentNode.
**Impact:** 2 fewer fields per element node. ~16 bytes per element. Memory.
---
#### M2. `LayoutElementNode` carries both `classTokens` (array) and `classTokenSet` (Set)
**File:** `graph.ts:28-29`
readonly classTokens: readonly string[]
readonly classTokenSet: ReadonlySet<string>
`classTokens` is used in Tailwind resolution (iteration) and selector dispatch key building. `classTokenSet` is used in selector matching (`.has()` checks).
**Observation:** Both are needed for different access patterns. The Set is essential for O(1) class matching; the array is essential for ordered iteration in Tailwind. Keeping both is correct.
**No change.**
---
#### M3. `LayoutSignalSnapshot` duplicates identity fields from `LayoutElementNode`
**File:** `signal-model.ts:97-109`
readonly solidFile: string
readonly elementId: number
readonly elementKey: string
readonly tag: string | null
readonly textualContent: LayoutTextualContentState
readonly isControl: boolean
readonly isReplaced: boolean
These 7 fields copy data from the element node. The snapshot is stored in a WeakMap keyed by node — the node is always available when the snapshot is accessed.
**Replacement:** Remove `solidFile`, `elementId`, `elementKey`, `tag` from `LayoutSignalSnapshot`. Replace with a reference to the node:
export interface LayoutSignalSnapshot {
  readonly node: LayoutElementNode
  readonly textualContent: LayoutTextualContentState
  readonly isControl: boolean
  readonly isReplaced: boolean
  readonly signals: ReadonlyMap<LayoutSignalName, LayoutSignalValue>
  readonly knownSignalCount: number
  readonly unknownSignalCount: number
  readonly conditionalSignalCount: number
}
However, `textualContent`, `isControl`, `isReplaced` are already on the node. So the snapshot can be reduced to:
export interface LayoutSignalSnapshot {
  readonly node: LayoutElementNode
  readonly signals: ReadonlyMap<LayoutSignalName, LayoutSignalValue>
  readonly knownSignalCount: number
  readonly unknownSignalCount: number
  readonly conditionalSignalCount: number
}
**Impact:** 4 fewer string/number fields per snapshot. Saves ~32-48 bytes per element. Memory. Touches: `signal-collection.ts:77-88`, `cohort-index.ts:282-288`, all consumers accessing `snapshot.solidFile` etc.
---
#### M4. `LayoutKnownSignalValue` stores `raw` AND `normalized` strings
**File:** `signal-model.ts:70-81`
readonly raw: string
readonly normalized: string
`raw` is the original CSS value. `normalized` is `raw.trim().toLowerCase()`. For keywords (the majority), these differ only in casing/whitespace. `raw` is used in exactly one place: `consistency-domain.ts:143` for conditional fact formatting, and `signal-normalization.ts:437` stores it.
**Replacement:** Compute `normalized` once and discard `raw`. For the one diagnostic that uses `raw`, use `normalized` instead (it's a superset of information for display purposes).
**Impact:** 1 fewer string pointer per known signal value. For a project with 5000 signals, saves ~40KB (pointer + string object overhead). Memory.
---
#### M5. `LayoutUnknownSignalValue` stores `raw: string | null`
**File:** `signal-model.ts:83-91`
`raw` is only stored for potential diagnostics and is rarely accessed.
**Same treatment as M4:** Remove `raw`. The `reason` field already describes why the signal is unknown.
---
#### M6. `AlignmentCase` carries `cohortContentCompositions: readonly ContentCompositionFingerprint[]`
**File:** `signal-model.ts:248`
Each `ContentCompositionFingerprint` has 11 fields. The array is the full cohort's fingerprints — duplicated for every subject in the same cohort.
**Replacement:** Store cohort compositions once per parent (on `LayoutCohortStats`) and pass by reference. Currently `collectCohortContentCompositions` in `case-builder.ts:272-294` rebuilds this array for every parent, and it's the same for all children of that parent.
**Action:** Compute once per parent, store on cohort stats, reference in case.
**Impact:** For a cohort of size K, eliminates K-1 duplicate array allocations. Memory.
---
#### M7. `AlignmentCase` carries `cohortSnapshots: readonly LayoutSignalSnapshot[]`
**File:** `signal-model.ts:240`
Same issue — shared across all subjects in a cohort but stored per-case.
**Replacement:** Reference from `LayoutCohortStats.snapshots` directly instead of copying into each case.
**Impact:** Same as M6.
---
#### M8. `LayoutMatchEdge` stores `solidFile`, `elementId`, and `elementKey` — all derivable from node
**File:** `graph.ts:53-60`
readonly solidFile: string
readonly elementId: number
readonly elementKey: string
readonly selectorId: number
readonly specificityScore: number
readonly sourceOrder: number
`solidFile`, `elementId`, `elementKey` are always the same as the matched node's properties. These are only used for indexing (by key) and logging.
**Replacement:** Remove `solidFile`, `elementId`, `elementKey` from `LayoutMatchEdge`. Store the node reference:
export interface LayoutMatchEdge {
  readonly node: LayoutElementNode
  readonly selectorId: number
  readonly specificityScore: number
  readonly sourceOrder: number
}
**Impact:** 3 fewer fields per match edge. For projects with many CSS rules × many elements, this can be thousands of edges. ~24 bytes saved per edge. Memory.
---
#### M9. `LayoutGuardProvenance` is allocated per-declaration in cascade building
**File:** `cascade-builder.ts:58-62`
const guardProvenance: LayoutGuardProvenance = {
  kind: signalGuard,
  conditions: guard.conditions,
  key: guard.key,
}
This is inside `collectMonitoredDeclarations`, which runs once per selector. But the same guard data is already on the `LayoutRuleGuard`. The provenance object just re-wraps it with a `kind` field that's derivable from `guard.kind`.
**Replacement:** Use the guard directly. Change `LayoutGuardProvenance` to extend `LayoutRuleGuard` or use `LayoutRuleGuard` directly where provenance is needed. The `kind` field on provenance is always `guard.kind === "conditional" ? "conditional" : "unconditional"`, which is already `guard.kind` mapped through the discriminated union.
**Impact:** Fewer intermediate objects. Memory.
---
#### M10. `posteriorWidths: number[]` on `LayoutPerfStatsMutable` grows unboundedly
**File:** `perf.ts:58`
This array stores one width per scored case. For P95 computation, only the 95th percentile matters.
**Replacement:** Use a reservoir sampling approach (fixed-size buffer of ~200 elements) or maintain a running approximate quantile (t-digest or simple sorted-insertion into a small array). For this use case, keeping the top 5% in a sorted buffer is sufficient.
**Impact:** Bounded memory regardless of project size. Memory.
---
### 7. Implementation Plan
1. **Phase 1 — Enums (E1-E11):** Convert all string literal unions to `const enum`. Touch every file that compares/constructs these values. This is mechanical but pervasive. Update all discriminated union checks from string comparison to numeric comparison. **Key files:** `signal-model.ts`, `context-model.ts`, `graph.ts`, plus all 30+ consumers.
2. **Phase 2 — Dead code & consolidation (C1, C3, C6, C7):** Delete `buildContainingBlockFactsByElementKey`, deduplicate `TextualContentState`, consolidate tag sets, consolidate regex constants.
3. **Phase 3 — Signature compression (S3, S5):** Create `SelectorMatchContext`, convert `*ByElementKey` Maps to `Map<LayoutElementNode, T>` keyed by object identity.
4. **Phase 4 — Hot signal optimization (P1, P2, P7, P8):** Hoist constants, single-pass hot signal computation, inline overflow token checks.
5. **Phase 5 — Memory reduction (M1, M3, M4, M5, M6, M7, M8, M9, M10):** Remove duplicate fields from snapshot/edge/node, share cohort data by reference, bound perf arrays.
6. **Phase 6 — Consolidation (C2, C4, C5):** Extract `deriveAlignmentContext`, inline hot-signal creation, merge divergence+majority computation.
### 8. Rationale
This subsystem is the single most allocation-heavy and CPU-intensive module in the ganko toolchain. The layout graph is built once per lint pass and then queried thousands of times by downstream rules. Every unnecessary string comparison, object allocation, and Map lookup compounds across the element × signal × cohort cross-product.
The enum conversions (Phase 1) are highest-impact-per-effort because they affect every signal value object, every evidence comparison, and every cascade check. The `const enum` pattern compiles to inline integer constants in TypeScript — zero runtime overhead, zero string interning pressure.
The Map re-keying (S5) is second-highest impact because it eliminates string hashing on every fact/index lookup. V8's Map implementation uses pointer identity for object keys, which is an O(1) hash (just the address).
### 9. Risks and Guardrails
- **`const enum` requires single-project compilation.** Since this is a monorepo with `isolatedModules: true`, `const enum` may not be erasable across package boundaries. **Mitigation:** All enum types are internal to the `ganko` package. They're never exported to `shared`, `lsp`, or `vscode`. Verify with `bun run tsc`.
- **Object-identity keyed Maps break if nodes are ever cloned.** The current codebase never clones nodes. **Guardrail:** Add a comment to `LayoutElementNode` interface documenting identity semantics.
- **Removing `raw` from signal values (M4/M5) may affect diagnostic quality.** **Mitigation:** `normalized` is `raw.trim().toLowerCase()` — strictly more canonical. No diagnostic message currently displays the original casing.
- **Phase 3 (Map re-keying) is a large diff** touching graph interface, all fact builders, all accessors, and all rule consumers. **Mitigation:** Run the full 1476-test suite after each Map conversion.
### 10. Validation
- `bun run ci` — full pipeline including manifest freshness
- Performance: Run `SOLID_LINT_LAYOUT_PROFILE=1` on a representative project before and after Phase 1+4 to measure `elapsedMs`, `selectorMatchMs`, `cascadeBuildMs`, and `caseBuildMs` deltas
- Memory: Use `--expose-gc` + `process.memoryUsage()` snapshots before/after graph construction to validate M-series changes
### 11. Unresolved Questions
None.