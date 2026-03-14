# Phase 1 — Enumeration Reduction (E1–E11)

**Goal:** Convert all string literal union types on hot paths to `const enum` with numeric values. Integer comparison instead of string comparison; 8 bytes per field instead of pointer + string. Bun's transpiler inlines `const enum` member accesses to raw integer literals at transpile time — zero runtime overhead.

**WHY `const enum`:** Despite `isolatedModules: true` in `tsconfig.json`, Bun's transpiler (which does the actual emit — `tsc` runs with `--noEmit`) always inlines `const enum` values regardless of `isolatedModules`. Verified in Bun source: the parser stores all enum member values in a `TsEnumsMap` and the printer substitutes them via `tryToGetImportedEnumValue`. Bun's own internal code uses `const enum` extensively (`src/js/internal/http.ts`, `src/js/internal/sql/query.ts`).

```typescript
// Pattern: const enum with numeric values
export const enum SignalGuard { Unconditional = 0, Conditional = 1 }
```


---

## Step 1.1: `LayoutSignalGuard` (E1)

**File:** `signal-model.ts:60`

**Current:**
```typescript
export type LayoutSignalGuard = "unconditional" | "conditional"
```

**Replace with:**
```typescript
export const enum LayoutSignalGuard { Unconditional = 0, Conditional = 1 }
```

**Consumers to update (search `=== "unconditional"`, `=== "conditional"`, `guard:`, `: LayoutSignalGuard`):**
- `signal-model.ts:63,76,88` — `LayoutGuardProvenance.kind`, `LayoutKnownSignalValue.guard`, `LayoutUnknownSignalValue.guard`
- `signal-normalization.ts:131,163-166` — guard checks in `normalizeSignalMapWithCounts`
- `signal-access.ts:81,99,131,156` — `toEvidenceKind`, `readNumericSignalEvidence`, `readNormalizedSignalEvidence`, `readKnownSignal`
- `cascade-builder.ts:57,74,224,246,297-307` — `collectMonitoredDeclarations`, `augmentCascadeWithTailwind`, `buildCascadeMapForElement`
- `graph.ts:18` — `LayoutCascadedDeclaration.guard`
- `build.ts:428-429,568,589,628-631` — `computeScrollContainerFact`, `computeFlowParticipationFact`, fact checks
- `cohort-index.ts` — guard checks throughout cohort signal aggregation
- `context-classification.ts:359` — `resolveSignalCertainty`
- `test/cross-file/layout-is-hidden.test.ts:52-53` — `guard: "unconditional"`, `kind: "unconditional"`

**Mapping:**
| Old | New |
|---|---|
| `"unconditional"` | `LayoutSignalGuard.Unconditional` |
| `"conditional"` | `LayoutSignalGuard.Conditional` |

---

## Step 1.2: `LayoutSignalSource` (E2)

**File:** `signal-model.ts:58`

**Current:**
```typescript
export type LayoutSignalSource = "selector" | "inline-style"
```

**Replace with:**
```typescript
export const enum LayoutSignalSource { Selector = 0, InlineStyle = 1 }
```

**Consumers:**
- `signal-model.ts:75,87` — `LayoutKnownSignalValue.source`, `LayoutUnknownSignalValue.source`
- `signal-normalization.ts` — `createKnown`, `createUnknown` parameter types
- `graph.ts:17` — `LayoutCascadedDeclaration.source` (inline literal union `"selector" | "inline-style"` — change to `LayoutSignalSource` and add import)
- `cascade-builder.ts:245,274,306,349-358` — `augmentCascadeWithTailwind`, `buildCascadeMapForElement`, `doesCandidateOverride`
- `test/cross-file/layout-is-hidden.test.ts:51` — `source: "selector"`
- `test/cross-file/layout-sibling-alignment-signals.test.ts:7,18` — type annotation and construction

**Mapping:**
| Old | New |
|---|---|
| `"selector"` | `LayoutSignalSource.Selector` |
| `"inline-style"` | `LayoutSignalSource.InlineStyle` |

---

## Step 1.3: `LayoutSignalUnit` (E3)

**File:** `signal-model.ts:68`

**Current:**
```typescript
export type LayoutSignalUnit = "px" | "unitless" | "keyword" | "unknown"
```

**Replace with:**
```typescript
export const enum LayoutSignalUnit { Px = 0, Unitless = 1, Keyword = 2, Unknown = 3 }
```

**Consumers:**
- `signal-model.ts:78` — `LayoutKnownSignalValue.unit`
- `signal-normalization.ts` — all `createKnown` calls pass unit literals
- `test/cross-file/layout-is-hidden.test.ts:54` — `unit: "keyword"`

**Mapping:**
| Old | New |
|---|---|
| `"px"` | `LayoutSignalUnit.Px` |
| `"unitless"` | `LayoutSignalUnit.Unitless` |
| `"keyword"` | `LayoutSignalUnit.Keyword` |
| `"unknown"` | `LayoutSignalUnit.Unknown` |

---

## Step 1.4: `EvidenceValueKind` (E4)

**File:** `signal-model.ts:297`

**Current:**
```typescript
export type EvidenceValueKind = "exact" | "interval" | "conditional" | "unknown"
```

**Replace with:**
```typescript
export const enum EvidenceValueKind { Exact = 0, Interval = 1, Conditional = 2, Unknown = 3 }
```

**Critical optimization — `util.ts:17-27`:**
```typescript
// DELETE kindRank entirely. Replace mergeEvidenceKind:
export function mergeEvidenceKind(left: EvidenceValueKind, right: EvidenceValueKind): EvidenceValueKind {
  return left > right ? left : right
}
```

**Consumers (pervasive — ~40 sites):**
- `signal-model.ts:132,150,297,301,319` — `SignalConflictEvidence.kind`, `CohortIdentifiability.kind`, `EvidenceWitness.kind`, `EvidenceAtom.valueKind`
- `signal-access.ts:80-84,92-110` — `toEvidenceKind`, `readNumericSignalEvidence`, `readNormalizedSignalEvidence`
- `consistency-evidence.ts:229,236,261,412,418,424,437,440,446,452,465` — strength resolvers, atom builders
- `consistency-policy.ts` — evidence contribution scaling
- `case-builder.ts:221-258` — `coverageFromKind`
- `cohort-index.ts:686-688,846,1157,1179-1181` — `resolveCohortEvidenceKind`, signal aggregation initializations
- `util.ts:17-27` — `kindRank` (DELETE), `mergeEvidenceKind`
- `scoring.ts` — finding formatting
- `content-composition.ts:256` — composition kind
- `test/cross-file/layout-sibling-alignment-policy-semantics.test.ts:169,179,206,275-279,369,401,418-420,435,457,464,486,511,522,533,690` — `valueKind:` and `kind:` in EvidenceAtom/CohortIdentifiability constructions

**Mapping:**
| Old | New |
|---|---|
| `"exact"` | `EvidenceValueKind.Exact` |
| `"interval"` | `EvidenceValueKind.Interval` |
| `"conditional"` | `EvidenceValueKind.Conditional` |
| `"unknown"` | `EvidenceValueKind.Unknown` |

---

## Step 1.5: `ContextCertainty` (E5)

**File:** `context-model.ts:15`

**Current:**
```typescript
export type ContextCertainty = "resolved" | "conditional" | "unknown"
```

**Replace with:**
```typescript
export const enum ContextCertainty { Resolved = 0, Conditional = 1, Unknown = 2 }
```

**Critical optimization — `context-classification.ts:363-367`:**
```typescript
// combineCertainty becomes a single max:
function combineCertainty(left: ContextCertainty, right: ContextCertainty): ContextCertainty {
  return left > right ? left : right
}
```

**Consumers:**
- `context-model.ts:39,42,47,53,55,71` — all certainty fields on `AlignmentContext`, `LayoutContextEvidence`
- `context-classification.ts:323-327,355-361,363-367` — `toContextCertainty`, `resolveSignalCertainty`, `combineCertainty`
- `case-builder.ts:247-251` — `coverageFromContextCertainty`
- `consistency-evidence.ts:347-351` — `mapContextCertaintyToEvidenceKind`
- `signal-model.ts:343` — `AlignmentEvaluation.contextCertainty`

**Mapping:**
| Old | New |
|---|---|
| `"resolved"` | `ContextCertainty.Resolved` |
| `"conditional"` | `ContextCertainty.Conditional` |
| `"unknown"` | `ContextCertainty.Unknown` |

---

## Step 1.6: `SignalConflictValue` (E9)

**File:** `signal-model.ts:128`

**Current:**
```typescript
export type SignalConflictValue = "conflict" | "aligned" | "unknown"
```

**Replace with:**
```typescript
export const enum SignalConflictValue { Conflict = 0, Aligned = 1, Unknown = 2 }
```

**Consumers:**
- `signal-model.ts:131` — `SignalConflictEvidence.value`
- `cohort-index.ts:805,873,880,886` — signal aggregation comparisons, `value: "conflict"`, `"unknown"`, `sawConflict ? "conflict" : "aligned"`
- `consistency-evidence.ts:144,194` — `resolveBaselineStrength`, `resolveContextConflictEvidence`

**Mapping:**
| Old | New |
|---|---|
| `"conflict"` | `SignalConflictValue.Conflict` |
| `"aligned"` | `SignalConflictValue.Aligned` |
| `"unknown"` | `SignalConflictValue.Unknown` |

---

## Step 1.7: `AlignmentTextContrast` (E8)

**File:** `signal-model.ts:126`

**Current:**
```typescript
export type AlignmentTextContrast = "different" | "same" | "unknown"
```

**Replace with:**
```typescript
export const enum AlignmentTextContrast { Different = 0, Same = 1, Unknown = 2 }
```

**Consumers:**
- `signal-model.ts:140` — `AlignmentCohortSignals.textContrastWithPeers`
- `cohort-index.ts:897-913` — `resolveIndexedTextContrastWithPeers` (8 return sites producing string literals)
- `consistency-evidence.ts:221,228` — `resolveReplacedControlStrength`
- `case-builder.ts:233-236` — `coverageFromTextContrast`

**Mapping:**
| Old | New |
|---|---|
| `"different"` | `AlignmentTextContrast.Different` |
| `"same"` | `AlignmentTextContrast.Same` |
| `"unknown"` | `AlignmentTextContrast.Unknown` |

---

## Step 1.8: `CohortSubjectMembership` (E10)

**File:** `signal-model.ts:143`

**Current:**
```typescript
export type CohortSubjectMembership = "dominant" | "nondominant" | "ambiguous" | "insufficient"
```

**Replace with:**
```typescript
export const enum CohortSubjectMembership { Dominant = 0, Nondominant = 1, Ambiguous = 2, Insufficient = 3 }
```

**Consumers:**
- `signal-model.ts:148` — `CohortIdentifiability.subjectMembership`
- `cohort-index.ts:1063` — `resolveRoleMembership` return type (inline `"dominant" | "nondominant" | "ambiguous"` — change to `CohortSubjectMembership`)
- `cohort-index.ts` — membership resolution return values throughout
- `consistency-policy.ts` — identifiability checks
- `test/cross-file/layout-sibling-alignment-policy-semantics.test.ts:167,177` — `subjectMembership: "nondominant"`, `"ambiguous"`

**Mapping:**
| Old | New |
|---|---|
| `"dominant"` | `CohortSubjectMembership.Dominant` |
| `"nondominant"` | `CohortSubjectMembership.Nondominant` |
| `"ambiguous"` | `CohortSubjectMembership.Ambiguous` |
| `"insufficient"` | `CohortSubjectMembership.Insufficient` |

---

## Step 1.9: `ContentCompositionClassification` (E7)

**File:** `signal-model.ts:268-274`

**Current:**
```typescript
export type ContentCompositionClassification =
  | "text-only" | "replaced-only" | "mixed-unmitigated"
  | "mixed-mitigated" | "block-segmented" | "unknown"
```

**Replace with:**
```typescript
export const enum ContentCompositionClassification {
  TextOnly = 0, ReplacedOnly = 1, MixedUnmitigated = 2,
  MixedMitigated = 3, BlockSegmented = 4, Unknown = 5,
}
```

**Consumers:**
- `signal-model.ts:291` — `ContentCompositionFingerprint.classification`
- `content-composition.ts:474-498,505-530,587-609,618-627` — majority finding, `resolveCompositionDivergenceScoreForPair`, normalization (`classification === "mixed-mitigated"`, `"block-segmented"`)
- `consistency-evidence.ts:255-256` — `resolveContentCompositionStrength`
- `scoring.ts` — diagnostic formatting (needs string conversion for messages)
- `diagnostics.ts` — `formatCompositionClassification`

`scoring.ts` and `diagnostics.ts` need a lookup table for human-readable messages:
```typescript
const COMPOSITION_LABELS: Record<ContentCompositionClassification, string> = {
  [ContentCompositionClassification.TextOnly]: "text-only",
  [ContentCompositionClassification.ReplacedOnly]: "replaced-only",
  [ContentCompositionClassification.MixedUnmitigated]: "mixed-unmitigated",
  [ContentCompositionClassification.MixedMitigated]: "mixed-mitigated",
  [ContentCompositionClassification.BlockSegmented]: "block-segmented",
  [ContentCompositionClassification.Unknown]: "unknown",
}
```

**Mapping:**
| Old | New |
|---|---|
| `"text-only"` | `ContentCompositionClassification.TextOnly` |
| `"replaced-only"` | `ContentCompositionClassification.ReplacedOnly` |
| `"mixed-unmitigated"` | `ContentCompositionClassification.MixedUnmitigated` |
| `"mixed-mitigated"` | `ContentCompositionClassification.MixedMitigated` |
| `"block-segmented"` | `ContentCompositionClassification.BlockSegmented` |
| `"unknown"` | `ContentCompositionClassification.Unknown` |

---

## Step 1.10: `LayoutTextualContentState` (E11)

**File:** `signal-model.ts:95`

**Current:**
```typescript
export type LayoutTextualContentState = "yes" | "no" | "unknown" | "dynamic-text"
```

**Replace with:**
```typescript
export const enum LayoutTextualContentState { Yes = 0, No = 1, Unknown = 2, DynamicText = 3 }
```

**Consumers:**
- `signal-model.ts:102` — `LayoutSignalSnapshot.textualContent`
- `graph.ts:42` — `LayoutElementNode.textualContent` (inline literal union `"yes" | "no" | "unknown" | "dynamic-text"` — change to `LayoutTextualContentState` and add import)
- `element-record.ts:35,44` — `TextualContentState` (delete this duplicate, use `LayoutTextualContentState`)
- `content-composition.ts` — textual content checks throughout
- `cohort-index.ts:707-709,733,812,893,897,901` — textual content comparisons and assignments
- `case-builder.ts:238-242` — `coverageFromSubjectText`
- `build.ts:386` — `node.textualContent === "unknown"` dynamic slot candidate check
- `rule-runtime.ts:28,36,42` — `textualContent === "yes"`, `"unknown"`, `"dynamic-text"` comparisons
- `css-layout-content-visibility-no-intrinsic-size.ts:25` — `snapshot.textualContent`
- `css-layout-conditional-display-collapse.ts:41` — `snapshot.textualContent`
- `css-layout-conditional-white-space-wrap-shift.ts:46` — `snapshot.textualContent`

**Mapping:**
| Old | New |
|---|---|
| `"yes"` | `LayoutTextualContentState.Yes` |
| `"no"` | `LayoutTextualContentState.No` |
| `"unknown"` | `LayoutTextualContentState.Unknown` |
| `"dynamic-text"` | `LayoutTextualContentState.DynamicText` |

---

## Step 1.11: `LayoutScrollAxis` (E6)

**File:** `graph.ts:88`

**Current:**
```typescript
export type LayoutScrollAxis = "x" | "y" | "both" | "none"
```

**Replace with bitflag enum:**
```typescript
export const enum LayoutScrollAxis { None = 0, X = 1, Y = 2, Both = 3 }
```

**Consumers:**
- `graph.ts:92` — `LayoutScrollContainerFact.axis`
- `build.ts:635,672-677` — `computeScrollContainerFact`, `toScrollAxis`
- `signal-access.ts:39` — `EMPTY_LAYOUT_SCROLL_CONTAINER_FACT`

**`toScrollAxis` in `build.ts:672-677` becomes:**
```typescript
function toScrollAxis(x: boolean, y: boolean): LayoutScrollAxis {
  if (x && y) return LayoutScrollAxis.Both
  if (x) return LayoutScrollAxis.X
  if (y) return LayoutScrollAxis.Y
  return LayoutScrollAxis.None
}
```

---

## Step 1.12: Update `index.ts` re-exports from `export type` to `export`

**File:** `index.ts` (layout index)

All converted const enums are currently re-exported as `export type { ... }`. With `isolatedModules: true`, `tsc` will error on `export type` for const enums. Change to value exports.

**Lines to update in `index.ts`:** Move these from `export type { ... }` blocks to `export { ... }` blocks:
- `LayoutSignalGuard` (line 64)
- `LayoutSignalSource` (line 62)
- `LayoutSignalUnit` (line 65)
- `EvidenceValueKind` (line 51)
- `AlignmentTextContrast` (line 57)
- `SignalConflictValue`
- `CohortSubjectMembership` (line 48)
- `ContentCompositionClassification` (line 35)
- `LayoutTextualContentState` (line 68)
- `LayoutScrollAxis` (line 17)

**File:** `cross-file/index.ts`
- `ContextCertainty` (line 15) — move from `export type` to `export`
- `AlignmentTextContrast` (line 20) — move from `export type` to `export`

---

## Estimated Impact

- ~40 bytes saved per `LayoutSignalValue` (5 string fields → 5 inlined integers)
- ~30% faster `mergeEvidenceKind` (hot path, eliminates `kindRank` double-dispatch)
- `combineCertainty` becomes single integer comparison
- Every comparison in evidence building, scoring, cohort aggregation is integer comparison
- Bun inlines all `const enum` accesses to raw integer literals — zero property lookups at runtime
- For 500 elements × 10 signals = ~200KB memory reduction
