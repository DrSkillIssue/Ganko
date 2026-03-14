# Phase 6 — Consolidation (C2, C4, C5)

**Goal:** Extract shared helpers to eliminate duplicated logic patterns, merge redundant computation passes.

**Validation after each step:** `bun run tsc && bun run test && bun run lint`

---

## Step 6.1: Extract `deriveAlignmentContext` helper (C2)

**Problem:** Two functions create a new `AlignmentContext` by spreading all 20+ fields and overriding one or two. Every time a new field is added to `AlignmentContext` (like `crossAxisIsBlockAxis`), both must be updated — proven bug surface.

**File:** `case-builder.ts:331-349` — `resolveEffectiveAlignmentContext`
```typescript
return {
  kind: parentContext.kind,
  certainty: parentContext.certainty,
  parentSolidFile: parentContext.parentSolidFile,
  // ... 18 more fields ...
  baselineRelevance: "irrelevant",
  evidence: parentContext.evidence,
}
```

**File:** `context-classification.ts:506-526` — `finalizeTableCellBaselineRelevance`
```typescript
contextByParentNode.set(parent, {
  kind: context.kind,
  certainty: context.certainty,
  // ... 18 more fields ...
  baselineRelevance: "irrelevant",
  evidence: context.evidence,
})
```

**Action:**
1. In `context-model.ts`, add:
```typescript
export function deriveAlignmentContext(
  base: AlignmentContext,
  overrides: Partial<Pick<AlignmentContext, "baselineRelevance" | "crossAxisIsBlockAxis" | "crossAxisIsBlockAxisCertainty">>,
): AlignmentContext {
  return { ...base, ...overrides }
}
```

2. In `case-builder.ts:331-349`, replace the full spread with:
```typescript
return deriveAlignmentContext(parentContext, { baselineRelevance: "irrelevant" })
```

3. In `context-classification.ts:506-526`, replace with:
```typescript
contextByParentNode.set(parent, deriveAlignmentContext(context, { baselineRelevance: "irrelevant" }))
```

**Impact:** DRY. New fields on `AlignmentContext` automatically propagate. Reduced bug surface.

---

## Step 6.2: Inline hot signal creation without intermediate spreads (C4)

**Problem:** `computeHotNumeric` and `computeHotNormalized` in `build.ts:497-515` each create a temporary `{ ...readXxx() }` spread, then add `present: boolean`. Each call does a Map lookup + object spread + new object.

**This is already addressed by Phase 4, Step 4.2** (single-pass `computeHotSignals`). If Phase 4 is complete, these functions are deleted and this step is a no-op.

**If Phase 4 is NOT yet complete**, the standalone fix is:

In `signal-access.ts`, add direct hot signal constructors:
```typescript
export function readHotNumericSignalEvidence(
  snapshot: LayoutSignalSnapshot,
  name: LayoutSignalName,
): HotNumericSignalEvidence {
  const value = snapshot.signals.get(name)
  if (!value) return { present: false, value: null, kind: EvidenceValueKind.Unknown }
  if (value.kind !== "known") {
    return {
      present: true,
      value: null,
      kind: value.guard === LayoutSignalGuard.Conditional ? EvidenceValueKind.Conditional : EvidenceValueKind.Unknown,
    }
  }
  return {
    present: true,
    value: value.px,
    kind: value.guard === LayoutSignalGuard.Conditional
      ? EvidenceValueKind.Conditional
      : value.quality === "estimated" ? EvidenceValueKind.Interval : EvidenceValueKind.Exact,
  }
}
```

Then `computeHotNumeric` becomes a direct call without spread:
```typescript
function computeHotNumeric(snapshot: LayoutSignalSnapshot, name: LayoutSignalName): HotNumericSignalEvidence {
  return readHotNumericSignalEvidence(snapshot, name)
}
```

**Impact:** 21 fewer spread allocations per element. CPU + memory.

---

## Step 6.3: Merge `resolveCompositionDivergenceStrength` and `resolveMajorityClassification` (C5)

**Problem:** Both functions build the same `countByClassification` Map and find the majority. The scoring path (`scoring.ts`) calls `resolveCompositionDivergenceStrength` (which computes majority internally at `content-composition.ts:490-497`) and then separately calls `resolveMajorityClassification` (which repeats the same computation at `content-composition.ts:590-609`).

**File:** `content-composition.ts:474-498` — `resolveCompositionDivergenceStrength` (builds Map, finds majority)
**File:** `content-composition.ts:587-609` — `resolveMajorityClassification` (builds same Map, finds same majority)

**Action:**
1. Change `resolveCompositionDivergenceStrength` to return both strength and majority:
```typescript
export interface CompositionDivergenceResult {
  readonly strength: number
  readonly majorityClassification: ContentCompositionClassification
}

export function resolveCompositionDivergence(
  subjectFingerprint: ContentCompositionFingerprint,
  allFingerprints: readonly ContentCompositionFingerprint[],
  parentContext: AlignmentContext | null,
): CompositionDivergenceResult {
  // ... existing logic, but return { strength, majorityClassification }
}
```

2. Update `resolveContentCompositionStrength` in `consistency-evidence.ts:241-262` to call the new combined function.

3. Update `scoring.ts` (where `resolveMajorityClassification` is called for diagnostic messages) to use the majority from the combined result instead of calling a separate function.

4. Delete `resolveMajorityClassification` or make it a thin wrapper that calls `resolveCompositionDivergence` and extracts `.majorityClassification`.

**Challenge:** `resolveCompositionDivergenceStrength` is called from `consistency-evidence.ts` which doesn't need the majority. `resolveMajorityClassification` is called from `scoring.ts` which doesn't need the strength. The merge only helps if both are called for the same case.

**Better approach:** Cache the majority on the `AlignmentCase` or pass it through the evidence chain:
- In `buildConsistencyEvidence`, call the combined function once
- Store `majorityClassification` on `ConsistencyEvidence`
- In `scoring.ts`, read from evidence instead of re-computing

**Impact:** Eliminates 1 redundant Map build + iteration per composition evaluation. CPU.

---

## Estimated Impact

- C2: Bug prevention, reduced maintenance surface
- C4: 21 fewer spread allocations per element (if Phase 4 not done)
- C5: 1 fewer Map build per evidence evaluation
