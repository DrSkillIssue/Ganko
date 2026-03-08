import { describe, expect, it } from "vitest";
import { analyzeCrossFileInput, getLatestLayoutPerfStatsForTest } from "../../src/cross-file";
import { parseCode } from "../solid/test-utils";

const IS_CI = !!process.env["CI"];

const PERF_BASELINE_MS = {
  shallowCaseBuild: 45,
  shallowElapsed: 95,
  deepCaseBuild: 500,
  deepElapsed: 500,
} as const;

function buildRows(count: number): string {
  const rows: string[] = [];
  for (let i = 0; i < count; i++) {
    rows.push(`<tr><td><input type="checkbox" /></td><td>Row ${i}</td></tr>`);
  }
  return rows.join("\n");
}

function buildNestedRows(count: number, depth: number): string {
  const openParts: string[] = [];
  const closeParts: string[] = [];
  for (let i = 0; i < depth; i++) {
    openParts.push(`<div class="nest">`);
    closeParts.push("</div>");
  }
  const open = openParts.join("");
  const close = closeParts.join("");

  const rows: string[] = [];
  for (let i = 0; i < count; i++) {
    rows.push(`<tr><td>${open}<input type="checkbox" />${close}</td><td>${open}<span>Row ${i}</span>${close}</td></tr>`);
  }
  return rows.join("\n");
}

describe("layout performance instrumentation", () => {
  it("keeps selector candidate checks within bounded budget", () => {
    const rows = buildRows(40);
    const solid = parseCode(
      `
        import "./table.css";

        export function Table() {
          return (
            <section>
              <table><tbody>${rows}</tbody></table>
              <div class="flex"><span class="icon">.</span><span class="label">Label</span></div>
              <div class="grid"><span class="icon">.</span><span class="label">Label</span></div>
            </section>
          );
        }
      `,
      "/project/perf/App.tsx",
    );

    analyzeCrossFileInput(
      {
        solid,
        css: {
          files: [
            {
              path: "/project/perf/table.css",
              content: `
                table td { line-height: 20px; }
                td:first-child { vertical-align: baseline; }
                input[type="checkbox"] { line-height: 12px; }
                .x input[type="checkbox"] { transform: translateY(-1px); }
                input::before { line-height: 10px; }
                .flex { display: flex; align-items: flex-start; }
                .grid { display: grid; align-items: baseline; }
                .icon { line-height: 12px; transform: translateY(-1px); }
                .label { line-height: 20px; }
                @media (min-width: 900px) {
                  .icon { transform: translateY(-4px); line-height: 10px; }
                }
              `,
            },
          ],
        },
      },
      () => {},
    );

    const stats = getLatestLayoutPerfStatsForTest();
    expect(stats.elementsScanned).toBeGreaterThan(0);
    expect(stats.matchEdgesCreated).toBeGreaterThan(0);
    expect(stats.compiledSelectorCount).toBeGreaterThan(0);
    expect(stats.selectorsRejectedUnsupported).toBeGreaterThan(0);
    expect(stats.selectorsGuardedConditional).toBeGreaterThan(0);
    expect(stats.ancestryChecks).toBeGreaterThan(0);
    expect(stats.casesScored).toBeGreaterThan(0);
    expect(stats.casesCollected).toBeGreaterThan(0);
    expect(stats.measurementIndexHits).toBeGreaterThan(0);
    expect(stats.conditionalSignalRatio).toBeGreaterThanOrEqual(0);
    expect(stats.conditionalSignalRatio).toBeLessThanOrEqual(1);
    expect(stats.conditionalSignals).toBeGreaterThanOrEqual(0);
    expect(stats.totalSignals).toBeGreaterThanOrEqual(stats.conditionalSignals);
    expect(stats.cohortUnimodalFalse).toBeGreaterThanOrEqual(0);
    expect(stats.factorCoverageMean).toBeGreaterThanOrEqual(0);
    expect(stats.factorCoverageMean).toBeLessThanOrEqual(1);
    expect(stats.posteriorWidthP95).toBeGreaterThanOrEqual(0);
    expect(stats.posteriorWidthP95).toBeLessThanOrEqual(1);
    expect(stats.uncertaintyEscalations).toBeGreaterThanOrEqual(0);
    expect(stats.diagnosticsEmitted).toBeGreaterThanOrEqual(0);
    expect(stats.contextsClassified).toBeGreaterThan(0);
    expect(stats.casesRejectedUndecidable).toBeGreaterThanOrEqual(0);
    expect(stats.casesRejectedIdentifiability).toBeGreaterThanOrEqual(0);
    expect(stats.undecidableInterval).toBeGreaterThanOrEqual(0);
    expect(stats.selectorCandidatesChecked).toBeLessThanOrEqual(stats.elementsScanned * 3);
    expect(stats.ancestryChecks).toBeLessThanOrEqual(stats.selectorCandidatesChecked * 3);
    expect(stats.casesCollected).toBeLessThanOrEqual(stats.elementsScanned * 4);
    expect(stats.signalSnapshotsBuilt).toBeGreaterThanOrEqual(stats.elementsScanned);
    expect(stats.signalSnapshotCacheHits).toBeGreaterThan(0);
    expect(stats.selectorIndexMs).toBeGreaterThanOrEqual(0);
    expect(stats.selectorMatchMs).toBeGreaterThanOrEqual(0);
    expect(stats.cascadeBuildMs).toBeGreaterThanOrEqual(0);
    expect(stats.caseBuildMs).toBeGreaterThanOrEqual(0);
    expect(stats.scoringMs).toBeGreaterThanOrEqual(0);
    expect(stats.selectorIndexMs + stats.selectorMatchMs + stats.cascadeBuildMs).toBeLessThanOrEqual(stats.elapsedMs + 5);
    if (!IS_CI) {
      expect(stats.caseBuildMs).toBeLessThanOrEqual(PERF_BASELINE_MS.shallowCaseBuild);
      expect(stats.elapsedMs).toBeLessThanOrEqual(PERF_BASELINE_MS.shallowElapsed);
    }
  });

  it("keeps deep-tree measurement lookup within bounded budget", () => {
    const rows = buildNestedRows(320, 7);
    const solid = parseCode(
      `
        import "./layout.css";

        export function Table() {
          return (
            <section>
              <table><tbody>${rows}</tbody></table>
            </section>
          );
        }
      `,
      "/project/perf/deep/App.tsx",
    );

    analyzeCrossFileInput(
      {
        solid,
        css: {
          files: [
            {
              path: "/project/perf/deep/layout.css",
              content: `
                table td { line-height: 20px; }
                input[type="checkbox"] { line-height: 12px; transform: translateY(-2px); }
                .nest { display: block; }
              `,
            },
          ],
        },
      },
      () => {},
    );

    const stats = getLatestLayoutPerfStatsForTest();
    // Correctness: algorithm complexity invariants
    expect(stats.elementsScanned).toBeGreaterThan(5000);
    expect(stats.casesCollected).toBeGreaterThan(800);
    expect(stats.measurementIndexHits).toBe(stats.casesCollected);
    expect(stats.signalSnapshotsBuilt).toBeGreaterThanOrEqual(stats.elementsScanned);
    expect(stats.signalSnapshotCacheHits).toBeGreaterThan(0);
    // Timing: only enforce locally — CI runners have unbounded scheduling jitter
    if (!IS_CI) {
      expect(stats.caseBuildMs).toBeLessThanOrEqual(PERF_BASELINE_MS.deepCaseBuild);
      expect(stats.elapsedMs).toBeLessThanOrEqual(PERF_BASELINE_MS.deepElapsed);
    }
  });
});
