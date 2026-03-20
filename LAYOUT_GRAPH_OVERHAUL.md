# LayoutGraph Architecture Overhaul

## Goal
Replace the incremental 7-pass, 14-map graph builder with a 2-pass, consolidated-record architecture.

---

## Phase 1: Shorthand Expansion Cache
Cache expanded longhands on `MonitoredDeclaration` during `collectMonitoredDeclarations`. All downstream consumers (`expandMonitoredDeclarationForDelta`, `normalizeSignalMap`, `buildStatefulRuleIndexes`) read pre-expanded results instead of re-expanding.

**Files**: `cascade-builder.ts`, `signal-normalization.ts`, `stateful-rule-index.ts`, `shorthand-expansion.ts`

- [ ] Add `expandedLonghands: readonly { name: LayoutSignalName; value: string }[] | null` to `MonitoredDeclaration`
- [ ] Compute expansion once in `collectMonitoredDeclarations`
- [ ] Replace `expandMonitoredDeclarationForDelta` body with cached read
- [ ] Replace `applyExpandedShorthand` in signal-normalization with cached read
- [ ] Replace expansion in `buildStatefulRuleIndexes` with cached read
- [ ] Verify identical results via existing tests

---

## Phase 2: Per-Element Consolidated Record
Replace 14 separate `Map`/`WeakMap` structures keyed by `LayoutElementNode` with a single `LayoutElementRecord` struct per element.

**Files**: `graph.ts`, `build.ts`, `signal-access.ts`, all rules

- [ ] Define `LayoutElementRecord` interface in `graph.ts`:
  ```
  node, ref, edges, cascade, snapshot, hotSignals,
  reservedSpace, scrollContainer, flowParticipation,
  containingBlock, conditionalDelta, baselineOffsets
  ```
- [ ] Add `records: ReadonlyMap<LayoutElementNode, LayoutElementRecord>` to `LayoutGraph`
- [ ] Remove individual fact maps from `LayoutGraph` interface (`reservedSpaceFactsByNode`, `scrollContainerFactsByNode`, `flowParticipationFactsByNode`, `containingBlockFactsByNode`, `conditionalSignalDeltaFactsByNode`, `baselineOffsetFactsByNode`, `snapshotHotSignalsByNode`, `cascadeByElementNode`, `snapshotByElementNode`, `appliesByNode`)
- [ ] Update all `read*Fact` accessors in `signal-access.ts` to use `graph.records.get(node)`
- [ ] Update all rule files to use new accessors
- [ ] Update `cohort-index.ts` and `context-classification.ts` to read from records

---

## Phase 3: Merge Passes 3–7 into Single Unified Pass
Current passes: selector candidates → selector matching → cascade → signal snapshot → facts.
Merge into a single per-element loop that produces the `LayoutElementRecord` directly.

**Files**: `build.ts`, `cascade-builder.ts`, `signal-collection.ts`

- [ ] Inline selector candidate lookup + matching + cascade + snapshot + facts into one loop
- [ ] Compute conditional delta facts during cascade building (edges are right there)
- [ ] Remove `buildElementFactIndex` as separate function
- [ ] Remove `buildConditionalDeltaIndex` as separate function
- [ ] Remove `buildSignalSnapshotIndex` as separate function
- [ ] Produce `Map<LayoutElementNode, LayoutElementRecord>` directly

---

## Phase 4: Forward-Pass Signal Snapshots (eliminate recursion)
Replace recursive parent-walking snapshot builder with a single forward pass over elements in tree order.

**Files**: `signal-collection.ts`, `build.ts`

- [ ] Elements are already collected depth-first — parent always precedes child
- [ ] Each element's snapshot = parent's snapshot signals + own cascade overlay
- [ ] Replace `buildSnapshotForNode` recursion with iterative lookup from already-built parent record
- [ ] Remove snapshot cache (no longer needed — each snapshot built exactly once)

---

## Phase 5: Flatten Graph Interface
Replace 5-interface composition with flat grouped structure.

**Files**: `graph.ts`, `build.ts`, all consumers

- [ ] Collapse `LayoutGraphTopology`, `LayoutGraphCascade`, `LayoutGraphFacts`, `LayoutGraphCohorts`, `LayoutGraphIndexes` into single `LayoutGraph`
- [ ] Group remaining fields semantically (topology fields stay top-level, indexes grouped)
- [ ] Update all rule imports/access patterns

---

## Phase 6: Unify Dispatch Key Extraction
`buildSelectorDispatchKeys` (element-record.ts) and `resolveSubjectDispatchKeys` (selector-dispatch.ts) duplicate the same id/class/attr key logic.

**Files**: `selector-dispatch.ts`, `element-record.ts`

- [ ] Extract shared `buildDispatchKeys(id, classes, attributes)` function
- [ ] Both callers delegate to it with their respective input shapes

---

## Verification Strategy
- Run full cross-file + integration test suite after each phase
- Performance test (`layout-performance.test.ts`) must stay within existing budgets
- No regressions in any rule behavior
