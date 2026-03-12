import { noopLogger } from "@drskillissue/ganko-shared";
import { describe, expect, it } from "vitest";
import { buildSolidGraph } from "../../src/solid/plugin";
import { buildCSSGraph } from "../../src/css/plugin";
import {
  buildLayoutGraph,
  collectAlignmentCases,
  evaluateAlignmentCase,
} from "../../src/cross-file";
import { parseCode } from "../solid/test-utils";

type AcceptedEvaluation = Extract<ReturnType<typeof evaluateAlignmentCase>, { kind: "accept" }>;
type AlignmentDecision = ReturnType<typeof evaluateAlignmentCase>;

function collectDecisionsFromFixture(tsx: string, css: string): readonly AlignmentDecision[] {
  const solidInput = parseCode(tsx, "/project/App.tsx");
  const solidGraph = buildSolidGraph(solidInput);
  const cssGraph = buildCSSGraph({
    files: [{ path: "/project/layout.css", content: css }],
  });

  const context = {
    solids: [solidGraph],
    css: cssGraph,
    layout: buildLayoutGraph([solidGraph], cssGraph),
    logger: noopLogger,
  };

  const cases = collectAlignmentCases(context);
  const out: AlignmentDecision[] = [];

  for (const c of cases) {
    out.push(evaluateAlignmentCase(c));
  }

  return out;
}

function scoreFromFixture(tsx: string, css: string): number | null {
  const best = bestEvaluationFromFixture(tsx, css);
  if (!best) return null;
  return best.severity;
}

function bestEvaluationFromFixture(tsx: string, css: string) {
  const cases = collectDecisionsFromFixture(tsx, css);
  let best: AcceptedEvaluation | null = null;

  for (const entry of cases) {
    if (entry.kind !== "accept") continue;
    if (best === null) {
      best = entry;
      continue;
    }
    if (entry.evaluation.severity > best.evaluation.severity) {
      best = entry;
    }
  }

  if (!best) return null;
  return best.evaluation;
}

describe("sibling alignment scoring", () => {
  it("scores table checkbox mismatch at high confidence", () => {
    const score = scoreFromFixture(
      `
        import "./layout.css";

        export function Table() {
          return (
            <table>
              <tbody>
                <tr>
                  <td><input type="checkbox" /></td>
                  <td>System</td>
                </tr>
              </tbody>
            </table>
          );
        }
      `,
      `
        input[type="checkbox"] { line-height: 12px; vertical-align: baseline; transform: translateY(-2px); }
        td { line-height: 20px; }
      `,
    );

    expect(score).not.toBeNull();
    expect(score).toBeGreaterThanOrEqual(0.7);
  });

  it("accepts only when posterior lower bound clears threshold", () => {
    const evaluation = bestEvaluationFromFixture(
      `
        import "./layout.css";

        export function Table() {
          return (
            <table>
              <tbody>
                <tr>
                  <td><input type="checkbox" /></td>
                  <td>System</td>
                </tr>
              </tbody>
            </table>
          );
        }
      `,
      `
        input[type="checkbox"] { line-height: 12px; vertical-align: baseline; transform: translateY(-2px); }
        td { line-height: 20px; }
      `,
    );

    expect(evaluation).not.toBeNull();
    if (!evaluation) throw new Error("expected accepted evaluation");
    expect(evaluation.posterior.lower).toBeGreaterThanOrEqual(0.68);
    expect(evaluation.posterior.upper).toBeGreaterThanOrEqual(evaluation.posterior.lower);
  });

  it("scores text-only table cell misalignment", () => {
    const score = scoreFromFixture(
      `
        import "./layout.css";

        export function Table() {
          return (
            <table>
              <tbody>
                <tr>
                  <td class="left">IP Address</td>
                  <td>System</td>
                </tr>
              </tbody>
            </table>
          );
        }
      `,
      `
        td.left { transform: translateY(-2px); line-height: 12px; }
        td { line-height: 20px; }
      `,
    );

    expect(score).not.toBeNull();
    expect(score).toBeGreaterThanOrEqual(0.55);
  });

  it("scores non-table flex alignment outlier", () => {
    const score = scoreFromFixture(
      `
        import "./layout.css";

        export function Row() {
          return (
            <div class="row">
              <span class="icon">.</span>
              <span class="label">Label</span>
            </div>
          );
        }
      `,
      `
        .row { display: flex; align-items: flex-start; }
        .icon { transform: translateY(-2px); line-height: 12px; }
        .label { line-height: 20px; }
      `,
    );

    expect(score).not.toBeNull();
    expect(score).toBeGreaterThanOrEqual(0.55);
  });

  it("does not flag intentional centered layouts", () => {
    const score = scoreFromFixture(
      `
        import "./layout.css";

        export function Row() {
          return (
            <div class="row">
              <span class="icon">.</span>
              <span class="label">Label</span>
            </div>
          );
        }
      `,
      `
        .row { display: flex; align-items: center; }
        .icon { line-height: 20px; }
        .label { line-height: 20px; }
      `,
    );

    expect(score).toBeNull();
  });

  it("does not score tiny subpixel shifts as outliers", () => {
    const score = scoreFromFixture(
      `
        import "./layout.css";

        export function Row() {
          return (
            <div class="row">
              <span class="icon">.</span>
              <span class="label">Label</span>
            </div>
          );
        }
      `,
      `
        .row { display: flex; align-items: flex-start; }
        .icon { transform: translateY(-0.5px); line-height: 20px; }
        .label { line-height: 20px; }
      `,
    );

    expect(score).toBeNull();
  });

  it("does not impute zero offset when no numeric offset evidence exists", () => {
    const score = scoreFromFixture(
      `
        import "./layout.css";

        export function Row() {
          return (
            <div class="row">
              <span class="a">A</span>
              <span class="b">B</span>
            </div>
          );
        }
      `,
      `
        .row { display: flex; align-items: flex-start; }
        .a { transform: translateY(calc(var(--y) * 1px)); line-height: 20px; }
        .b { line-height: 20px; }
      `,
    );

    expect(score).toBeNull();
  });

  it("captures replaced/control baseline risk in findings", () => {
    const evaluation = bestEvaluationFromFixture(
      `
        import "./layout.css";

        export function Row() {
          return (
            <table>
              <tbody>
                <tr>
                  <td><input type="checkbox" /></td>
                  <td>Label</td>
                </tr>
              </tbody>
            </table>
          );
        }
      `,
      `
        input[type="checkbox"] { line-height: 12px; transform: translateY(-2px); }
        td { line-height: 20px; }
      `,
    );

    expect(evaluation).not.toBeNull();
    if (!evaluation) throw new Error("expected accepted evaluation");
    const replaced = evaluation.signalFindings.find((finding) => finding.kind === "replaced-control-risk");
    expect(replaced).toBeDefined();
    expect(evaluation.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("remaps block axis for vertical writing mode offsets", () => {
    const evaluation = bestEvaluationFromFixture(
      `
        import "./layout.css";

        export function Row() {
          return (
            <div class="row">
              <span class="a">A</span>
              <span class="b">B</span>
            </div>
          );
        }
      `,
      `
        .row { writing-mode: vertical-rl; display: inline-block; }
        .a { position: relative; inset-block-start: 3px; line-height: 12px; }
        .b { line-height: 20px; }
      `,
    );

    expect(evaluation).not.toBeNull();
    if (!evaluation) throw new Error("expected accepted evaluation");
    expect(evaluation.contextKind).toBe("inline-formatting");
    expect(evaluation.estimatedOffsetPx).toBeGreaterThanOrEqual(2);
  });

  it("keeps pair and n>=3 cohorts on one policy surface", () => {
    const pair = scoreFromFixture(
      `
        import "./layout.css";

        export function Row() {
          return (
            <div class="row">
              <span class="icon">.</span>
              <span class="label">Label</span>
            </div>
          );
        }
      `,
      `
        .row { display: flex; align-items: flex-start; }
        .icon { transform: translateY(-2px); line-height: 12px; }
        .label { line-height: 20px; }
      `,
    );

    const triplet = scoreFromFixture(
      `
        import "./layout.css";

        export function Row() {
          return (
            <div class="row">
              <span class="icon">.</span>
              <span class="label">Label</span>
              <span class="label2">Extra</span>
            </div>
          );
        }
      `,
      `
        .row { display: flex; align-items: flex-start; }
        .icon { transform: translateY(-2px); line-height: 12px; }
        .label, .label2 { line-height: 20px; }
      `,
    );

    expect(pair).not.toBeNull();
    expect(triplet).not.toBeNull();
    if (pair === null || triplet === null) throw new Error("expected accepted evaluations");
    expect(Math.abs(pair - triplet)).toBeLessThanOrEqual(0.2);
  });

  it("does not increase acceptance confidence from irrelevant exact declarations", () => {
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

    const baselineCss = `
      .row { display: flex; align-items: flex-start; }
      .icon { transform: translateY(-2px); line-height: 12px; }
      .label { line-height: 20px; }
    `;

    const noisyCss = `
      .row { display: flex; align-items: flex-start; box-sizing: border-box; }
      .icon {
        transform: translateY(-2px);
        line-height: 12px;
        appearance: none;
        box-sizing: border-box;
        white-space: normal;
      }
      .label {
        line-height: 20px;
        appearance: auto;
        box-sizing: content-box;
      }
    `;

    const baseline = bestEvaluationFromFixture(tsx, baselineCss);
    const noisy = bestEvaluationFromFixture(tsx, noisyCss);

    expect(baseline).not.toBeNull();
    expect(noisy).not.toBeNull();
    if (!baseline || !noisy) throw new Error("expected accepted evaluations");
    expect(noisy.confidence).toBeLessThanOrEqual(baseline.confidence);
    expect(noisy.posterior.lower).toBeLessThanOrEqual(baseline.posterior.lower);
  });

  it("treats conditional-only cohorts as undecidable", () => {
    const decisions = collectDecisionsFromFixture(
      `
        import "./layout.css";

        export function Row() {
          return (
            <div class="row">
              <span class="icon">.</span>
              <span class="label">Label</span>
            </div>
          );
        }
      `,
      `
        .row { display: flex; align-items: flex-start; }
        @media (min-width: 900px) {
          .icon { transform: translateY(-4px); line-height: 12px; }
          .label { line-height: 20px; }
        }
      `,
    );

    const undecidable = decisions.filter((decision) => decision.kind === "reject" && decision.reason === "undecidable");
    expect(undecidable.length).toBeGreaterThan(0);
  });

  it("uses conditional offset evidence as interval support", () => {
    const decisions = collectDecisionsFromFixture(
      `
        import "./layout.css";

        export function Row() {
          return (
            <div class="row">
              <span class="icon">.</span>
              <span class="label">Label</span>
            </div>
          );
        }
      `,
      `
        .row { display: flex; align-items: flex-start; }
        .icon { line-height: 12px; }
        .label { line-height: 20px; }
        @media (min-width: 900px) {
          .icon { transform: translateY(-4px); }
        }
      `,
    );

    const undecidable = decisions.filter((decision) => decision.kind === "reject" && decision.reason === "undecidable");
    const threshold = decisions.filter((decision) => decision.kind === "reject" && decision.reason === "threshold");
    expect(undecidable.length).toBeGreaterThan(0);
    expect(undecidable.length + threshold.length).toBeGreaterThan(0);
  });
});
