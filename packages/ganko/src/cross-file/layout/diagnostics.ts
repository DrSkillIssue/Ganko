import type { AlignmentSignalFinding } from "./signal-model"

const FINDING_WEIGHT_BY_KIND = new Map<string, number>([
  ["offset-delta", 0],
  ["declared-offset-delta", 1],
  ["baseline-conflict", 2],
  ["context-conflict", 3],
  ["replaced-control-risk", 4],
  ["content-composition-conflict", 5],
])

export function orderAlignmentFindings(
  findings: readonly AlignmentSignalFinding[],
): readonly AlignmentSignalFinding[] {
  const out = [...findings]
  out.sort((left, right) => {
    const leftWeight = FINDING_WEIGHT_BY_KIND.get(left.kind) ?? Number.MAX_SAFE_INTEGER
    const rightWeight = FINDING_WEIGHT_BY_KIND.get(right.kind) ?? Number.MAX_SAFE_INTEGER
    if (leftWeight !== rightWeight) return leftWeight - rightWeight
    if (left.weight !== right.weight) return right.weight - left.weight
    return compareAscii(left.message, right.message)
  })
  return out
}

export function formatAlignmentCauses(findings: readonly AlignmentSignalFinding[]): readonly string[] {
  const ordered = orderAlignmentFindings(findings)
  const out: string[] = []

  for (let i = 0; i < ordered.length; i++) {
    const finding = ordered[i];
    if (!finding) continue;
    const message = finding.message.trim()
    if (message.length === 0) continue
    out.push(message)
  }

  return out
}

/**
 * Returns the fix suggestion from the highest-weight finding.
 * Used as the primary actionable text in user-facing diagnostics.
 */
export function formatPrimaryFix(findings: readonly AlignmentSignalFinding[]): string {
  if (findings.length === 0) return ""

  let best: AlignmentSignalFinding | null = null
  for (let i = 0; i < findings.length; i++) {
    const finding = findings[i]
    if (!finding) continue
    if (best === null || finding.weight > best.weight) {
      best = finding
    }
  }

  if (best === null) return ""
  return best.fix
}

function compareAscii(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}
