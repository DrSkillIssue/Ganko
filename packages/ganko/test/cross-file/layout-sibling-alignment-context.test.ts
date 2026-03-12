import { noopLogger } from "@drskillissue/ganko-shared";
import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../../src/diagnostic";
import { analyzeCrossFileInput, buildLayoutGraph, collectAlignmentCases, evaluateAlignmentCase } from "../../src/cross-file";
import { buildSolidGraph } from "../../src/solid/plugin";
import { buildCSSGraph } from "../../src/css/plugin";
import { parseCode } from "../solid/test-utils";

interface CssFixture {
  readonly path: string;
  readonly content: string;
}

function runRule(tsx: string, files: readonly CssFixture[]): readonly Diagnostic[] {
  const solid = parseCode(tsx, "/project/App.tsx");
  const diagnostics: Diagnostic[] = [];

  analyzeCrossFileInput(
    {
      solid,
      css: {
        files,
      },
    },
    (diagnostic) => diagnostics.push(diagnostic),
  );

  return diagnostics.filter((diagnostic) => diagnostic.rule === "css-layout-sibling-alignment-outlier");
}

describe("layout alignment context handling", () => {
  it("emits inline formatting context outliers", () => {
    const diagnostics = runRule(
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
      [
        {
          path: "/project/layout.css",
          content: `
            .row { display: inline-block; }
            .a { line-height: 12px; transform: translateY(-2px); }
            .b { line-height: 20px; }
          `,
        },
      ],
    );

    expect(diagnostics.length).toBeGreaterThan(0);
    const d0 = diagnostics[0];
    if (!d0) throw new Error("Expected diagnostic at index 0");
    expect(d0.message).toContain("context inline-formatting");
  });

  it("emits table-cell context and suppresses intentional middle alignment", () => {
    const mismatch = runRule(
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
      [
        {
          path: "/project/layout.css",
          content: `
            td.left { transform: translateY(-2px); line-height: 12px; }
            td { line-height: 20px; }
          `,
        },
      ],
    );

    expect(mismatch.length).toBeGreaterThan(0);
    const m0 = mismatch[0];
    if (!m0) throw new Error("Expected diagnostic at index 0");
    expect(m0.message).toContain("context table-cell");

    const aligned = runRule(
      `
        import "./layout.css";

        export function Table() {
          return (
            <table>
              <tbody>
                <tr>
                  <td>IP Address</td>
                  <td>System</td>
                </tr>
              </tbody>
            </table>
          );
        }
      `,
      [
        {
          path: "/project/layout.css",
          content: `
            td { vertical-align: middle; line-height: 20px; }
          `,
        },
      ],
    );

    expect(aligned).toHaveLength(0);
  });

  it("emits flex and grid context conflicts", () => {
    const flexDiagnostics = runRule(
      `
        import "./layout.css";

        export function FlexRow() {
          return (
            <div class="flex-row">
              <span class="a">.</span>
              <span class="b">Label</span>
            </div>
          );
        }
      `,
      [
        {
          path: "/project/layout.css",
          content: `
            .flex-row { display: flex; align-items: flex-start; }
            .a { line-height: 12px; transform: translateY(-2px); }
            .b { line-height: 20px; }
          `,
        },
      ],
    );

    expect(flexDiagnostics.length).toBeGreaterThan(0);
    const fd0 = flexDiagnostics[0];
    if (!fd0) throw new Error("Expected diagnostic at index 0");
    expect(fd0.message).toContain("context flex-cross-axis");

    const gridDiagnostics = runRule(
      `
        import "./layout.css";

        export function GridRow() {
          return (
            <div class="grid-row">
              <span class="a">.</span>
              <span class="b">Label</span>
            </div>
          );
        }
      `,
      [
        {
          path: "/project/layout.css",
          content: `
            .grid-row { display: grid; align-items: baseline; }
            .a { line-height: 12px; transform: translateY(-2px); }
            .b { line-height: 20px; }
          `,
        },
      ],
    );

    expect(gridDiagnostics.length).toBeGreaterThan(0);
    const gd0 = gridDiagnostics[0];
    if (!gd0) throw new Error("Expected diagnostic at index 0");
    expect(gd0.message).toContain("context grid-cross-axis");
  });

  it("remaps axis for vertical writing mode and avoids false positives", () => {
    const diagnostics = runRule(
      `
        import "./layout.css";

        export function VerticalRow() {
          return (
            <div class="row">
              <span class="a">A</span>
              <span class="b">B</span>
            </div>
          );
        }
      `,
      [
        {
          path: "/project/layout.css",
          content: `
            .row { writing-mode: vertical-rl; }
            .a { top: -2px; line-height: 20px; }
            .b { line-height: 20px; }
          `,
        },
      ],
    );

    expect(diagnostics).toHaveLength(0);
  });

  it("keeps case ordering deterministic", () => {
    const solidInput = parseCode(
      `
        import "./layout.css";

        export function Row() {
          return (
            <div class="row">
              <span class="a">.</span>
              <span class="b">Label</span>
              <span class="c">Label</span>
            </div>
          );
        }
      `,
      "/project/App.tsx",
    );

    const solidGraph = buildSolidGraph(solidInput);
    const cssGraph = buildCSSGraph({
      files: [
        {
          path: "/project/layout.css",
          content: `
            .row { display: flex; align-items: flex-start; }
            .a { line-height: 12px; transform: translateY(-2px); }
            .b { line-height: 20px; }
            .c { line-height: 20px; }
          `,
        },
      ],
    });

    const context = {
      solids: [solidGraph],
      css: cssGraph,
      layout: buildLayoutGraph([solidGraph], cssGraph),
    logger: noopLogger,
    };

    const firstPass = collectAlignmentCases(context);
    const secondPass = collectAlignmentCases(context);

    expect(firstPass.length).toBeGreaterThan(0);
    expect(secondPass.length).toBeGreaterThan(0);
    const firstOrder = firstPass.map((entry) => entry.subject.elementKey);
    const secondOrder = secondPass.map((entry) => entry.subject.elementKey);
    expect(firstOrder).toStrictEqual(secondOrder);
  });

  it("inherits line-height signals from parent context", () => {
    const diagnostics = runRule(
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
      [
        {
          path: "/project/layout.css",
          content: `
            .row { display: flex; align-items: flex-start; line-height: 20px; }
            .a { line-height: 12px; transform: translateY(-2px); }
            .b { }
          `,
        },
      ],
    );

    expect(diagnostics.length).toBeGreaterThan(0);
    const dd0 = diagnostics[0];
    if (!dd0) throw new Error("Expected diagnostic at index 0");
    expect(dd0.message).toContain("explicit block-axis offset differs from sibling cohort");
  });

  it("includes transitive css @import scope", () => {
    const diagnostics = runRule(
      `
        import "./entry.css";

        export function Row() {
          return (
            <div class="row">
              <span class="icon">.</span>
              <span class="label">Label</span>
            </div>
          );
        }
      `,
      [
        {
          path: "/project/entry.css",
          content: `
            @import "./base.css";
            .row { display: flex; align-items: flex-start; }
          `,
        },
        {
          path: "/project/base.css",
          content: `
            @import "./details.css";
          `,
        },
        {
          path: "/project/details.css",
          content: `
            .icon { line-height: 12px; transform: translateY(-2px); }
            .label { line-height: 20px; }
          `,
        },
      ],
    );

    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("classifies conditional flex context as conditional, not block-flow", () => {
    const tsx = `
      import "./layout.css";

      export function Row() {
        return (
          <div class="row">
            <span class="a">.</span>
            <span class="b">Label</span>
          </div>
        );
      }
    `;

    const css = `
      @media (min-width: 900px) {
        .row { display: flex; align-items: flex-start; }
        .a { line-height: 12px; transform: translateY(-2px); }
        .b { line-height: 20px; }
      }
    `;

    const solidInput = parseCode(tsx, "/project/App.tsx");
    const solidGraph = buildSolidGraph(solidInput);
    const cssGraph = buildCSSGraph({
      files: [
        {
          path: "/project/layout.css",
          content: css,
        },
      ],
    });

    const context = {
      solids: [solidGraph],
      css: cssGraph,
      layout: buildLayoutGraph([solidGraph], cssGraph),
    logger: noopLogger,
    };

    const cases = collectAlignmentCases(context);
    expect(cases.length).toBeGreaterThan(0);

    for (const entry of cases) {
      expect(entry.context.kind).toBe("flex-cross-axis");
      expect(entry.context.certainty).toBe("conditional");
      const decision = evaluateAlignmentCase(entry);
      expect(decision.kind).toBe("reject");
      if (decision.kind !== "reject") throw new Error("expected reject decision");
      expect(decision.reason).toBe("undecidable");
    }

    const diagnostics = runRule(tsx, [{ path: "/project/layout.css", content: css }]);
    expect(diagnostics).toHaveLength(0);
  });

  it("keeps conditional writing-mode axis uncertain and rejects resolved acceptance", () => {
    const tsx = `
      import "./layout.css";

      export function Row() {
        return (
          <div class="row">
            <span class="a">A</span>
            <span class="b">B</span>
          </div>
        );
      }
    `;

    const css = `
      .row { display: inline-block; }
      .a { position: relative; inset-block-start: 3px; line-height: 12px; }
      .b { line-height: 20px; }
      @media (min-width: 900px) {
        .row { writing-mode: vertical-rl; }
      }
    `;

    const solidInput = parseCode(tsx, "/project/App.tsx");
    const solidGraph = buildSolidGraph(solidInput);
    const cssGraph = buildCSSGraph({
      files: [
        {
          path: "/project/layout.css",
          content: css,
        },
      ],
    });

    const context = {
      solids: [solidGraph],
      css: cssGraph,
      layout: buildLayoutGraph([solidGraph], cssGraph),
    logger: noopLogger,
    };

    const cases = collectAlignmentCases(context);
    expect(cases.length).toBeGreaterThan(0);

    for (const entry of cases) {
      expect(entry.context.axisCertainty).toBe("conditional");
      const decision = evaluateAlignmentCase(entry);
      expect(decision.kind).toBe("reject");
    }

    const diagnostics = runRule(tsx, [{ path: "/project/layout.css", content: css }]);
    expect(diagnostics).toHaveLength(0);
  });
});
