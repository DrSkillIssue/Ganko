import { noopLogger } from "@drskillissue/ganko-shared";
import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../../src/diagnostic";
import {
  analyzeCrossFileInput,
  buildLayoutGraph,
  collectAlignmentCases,
  evaluateAlignmentCase,
  getLatestLayoutPerfStatsForTest,
} from "../../src/cross-file";
import { buildCSSGraph } from "../../src/css/plugin";
import { buildSolidGraph } from "../../src/solid/plugin";
import {
  applyConsistencyPolicy,
  buildConsistencyEvidence,
  formatAlignmentCauses,
  CohortSubjectMembership,
  ContentCompositionClassification,
  EvidenceValueKind,
  type AlignmentSignalFinding,
  type CohortIdentifiability,
  type ConsistencyEvidence,
  type EvidenceAtom,
  type EvidenceProvenance,
} from "../../src/cross-file/layout";
import { alignmentPolicyCalibration } from "../../src/cross-file/layout/calibration";
import { parseCode } from "../solid/test-utils";

const _psCache = new Map<string, ReturnType<typeof parseCode>>()
let _psFC = 0

function runRule(tsx: string, css: string): readonly Diagnostic[] {
  let solid = _psCache.get(tsx); if (!solid) { solid = parseCode(tsx, `/project/ps_${_psFC++}.tsx`); _psCache.set(tsx, solid); }
  const diagnostics: Diagnostic[] = [];

  analyzeCrossFileInput(
    {
      solid,
      css: {
        files: [{ path: "/project/layout.css", content: css }],
      },
    },
    (diagnostic) => diagnostics.push(diagnostic),
  );

  return diagnostics.filter((diagnostic) => diagnostic.rule === "css-layout-sibling-alignment-outlier");
}

function collectDecisionClasses(tsx: string, css: string): readonly string[] {
  const solidInput = parseCode(tsx, "/project/App.tsx");
  const solidGraph = buildSolidGraph(solidInput);
  const cssGraph = buildCSSGraph({ files: [{ path: "/project/layout.css", content: css }] });
  const context = {
    solids: [solidGraph],
    css: cssGraph,
    layout: buildLayoutGraph([solidGraph], cssGraph),
    logger: noopLogger,
  };

  const cases = collectAlignmentCases(context);
  const out: string[] = [];
  for (const c of cases) {
    const decision = evaluateAlignmentCase(c);
    if (decision.kind === "accept") {
      out.push("accept");
      continue;
    }

    out.push(`reject:${decision.reason}:${decision.detail}`);
  }

  out.sort();
  return out;
}

interface CssFixture {
  readonly path: string;
  readonly content: string;
}

function collectProvenanceSignatures(tsx: string, files: readonly CssFixture[]): readonly string[] {
  const solidInput = parseCode(tsx, "/project/App.tsx");
  const solidGraph = buildSolidGraph(solidInput);
  const cssGraph = buildCSSGraph({ files });
  const context = {
    solids: [solidGraph],
    css: cssGraph,
    layout: buildLayoutGraph([solidGraph], cssGraph),
    logger: noopLogger,
  };

  const cases = collectAlignmentCases(context);
  const out: string[] = [];

  for (const c of cases) {
    const guardKeys = c.cohortProvenance.guards.map((guard) => guard.key).join(",");
    out.push(`${c.subject.elementKey}:${c.cohortProvenance.guardKey}:${guardKeys}`);
  }

  out.sort();
  return out;
}

function createPolicyEvidence(
  atoms: readonly EvidenceAtom[],
  identifiability: CohortIdentifiability = createResolvedIdentifiability(),
): ConsistencyEvidence {
  return {
    offsetStrength: 1,
    declaredOffsetStrength: 0.6,
    baselineStrength: 0.8,
    contextStrength: 0.7,
    replacedStrength: 0.4,
    compositionStrength: 0,
    majorityClassification: ContentCompositionClassification.Unknown,
    identifiability,
    factSummary: {
      exact: 12,
      interval: 0,
      unknown: 0,
      conditional: 0,
      total: 12,
      exactShare: 1,
      intervalShare: 0,
      unknownShare: 0,
      conditionalShare: 0,
    },
    atoms,
  };
}

function createProvenance(reason: string): EvidenceProvenance {
  return {
    reason,
    guardKey: "always",
    guards: [],
  };
}

function createAtom(input: {
  factorId: EvidenceAtom["factorId"];
  valueKind: EvidenceAtom["valueKind"];
  min: number;
  max: number;
  reason: string;
  relevanceWeight?: number;
  coverage?: number;
}): EvidenceAtom {
  return {
    factorId: input.factorId,
    valueKind: input.valueKind,
    contribution: {
      min: input.min,
      max: input.max,
    },
    provenance: createProvenance(input.reason),
    relevanceWeight: input.relevanceWeight ?? 1,
    coverage: input.coverage ?? 1,
  };
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function createResolvedIdentifiability(): CohortIdentifiability {
  return {
    dominantShare: 0.75,
    subjectExcludedDominantShare: 0.67,
    subjectMembership: CohortSubjectMembership.Nondominant,
    ambiguous: false,
    kind: EvidenceValueKind.Exact,
  };
}

function createAmbiguousIdentifiability(): CohortIdentifiability {
  return {
    dominantShare: 0.5,
    subjectExcludedDominantShare: 0.5,
    subjectMembership: CohortSubjectMembership.Ambiguous,
    ambiguous: true,
    kind: EvidenceValueKind.Exact,
  };
}

function createLowMassPolicyEvidence(): ConsistencyEvidence {
  return {
    offsetStrength: 0.1,
    declaredOffsetStrength: 0.1,
    baselineStrength: 0,
    contextStrength: 0,
    replacedStrength: 0,
    compositionStrength: 0,
    majorityClassification: ContentCompositionClassification.Unknown,
    identifiability: createResolvedIdentifiability(),
    factSummary: {
      exact: 2,
      interval: 0,
      unknown: 0,
      conditional: 0,
      total: 10,
      exactShare: 0.2,
      intervalShare: 0,
      unknownShare: 0,
      conditionalShare: 0,
    },
    atoms: [
      createAtom({
        factorId: "offset-delta",
        valueKind: EvidenceValueKind.Exact,
        min: 0.1,
        max: 0.1,
        reason: "very weak offset",
        coverage: 0.2,
      }),
    ],
  };
}

describe("layout alignment policy semantics", () => {
  it("rejects ambiguous multimodal cohorts as undecidable", () => {
    const tsx = `
      import "./layout.css";

      export function Row() {
        const label = "E";
        return (
          <div class="row">
            <span class="a">A</span>
            <span class="b">B</span>
            <span class="c">C</span>
            <span class="d">D</span>
            <span class="e">{label}</span>
          </div>
        );
      }
    `;

    const css = `
      .row { display: flex; align-items: flex-start; }
      .a, .b { transform: translateY(-2px); line-height: 12px; }
      .c, .d { line-height: 20px; }
      @media (min-width: 900px) {
        .e { transform: translateY(-4px); line-height: 16px; }
      }
    `;

    const solidInput = parseCode(tsx, "/project/App.tsx");
    const solidGraph = buildSolidGraph(solidInput);
    const cssGraph = buildCSSGraph({ files: [{ path: "/project/layout.css", content: css }] });
    const context = {
      solids: [solidGraph],
      css: cssGraph,
      layout: buildLayoutGraph([solidGraph], cssGraph),
    logger: noopLogger,
    };

    const cases = collectAlignmentCases(context);
    let undecidable = 0;

    for (const c of cases) {
      const decision = evaluateAlignmentCase(c);
      if (decision.kind !== "reject") continue;
      if (decision.reason !== "undecidable") continue;
      undecidable++;
    }

    expect(undecidable).toBeGreaterThan(0);

    const diagnostics = runRule(tsx, css);
    const stats = getLatestLayoutPerfStatsForTest();
    expect(diagnostics).toHaveLength(0);
    expect(stats.cohortUnimodalFalse).toBeGreaterThan(0);
    expect(stats.casesRejectedUndecidable).toBeGreaterThan(0);
  });

  it("keeps top factor ordering deterministic across atom permutations", () => {
    const atomsA: readonly EvidenceAtom[] = [
      createAtom({ factorId: "context-conflict", valueKind: EvidenceValueKind.Exact, min: 0.5, max: 0.5, reason: "context" }),
      createAtom({ factorId: "offset-delta", valueKind: EvidenceValueKind.Exact, min: 1.1, max: 1.1, reason: "offset" }),
      createAtom({ factorId: "declared-offset-delta", valueKind: EvidenceValueKind.Exact, min: 0.5, max: 0.5, reason: "declared" }),
      createAtom({ factorId: "baseline-conflict", valueKind: EvidenceValueKind.Exact, min: 0.5, max: 0.5, reason: "baseline" }),
      createAtom({ factorId: "replaced-control-risk", valueKind: EvidenceValueKind.Exact, min: 0.2, max: 0.2, reason: "replaced" }),
    ];

    const a0 = atomsA[0];
    const a1 = atomsA[1];
    const a2 = atomsA[2];
    const a3 = atomsA[3];
    const a4 = atomsA[4];
    if (!a0 || !a1 || !a2 || !a3 || !a4) throw new Error("Expected 5 atoms");

    const atomsB: readonly EvidenceAtom[] = [
      a4,
      a2,
      a1,
      a3,
      a0,
    ];

    const first = applyConsistencyPolicy({
      evidence: createPolicyEvidence(atomsA),
    });
    const second = applyConsistencyPolicy({
      evidence: createPolicyEvidence(atomsB),
    });

    expect(first.kind).toBe("accept");
    expect(second.kind).toBe("accept");
    if (first.kind !== "accept" || second.kind !== "accept") throw new Error("expected accepted policy decisions");

    expect(first.topFactors).toStrictEqual([
      "offset-delta",
      "baseline-conflict",
      "context-conflict",
      "declared-offset-delta",
    ]);
    expect(second.topFactors).toStrictEqual(first.topFactors);
  });

  it("formats cause ordering by priority, weight, and ASCII message order", () => {
    const findings: readonly AlignmentSignalFinding[] = [
      {
        kind: "baseline-conflict",
        message: "a-cause",
        fix: "fix-a",
        weight: 0.5,
      },
      {
        kind: "context-conflict",
        message: "context-cause",
        fix: "fix-context",
        weight: 0.7,
      },
      {
        kind: "offset-delta",
        message: "later-offset-cause",
        fix: "fix-offset-later",
        weight: 0.4,
      },
      {
        kind: "baseline-conflict",
        message: "A-cause",
        fix: "fix-A",
        weight: 0.5,
      },
      {
        kind: "offset-delta",
        message: "first-offset-cause",
        fix: "fix-offset-first",
        weight: 0.9,
      },
    ];

    const causes = formatAlignmentCauses(findings);
    expect(causes).toStrictEqual([
      "first-offset-cause",
      "later-offset-cause",
      "A-cause",
      "a-cause",
      "context-cause",
    ]);
  });

  it("uses stable reject reason/detail codes across policy branches", () => {
    const lowEvidence = applyConsistencyPolicy({
      evidence: createLowMassPolicyEvidence(),
    });
    expect(lowEvidence.kind).toBe("reject");
    if (lowEvidence.kind !== "reject") throw new Error("expected reject");
    expect(lowEvidence.reason).toBe("threshold");
    expect(lowEvidence.detail).toBe("posterior");

    const threshold = applyConsistencyPolicy({
      evidence: createPolicyEvidence([
        createAtom({
          factorId: "context-certainty",
          valueKind: EvidenceValueKind.Exact,
          min: -0.8,
          max: -0.8,
          reason: "unknown context",
        }),
      ]),
    });
    expect(threshold.kind).toBe("reject");
    if (threshold.kind !== "reject") throw new Error("expected reject");
    expect(threshold.reason).toBe("threshold");
    expect(threshold.detail).toBe("posterior");

    const undecidable = applyConsistencyPolicy({
      evidence: createPolicyEvidence([
        createAtom({
          factorId: "offset-delta",
          valueKind: EvidenceValueKind.Conditional,
          min: 0,
          max: 2.2,
          reason: "conditional offset interval",
        }),
      ]),
    });
    expect(undecidable.kind).toBe("reject");
    if (undecidable.kind !== "reject") throw new Error("expected reject");
    expect(undecidable.reason).toBe("undecidable");
    expect(undecidable.detail).toBe("interval");

    const identifiability = applyConsistencyPolicy({
      evidence: createPolicyEvidence([
        createAtom({
          factorId: "offset-delta",
          valueKind: EvidenceValueKind.Exact,
          min: 1.8,
          max: 1.8,
          reason: "strong offset",
        }),
      ], createAmbiguousIdentifiability()),
    });
    expect(identifiability.kind).toBe("reject");
    if (identifiability.kind !== "reject") throw new Error("expected reject");
    expect(identifiability.reason).toBe("undecidable");
    expect(identifiability.detail).toBe("identifiability");
  });

  it("rejects when subject identifiability is ambiguous despite strong factor evidence", () => {
    const decision = applyConsistencyPolicy({
      evidence: createPolicyEvidence(
        [
          createAtom({ factorId: "offset-delta", valueKind: EvidenceValueKind.Exact, min: 2.4, max: 2.4, reason: "offset" }),
          createAtom({ factorId: "baseline-conflict", valueKind: EvidenceValueKind.Exact, min: 1.4, max: 1.4, reason: "baseline" }),
          createAtom({ factorId: "context-conflict", valueKind: EvidenceValueKind.Exact, min: 0.7, max: 0.7, reason: "context" }),
        ],
        createAmbiguousIdentifiability(),
      ),
    });

    expect(decision.kind).toBe("reject");
    if (decision.kind !== "reject") throw new Error("expected reject");
    expect(decision.reason).toBe("undecidable");
    expect(decision.detail).toBe("identifiability");
  });

  it("replacing exact with conditional never increases posterior lower bound", () => {
    const exact = applyConsistencyPolicy({
      evidence: createPolicyEvidence([
        createAtom({ factorId: "offset-delta", valueKind: EvidenceValueKind.Exact, min: 1.6, max: 1.6, reason: "exact" }),
      ]),
    });
    const conditional = applyConsistencyPolicy({
      evidence: createPolicyEvidence([
        createAtom({ factorId: "offset-delta", valueKind: EvidenceValueKind.Conditional, min: 0, max: 1.6, reason: "conditional" }),
      ]),
    });

    const exactPosteriorLower = exact.posterior.lower;
    const conditionalPosteriorLower = conditional.posterior.lower;
    expect(conditionalPosteriorLower).toBeLessThanOrEqual(exactPosteriorLower);
  });

  it("keeps posterior lower bound monotonic under certainty degradation", () => {
    const rng = createRng(7);

    for (let i = 0; i < 100; i++) {
      const magnitude = 0.2 + rng() * 2.4;

      const exact = applyConsistencyPolicy({
        evidence: createPolicyEvidence([
          createAtom({ factorId: "offset-delta", valueKind: EvidenceValueKind.Exact, min: magnitude, max: magnitude, reason: "exact" }),
        ]),
      });
      const interval = applyConsistencyPolicy({
        evidence: createPolicyEvidence([
          createAtom({
            factorId: "offset-delta",
            valueKind: EvidenceValueKind.Interval,
            min: magnitude * 0.6,
            max: magnitude,
            reason: "interval",
          }),
        ]),
      });
      const conditional = applyConsistencyPolicy({
        evidence: createPolicyEvidence([
          createAtom({
            factorId: "offset-delta",
            valueKind: EvidenceValueKind.Conditional,
            min: 0,
            max: magnitude * 0.7,
            reason: "conditional",
          }),
        ]),
      });
      const unknown = applyConsistencyPolicy({
        evidence: createPolicyEvidence([
          createAtom({
            factorId: "offset-delta",
            valueKind: EvidenceValueKind.Unknown,
            min: 0,
            max: 0,
            reason: "unknown",
          }),
        ]),
      });

      expect(interval.posterior.lower).toBeLessThanOrEqual(exact.posterior.lower);
      expect(conditional.posterior.lower).toBeLessThanOrEqual(interval.posterior.lower);
      expect(unknown.posterior.lower).toBeLessThanOrEqual(conditional.posterior.lower);
    }
  });

  it("anchors accept/reject boundary to calibrated posterior threshold", () => {
    const threshold = alignmentPolicyCalibration.posteriorThreshold;
    const prior = alignmentPolicyCalibration.priorLogOdds;
    const thresholdLogOdds = Math.log(threshold / (1 - threshold));
    const requiredLift = thresholdLogOdds - prior;

    const epsilon = 0.001;
    const below = applyConsistencyPolicy({
      evidence: createPolicyEvidence([
        createAtom({
          factorId: "offset-delta",
          valueKind: EvidenceValueKind.Exact,
          min: requiredLift - epsilon,
          max: requiredLift - epsilon,
          reason: "just below threshold",
        }),
      ]),
    });
    const at = applyConsistencyPolicy({
      evidence: createPolicyEvidence([
        createAtom({
          factorId: "offset-delta",
          valueKind: EvidenceValueKind.Exact,
          min: requiredLift,
          max: requiredLift,
          reason: "exactly at threshold",
        }),
      ]),
    });
    const above = applyConsistencyPolicy({
      evidence: createPolicyEvidence([
        createAtom({
          factorId: "offset-delta",
          valueKind: EvidenceValueKind.Exact,
          min: requiredLift + epsilon,
          max: requiredLift + epsilon,
          reason: "just above threshold",
        }),
      ]),
    });

    expect(below.kind).toBe("reject");
    if (below.kind !== "reject") throw new Error("expected reject");
    expect(below.reason).toBe("threshold");
    expect(below.detail).toBe("posterior");
    expect(at.kind).toBe("accept");
    expect(above.kind).toBe("accept");
  });

  it("keeps cohort symmetry under cluster-label swap", () => {
    const tsx = `
      import "./layout.css";

      export function Row() {
        return (
          <div class="row">
            <span class="a">A</span>
            <span class="b">B</span>
            <span class="c">C</span>
            <span class="d">D</span>
          </div>
        );
      }
    `;

    const firstCss = `
      .row { display: flex; align-items: flex-start; }
      .a, .b { transform: translateY(-2px); line-height: 12px; vertical-align: baseline; }
      .c, .d { line-height: 20px; vertical-align: middle; }
    `;

    const swappedCss = `
      .row { display: flex; align-items: flex-start; }
      .a, .b { line-height: 20px; vertical-align: middle; }
      .c, .d { transform: translateY(-2px); line-height: 12px; vertical-align: baseline; }
    `;

    const firstClasses = collectDecisionClasses(tsx, firstCss);
    const swappedClasses = collectDecisionClasses(tsx, swappedCss);

    expect(firstClasses.length).toBeGreaterThan(0);
    expect(swappedClasses.length).toBe(firstClasses.length);
    expect(swappedClasses).toStrictEqual(firstClasses);
  });

  it("keeps cohort guard provenance ordering deterministic across css permutations", () => {
    const tsx = `
      import "./base.css";
      import "./conditional.css";

      export function Row() {
        return (
          <div class="row">
            <span class="icon">.</span>
            <span class="label">Label</span>
          </div>
        );
      }
    `;

    const first = collectProvenanceSignatures(tsx, [
      {
        path: "/project/base.css",
        content: `
          .row { display: flex; align-items: flex-start; }
          .icon { line-height: 12px; }
          .label { line-height: 20px; }
        `,
      },
      {
        path: "/project/conditional.css",
        content: `
          @supports (display: grid) {
            .icon { transform: translateY(-3px); }
          }
          @media (min-width: 900px) {
            .icon { margin-top: 1px; }
          }
        `,
      },
    ]);

    const second = collectProvenanceSignatures(tsx, [
      {
        path: "/project/conditional.css",
        content: `
          @media (min-width: 900px) {
            .icon { margin-top: 1px; }
          }
          @supports (display: grid) {
            .icon { transform: translateY(-3px); }
          }
        `,
      },
      {
        path: "/project/base.css",
        content: `
          .label { line-height: 20px; }
          .icon { line-height: 12px; }
          .row { align-items: flex-start; display: flex; }
        `,
      },
    ]);

    expect(first.length).toBeGreaterThan(0);
    expect(second).toStrictEqual(first);
  });

  it("keeps per-atom certainty instead of cohort-wide evidence kind collapse", () => {
    const tsx = `
      import "./layout.css";

      export function Row() {
        return (
          <div class="row">
            <span class="icon">.</span>
            <span class="label">Label</span>
          </div>
        );
      }
    `;

    const css = `
      .icon { line-height: 12px; transform: translateY(-2px); }
      .label { line-height: 20px; }
      @media (min-width: 900px) {
        .row { display: flex; align-items: flex-start; }
      }
    `;

    const solidInput = parseCode(tsx, "/project/App.tsx");
    const solidGraph = buildSolidGraph(solidInput);
    const cssGraph = buildCSSGraph({ files: [{ path: "/project/layout.css", content: css }] });
    const context = {
      solids: [solidGraph],
      css: cssGraph,
      layout: buildLayoutGraph([solidGraph], cssGraph),
    logger: noopLogger,
    };

    const cases = collectAlignmentCases(context);
    expect(cases.length).toBeGreaterThan(0);

    let foundMixedEvidence = false;

    for (const c of cases) {
      const evidence = buildConsistencyEvidence(c);
      const offsetAtom = evidence.atoms.find((atom) => atom.factorId === "offset-delta");
      const contextCertaintyAtom = evidence.atoms.find((atom) => atom.factorId === "context-certainty");
      if (!offsetAtom || !contextCertaintyAtom) continue;
      if (offsetAtom.valueKind !== EvidenceValueKind.Exact) continue;
      if (contextCertaintyAtom.valueKind !== EvidenceValueKind.Conditional) continue;
      foundMixedEvidence = true;
      break;
    }

    expect(foundMixedEvidence).toBe(true);
  });
});
