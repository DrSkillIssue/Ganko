import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { SolidPlugin, CSSPlugin } from "../../src";
import { analyzeCrossFileInput } from "../../src/cross-file";
import { buildGraph, parseCode, at } from "../solid/test-utils";
import { buildGraph as buildCSSGraph, buildGraphMultiple as buildCSSGraphMultiple } from "../css/test-utils";
import type { Diagnostic } from "../../src/diagnostic";
import { createStaticValidator, detectTailwindEntry } from "../../src/css/tailwind";
import type { TailwindValidator } from "../../src/css/tailwind";
import { buildLayoutGraph } from "../../src/cross-file";

describe("Integration: Both Solid and CSS plugins", () => {
  describe("plugin properties", () => {
    it("both plugins have distinct kinds", () => {
      expect(SolidPlugin.kind).toBe("solid");
      expect(CSSPlugin.kind).toBe("css");
      expect(SolidPlugin.kind).not.toBe(CSSPlugin.kind);
    });

    it("plugins have non-overlapping extensions", () => {
      const solidExts = SolidPlugin.extensions;
      const cssExts = CSSPlugin.extensions;
      
      for (const ext of solidExts) {
        expect(cssExts).not.toContain(ext);
      }
      for (const ext of cssExts) {
        expect(solidExts).not.toContain(ext);
      }
    });

    it("solid plugin has typescript extensions", () => {
      expect(SolidPlugin.extensions).toContain(".ts");
      expect(SolidPlugin.extensions).toContain(".tsx");
      expect(SolidPlugin.extensions).toContain(".js");
      expect(SolidPlugin.extensions).toContain(".jsx");
    });

    it("css plugin has stylesheet extensions", () => {
      expect(CSSPlugin.extensions).toContain(".css");
      expect(CSSPlugin.extensions).toContain(".scss");
      expect(CSSPlugin.extensions).toContain(".sass");
      expect(CSSPlugin.extensions).toContain(".less");
    });
  });

  describe("both graphs can be built", () => {
    it("builds solid graph", () => {
      const graph = buildGraph(`
        import { createSignal } from "solid-js";
        function App() {
          const [count] = createSignal(0);
          return <div>{count()}</div>;
        }
      `);

      expect(graph.kind).toBe("solid");
      expect(graph.functions.length).toBeGreaterThan(0);
      expect(graph.jsxElements.length).toBeGreaterThan(0);
    });

    it("builds css graph", () => {
      const graph = buildCSSGraph(`
        :root { --primary: blue; }
        .button { color: var(--primary); }
      `);

      expect(graph.kind).toBe("css");
      expect(graph.variables.length).toBe(1);
      expect(graph.variableRefs.length).toBe(1);
    });

    it("graphs are independent", () => {
      const solidGraph = buildGraph(`const x = 1;`);
      const cssGraph = buildCSSGraph(`.x { color: red; }`);

      expect(solidGraph.kind).toBe("solid");
      expect(cssGraph.kind).toBe("css");
    });
  });

  describe("layout graph import scoping", () => {
    it("maps selectors only from imported stylesheet scope", () => {
      const solidGraph = buildGraph(
        `
          import "./table.css";

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
        "/project/layout/App.tsx",
      );

      const cssGraph = buildCSSGraphMultiple([
        {
          path: "/project/layout/table.css",
          content: `input[type="checkbox"] { line-height: 12px; }`,
        },
        {
          path: "/project/layout/unrelated.css",
          content: `input[type="checkbox"] { transform: translateY(-3px); }`,
        },
      ]);

      const layout = buildLayoutGraph([solidGraph], cssGraph);
      const checkbox = layout.elements.find((element) => element.tag === "input");

      expect(checkbox).toBeDefined();
      if (!checkbox) {
        throw new Error("Expected checkbox element in layout graph");
      }

      const edges = layout.appliesByNode.get(checkbox) ?? [];
      const cssFiles = new Set<string>();

      for (const edge of edges) {
        const selector = layout.selectorsById.get(edge.selectorId);
        if (!selector) continue;
        cssFiles.add(selector.rule.file.path);
      }

      expect(cssFiles.has("/project/layout/table.css")).toBe(true);
      expect(cssFiles.has("/project/layout/unrelated.css")).toBe(false);
    });

    it("collects static class tokens from class and classList", () => {
      const solidGraph = buildGraph(
        `
          import "./table.css";

          export function Table(cond: boolean) {
            return (
              <table>
                <tbody>
                  <tr>
                    <td class="class-token" classList={{ "list-token": cond }}><input type="checkbox" /></td>
                    <td>System</td>
                  </tr>
                </tbody>
              </table>
            );
          }
        `,
        "/project/layout/App.tsx",
      );

      const cssGraph = buildCSSGraph(
        `
          .class-token { }
          .list-token { }
        `,
        "/project/layout/table.css",
      );

      const layout = buildLayoutGraph([solidGraph], cssGraph);
      const firstCell = layout.elements.find((element) =>
        element.tag === "td" && element.classTokens.includes("class-token"),
      );

      expect(firstCell).toBeDefined();
      if (!firstCell) {
        throw new Error("Expected first table cell node");
      }

      expect(firstCell.classTokens).toContain("class-token");
      expect(firstCell.classTokens).toContain("list-token");
    });

    it("composes member component host semantics through transparent wrappers", () => {
      const appFile = "/project/app/row.tsx";
      const uiFile = "/project/ui/data-table.tsx";

      const appGraph = buildGraph(
        `
          import { For, Show } from "solid-js";
          import { DataTable } from "../ui/data-table";
          import "./layout.css";

          export function TableRow() {
            return (
              <table>
                <tbody>
                  <DataTable.Row>
                    <Show when={true}>
                      <DataTable.Cell>
                        <input type="checkbox" />
                      </DataTable.Cell>
                    </Show>
                    <For each={[1]}>
                      {() => <DataTable.Cell>System</DataTable.Cell>}
                    </For>
                  </DataTable.Row>
                </tbody>
              </table>
            );
          }
        `,
        appFile,
      );

      const uiGraph = buildGraph(
        `
          function DataTableRoot(props: { children?: unknown }) {
            return <table>{props.children}</table>;
          }

          function DataTableRow(props: { children?: unknown }) {
            return <tr data-slot="data-table-row">{props.children}</tr>;
          }

          function DataTableCell(props: { children?: unknown }) {
            return <td data-slot="data-table-cell">{props.children}</td>;
          }

          export const DataTable = Object.assign(DataTableRoot, {
            Row: DataTableRow,
            Cell: DataTableCell,
          });
        `,
        uiFile,
      );

      const cssGraph = buildCSSGraph(
        `
          [data-slot="data-table-row"] > [data-slot="data-table-cell"] { line-height: 20px; }
          [data-slot="data-table-row"] > [data-slot="data-table-cell"] input[type="checkbox"] {
            line-height: 12px;
            transform: translateY(-2px);
          }
        `,
        "/project/app/layout.css",
      );

      const layout = buildLayoutGraph([appGraph, uiGraph], cssGraph);
      const row = layout.elements.find((element) =>
        element.solidFile === appFile
        && element.tagName === "tr"
        && element.attributes.get("data-slot") === "data-table-row",
      );

      expect(row).toBeDefined();
      if (!row) {
        throw new Error("Expected composed row host element");
      }

      const children = layout.childrenByParentNode.get(row) ?? [];
      const cells = children.filter((child) => child.tagName === "td");
      expect(cells).toHaveLength(2);

      const checkbox = layout.elements.find((element) =>
        element.solidFile === appFile
        && element.tagName === "input"
        && element.attributes.get("type") === "checkbox",
      );

      expect(checkbox).toBeDefined();
      if (!checkbox) {
        throw new Error("Expected checkbox element in composed row");
      }

      const edges = layout.appliesByNode.get(checkbox) ?? [];
      const selectorRaws: string[] = [];
      for (const edge of edges) {
        const selector = layout.selectorsById.get(edge.selectorId);
        if (!selector) continue;
        selectorRaws.push(selector.raw);
      }

      expect(
        selectorRaws.some((raw) =>
          raw.includes("[data-slot=\"data-table-row\"]")
          && raw.includes("[data-slot=\"data-table-cell\"]")
          && raw.includes("input[type=\"checkbox\"]"),
        ),
      ).toBe(true);
    });

    it("applies package side-effect css import scope across files", () => {
      const root = mkdtempSync(join(tmpdir(), "ganko-layout-"));

      try {
        const appPackage = join(root, "packages", "app");
        const appSrc = join(appPackage, "src");
        const appComponents = join(appSrc, "components");
        const uiPackage = join(root, "packages", "ui");
        const uiStyles = join(uiPackage, "src", "styles");

        mkdirSync(appComponents, { recursive: true });
        mkdirSync(uiStyles, { recursive: true });

        writeFileSync(join(appPackage, "package.json"), JSON.stringify({ name: "@web/app" }));
        writeFileSync(
          join(uiPackage, "package.json"),
          JSON.stringify({
            name: "@web/ui",
            exports: {
              "./styles/tailwind": "./src/styles/tailwind.css",
            },
          }),
        );

        const appFile = join(appSrc, "app.tsx");
        const tableFile = join(appComponents, "ip-rule-table.tsx");
        const tailwindPath = join(uiStyles, "tailwind.css");

        const appGraph = buildGraph(
          `
            import "@web/ui/styles/tailwind";

            export function App() {
              return <div />;
            }
          `,
          appFile,
        );
        const tableGraph = buildGraph(
          `
            export function TableRow() {
              return (
                <div class="row">
                  <span class="icon">.</span>
                  <span class="label">Label</span>
                </div>
              );
            }
          `,
          tableFile,
        );

        const cssGraph = buildCSSGraphMultiple([
          {
            path: tailwindPath,
            content: `
              .row { display: flex; align-items: flex-start; }
              .icon { line-height: 12px; transform: translateY(-2px); }
              .label { line-height: 20px; }
            `,
          },
        ]);

        const layout = buildLayoutGraph([appGraph, tableGraph], cssGraph);
        const scope = layout.cssScopeBySolidFile.get(tableFile) ?? [];

        expect(scope).toContain(resolve(tailwindPath));
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("emits sibling outlier for composed table row with unresolved line-height", () => {
      const appGraph = parseCode(
        `
          import { DataTable } from "../ui/data-table";
          import "./layout.css";

          export function TableRow() {
            return (
              <table>
                <tbody>
                  <DataTable.Row>
                    <DataTable.Cell>
                      <input type="checkbox" />
                    </DataTable.Cell>
                    <DataTable.Cell>System</DataTable.Cell>
                  </DataTable.Row>
                </tbody>
              </table>
            );
          }
        `,
        "/project/app/row.tsx",
      );

      const uiGraph = parseCode(
        `
          function DataTableRoot(props: { children?: unknown }) {
            return <table>{props.children}</table>;
          }

          function DataTableRow(props: { children?: unknown }) {
            return <tr data-slot="data-table-row">{props.children}</tr>;
          }

          function DataTableCell(props: { children?: unknown }) {
            return <td data-slot="data-table-cell">{props.children}</td>;
          }

          export const DataTable = Object.assign(DataTableRoot, {
            Row: DataTableRow,
            Cell: DataTableCell,
          });
        `,
        "/project/ui/data-table.tsx",
      );

      const cssInput = {
        files: [{
          path: "/project/app/layout.css",
          content: `
            :root { --row-line-height: 1.4; }
            [data-slot="data-table-row"] > [data-slot="data-table-cell"] {
              line-height: var(--row-line-height);
              vertical-align: middle;
            }
            [data-slot="data-table-row"] > [data-slot="data-table-cell"] input[type="checkbox"] {
              line-height: var(--row-line-height);
              vertical-align: baseline;
              transform: translateY(-2px);
            }
          `,
        }],
      };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: [appGraph, uiGraph], css: cssInput }, (d) => diagnostics.push(d));
      const outliers = diagnostics.filter((d) => d.rule === "css-layout-sibling-alignment-outlier");

      expect(outliers.length).toBeGreaterThan(0);
    });
  });

  describe("cross-plugin rules via CrossFilePlugin", () => {
    it("jsx-no-undefined-css-class detects undefined class", () => {
      const solidInput = parseCode(`
        function App() {
          return <div class="button">Hello</div>;
        }
      `);
      const cssInput = {
        files: [{ path: "styles.css", content: ".container { color: red; }" }],
      };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));
      const undefinedOnly = diagnostics.filter((d) => d.rule === "jsx-no-undefined-css-class");
      
      expect(undefinedOnly).toHaveLength(1);
      expect(at(undefinedOnly, 0).messageId).toBe("undefinedClass");
    });

    it("jsx-no-undefined-css-class passes for defined class", () => {
      const solidInput = parseCode(`
        function App() {
          return <div class="button">Hello</div>;
        }
      `);
      const cssInput = {
        files: [{ path: "styles.css", content: ".button { color: red; }" }],
      };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));
      const undefinedOnly = diagnostics.filter((d) => d.rule === "jsx-no-undefined-css-class");
      
      expect(undefinedOnly).toHaveLength(0);
    });

    it("jsx-no-undefined-css-class accepts class expression literal", () => {
      const solidInput = parseCode(`
        function App() {
          return <div class={"defined"}>Hello</div>;
        }
      `);
      const cssInput = {
        files: [{ path: "styles.css", content: ".defined { }" }],
      };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));
      const undefinedOnly = diagnostics.filter((d) => d.rule === "jsx-no-undefined-css-class");

      expect(undefinedOnly).toHaveLength(0);
    });

    it("jsx-no-undefined-css-class handles multiple classes", () => {
      const solidInput = parseCode(`
        function App() {
          return <div class="btn secondary primary">Hello</div>;
        }
      `);
      const cssInput = {
        files: [{ path: "styles.css", content: ".btn { } .primary { }" }],
      };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));
      const undefinedOnly = diagnostics.filter((d) => d.rule === "jsx-no-undefined-css-class");
      
      // "secondary" is not defined
      expect(undefinedOnly).toHaveLength(1);
    });

    it("jsx-no-undefined-css-class reports static classList key after spread", () => {
      const solidInput = parseCode(`
        function App(rest: Record<string, boolean>, cond: boolean) {
          return <div classList={{ ...rest, missing: cond }}>Hello</div>;
        }
      `);
      const cssInput = {
        files: [{ path: "styles.css", content: ".defined { }" }],
      };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));
      const undefinedOnly = diagnostics.filter((d) => d.rule === "jsx-no-undefined-css-class");

      expect(undefinedOnly).toHaveLength(1);
      expect(at(undefinedOnly, 0).message).toContain("missing");
    });

    it("jsx-no-undefined-css-class accepts classes defined in inline <style> elements", () => {
      const solidInput = parseCode(`
        function Icon() {
          return (
            <svg viewBox="0 0 14 14">
              <style>{\`
                .check-path { stroke-dasharray: 12; }
                .icon-bounce { animation: bounce 0.3s; }
              \`}</style>
              <path class="check-path" d="M3 7L6 9L10 4" />
              <circle class="icon-bounce" cx="7" cy="7" r="6" />
            </svg>
          );
        }
      `);
      const cssInput = {
        files: [{ path: "styles.css", content: "svg { fill: none; }" }],
      };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));
      const undefinedOnly = diagnostics.filter((d) => d.rule === "jsx-no-undefined-css-class");

      expect(undefinedOnly).toHaveLength(0);
    });

    it("jsx-no-undefined-css-class still reports classes NOT in inline <style>", () => {
      const solidInput = parseCode(`
        function Icon() {
          return (
            <svg viewBox="0 0 14 14">
              <style>{\`.defined-class { opacity: 1; }\`}</style>
              <path class="undefined-class" d="M0 0" />
            </svg>
          );
        }
      `);
      const cssInput = {
        files: [{ path: "styles.css", content: "svg { fill: none; }" }],
      };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));
      const undefinedOnly = diagnostics.filter((d) => d.rule === "jsx-no-undefined-css-class");

      expect(undefinedOnly).toHaveLength(1);
      expect(at(undefinedOnly, 0).message).toContain("undefined-class");
    });

    it("css-no-unreferenced-component-class detects unreferenced simple class selectors", () => {
      const solidInput = parseCode(`
        function App() {
          return <div class="used">Hello</div>;
        }
      `);
      const cssInput = {
        files: [{ path: "styles.css", content: ".used { } .unused { }" }],
      };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));

      const unreferenced = diagnostics.filter((d) => d.rule === "css-no-unreferenced-component-class");
      expect(unreferenced).toHaveLength(1);
      expect(at(unreferenced, 0).message).toContain("unused");
    });

    it("css-no-unreferenced-component-class skips dynamic solid file but still checks css", () => {
      const solidInput = parseCode(`
        function App() {
          const k = "used";
          return <div class={k}>Hello</div>;
        }
      `);
      const cssInput = {
        files: [{ path: "styles.css", content: ".used { } .unused { }" }],
      };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));

      const unreferenced = diagnostics.filter((d) => d.rule === "css-no-unreferenced-component-class");
      expect(unreferenced).toHaveLength(2);
    });

    it("css-no-unreferenced-component-class counts static classList keys as references", () => {
      const solidInput = parseCode(`
        function App() {
          return <div classList={{ used: true }}>Hello</div>;
        }
      `);
      const cssInput = {
        files: [{ path: "styles.css", content: ".used { } .unused { }" }],
      };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));

      const unreferenced = diagnostics.filter((d) => d.rule === "css-no-unreferenced-component-class");
      expect(unreferenced).toHaveLength(1);
      expect(at(unreferenced, 0).message).toContain("unused");
    });

    it("css-no-unreferenced-component-class counts static classList keys after spread", () => {
      const solidInput = parseCode(`
        function App(rest: Record<string, boolean>, cond: boolean) {
          return <div classList={{ ...rest, used: cond }}>Hello</div>;
        }
      `);
      const cssInput = {
        files: [{ path: "styles.css", content: ".used { } .unused { }" }],
      };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));

      const unreferenced = diagnostics.filter((d) => d.rule === "css-no-unreferenced-component-class");
      expect(unreferenced).toHaveLength(1);
      expect(at(unreferenced, 0).message).toContain("unused");
    });

    it("jsx-classlist-static-keys allows computed keys", () => {
      const solidInput = parseCode(`
        function App() {
          const k = "active";
          return <div classList={{ [k]: true }}>Hello</div>;
        }
      `);
      const cssInput = { files: [{ path: "styles.css", content: ".active { }" }] };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));

      const relevant = diagnostics.filter((d) => d.rule === "jsx-classlist-static-keys");
      expect(relevant).toHaveLength(0);
    });

    it("jsx-classlist-static-keys allows classList spread forwarding", () => {
      const solidInput = parseCode(`
        import { splitProps } from "solid-js";
        function Button(props) {
          const [local, rest] = splitProps(props, ["class", "classList"]);
          return <div classList={{ ...(local.classList ?? {}), [local.class ?? ""]: !!local.class }}>Hello</div>;
        }
      `);
      const cssInput = { files: [{ path: "styles.css", content: ".btn { }" }] };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));

      const relevant = diagnostics.filter((d) => d.rule === "jsx-classlist-static-keys");
      // Both spread and computed prop-forwarding keys are allowed
      expect(relevant).toHaveLength(0);
    });

    it("jsx-classlist-no-constant-literals reports constant booleans", () => {
      const solidInput = parseCode(`
        function App() {
          return <div classList={{ active: true }}>Hello</div>;
        }
      `);
      const cssInput = { files: [{ path: "styles.css", content: ".active { }" }] };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));

      const relevant = diagnostics.filter((d) => d.rule === "jsx-classlist-no-constant-literals");
      expect(relevant).toHaveLength(1);
    });

    it("jsx-no-duplicate-class-token-class-classlist reports duplicate token", () => {
      const solidInput = parseCode(`
        function App() {
          return <div class="btn" classList={{ btn: cond }}>Hello</div>;
        }
      `);
      const cssInput = { files: [{ path: "styles.css", content: ".btn { }" }] };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));

      const relevant = diagnostics.filter((d) => d.rule === "jsx-no-duplicate-class-token-class-classlist");
      expect(relevant).toHaveLength(1);
    });

    it("jsx-style-kebab-case-keys reports camelCase keys", () => {
      const solidInput = parseCode(`
        function App() {
          return <div style={{ backgroundColor: "red" }}>Hello</div>;
        }
      `);
      const cssInput = { files: [{ path: "styles.css", content: ".x { }" }] };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));

      const relevant = diagnostics.filter((d) => d.rule === "jsx-style-kebab-case-keys");
      expect(relevant).toHaveLength(1);
    });

    it("jsx-classlist-boolean-values reports non-boolean value", () => {
      const solidInput = parseCode(`
        function App() {
          return <div classList={{ active: "yes" }}>Hello</div>;
        }
      `);
      const cssInput = { files: [{ path: "styles.css", content: ".active {}" }] };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));

      const relevant = diagnostics.filter((d) => d.rule === "jsx-classlist-boolean-values");
      expect(relevant).toHaveLength(1);
    });

    it("jsx-classlist-boolean-values reports post-spread non-boolean value", () => {
      const solidInput = parseCode(`
        function App(rest: Record<string, boolean>) {
          return <div classList={{ ...rest, active: "yes" }}>Hello</div>;
        }
      `);
      const cssInput = { files: [{ path: "styles.css", content: ".active {}" }] };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));

      const relevant = diagnostics.filter((d) => d.rule === "jsx-classlist-boolean-values");
      expect(relevant).toHaveLength(1);
    });

    it("jsx-classlist-boolean-values accepts typed boolean expressions", () => {
      const solidInput = parseCode(`
        function App(props: { open: boolean }) {
          const ready = true;
          return <div classList={{ active: props.open && ready }}>Hello</div>;
        }
      `);
      const cssInput = { files: [{ path: "styles.css", content: ".active {}" }] };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));

      const relevant = diagnostics.filter((d) => d.rule === "jsx-classlist-boolean-values");
      expect(relevant).toHaveLength(0);
    });

    it("jsx-classlist-boolean-values reports arithmetic expressions", () => {
      const solidInput = parseCode(`
        function App() {
          const count = 1;
          return <div classList={{ active: count + 1 }}>Hello</div>;
        }
      `);
      const cssInput = { files: [{ path: "styles.css", content: ".active {}" }] };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));

      const relevant = diagnostics.filter((d) => d.rule === "jsx-classlist-boolean-values");
      expect(relevant).toHaveLength(1);
    });

    it("jsx-classlist-boolean-values reports logical expression with string branch", () => {
      const solidInput = parseCode(`
        function App(cond: boolean) {
          return <div classList={{ active: cond && "x" }}>Hello</div>;
        }
      `);
      const cssInput = { files: [{ path: "styles.css", content: ".active {}" }] };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));

      const relevant = diagnostics.filter((d) => d.rule === "jsx-classlist-boolean-values");
      expect(relevant).toHaveLength(1);
    });

    it("jsx-style-no-function-values reports function style value", () => {
      const solidInput = parseCode(`
        function App() {
          return <div style={{ color: () => "red" }}>Hello</div>;
        }
      `);
      const cssInput = { files: [{ path: "styles.css", content: ".x {}" }] };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));

      const relevant = diagnostics.filter((d) => d.rule === "jsx-style-no-function-values");
      expect(relevant).toHaveLength(1);
    });

    it("jsx-style-kebab-case-keys reports post-spread camelCase key", () => {
      const solidInput = parseCode(`
        function App(s: Record<string, string>) {
          return <div style={{ ...s, backgroundColor: "red" }}>Hello</div>;
        }
      `);
      const cssInput = { files: [{ path: "styles.css", content: ".x {}" }] };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));

      const relevant = diagnostics.filter((d) => d.rule === "jsx-style-kebab-case-keys");
      expect(relevant).toHaveLength(1);
    });

    it("jsx-classlist-no-accessor-reference reports accessor reference", () => {
      const solidInput = parseCode(`
        import { createSignal } from "solid-js";
        function App() {
          const [active] = createSignal(false);
          return <div classList={{ active }}>Hello</div>;
        }
      `);
      const cssInput = { files: [{ path: "styles.css", content: ".active {}" }] };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));

      const relevant = diagnostics.filter((d) => d.rule === "jsx-classlist-no-accessor-reference");
      expect(relevant).toHaveLength(1);
    });

    it("jsx-style-no-unused-custom-prop reports unused inline custom property", () => {
      const solidInput = parseCode(`
        function App() {
          return <div style={{ "--card-gap": "8px" }}>Hello</div>;
        }
      `);
      const cssInput = { files: [{ path: "styles.css", content: ".x { color: red; }" }] };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));

      const relevant = diagnostics.filter((d) => d.rule === "jsx-style-no-unused-custom-prop");
      expect(relevant).toHaveLength(1);
    });

    it("cross-file rules run once over Solid corpus", () => {
      const solidA = parseCode(`
        function A() {
          return <div class="used">Hello</div>;
        }
      `, "a.tsx");
      const solidB = parseCode(`
        function B() {
          return <div class="other">Hello</div>;
        }
      `, "b.tsx");
      const cssInput = {
        files: [{ path: "styles.css", content: ".used {} .other {} .unused {}" }],
      };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: [solidA, solidB], css: cssInput }, (d) => diagnostics.push(d));

      const unreferenced = diagnostics.filter((d) => d.rule === "css-no-unreferenced-component-class");
      expect(unreferenced).toHaveLength(1);
      expect(at(unreferenced, 0).message).toContain("unused");
    });

    it("class used in one solid file prevents unreferenced warning", () => {
      const solidA = parseCode(`
        function A() {
          return <div class="used">Hello</div>;
        }
      `, "a.tsx");
      const solidB = parseCode(`
        function B() {
          return <div class="other">Hello</div>;
        }
      `, "b.tsx");
      const cssInput = {
        files: [{ path: "styles.css", content: ".used {} .other {}" }],
      };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: [solidA, solidB], css: cssInput }, (d) => diagnostics.push(d));

      const unreferenced = diagnostics.filter((d) => d.rule === "css-no-unreferenced-component-class");
      expect(unreferenced).toHaveLength(0);
    });

    it("analyzeCrossFileInput deduplicates repeated solid inputs", () => {
      const solidInput = parseCode(`
        function App() {
          return <div class="missing">Hello</div>;
        }
      `, "app.tsx");
      const cssInput = { files: [{ path: "styles.css", content: ".defined {}" }] };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: [solidInput, solidInput], css: cssInput }, (d) => diagnostics.push(d));

      const undefinedOnly = diagnostics.filter((d) => d.rule === "jsx-no-undefined-css-class");
      expect(undefinedOnly).toHaveLength(1);
    });

    it("analyzeCrossFileInput deduplicates equivalent solid paths", () => {
      const solidA = parseCode(`
        function App() {
          return <div class="missing">Hello</div>;
        }
      `, "app.tsx");
      const solidB = parseCode(`
        function App() {
          return <div class="missing">Hello</div>;
        }
      `, "./app.tsx");
      const cssInput = { files: [{ path: "styles.css", content: ".defined {}" }] };

      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid: [solidA, solidB], css: cssInput }, (d) => diagnostics.push(d));

      const undefinedOnly = diagnostics.filter((d) => d.rule === "jsx-no-undefined-css-class");
      expect(undefinedOnly).toHaveLength(1);
    });
  });

  describe("jsx-style-policy", () => {
    const emptyCss = { files: [{ path: "empty.css", content: "" }] };

    it("reports inline font-size below minimum", () => {
      const solid = parseCode(`
        function App() {
          return <div style={{ "font-size": "10px" }}>Hello</div>;
        }
      `);
      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid, css: emptyCss }, (d) => diagnostics.push(d));
      const hits = diagnostics.filter((d) => d.rule === "jsx-style-policy");
      expect(hits).toHaveLength(1);
      expect(at(hits, 0).message).toContain("10px");
      expect(at(hits, 0).message).toContain("16px");
    });

    it("does not report inline font-size at minimum", () => {
      const solid = parseCode(`
        function App() {
          return <div style={{ "font-size": "16px" }}>Hello</div>;
        }
      `);
      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid, css: emptyCss }, (d) => diagnostics.push(d));
      const hits = diagnostics.filter((d) => d.rule === "jsx-style-policy");
      expect(hits).toHaveLength(0);
    });

    it("reports inline line-height below minimum", () => {
      const solid = parseCode(`
        function App() {
          return <div style={{ "line-height": "1.2" }}>Hello</div>;
        }
      `);
      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid, css: emptyCss }, (d) => diagnostics.push(d));
      const hits = diagnostics.filter((d) => d.rule === "jsx-style-policy" && d.message.includes("line-height"));
      expect(hits).toHaveLength(1);
      expect(at(hits, 0).message).toContain("1.5");
    });

    it("reports inline height below minimum for interactive elements", () => {
      const solid = parseCode(`
        function App() {
          return <button style={{ height: "16px" }}>Click</button>;
        }
      `);
      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid, css: emptyCss }, (d) => diagnostics.push(d));
      const hits = diagnostics.filter((d) => d.rule === "jsx-style-policy" && d.message.includes("height"));
      expect(hits).toHaveLength(1);
      expect(at(hits, 0).message).toContain("24px");
    });

    it("reports inline letter-spacing below minimum", () => {
      const solid = parseCode(`
        function App() {
          return <p style={{ "letter-spacing": "0.05em" }}>Text</p>;
        }
      `);
      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid, css: emptyCss }, (d) => diagnostics.push(d));
      const hits = diagnostics.filter((d) => d.rule === "jsx-style-policy" && d.message.includes("letter-spacing"));
      expect(hits).toHaveLength(1);
      expect(at(hits, 0).message).toContain("0.12");
    });

    it("reports inline word-spacing below minimum", () => {
      const solid = parseCode(`
        function App() {
          return <p style={{ "word-spacing": "0.08em" }}>Text</p>;
        }
      `);
      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid, css: emptyCss }, (d) => diagnostics.push(d));
      const hits = diagnostics.filter((d) => d.rule === "jsx-style-policy" && d.message.includes("word-spacing"));
      expect(hits).toHaveLength(1);
      expect(at(hits, 0).message).toContain("0.16");
    });

    it("does not report dynamic values (var expressions)", () => {
      const solid = parseCode(`
        function App() {
          const size = "12px";
          return <div style={{ "font-size": size }}>Hello</div>;
        }
      `);
      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid, css: emptyCss }, (d) => diagnostics.push(d));
      const hits = diagnostics.filter((d) => d.rule === "jsx-style-policy");
      expect(hits).toHaveLength(0);
    });

    it("handles rem values in inline styles", () => {
      const solid = parseCode(`
        function App() {
          return <div style={{ "font-size": "0.5rem" }}>Hello</div>;
        }
      `);
      const diagnostics: Diagnostic[] = [];
      analyzeCrossFileInput({ solid, css: emptyCss }, (d) => diagnostics.push(d));
      const hits = diagnostics.filter((d) => d.rule === "jsx-style-policy");
      expect(hits).toHaveLength(1);
      expect(at(hits, 0).message).toContain("8px");
    });
  });

  describe("tailwind integration", () => {
    describe("detectTailwindEntry", () => {
      it("detects @import tailwindcss", () => {
        const files = [
          { path: "styles.css", content: ".btn { color: red; }" },
          { path: "tailwind.css", content: '@import "tailwindcss/theme.css";\n@import "tailwindcss/utilities.css";' },
        ];
        const entry = detectTailwindEntry(files);
        expect(entry).not.toBeNull();
        expect(entry?.path).toBe("tailwind.css");
      });

      it("detects @theme block", () => {
        const files = [
          { path: "styles.css", content: "@theme {\n  --color-primary: red;\n}" },
        ];
        const entry = detectTailwindEntry(files);
        expect(entry).not.toBeNull();
      });

      it("returns null for non-tailwind CSS", () => {
        const files = [
          { path: "styles.css", content: ".btn { color: red; }" },
        ];
        expect(detectTailwindEntry(files)).toBeNull();
      });
    });

    describe("createStaticValidator", () => {
      const utilities = new Set(["flex", "block", "p-4", "gap-2", "bg-red-500", "text-sm"]);
      const variants = new Set(["md", "hover", "sm", "lg", "focus"]);
      const validator = createStaticValidator(utilities, variants);

      it("validates base utilities", () => {
        expect(validator.has("flex")).toBe(true);
        expect(validator.has("block")).toBe(true);
        expect(validator.has("p-4")).toBe(true);
      });

      it("rejects unknown utilities", () => {
        expect(validator.has("nonsense")).toBe(false);
        expect(validator.has("my-custom-class")).toBe(false);
      });

      it("validates variant-prefixed utilities", () => {
        expect(validator.has("md:flex")).toBe(true);
        expect(validator.has("hover:bg-red-500")).toBe(true);
        expect(validator.has("sm:p-4")).toBe(true);
      });

      it("rejects unknown variants", () => {
        expect(validator.has("fake:flex")).toBe(false);
      });

      it("rejects valid variant with unknown utility", () => {
        expect(validator.has("md:nonsense")).toBe(false);
      });

      it("validates compound variants", () => {
        expect(validator.has("sm:hover:flex")).toBe(true);
        expect(validator.has("md:focus:text-sm")).toBe(true);
      });

      it("rejects compound with unknown inner variant", () => {
        expect(validator.has("md:fake:flex")).toBe(false);
      });

      it("caches results", () => {
        expect(validator.has("flex")).toBe(true);
        expect(validator.has("flex")).toBe(true);
        expect(validator.has("nonsense")).toBe(false);
        expect(validator.has("nonsense")).toBe(false);
      });
    });

    describe("jsx-no-undefined-css-class with tailwind", () => {
      function createMockValidator(classes: string[]): TailwindValidator {
        const set = new Set(classes);
        return {
          has: (name: string) => set.has(name),
          resolve: () => null,
        };
      }

      it("does not report tailwind utilities as undefined", () => {
        const solidInput = parseCode(`
          function App() {
            return <div class="flex p-4 gap-2">Hello</div>;
          }
        `);
        const tailwind = createMockValidator(["flex", "p-4", "gap-2"]);
        const cssInput = {
          files: [{ path: "styles.css", content: "" }],
          tailwind,
        };

        const diagnostics: Diagnostic[] = [];
        analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));
        const undefinedOnly = diagnostics.filter((d) => d.rule === "jsx-no-undefined-css-class");

        expect(undefinedOnly).toHaveLength(0);
      });

      it("reports truly undefined classes even with tailwind", () => {
        const solidInput = parseCode(`
          function App() {
            return <div class="flex nonexistent-class">Hello</div>;
          }
        `);
        const tailwind = createMockValidator(["flex"]);
        const cssInput = {
          files: [{ path: "styles.css", content: "" }],
          tailwind,
        };

        const diagnostics: Diagnostic[] = [];
        analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));
        const undefinedOnly = diagnostics.filter((d) => d.rule === "jsx-no-undefined-css-class");

        expect(undefinedOnly).toHaveLength(1);
        expect(at(undefinedOnly, 0).message).toContain("nonexistent-class");
      });

      it("checks both classNameIndex and tailwind validator", () => {
        const solidInput = parseCode(`
          function App() {
            return <div class="css-defined tw-utility">Hello</div>;
          }
        `);
        const tailwind = createMockValidator(["tw-utility"]);
        const cssInput = {
          files: [{ path: "styles.css", content: ".css-defined { color: red; }" }],
          tailwind,
        };

        const diagnostics: Diagnostic[] = [];
        analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));
        const undefinedOnly = diagnostics.filter((d) => d.rule === "jsx-no-undefined-css-class");

        expect(undefinedOnly).toHaveLength(0);
      });

      it("works without tailwind (backward compatible)", () => {
        const solidInput = parseCode(`
          function App() {
            return <div class="undefined-class">Hello</div>;
          }
        `);
        const cssInput = {
          files: [{ path: "styles.css", content: ".defined { }" }],
        };

        const diagnostics: Diagnostic[] = [];
        analyzeCrossFileInput({ solid: solidInput, css: cssInput }, (d) => diagnostics.push(d));
        const undefinedOnly = diagnostics.filter((d) => d.rule === "jsx-no-undefined-css-class");

        expect(undefinedOnly).toHaveLength(1);
      });
    });
  });
});
