import { describe, expect, it } from "vitest";
import { buildCSSGraph } from "../../src/css/plugin";
import { buildLayoutGraph } from "../../src/cross-file";
import type { LayoutGraph } from "../../src/cross-file/layout";
import { createLayoutPerfStats } from "../../src/cross-file/layout/perf";
import { compileSelectorMatcher, selectorMatchesLayoutElement } from "../../src/cross-file/layout/selector-match";
import { canonicalPath } from "@ganko/shared";
import { buildSolidGraph } from "../../src/solid/plugin";
import { parseCode } from "../solid/test-utils";

function collectExpectedSelectorIdsByElement(
  layout: LayoutGraph,
  css: ReturnType<typeof buildCSSGraph>,
  solidFile: string,
): ReadonlyMap<string, readonly number[]> {
  const scopePaths = layout.cssScopeBySolidFile.get(solidFile) ?? [];
  const scope = new Set(scopePaths);
  const perf = createLayoutPerfStats();
  const out = new Map<string, number[]>();

  for (const element of layout.elements) {
    if (element.solidFile !== solidFile) continue;

    for (const selector of css.selectors) {
      if (!scope.has(canonicalPath(selector.rule.file.path))) continue;

      const matcher = compileSelectorMatcher(selector);
      if (matcher === null) continue;
      if (!selectorMatchesLayoutElement(matcher, element, perf)) continue;

      const ids = out.get(element.key);
      if (ids) {
        ids.push(selector.id);
        continue;
      }

      out.set(element.key, [selector.id]);
    }
  }

  for (const [key, ids] of out) {
    ids.sort((left, right) => left - right);
    out.set(key, ids);
  }

  return out;
}

function collectActualSelectorIdsByElement(layout: LayoutGraph, solidFile: string): ReadonlyMap<string, readonly number[]> {
  const out = new Map<string, number[]>();

  for (const element of layout.elements) {
    if (element.solidFile !== solidFile) continue;

    const edges = layout.appliesByElementKey.get(element.key) ?? [];
    const ids: number[] = [];
    for (const edge of edges) {
      ids.push(edge.selectorId);
    }
    ids.sort((left, right) => left - right);
    out.set(element.key, ids);
  }

  return out;
}

function assertSelectorParity(
  layout: LayoutGraph,
  css: ReturnType<typeof buildCSSGraph>,
  solidFile: string,
): void {
  const expected = collectExpectedSelectorIdsByElement(layout, css, solidFile);
  const actual = collectActualSelectorIdsByElement(layout, solidFile);

  for (const [key, actualIds] of actual) {
    const expectedIds = expected.get(key) ?? [];
    expect(actualIds).toStrictEqual(expectedIds);
  }
}

describe("layout selector dispatch parity", () => {
  it("keeps exact apply-edge parity with brute-force selector matching", () => {
    const solid = buildSolidGraph(parseCode(
      `
        import "./base.css";
        import "./components.css";

        export function Row() {
          return (
            <div class="row" data-kind="layout">
              <span id="lead" class="icon hot" data-role="glyph">.</span>
              <span class="label">Label</span>
              <input type="checkbox" data-role="glyph" />
            </div>
          );
        }
      `,
      "/project/App.tsx",
    ));

    const css = buildCSSGraph({
      files: [
        {
          path: "/project/base.css",
          content: `
            .row { display: flex; align-items: flex-start; }
            .row > .icon.hot[data-role="glyph"] { line-height: 12px; }
            .row > #lead + .label { vertical-align: middle; }
            .row > [data-role] { box-sizing: border-box; }
            .row > input[type="checkbox"] { line-height: 12px; vertical-align: baseline; }
            .row > .label:not(.muted) { line-height: 20px; }
          `,
        },
        {
          path: "/project/components.css",
          content: `
            [data-kind="layout"] > :first-child { transform: translateY(-2px); }
            [data-kind="layout"] > :nth-child(2) { white-space: normal; }
            .row > .unknown { color: red; }
          `,
        },
      ],
    });

    const layout = buildLayoutGraph([solid], css);
    assertSelectorParity(layout, css, "/project/App.tsx");
  });

  it("keeps scoped selector parity across multiple solid files", () => {
    const first = buildSolidGraph(parseCode(
      `
        import "./a.css";

        export function One() {
          return (
            <section class="row a">
              <span class="icon">.</span>
              <span class="label">A</span>
            </section>
          );
        }
      `,
      "/project/one.tsx",
    ));

    const second = buildSolidGraph(parseCode(
      `
        import "./b.css";

        export function Two() {
          return (
            <section class="row b">
              <span class="icon">.</span>
              <span class="label">B</span>
            </section>
          );
        }
      `,
      "/project/two.tsx",
    ));

    const css = buildCSSGraph({
      files: [
        {
          path: "/project/a.css",
          content: `
            .a > .icon { line-height: 12px; }
            .a > .label { line-height: 20px; }
          `,
        },
        {
          path: "/project/b.css",
          content: `
            .b > .icon { line-height: 12px; }
            .b > .label { line-height: 20px; }
          `,
        },
      ],
    });

    const layout = buildLayoutGraph([first, second], css);
    assertSelectorParity(layout, css, "/project/one.tsx");
    assertSelectorParity(layout, css, "/project/two.tsx");
  });
});
