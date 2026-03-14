# Phase 3 — Signature Compression (S3, S5)

**Goal:** Extract shared context structs to reduce parameter counts; convert `*ByElementKey` string-keyed Maps to object-identity-keyed Maps for faster lookups.


---

## Step 3.1: Extract `SelectorMatchContext` (S3)

**File:** `cascade-builder.ts:128-138`

**Current signature:**
```typescript
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
```

**Action:**
1. In `cascade-builder.ts`, define:
```typescript
export interface SelectorMatchContext {
  readonly selectorMetadataById: ReadonlyMap<number, SelectorBuildMetadata>
  readonly selectorsById: ReadonlyMap<number, SelectorEntity>
  readonly rootElementsByFile: ReadonlyMap<string, readonly LayoutElementNode[]>
  readonly perf: LayoutPerfStatsMutable
  readonly logger: Logger
}
```

2. Change signature to:
```typescript
export function appendMatchingEdgesFromSelectorIds(
  ctx: SelectorMatchContext,
  selectorIds: readonly number[],
  node: LayoutElementNode,
  applies: LayoutMatchEdge[],
  appliesByElementNode: Map<LayoutElementNode, LayoutMatchEdge[]>,
): void
```

3. Update function body to use `ctx.selectorMetadataById`, `ctx.selectorsById`, etc.

4. Update call site in `build.ts:245-256`:
```typescript
// Before the loop, create context once:
const selectorMatchCtx: SelectorMatchContext = {
  selectorMetadataById,
  selectorsById,
  rootElementsByFile,
  perf,
  logger,
}

// In loop:
appendMatchingEdgesFromSelectorIds(
  selectorMatchCtx,
  selectorIds,
  node,
  applies,
  appliesByElementNodeMutable,
)
```

---

## Step 3.2: Convert `*ByElementKey` Maps from `string` to `LayoutElementNode` keys (S5)

**Rationale:** Object identity comparison is faster than string hashing. The graph owns all nodes; no cloning occurs. `cascadeByElementNode` and `snapshotByElementNode` already use this pattern.

**This is a large diff. Execute one Map at a time, running `tsc` after each.**

### 3.2a: `snapshotHotSignalsByElementKey` → `snapshotHotSignalsByNode`

**Files:**
- `graph.ts:164` — change type: `ReadonlyMap<string, LayoutSnapshotHotSignals>` → `ReadonlyMap<LayoutElementNode, LayoutSnapshotHotSignals>`
- `build.ts:374,424` — change Map key from `node.key` to `node`
- `content-composition.ts:89,109,138,167,185,223,228,247,311,315,322,332,357` — parameter types and `.get(xxx.key)` → `.get(xxx)` (14 sites)
- `cohort-index.ts:102,127,165,237,277` — interface field, assignment, pass-through, `.get(measurementNode.key)` → `.get(measurementNode)`
- `test/cross-file/layout-precomputed-indexes.test.ts:18` — `layout.snapshotHotSignalsByElementKey.has(element.key)` → `layout.snapshotHotSignalsByNode.has(element)`
- Rename field to `snapshotHotSignalsByNode` everywhere

### 3.2b: `reservedSpaceFactsByElementKey` → `reservedSpaceFactsByNode`

**Files:**
- `graph.ts:168` — change type
- `build.ts:370,419` — change Map key
- `signal-access.ts:212-217` — `readReservedSpaceFact`: change `graph.reservedSpaceFactsByElementKey.get(node.key)` → `graph.reservedSpaceFactsByNode.get(node)`
- All rule consumers

### 3.2c: `scrollContainerFactsByElementKey` → `scrollContainerFactsByNode`

**Files:**
- `graph.ts:169` — change type
- `build.ts:371,421` — change Map key
- `signal-access.ts:219-224` — `readScrollContainerFact`
- All rule consumers

### 3.2d: `flowParticipationFactsByElementKey` → `flowParticipationFactsByNode`

**Files:**
- `graph.ts:170` — change type
- `build.ts:372,423` — change Map key
- `signal-access.ts:226-231` — `readFlowParticipationFact`
- All rule consumers

### 3.2e: `containingBlockFactsByElementKey` → `containingBlockFactsByNode`

**Files:**
- `graph.ts:171` — change type
- `build.ts:373,411` — change Map key
- `signal-access.ts:233-238` — `readContainingBlockFact`
- All rule consumers

### 3.2f: `conditionalSignalDeltaFactsByElementKey` → `conditionalSignalDeltaFactsByNode`

**Files:**
- `graph.ts:172` — change type
- `cascade-builder.ts:426,436` — change Map key
- `signal-access.ts:240-248` — `readConditionalSignalDeltaFact`
- All rule consumers

### 3.2g: `baselineOffsetFactsByElementKey` → `baselineOffsetFactsByNode`

**Files:**
- `graph.ts:173` — change type
- `cascade-builder.ts:428,438` — change Map key
- `signal-access.ts:287-292` — `readBaselineOffsetFacts`
- All rule consumers

### 3.2h: `appliesByElementKey` → `appliesByNode`

**Files:**
- `graph.ts:159` — change type: `ReadonlyMap<string, readonly LayoutMatchEdge[]>` → `ReadonlyMap<LayoutElementNode, readonly LayoutMatchEdge[]>`
- `build.ts:265,274` — change Map key from `node.key` to `node`
- `cascade-builder.ts:433,444` — `buildConditionalDeltaIndex` parameter type and `.get(node.key)` → `.get(node)`
- `test/cross-file/layout-selector-dispatch-parity.test.ts:55` — `layout.appliesByElementKey.get(element.key)` → `layout.appliesByNode.get(element)`
- `test/integration/both-graphs.test.ts:125,273` — `layout.appliesByElementKey.get(checkbox.key)` → `layout.appliesByNode.get(checkbox)`
- All rule consumers

### 3.2i: `selectorCandidatesByElementKey` → `selectorCandidatesByNode`

**Files:**
- `graph.ts:160` — change type
- `build.ts:238,243` — change Map key
- `selector-dispatch.ts` — return type of `buildSelectorCandidatesByElementKey`
- `test/cross-file/layout-precomputed-indexes.test.ts:23` — `layout.selectorCandidatesByElementKey.get(element.key)` → `layout.selectorCandidatesByNode.get(element)`

---

## Estimated Impact

- S3: Readability, one fewer context object allocation per build
- S5: ~15-20% faster Map lookups on all fact/index access paths (object identity vs string hashing). Eliminates `node.key` string access on every lookup. CPU.
