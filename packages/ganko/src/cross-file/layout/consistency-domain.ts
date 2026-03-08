import type {
  AlignmentCohortFactSummary,
  LayoutKnownSignalValue,
  LayoutSignalName,
  LayoutSignalSnapshot,
  LayoutSignalValue,
  LayoutUnknownSignalValue,
} from "./signal-model"

export type LayoutSignalFact =
  | {
    readonly kind: "exact"
    readonly signal: LayoutSignalName
    readonly numeric: number | null
    readonly token: string | null
  }
  | {
    readonly kind: "interval"
    readonly signal: LayoutSignalName
    readonly min: number
    readonly max: number
  }
  | {
    readonly kind: "unknown"
    readonly signal: LayoutSignalName
    readonly reason: string
  }
  | {
    readonly kind: "conditional"
    readonly signal: LayoutSignalName
    readonly reason: string
    readonly min: number | null
    readonly max: number | null
  }

const ESTIMATED_SPREAD_FLOOR_PX = 0.5
const ESTIMATED_SPREAD_SCALE = 0.1
const ESTIMATED_SPREAD_CAP_PX = 2

export function collectSignalFacts(snapshot: LayoutSignalSnapshot): readonly LayoutSignalFact[] {
  const out: LayoutSignalFact[] = []

  for (const value of snapshot.signals.values()) {
    out.push(toFact(value))
  }

  return out
}

export function summarizeSignalFacts(snapshots: readonly LayoutSignalSnapshot[]): AlignmentCohortFactSummary {
  let exact = 0
  let interval = 0
  let unknown = 0
  let conditional = 0
  let total = 0

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    if (!snap) continue;
    accumulateSnapshotFacts(snap, {
      addExact() {
        exact++
        total++
      },
      addInterval() {
        interval++
        total++
      },
      addUnknown() {
        unknown++
        total++
      },
      addConditional() {
        conditional++
        total++
      },
    })
  }

  if (total === 0) {
    return {
      exact,
      interval,
      unknown,
      conditional,
      total,
      exactShare: 0,
      intervalShare: 0,
      unknownShare: 0,
      conditionalShare: 0,
    }
  }

  const exactShare = exact / total
  const intervalShare = interval / total
  const unknownShare = unknown / total
  const conditionalShare = conditional / total
  return {
    exact,
    interval,
    unknown,
    conditional,
    total,
    exactShare,
    intervalShare,
    unknownShare,
    conditionalShare,
  }
}

function accumulateSnapshotFacts(
  snapshot: LayoutSignalSnapshot,
  sink: {
    addExact(): void
    addInterval(): void
    addUnknown(): void
    addConditional(): void
  },
): void {
  for (const value of snapshot.signals.values()) {
    if (value.guard === "conditional") {
      sink.addConditional()
      continue
    }

    if (value.kind === "unknown") {
      sink.addUnknown()
      continue
    }

    if (value.quality === "estimated" && value.px !== null) {
      sink.addInterval()
      continue
    }

    sink.addExact()
  }
}

function toFact(value: LayoutSignalValue): LayoutSignalFact {
  if (value.guard === "conditional") {
    if (value.kind === "known") return toConditionalFactFromKnown(value)
    const reason = `${value.reason} [${value.guardProvenance.key}]`
    return {
      kind: "conditional",
      signal: value.name,
      reason,
      min: null,
      max: null,
    }
  }

  if (value.kind === "unknown") {
    return {
      kind: "unknown",
      signal: value.name,
      reason: value.reason,
    }
  }

  if (value.quality === "estimated" && value.px !== null) {
    const spread = resolveEstimatedSpread(value)
    return {
      kind: "interval",
      signal: value.name,
      min: value.px - spread,
      max: value.px + spread,
    }
  }

  return {
    kind: "exact",
    signal: value.name,
    numeric: value.px,
    token: value.px === null ? value.normalized : null,
  }
}

function toConditionalFactFromKnown(value: LayoutKnownSignalValue): LayoutSignalFact {
  const reason = value.guardProvenance.key
  if (value.px === null) {
    return {
      kind: "conditional",
      signal: value.name,
      reason,
      min: null,
      max: null,
    }
  }

  if (value.quality === "exact") {
    return {
      kind: "conditional",
      signal: value.name,
      reason,
      min: value.px,
      max: value.px,
    }
  }

  const spread = resolveEstimatedSpread(value)
  return {
    kind: "conditional",
    signal: value.name,
    reason,
    min: value.px - spread,
    max: value.px + spread,
  }
}

function resolveEstimatedSpread(value: LayoutKnownSignalValue | LayoutUnknownSignalValue): number {
  if (value.kind !== "known") return ESTIMATED_SPREAD_FLOOR_PX
  if (value.px === null) return ESTIMATED_SPREAD_FLOOR_PX

  const scaled = Math.abs(value.px) * ESTIMATED_SPREAD_SCALE
  if (scaled < ESTIMATED_SPREAD_FLOOR_PX) return ESTIMATED_SPREAD_FLOOR_PX
  if (scaled > ESTIMATED_SPREAD_CAP_PX) return ESTIMATED_SPREAD_CAP_PX
  return scaled
}
