import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../../src/diagnostic";
import { analyzeCrossFileInput } from "../../src/cross-file";
import { getLatestLayoutPerfStatsForTest } from "../../src/cross-file";
import { parseCode } from "../solid/test-utils";

const OFFSET_RE = /\d+\.\d{2}px/


interface CssFixture {
  readonly path: string;
  readonly content: string;
}

function runRule(tsx: string, css: string | readonly CssFixture[]): readonly Diagnostic[] {
  const solid = parseCode(tsx, "/project/App.tsx");
  const diagnostics: Diagnostic[] = [];
  const files = typeof css === "string"
    ? [{ path: "/project/layout.css", content: css }]
    : css;

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

interface SolidFixture {
  readonly path: string;
  readonly code: string;
}

function runRuleMultiFile(solids: readonly SolidFixture[], css: string | readonly CssFixture[]): readonly Diagnostic[] {
  const parsedSolids = solids.map((f) => parseCode(f.code, f.path));
  const diagnostics: Diagnostic[] = [];
  const files = typeof css === "string"
    ? [{ path: "/project/layout.css", content: css }]
    : css;

  analyzeCrossFileInput(
    {
      solid: parsedSolids,
      css: {
        files,
      },
    },
    (diagnostic) => diagnostics.push(diagnostic),
  );

  return diagnostics.filter((diagnostic) => diagnostic.rule === "css-layout-sibling-alignment-outlier");
}

describe("css-layout-sibling-alignment-outlier", () => {
  it("emits for table checkbox outlier", () => {
    const diagnostics = runRule(
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
        input[type="checkbox"] { line-height: 12px; transform: translateY(-2px); }
        td { line-height: 20px; }
      `,
    );

    expect(diagnostics.length).toBeGreaterThan(0);
    const d0 = diagnostics[0];
    if (!d0) throw new Error("Expected diagnostic at index 0");
    expect(d0.messageId).toBe("misalignedSibling");
    expect(d0.rule).toBe("css-layout-sibling-alignment-outlier");
    expect(d0.message).toContain("Estimated offset");
    expect(d0.message).toMatch(OFFSET_RE);
    expect(d0.message).toContain("Vertically misaligned");
  });

  it("emits when control/text siblings use unresolved line-height values", () => {
    const diagnostics = runRule(
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
        :root { --row-line-height: 1.4; }
        input[type="checkbox"] {
          line-height: var(--row-line-height);
          transform: translateY(-2px);
          vertical-align: baseline;
        }
        td {
          line-height: var(--row-line-height);
          vertical-align: middle;
        }
      `,
    );

    const stats = getLatestLayoutPerfStatsForTest();
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(stats.casesCollected).toBeGreaterThan(0);
    expect(stats.casesRejectedIdentifiability).toBeLessThan(stats.casesCollected);
  });

  it("emits for unresolved three-sibling header with lone control", () => {
    const diagnostics = runRule(
      `
        import "./layout.css";

        export function Table() {
          const a = "IP Address";
          const b = "Status";

          return (
            <table>
              <tbody>
                <tr>
                  <th><input type="checkbox" /></th>
                  <th>{a}</th>
                  <th>{b}</th>
                </tr>
              </tbody>
            </table>
          );
        }
      `,
      `
        :root { --row-line-height: 1.4; }
        th {
          line-height: var(--row-line-height);
          vertical-align: middle;
        }
      `,
    );

    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it("emits for text-only table cell outlier", () => {
    const diagnostics = runRule(
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

    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("emits for non-table flex outlier", () => {
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
        .icon { transform: translateY(-2px); line-height: 12px; }
        .label { line-height: 20px; }
      `,
    );

    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("applies child and descendant combinators without leaking across containers", () => {
    const diagnostics = runRule(
      `
        import "./layout.css";

        export function Row() {
          return (
            <section>
              <div class="row">
                <span class="icon">.</span>
                <span class="label">Label</span>
              </div>
              <div class="other">
                <span class="icon">.</span>
                <span class="label">Label</span>
              </div>
            </section>
          );
        }
      `,
      `
        .row { display: flex; align-items: flex-start; }
        .other { display: flex; align-items: flex-start; }
        .row > .icon { transform: translateY(-2px); line-height: 12px; }
        .row .label { line-height: 20px; }
        .other > .icon { line-height: 20px; }
        .other > .label { line-height: 20px; }
      `,
    );

    expect(diagnostics).toHaveLength(3);
  });

  it("supports structural pseudo selectors for child position", () => {
    const diagnostics = runRule(
      `
        import "./layout.css";

        export function Row() {
          return (
            <div class="row">
              <span>A</span>
              <span>B</span>
              <span>C</span>
            </div>
          );
        }
      `,
      `
        .row { display: flex; align-items: flex-start; }
        .row > span { line-height: 20px; }
        .row > :nth-child(2) { transform: translateY(-2px); line-height: 12px; }
      `,
    );

    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("supports first-child and last-child pseudo selectors", () => {
    const diagnostics = runRule(
      `
        import "./layout.css";

        export function Row() {
          return (
            <div class="row">
              <span>A</span>
              <span>B</span>
              <span>C</span>
            </div>
          );
        }
      `,
      `
        .row { display: flex; align-items: flex-start; }
        .row > span { line-height: 20px; }
        .row > :first-child,
        .row > :last-child { line-height: 20px; }
        .row > :first-child { transform: translateY(-5px); line-height: 12px; }
      `,
    );

    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("supports :is/:where/:not selector pseudos", () => {
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
        .row > :where(:is(.icon, .label):not(.label)) { transform: translateY(-2px); line-height: 12px; }
        .row > .label { line-height: 20px; }
      `,
    );

    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("supports attribute operators for selector applicability", () => {
    const diagnostics = runRule(
      `
        import "./layout.css";

        export function Row() {
          return (
            <div class="row">
              <span data-kind="icon-primary">.</span>
              <span data-kind="label">Label</span>
            </div>
          );
        }
      `,
      `
        .row { display: flex; align-items: flex-start; }
        [data-kind^="icon"] { transform: translateY(-2px); line-height: 12px; }
        [data-kind$="label"] { line-height: 20px; }
      `,
    );

    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("supports ~=, |=, and *= attribute operators", () => {
    const diagnostics = runRule(
      `
        import "./layout.css";

        export function Row() {
          return (
            <div class="row">
              <span data-tags="badge icon" data-lang="en-US" data-kind="prefix-icon-suffix">.</span>
              <span data-tags="badge label" data-lang="fr" data-kind="label">Label</span>
            </div>
          );
        }
      `,
      `
        .row { display: flex; align-items: flex-start; }
        [data-tags~="icon"],
        [data-lang|="en"],
        [data-kind*="icon"] { transform: translateY(-2px); line-height: 12px; }
        [data-kind="label"] { line-height: 20px; }
      `,
    );

    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("supports an+b nth pseudo formulas", () => {
    const diagnostics = runRule(
      `
        import "./layout.css";

        export function Row() {
          return (
            <div class="row">
              <span>A</span>
              <span>B</span>
              <span>C</span>
            </div>
          );
        }
      `,
      `
        .row { display: flex; align-items: flex-start; }
        .row > span { line-height: 20px; }
        .row > span:nth-child(2n) { transform: translateY(-2px); line-height: 12px; }
      `,
    );

    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("supports odd and even nth pseudo keywords", () => {
    const oddDiagnostics = runRule(
      `
        import "./layout.css";

        export function Row() {
          return (
            <div class="row">
              <span>A</span>
              <span>B</span>
            </div>
          );
        }
      `,
      `
        .row { display: flex; align-items: flex-start; }
        .row > span { line-height: 20px; }
        .row > span:nth-child(odd) { transform: translateY(-2px); line-height: 12px; }
      `,
    );

    const evenDiagnostics = runRule(
      `
        import "./layout.css";

        export function Row() {
          return (
            <div class="row">
              <span>A</span>
              <span>B</span>
            </div>
          );
        }
      `,
      `
        .row { display: flex; align-items: flex-start; }
        .row > span { line-height: 20px; }
        .row > span:nth-child(even) { transform: translateY(-2px); line-height: 12px; }
      `,
    );

    expect(oddDiagnostics.length).toBeGreaterThan(0);
    expect(evenDiagnostics.length).toBeGreaterThan(0);
  });

  it("supports nth-of-type and nth-last-of-type pseudos", () => {
    const diagnostics = runRule(
      `
        import "./layout.css";

        export function Row() {
          return (
            <div class="row">
              <span>A</span>
              <span>B</span>
              <span>C</span>
            </div>
          );
        }
      `,
      `
        .row { display: flex; align-items: flex-start; }
        .row > span { line-height: 20px; }
        .row > span:nth-of-type(2),
        .row > span:nth-last-of-type(2) { transform: translateY(-2px); line-height: 12px; }
      `,
    );

    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("respects !important when resolving selector cascade winners", () => {
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
        .icon { transform: translateY(0px) !important; line-height: 20px !important; }
        .icon { transform: translateY(-3px); line-height: 12px; }
        .label { line-height: 20px; }
      `,
    );

    expect(diagnostics).toHaveLength(0);
  });

  it("respects layer precedence over source order", () => {
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
        @layer base, components;
        .row { display: flex; align-items: flex-start; }
        .label { line-height: 20px; }
        @layer components {
          .icon { transform: translateY(0px); line-height: 20px; }
        }
        @layer base {
          .icon { transform: translateY(-3px); line-height: 12px; }
        }
      `,
    );

    expect(diagnostics).toHaveLength(0);
  });

  it("respects source order when specificity is tied", () => {
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
        .label { line-height: 20px; }
        .icon { transform: translateY(-3px); line-height: 12px; }
        .icon { transform: translateY(0px); line-height: 20px; }
      `,
    );

    expect(diagnostics).toHaveLength(0);
  });

  it("ignores conditional selectors for hard evidence", () => {
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
        .icon { line-height: 20px; }
        .label { line-height: 20px; }
        @media (min-width: 900px) {
          .icon { transform: translateY(-3px); line-height: 12px; }
        }
      `,
    );

    expect(diagnostics).toHaveLength(0);
  });

  it("treats static top as declared-only and effective top as active", () => {
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
      `
        .row { position: relative; display: flex; align-items: flex-start; }
        .a { position: static; top: -5px; line-height: 12px; }
        .b { position: relative; top: -5px; line-height: 20px; }
      `,
    );

    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("isolates a single divergent sibling in larger cohorts", () => {
    const diagnostics = runRule(
      `
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
      `,
      `
        .row { display: flex; align-items: flex-start; }
        .a, .b, .c { line-height: 20px; }
        .d { line-height: 12px; transform: translateY(-2px); }
      `,
    );

    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("keeps n>=3 baseline/control conflicts from being pre-pruned", () => {
    const diagnostics = runRule(
      `
        import "./layout.css";

        export function Row() {
          return (
            <table>
              <tbody>
                <tr>
                  <td><span>A</span></td>
                  <td><span>B</span></td>
                  <td><span>C</span></td>
                  <td><input type="checkbox" /></td>
                </tr>
              </tbody>
            </table>
          );
        }
      `,
      `
        td > span { line-height: 20px; vertical-align: middle; }
        td > input[type="checkbox"] { line-height: 20px; vertical-align: baseline; }
      `,
    );

    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("does not emit for two-cluster sibling cohorts without a clear outlier", () => {
    const diagnostics = runRule(
      `
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
      `,
      `
        .row { display: flex; align-items: flex-start; }
        .a, .b { transform: translateY(-2px); line-height: 12px; }
        .c, .d { line-height: 20px; }
      `,
    );

    expect(diagnostics).toHaveLength(0);
  });

  it("does not emit for balanced bimodal cohorts even with baseline conflicts", () => {
    const diagnostics = runRule(
      `
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
      `,
      `
        .row { display: flex; align-items: flex-start; }
        .a, .b { transform: translateY(-2px); line-height: 12px; vertical-align: baseline; }
        .c, .d { line-height: 20px; vertical-align: middle; }
      `,
    );

    expect(diagnostics).toHaveLength(0);
  });

  it("keeps balanced two-cluster synthetic corpus at zero accepted diagnostics", () => {
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

    const baseRules = [
      ".row { display: flex; align-items: flex-start; }",
      ".a, .b { transform: translateY(-2px); line-height: 12px; vertical-align: baseline; }",
      ".c, .d { line-height: 20px; vertical-align: middle; }",
    ] as const;
    const swappedRules = [
      ".row { display: flex; align-items: flex-start; }",
      ".a, .b { line-height: 20px; vertical-align: middle; }",
      ".c, .d { transform: translateY(-2px); line-height: 12px; vertical-align: baseline; }",
    ] as const;
    const corpus: readonly (readonly CssFixture[])[] = [
      [{ path: "/project/layout.css", content: `${baseRules.join("\n")}` }],
      [{ path: "/project/layout.css", content: `${swappedRules.join("\n")}` }],
      [{ path: "/project/layout.css", content: `${baseRules.join("\n")}\n.row { box-sizing: border-box; }` }],
      [{ path: "/project/layout.css", content: `${swappedRules.join("\n")}\n.row { box-sizing: border-box; }` }],
      [{ path: "/project/layout.css", content: `${baseRules.join("\n")}\n.a, .b { margin-top: 0px; margin-bottom: 0px; }` }],
      [{ path: "/project/layout.css", content: `${swappedRules.join("\n")}\n.c, .d { margin-top: 0px; margin-bottom: 0px; }` }],
      [{ path: "/project/layout.css", content: `${baseRules.join("\n")}\n@media (min-width: 900px) { .row { writing-mode: vertical-rl; } }` }],
      [{ path: "/project/layout.css", content: `${swappedRules.join("\n")}\n@media (min-width: 900px) { .row { writing-mode: vertical-rl; } }` }],
      [
        { path: "/project/base.css", content: ".row { display: flex; align-items: flex-start; }" },
        {
          path: "/project/clusters.css",
          content: ".a, .b { transform: translateY(-2px); line-height: 12px; vertical-align: baseline; }\n.c, .d { line-height: 20px; vertical-align: middle; }",
        },
      ],
      [
        { path: "/project/base.css", content: ".row { display: flex; align-items: flex-start; }" },
        {
          path: "/project/clusters.css",
          content: ".a, .b { line-height: 20px; vertical-align: middle; }\n.c, .d { transform: translateY(-2px); line-height: 12px; vertical-align: baseline; }",
        },
      ],
      [
        { path: "/project/base.css", content: ".row { display: flex; align-items: flex-start; }\n@media (min-width: 900px) { .row { writing-mode: vertical-rl; } }" },
        {
          path: "/project/clusters.css",
          content: ".a, .b { transform: translateY(-2px); line-height: 12px; vertical-align: baseline; }\n.c, .d { line-height: 20px; vertical-align: middle; }",
        },
      ],
      [
        { path: "/project/base.css", content: ".row { display: flex; align-items: flex-start; }\n@media (min-width: 900px) { .row { writing-mode: vertical-rl; } }" },
        {
          path: "/project/clusters.css",
          content: ".a, .b { line-height: 20px; vertical-align: middle; }\n.c, .d { transform: translateY(-2px); line-height: 12px; vertical-align: baseline; }",
        },
      ],
    ];

    let totalCasesCollected = 0;
    let totalIdentifiabilityRejects = 0;

    for (const entry of corpus) {
      const diagnostics = runRule(tsx, entry);
      expect(diagnostics).toHaveLength(0);

      const stats = getLatestLayoutPerfStatsForTest();
      expect(stats.casesCollected).toBeGreaterThan(0);
      totalCasesCollected += stats.casesCollected;
      totalIdentifiabilityRejects += stats.casesRejectedIdentifiability;
    }

    expect(corpus.length).toBeGreaterThanOrEqual(12);
    expect(totalCasesCollected).toBeGreaterThan(0);
    expect(totalIdentifiabilityRejects).toBeGreaterThan(0);
  });

  it("does not emit for centered flex layouts", () => {
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
        .row { display: flex; align-items: center; }
        .icon { line-height: 20px; }
        .label { line-height: 20px; }
      `,
    );

    expect(diagnostics).toHaveLength(0);
  });

  it("emits without offset when baseline signals conflict", () => {
    const diagnostics = runRule(
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
        input[type="checkbox"] {
          line-height: 12px;
          vertical-align: baseline;
          margin-top: 0px;
          margin-bottom: 0px;
        }
        td {
          line-height: 20px;
          vertical-align: middle;
          margin-top: 0px;
          margin-bottom: 0px;
        }
      `,
    );

    expect(diagnostics.length).toBeGreaterThan(0);
    const d0 = diagnostics[0];
    if (!d0) throw new Error("Expected diagnostic at index 0");
    expect(d0.messageId).toBe("misalignedSibling");
    expect(d0.message).toContain("Vertically misaligned");
    expect(d0.message).not.toContain("Estimated offset");
  });

  it("treats text-only expression siblings as decidable textual evidence", () => {
    const literalDiagnostics = runRule(
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
        input[type="checkbox"] {
          line-height: 12px;
          vertical-align: baseline;
          margin-top: 0px;
          margin-bottom: 0px;
        }
        td {
          line-height: 20px;
          vertical-align: middle;
          margin-top: 0px;
          margin-bottom: 0px;
        }
      `,
    );

    const expressionDiagnostics = runRule(
      `
        import "./layout.css";

        export function Table() {
          const label = "System";
          return (
            <table>
              <tbody>
                <tr>
                  <td><input type="checkbox" /></td>
                  <td>{label}</td>
                </tr>
              </tbody>
            </table>
          );
        }
      `,
      `
        input[type="checkbox"] {
          line-height: 12px;
          vertical-align: baseline;
          margin-top: 0px;
          margin-bottom: 0px;
        }
        td {
          line-height: 20px;
          vertical-align: middle;
          margin-top: 0px;
          margin-bottom: 0px;
        }
      `,
    );

    expect(literalDiagnostics.length).toBeGreaterThan(0);
    expect(expressionDiagnostics.length).toBeGreaterThan(0);
  });

  it("respects imported stylesheet scope across multiple css files", () => {
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
      [
        {
          path: "/project/layout.css",
          content: `
            .row { display: flex; align-items: center; }
            .icon { line-height: 20px; }
            .label { line-height: 20px; }
          `,
        },
        {
          path: "/project/unrelated.css",
          content: `
            .row { display: flex; align-items: flex-start; }
            .icon { line-height: 12px; transform: translateY(-3px); }
            .label { line-height: 20px; }
          `,
        },
      ],
    );

    expect(diagnostics).toHaveLength(0);
  });

  it("does not propagate measurement node across formatting context boundaries", () => {
    const diagnostics = runRuleMultiFile(
      [
        {
          path: "/project/spinner.tsx",
          code: `
            import { For } from "solid-js";
            export function Spinner(props: any) {
              return (
                <svg viewBox="0 0 15 15" fill="currentColor" role="status">
                  <For each={[1,2,3]}>
                    {(i) => <rect x={i} y={i} width="3" height="3" />}
                  </For>
                </svg>
              );
            }
          `,
        },
        {
          path: "/project/App.tsx",
          code: `
            import "./layout.css";
            import { Show, For } from "solid-js";
            import { Spinner } from "./spinner";

            function DataTableEmpty(props: any) {
              return (
                <tr>
                  <td colSpan={100}>
                    {props.children}
                  </td>
                </tr>
              );
            }

            export function Table() {
              const items = () => [{ id: 1, name: "test" }];
              const loading = () => false;
              return (
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <Show
                      when={!loading()}
                      fallback={
                        <DataTableEmpty colSpan={2}>
                          <div data-slot="loading">
                            <Spinner />
                            <p>Loading...</p>
                          </div>
                        </DataTableEmpty>
                      }
                    >
                      <For each={items()}>
                        {(item) => (
                          <tr>
                            <td>{item.name}</td>
                            <td>{item.id}</td>
                          </tr>
                        )}
                      </For>
                    </Show>
                  </tbody>
                </table>
              );
            }
          `,
        },
      ],
      `
        table { width: 100%; }
        td { line-height: 20px; padding: 8px; }
        th { line-height: 20px; padding: 8px; }
      `,
    );

    const svgDiags = diagnostics.filter((d) => d.message.includes("'svg'"));
    expect(svgDiags).toHaveLength(0);
  });

  it("excludes visually-hidden accessible checkbox from cohort analysis", () => {
    const diagnostics = runRule(
      `
        import "./layout.css";

        export function Toggle() {
          return (
            <label>
              <input type="checkbox" />
              <span>Visible label</span>
            </label>
          );
        }
      `,
      `
        label { display: flex; align-items: center; gap: 8px; }
        input[type="checkbox"] {
          position: absolute;
          width: 0px;
          height: 0px;
          opacity: 0;
        }
        span { line-height: 24px; font-size: 14px; }
      `,
    );

    const inputDiags = diagnostics.filter((d) => d.message.includes("'input'"));
    expect(inputDiags).toHaveLength(0);
  });

  it("excludes position-fixed zero-size element from cohort analysis", () => {
    const diagnostics = runRule(
      `
        import "./layout.css";

        export function Panel() {
          return (
            <div>
              <input type="text" />
              <div class="hidden-anchor" />
              <span>Label</span>
            </div>
          );
        }
      `,
      `
        div { display: flex; align-items: center; gap: 8px; }
        .hidden-anchor {
          position: fixed;
          width: 0px;
          height: 0px;
        }
        input[type="text"] { line-height: 20px; height: 32px; }
        span { line-height: 20px; }
      `,
    );

    const hiddenDiags = diagnostics.filter((d) => d.message.includes("'div'") && d.message.includes("hidden-anchor"));
    expect(hiddenDiags).toHaveLength(0);
  });

  it("excludes absolutely-positioned non-zero-size elements from cohort", () => {
    const diagnostics = runRule(
      `
        import "./layout.css";

        export function Row() {
          return (
            <div>
              <input type="checkbox" />
              <span>Label text</span>
              <span>Other text</span>
            </div>
          );
        }
      `,
      `
        div { display: flex; align-items: center; gap: 8px; }
        input[type="checkbox"] {
          position: absolute;
          width: 16px;
          height: 16px;
          transform: translateY(-3px);
          line-height: 12px;
        }
        span { line-height: 24px; }
      `,
    );

    // Absolutely-positioned element is out of flow and excluded from cohort
    const inputDiags = diagnostics.filter((d) => d.message.includes("'input'"));
    expect(inputDiags).toHaveLength(0);
  });

  it("still flags in-flow elements with misalignment", () => {
    const diagnostics = runRule(
      `
        import "./layout.css";

        export function Row() {
          return (
            <div>
              <input type="checkbox" />
              <span>Label text</span>
              <span>Other text</span>
            </div>
          );
        }
      `,
      `
        div { display: flex; align-items: center; gap: 8px; }
        input[type="checkbox"] {
          position: relative;
          width: 16px;
          height: 16px;
          transform: translateY(-3px);
          line-height: 12px;
        }
        span { line-height: 24px; }
      `,
    );

    // position: relative keeps the element in flow, so it should be flagged
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
