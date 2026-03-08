import { describe, expect, it } from "vitest";
import { buildLayoutGraph } from "../../src/cross-file";
import { buildCSSGraph } from "../../src/css/plugin";
import { buildSolidGraph } from "../../src/solid/plugin";
import { parseCode } from "../solid/test-utils";

function assertSorted(values: readonly number[]): void {
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const curr = values[i];
    if (prev === undefined || curr === undefined) throw new Error(`Expected values at indices ${i - 1} and ${i}`);
    expect(prev).toBeLessThanOrEqual(curr);
  }
}

function assertPrecomputedIndexes(layout: ReturnType<typeof buildLayoutGraph>): void {
  for (const element of layout.elements) {
    expect(layout.snapshotHotSignalsByElementKey.has(element.key)).toBe(true);

    const scope = layout.cssScopeBySolidFile.get(element.solidFile) ?? [];
    if (scope.length === 0 || element.tagName === null) continue;

    const candidates = layout.selectorCandidatesByElementKey.get(element.key);
    expect(candidates).toBeDefined();
    if (!candidates) continue;
    assertSorted(candidates);
  }

  for (const [parent, children] of layout.childrenByParentNode) {
    if (children.length < 2) continue;
    expect(layout.contextByParentNode.has(parent)).toBe(true);
    const stats = layout.cohortStatsByParentNode.get(parent);
    expect(stats).toBeDefined();
    expect(stats?.factSummary).toBeDefined();
    expect(stats?.provenance).toBeDefined();
  }
}

describe("layout precomputed indexes", () => {
  it("builds selector, context, and cohort indexes for scoped file", () => {
    const solid = buildSolidGraph(parseCode(
      `
        import "./layout.css";

        export function Row() {
          return (
            <div class="row" data-kind="layout">
              <span class="icon">.</span>
              <span class="label">Label</span>
              <input type="checkbox" />
            </div>
          );
        }
      `,
      "/project/App.tsx",
    ));

    const css = buildCSSGraph({
      files: [
        {
          path: "/project/layout.css",
          content: `
            .row { display: flex; align-items: flex-start; }
            .row > .icon { line-height: 12px; transform: translateY(-2px); }
            .row > .label { line-height: 20px; }
            .row > input[type="checkbox"] { line-height: 12px; vertical-align: baseline; }
          `,
        },
      ],
    });

    const layout = buildLayoutGraph([solid], css);
    assertPrecomputedIndexes(layout);
  });

  it("builds independent indexes per scoped solid file", () => {
    const first = buildSolidGraph(parseCode(
      `
        import "./a.css";

        export function A() {
          return (
            <section class="row a">
              <span class="icon">.</span>
              <span class="label">A</span>
            </section>
          );
        }
      `,
      "/project/a.tsx",
    ));

    const second = buildSolidGraph(parseCode(
      `
        import "./b.css";

        export function B() {
          return (
            <section class="row b">
              <span class="icon">.</span>
              <span class="label">B</span>
            </section>
          );
        }
      `,
      "/project/b.tsx",
    ));

    const css = buildCSSGraph({
      files: [
        {
          path: "/project/a.css",
          content: `.a > .icon { line-height: 12px; } .a > .label { line-height: 20px; }`,
        },
        {
          path: "/project/b.css",
          content: `.b > .icon { line-height: 12px; } .b > .label { line-height: 20px; }`,
        },
      ],
    });

    const layout = buildLayoutGraph([first, second], css);
    assertPrecomputedIndexes(layout);
  });
});
