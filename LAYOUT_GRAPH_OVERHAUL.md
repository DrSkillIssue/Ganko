# LayoutGraph Architecture Overhaul

## Goal
Replace the incremental 7-pass, 14-map graph builder with a 2-pass, consolidated-record architecture.

---

## Phase 1: Shorthand Expansion Cache
Cache expanded longhands on `MonitoredDeclaration` during `collectMonitoredDeclarations`. All downstream consumers (`expandMonitoredDeclarationForDelta`, `normalizeSignalMap`, `buildStatefulRuleIndexes`) read pre-expanded results instead of re-expanding.

**Files**: `cascade-builder.ts`, `signal-normalization.ts`, `stateful-rule-index.ts`, `shorthand-expansion.ts`

- [x] Pre-expand shorthands into longhands in `collectMonitoredDeclarations`
- [x] `MonitoredDeclaration.property` is now always `LayoutSignalName` (removed `MonitoredSignalKey`)
- [x] `expandMonitoredDeclarationForDelta` simplified to passthrough (declarations already longhands)
- [x] Removed `applyExpandedShorthand` and `MONITORED_SHORTHAND_SET` check from signal-normalization
- [x] Removed `expandShorthand`/`getShorthandLonghandNames` imports from signal-normalization
- [x] `stateful-rule-index.ts` kept separate (different data path — raw rule declarations)
- [x] 311/311 tests pass

---

## Phase 2: Per-Element Consolidated Record
Replace 14 separate `Map`/`WeakMap` structures keyed by `LayoutElementNode` with a single `LayoutElementRecord` struct per element.

**Files**: `graph.ts`, `build.ts`, `signal-access.ts`, all rules

- [x] Defined `LayoutElementRecord` in `graph.ts` (ref, edges, cascade, snapshot, hotSignals, 6 facts)
- [x] Added `records: ReadonlyMap<LayoutElementNode, LayoutElementRecord>` to `LayoutGraphFacts`
- [x] Removed per-element maps from `LayoutGraphCascade` (`appliesByNode`, `cascadeByElementNode`, `snapshotByElementNode`, `snapshotHotSignalsByNode`)
- [x] Removed per-element maps from `LayoutGraphFacts` (all 6 fact maps)
- [x] Updated all `read*Fact` accessors in `signal-access.ts` to use `graph.records.get(node)`
- [x] Updated `collectSignalSnapshot` to use `graph.records.get(node).snapshot`
- [x] Rules unchanged — all access through accessor functions
- [x] Internal build pipeline unchanged — uses local maps, constructs records at end
- [x] Updated test files accessing removed fields (`appliesByNode`, `snapshotHotSignalsByNode`)
- [x] 327/327 tests pass

---

## Phase 3: Merge Passes 3–7 into Single Unified Pass
Current passes: selector candidates → selector matching → cascade → signal snapshot → facts.
Merge into a single per-element loop that produces the `LayoutElementRecord` directly.

**Files**: `build.ts`, `cascade-builder.ts`, `signal-collection.ts`

- [x] Unified loop: selector matching → cascade → snapshot → indexes → facts → record in single pass
- [x] Forward-pass snapshots: parent record always available (depth-first order), no recursion
- [x] Removed `buildElementFactIndex` (inlined into unified loop)
- [x] Removed `buildSignalSnapshotIndex` (replaced by inline `buildSnapshotFromCascade`)
- [x] `buildConditionalDeltaIndex` kept as post-pass (needs all edges finalized), reads from records
- [x] Records constructed directly in the unified loop, conditional delta patched after
- [x] 327/327 tests pass

---

## Phase 4: ~~Forward-Pass Signal Snapshots~~ (merged into Phase 3)

---

## Phase 5: Flatten Graph Interface
Replace 5-interface composition with flat grouped structure.

**Files**: `graph.ts`, `build.ts`, all consumers

- [x] Collapsed 5 sub-interfaces into single flat `LayoutGraph`
- [x] Removed `LayoutGraphTopology`, `LayoutGraphCascade`, `LayoutGraphFacts`, `LayoutGraphCohorts`, `LayoutGraphIndexes`
- [x] No external consumers — clean removal

---

## Phase 6: Unify Dispatch Key Extraction

- [x] Extracted shared `buildDispatchKeys(idValue, classTokens, attributeNames)` in `selector-dispatch.ts`
- [x] `buildSelectorDispatchKeys` delegates to `buildDispatchKeys`
- [x] `resolveSubjectDispatchKeys` delegates to `buildDispatchKeys`
- [x] 327/327 tests pass

---

## Verification Strategy
- Run full cross-file + integration test suite after each phase
- Performance test (`layout-performance.test.ts`) must stay within existing budgets
- No regressions in any rule behavior
