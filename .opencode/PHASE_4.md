# Phase 4 — Hot Signal Optimization (P1, P2, P7, P8)

**Goal:** Eliminate per-element allocations on hot paths, reduce Map lookups in signal extraction, remove array allocations for overflow token parsing.


---

## Step 4.1: Hoist `inlinePosition` and `inlineGuardProvenance` constants (P1)

**File:** `cascade-builder.ts:297-302`

**Current (inside `buildCascadeMapForElement`, called once per element):**
```typescript
const inlinePosition = createInlineCascadePosition()
const inlineGuardProvenance: LayoutGuardProvenance = {
  kind: "unconditional",  // will be SignalGuard_Unconditional after Phase 1
  conditions: [],
  key: "always",
}
```

**Action:** Hoist both to module-level frozen constants:
```typescript
const INLINE_CASCADE_POSITION: CascadePosition = Object.freeze({
  layer: null,
  layerOrder: Number.MAX_SAFE_INTEGER,
  sourceOrder: Number.MAX_SAFE_INTEGER,
  specificity: [1, 0, 0, 0] as const,
  specificityScore: Number.MAX_SAFE_INTEGER,
  isImportant: false,
})

const INLINE_GUARD_PROVENANCE: LayoutGuardProvenance = Object.freeze({
  kind: LayoutSignalGuard.Unconditional,
  conditions: [],
  key: "always",
})
```

Then in `buildCascadeMapForElement`, replace `inlinePosition` and `inlineGuardProvenance` references with the module-level constants.

Also check `createInlineCascadePosition` — if it's only used here, delete it.

**Impact:** N fewer object allocations (N = element count). Memory + GC.

---

## Step 4.2: Single-pass `computeHotSignals` (P2)

**File:** `build.ts:472-495`

**Current:** 21 separate `computeHotNumeric`/`computeHotNormalized` calls, each doing `snapshot.signals.has(name)` + `readXxxSignalEvidence(snapshot, name)` which does ANOTHER `snapshot.signals.get(name)`. That's 2 Map lookups per signal × 21 = 42 Map lookups per element.

**Action:** Replace with a single iteration over `snapshot.signals`:

```typescript
function computeHotSignals(snapshot: LayoutSignalSnapshot): LayoutSnapshotHotSignals {
  // Pre-initialize all fields to absent defaults
  let lineHeight: HotNumericSignalEvidence = ABSENT_NUMERIC
  let verticalAlign: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let alignSelf: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let placeSelf: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let flexDirection: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let gridAutoFlow: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let writingMode: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let direction: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let display: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let alignItems: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let placeItems: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let position: HotNormalizedSignalEvidence = ABSENT_NORMALIZED
  let insetBlockStart: HotNumericSignalEvidence = ABSENT_NUMERIC
  let insetBlockEnd: HotNumericSignalEvidence = ABSENT_NUMERIC
  let transform: HotNumericSignalEvidence = ABSENT_NUMERIC
  let translate: HotNumericSignalEvidence = ABSENT_NUMERIC
  let top: HotNumericSignalEvidence = ABSENT_NUMERIC
  let bottom: HotNumericSignalEvidence = ABSENT_NUMERIC
  let marginTop: HotNumericSignalEvidence = ABSENT_NUMERIC
  let marginBottom: HotNumericSignalEvidence = ABSENT_NUMERIC

  for (const [name, value] of snapshot.signals) {
    switch (name) {
      case "line-height": lineHeight = toHotNumeric(value); break
      case "vertical-align": verticalAlign = toHotNormalized(value); break
      case "align-self": alignSelf = toHotNormalized(value); break
      case "place-self": placeSelf = toHotNormalized(value); break
      case "flex-direction": flexDirection = toHotNormalized(value); break
      case "grid-auto-flow": gridAutoFlow = toHotNormalized(value); break
      case "writing-mode": writingMode = toHotNormalized(value); break
      case "direction": direction = toHotNormalized(value); break
      case "display": display = toHotNormalized(value); break
      case "align-items": alignItems = toHotNormalized(value); break
      case "place-items": placeItems = toHotNormalized(value); break
      case "position": position = toHotNormalized(value); break
      case "inset-block-start": insetBlockStart = toHotNumeric(value); break
      case "inset-block-end": insetBlockEnd = toHotNumeric(value); break
      case "transform": transform = toHotNumeric(value); break
      case "translate": translate = toHotNumeric(value); break
      case "top": top = toHotNumeric(value); break
      case "bottom": bottom = toHotNumeric(value); break
      case "margin-top": marginTop = toHotNumeric(value); break
      case "margin-bottom": marginBottom = toHotNumeric(value); break
      default: break
    }
  }

  return {
    lineHeight, verticalAlign, alignSelf, placeSelf,
    flexDirection, gridAutoFlow, writingMode, direction,
    display, alignItems, placeItems, position,
    insetBlockStart, insetBlockEnd, transform, translate,
    top, bottom, marginTop, marginBottom,
  }
}
```

**Add module-level absent defaults:**
```typescript
const ABSENT_NUMERIC: HotNumericSignalEvidence = Object.freeze({
  present: false, value: null, kind: EvidenceValueKind.Unknown,
})
const ABSENT_NORMALIZED: HotNormalizedSignalEvidence = Object.freeze({
  present: false, value: null, kind: EvidenceValueKind.Unknown,
})
```

**Add conversion helpers (inline, no Map lookup):**
```typescript
function toHotNumeric(signal: LayoutSignalValue): HotNumericSignalEvidence {
  if (signal.kind !== "known") {
    return {
      present: true,
      value: null,
      kind: signal.guard === LayoutSignalGuard.Conditional ? EvidenceValueKind.Conditional : EvidenceValueKind.Unknown,
    }
  }
  return {
    present: true,
    value: signal.px,
    kind: signal.guard === LayoutSignalGuard.Conditional
      ? EvidenceValueKind.Conditional
      : signal.quality === "estimated" ? EvidenceValueKind.Interval : EvidenceValueKind.Exact,
  }
}

function toHotNormalized(signal: LayoutSignalValue): HotNormalizedSignalEvidence {
  if (signal.kind !== "known") {
    return {
      present: true,
      value: null,
      kind: signal.guard === LayoutSignalGuard.Conditional ? EvidenceValueKind.Conditional : EvidenceValueKind.Unknown,
    }
  }
  return {
    present: true,
    value: signal.normalized,
    kind: signal.guard === LayoutSignalGuard.Conditional
      ? EvidenceValueKind.Conditional
      : signal.quality === "estimated" ? EvidenceValueKind.Interval : EvidenceValueKind.Exact,
  }
}
```

**Delete:** `computeHotNumeric` and `computeHotNormalized` functions (build.ts:497-515).

**Impact:** 42 Map lookups → N (N = actual signal count, typically 5-15). ~50-70% fewer Map lookups per element. CPU.

---

## Step 4.3: Inline overflow token parsing (P7, P8)

**File:** `build.ts:643-670` — `parseOverflowShorthandAxis` calls `splitWhitespaceTokens` (allocates array)

**File:** `build.ts:664-670` — `parseSingleAxisScroll` calls `splitWhitespaceTokens`

**Current:**
```typescript
function parseOverflowShorthandAxis(value: string | null): { x: boolean; y: boolean } {
  if (value === null) return { x: false, y: false }
  const tokens = splitWhitespaceTokens(value)  // allocates array
  ...
}
```

**Replace `parseOverflowShorthandAxis`:**
```typescript
function parseOverflowShorthandAxis(value: string | null): { x: boolean; y: boolean } {
  if (value === null) return NO_SCROLL
  const trimmed = value.trim()
  const spaceIdx = trimmed.indexOf(" ")
  if (spaceIdx === -1) {
    const scroll = SCROLLABLE_VALUES.has(trimmed)
    return scroll ? BOTH_SCROLL : NO_SCROLL
  }
  const first = trimmed.slice(0, spaceIdx)
  const second = trimmed.slice(spaceIdx + 1).trimStart()
  return {
    x: SCROLLABLE_VALUES.has(first),
    y: SCROLLABLE_VALUES.has(second),
  }
}

const NO_SCROLL = Object.freeze({ x: false, y: false })
const BOTH_SCROLL = Object.freeze({ x: true, y: true })
```

**Replace `parseSingleAxisScroll`:**
```typescript
function parseSingleAxisScroll(value: string | null): boolean | null {
  if (value === null) return null
  const trimmed = value.trim()
  const spaceIdx = trimmed.indexOf(" ")
  const first = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
  return SCROLLABLE_VALUES.has(first)
}
```

Remove the `splitWhitespaceTokens` import from `build.ts:7` if it becomes unused after inlining. Also check `cascade-builder.ts:5` — remove if unused.

**Impact:** Eliminates array allocation per overflow value check. CPU + memory.

---

## Step 4.4: `selectTopFactors` without allocation (P4)

**File:** `consistency-policy.ts:130-149`

**Current:**
```typescript
function selectTopFactors(evidence: ConsistencyEvidence): readonly AlignmentFactorId[] {
  const sorted = [...evidence.atoms]  // copies array
  sorted.sort(...)
  ...top 4...
}
```

Atoms array is at most 7 elements. Use a fixed-size manual max-finding loop:

```typescript
function selectTopFactors(evidence: ConsistencyEvidence): readonly AlignmentFactorId[] {
  const atoms = evidence.atoms
  if (atoms.length === 0) return EMPTY_FACTOR_LIST

  // Find top 4 by magnitude without sorting
  const top: { id: AlignmentFactorId; mag: number }[] = []
  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i]
    if (!atom) continue
    const mag = Math.abs((atom.contribution.min + atom.contribution.max) / 2)
    if (mag <= 0) continue

    if (top.length < 4) {
      top.push({ id: atom.factorId, mag })
      continue
    }

    let minIdx = 0
    for (let j = 1; j < top.length; j++) {
      const curr = top[j]
      const best = top[minIdx]
      if (curr && best && curr.mag < best.mag) minIdx = j
    }
    const minEntry = top[minIdx]
    if (minEntry && mag > minEntry.mag) {
      top[minIdx] = { id: atom.factorId, mag }
    }
  }

  top.sort((a, b) => b.mag - a.mag)
  return top.map(t => t.id)
}

const EMPTY_FACTOR_LIST: readonly AlignmentFactorId[] = Object.freeze([])
```

**Impact:** Eliminates 1 array copy per policy evaluation. Minor but on hot path.

---

## Step 4.5: `computeP95` using `selectKth` (P6)

**File:** `perf.ts:240-249`

**Current:**
```typescript
function computeP95(values: readonly number[]): number {
  const sorted = [...values]  // full copy
  sorted.sort(...)            // O(n log n)
  ...
}
```

**Action:** Extract `selectKth` from `cohort-index.ts:1211-1240` to `util.ts`. Use it in `computeP95`:

1. Move `selectKth`, `choosePivotIndex`, `partitionAroundPivot`, `swap` from `cohort-index.ts` to `util.ts` as exports.
2. Update `cohort-index.ts` to import from `util.ts`.
3. Replace `computeP95`:
```typescript
function computeP95(values: readonly number[]): number {
  if (values.length === 0) return 0
  const scratch = [...values]  // still need mutable copy for quickselect
  const index = Math.ceil(scratch.length * 0.95) - 1
  const clamped = index <= 0 ? 0 : index >= scratch.length ? scratch.length - 1 : index
  return selectKth(scratch, clamped)
}
```

**Impact:** O(n) instead of O(n log n). CPU for large projects.

---

## Estimated Aggregate Impact

- P1: N fewer object allocations per build (N = elements)
- P2: ~50-70% fewer Map lookups in hot signal extraction
- P7/P8: Eliminates array allocations in overflow parsing
- P4: Eliminates array copy + sort on every policy evaluation
- P6: O(n) P95 computation instead of O(n log n)
