import { afterAll, describe, expect, it } from "vitest";
import type { Diagnostic } from "../../src/diagnostic";
import { analyzeCrossFileInput, getLatestLayoutPerfStatsForTest } from "../../src/cross-file";
import { parseCode } from "../solid/test-utils";

const _ceCache = new Map<string, ReturnType<typeof parseCode>>()
afterAll(() => _ceCache.clear())
let _ceFC = 0

function runRule(tsx: string, css: string): readonly Diagnostic[] {
  let solid = _ceCache.get(tsx); if (!solid) { solid = parseCode(tsx, `/project/ce_${_ceFC++}.tsx`); _ceCache.set(tsx, solid); }
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

describe("layout alignment conditional evidence", () => {
  it("keeps conditional-only offsets as guarded evidence and rejects as undecidable", () => {
    const diagnostics = runRule(
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

    const stats = getLatestLayoutPerfStatsForTest();
    expect(diagnostics).toHaveLength(0);
    expect(stats.selectorsGuardedConditional).toBeGreaterThan(0);
    expect(stats.casesRejectedUndecidable).toBeGreaterThan(0);
  });
});
