# Phase 5 — Memory Reduction (M1, M3, M4, M5, M6, M7, M8, M9, M10)

**Goal:** Remove duplicate/derivable fields from per-element objects, share cohort data by reference, bound perf arrays.

**Validation after each step:** `bun run tsc && bun run test && bun run lint`

---

## Step 5.1: Remove derivable fields from `LayoutElementNode` (M1)

**File:** `graph.ts:31-32`

**Current:**
```typescript
readonly parentElementId: number | null
readonly parentElementKey: string | null
```

Both are derivable from `parentElementNode`:
- `parentElementId` = `parentElementNode?.elementId ?? null`
- `parentElementKey` = `parentElementNode?.key ?? null`

**Action:**
1. Remove both fields from `LayoutElementNode` interface in `graph.ts:31-32`
2. In `build.ts:191-192`, remove these from the node construction
3. Search all consumers of `node.parentElementId` and `node.parentElementKey` — replace with `node.parentElementNode?.elementId ?? null` and `node.parentElementNode?.key ?? null`
4. Key consumer: `build.ts:165-169` uses `parentElementId` for lookup in `nodeByElementId` — change to use the parentNode directly since it's already resolved at line 166

**Impact:** 2 fewer fields per element node (~16 bytes per element). Memory.

---

## Step 5.2: Slim `LayoutSignalSnapshot` (M3)

**File:** `signal-model.ts:97-109`

**Current:**
```typescript
export interface LayoutSignalSnapshot {
  readonly solidFile: string
  readonly elementId: number
  readonly elementKey: string
  readonly tag: string | null
  readonly textualContent: LayoutTextualContentState
  readonly isControl: boolean
  readonly isReplaced: boolean
  readonly signals: ReadonlyMap<LayoutSignalName, LayoutSignalValue>
  readonly knownSignalCount: number
  readonly unknownSignalCount: number
  readonly conditionalSignalCount: number
}
```

`solidFile`, `elementId`, `elementKey`, `tag`, `textualContent`, `isControl`, `isReplaced` are all copies of data already on `LayoutElementNode`. The snapshot is stored in a `WeakMap<LayoutElementNode, LayoutSignalSnapshot>` — the node is always available.

**Replace with:**
```typescript
export interface LayoutSignalSnapshot {
  readonly node: LayoutElementNode
  readonly signals: ReadonlyMap<LayoutSignalName, LayoutSignalValue>
  readonly knownSignalCount: number
  readonly unknownSignalCount: number
  readonly conditionalSignalCount: number
}
```

**Consumers to update (replace `snapshot.solidFile` → `snapshot.node.solidFile`, etc.):**
- `signal-collection.ts:77-88` — snapshot construction (remove duplicated fields, add `node` ref)
- `cohort-index.ts` — multiple places accessing `snapshot.elementKey`, `snapshot.solidFile`, `snapshot.tag`, `snapshot.textualContent`, `snapshot.isControl`, `snapshot.isReplaced`
- `content-composition.ts` — `snapshot.isControl`, `snapshot.isReplaced`, `snapshot.tag`
- `case-builder.ts` — `snapshot.textualContent`
- `consistency-evidence.ts:209-213` — `snapshot.isControl`, `snapshot.isReplaced`
- `diagnostics.ts` — `snapshot.elementKey`, `snapshot.solidFile`
- `measurement-node.ts` — snapshot access

**Impact:** 7 fewer fields per snapshot (~48 bytes per element). Memory.

---

## Step 5.3: Remove `raw` from `LayoutKnownSignalValue` (M4)

**File:** `signal-model.ts:73`

**Current:**
```typescript
readonly raw: string
readonly normalized: string
```

`normalized` is `raw.trim().toLowerCase()`. `raw` is used in one place: `consistency-domain.ts:143` for conditional fact formatting.

**Action:**
1. Remove `readonly raw: string` from `LayoutKnownSignalValue`
2. In `signal-normalization.ts:429-440` (`createKnown`), remove the `raw` parameter and field
3. Update all callers of `createKnown` to not pass `raw`
4. In `consistency-domain.ts:143`, use `normalized` instead of `raw`

**Impact:** 1 fewer string per known signal. ~40KB for 5000 signals. Memory.

---

## Step 5.4: Remove `raw` from `LayoutUnknownSignalValue` (M5)

**File:** `signal-model.ts:86`

**Current:**
```typescript
readonly raw: string | null
```

`raw` is stored for potential diagnostics but `reason` already describes why the signal is unknown.

**Action:**
1. Remove `readonly raw: string | null` from `LayoutUnknownSignalValue`
2. In `signal-normalization.ts:443-459` (`createUnknown`), remove the `raw` parameter and field
3. Update all callers of `createUnknown`
4. In `build.ts:577`, `hasPositiveOrDeclaredDimension` accesses `signal.raw` on unknown signals — replace with checking `signal.reason` or removing that code path (unknown signals with non-null raw that aren't "auto"/"none" are treated as reserving space; this heuristic should be revisited — if the value is unknown, the conservative behavior is to assume no reserved space)

**CAUTION:** `build.ts:576-579` has:
```typescript
if (signal.kind === "unknown") {
  if (signal.raw === null) return false
  normalized = signal.raw.trim().toLowerCase()
}
```
This uses `raw` on unknown signals to check if dimension keywords are non-reserving. After removing `raw`, this must return `false` for unknown signals (conservative: unknown = no reserved space). This matches the semantic meaning — if we can't parse the value, we don't know if it reserves space.

**Impact:** 1 fewer string per unknown signal. Memory.

---

## Step 5.5: Share cohort content compositions by reference (M6)

**File:** `case-builder.ts:41,272-294`

**Current:** `collectCohortContentCompositions` builds a new `readonly ContentCompositionFingerprint[]` per parent, and it's stored on every `AlignmentCase` for every child of that parent.

**Action:**
1. Compute `cohortContentCompositions` once per parent (already done at line 41)
2. The array is already shared by reference across all children of the same parent — verify this is the case
3. If `AlignmentCase.cohortContentCompositions` copies or re-collects per child, fix to reuse the same array reference

**Verify:** Read `case-builder.ts:41` — `collectCohortContentCompositions` is called once per parent loop iteration, then reused for all children. This is already correct. **No change needed if the reference is shared.**

---

## Step 5.6: Share cohort snapshots by reference (M7)

**File:** `signal-model.ts:240` — `AlignmentCase.cohortSnapshots`

**Current:** `cohortStats.snapshots` is passed to `buildAlignmentCase` and stored per-case. If all cases in the same cohort share the same snapshots array reference, this is already optimal.

**Verify:** In `case-builder.ts:94`, `cohortStats.snapshots` is passed directly. Since `cohortStats` is retrieved once per parent, all children share the same reference. **No change needed.**

---

## Step 5.7: Slim `LayoutMatchEdge` (M8)

**File:** `graph.ts:53-60`

**Current:**
```typescript
export interface LayoutMatchEdge {
  readonly solidFile: string
  readonly elementId: number
  readonly elementKey: string
  readonly selectorId: number
  readonly specificityScore: number
  readonly sourceOrder: number
}
```

`solidFile`, `elementId`, `elementKey` are always the matched node's properties.

**Replace with:**
```typescript
export interface LayoutMatchEdge {
  readonly node: LayoutElementNode
  readonly selectorId: number
  readonly specificityScore: number
  readonly sourceOrder: number
}
```

**Consumers to update:**
- `cascade-builder.ts` — edge construction in `appendMatchingEdgesFromSelectorIds`
- `build.ts` — edge construction
- All consumers accessing `edge.solidFile`, `edge.elementId`, `edge.elementKey` — replace with `edge.node.solidFile`, etc.

**Impact:** 3 fewer fields per edge (~24 bytes per edge). For projects with many CSS rules × elements = thousands of edges. Memory.

---

## Step 5.8: Reuse guard provenance from rule guard (M9)

**File:** `cascade-builder.ts:58-62`

**Current (inside `collectMonitoredDeclarations`, runs per selector):**
```typescript
const guardProvenance: LayoutGuardProvenance = {
  kind: signalGuard,
  conditions: guard.conditions,
  key: guard.key,
}
```

`LayoutGuardProvenance` has the same fields as `LayoutRuleGuard` just with `kind` mapped from the guard's discriminated union. The provenance object is a re-wrap.

**Action:**
1. Check if `LayoutGuardProvenance` can be replaced with `LayoutRuleGuard` directly. The `kind` field on provenance is `LayoutSignalGuard` while `LayoutRuleGuard.kind` is the discriminated union.
2. If the types align after Phase 1 (both numeric), unify. If not, at minimum share the `conditions` and `key` by storing a reference to the guard rather than copying fields.
3. Alternative: make `LayoutGuardProvenance` extend `LayoutRuleGuard` or add a `guard: LayoutRuleGuard` reference field.

**Impact:** Fewer intermediate objects per selector. Memory.

---

## Step 5.9: Bound `posteriorWidths` array (M10)

**File:** `perf.ts:58`

**Current:**
```typescript
posteriorWidths: number[]
```

Grows unboundedly (one entry per scored case).

**Replace with reservoir sampling:** Keep a fixed-size buffer of ~200 elements using reservoir sampling for P95 approximation:

```typescript
interface ReservoirSampler {
  readonly buffer: number[]
  count: number
  readonly capacity: number
}

function createReservoir(capacity: number): ReservoirSampler {
  return { buffer: [], count: 0, capacity }
}

function reservoirPush(r: ReservoirSampler, value: number): void {
  r.count++
  if (r.buffer.length < r.capacity) {
    r.buffer.push(value)
    return
  }
  const j = Math.floor(Math.random() * r.count)
  if (j < r.capacity) {
    r.buffer[j] = value
  }
}
```

**Change `LayoutPerfStatsMutable`:**
```typescript
posteriorWidths: ReservoirSampler  // was: number[]
```

**Update `createLayoutPerfStats`:**
```typescript
posteriorWidths: createReservoir(200),
```

**Update `computeP95`:**
```typescript
function computeP95(sampler: ReservoirSampler): number {
  if (sampler.buffer.length === 0) return 0
  return selectKth([...sampler.buffer], Math.ceil(sampler.buffer.length * 0.95) - 1)
}
```

**Impact:** Bounded memory regardless of project size. Memory.

---

## Estimated Aggregate Impact

- M1: ~16 bytes per element
- M3: ~48 bytes per element
- M4: ~8 bytes per known signal (× thousands)
- M5: ~8 bytes per unknown signal
- M8: ~24 bytes per match edge (× thousands)
- M10: Bounded from O(cases) to O(200)
- Total for 500-element project: ~50-100KB reduction
