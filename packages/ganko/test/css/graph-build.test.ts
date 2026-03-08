import { describe, it, expect } from "vitest";
import { CSSPlugin } from "../../src";
import { buildGraph, buildGraphMultiple } from "./test-utils";
import { hasParseErrors } from "../../src/css/queries";
import { hasFlag, REF_IS_RESOLVED } from "../../src/css/entities";

describe("CSSPlugin.build() integration", () => {
  describe("plugin properties", () => {
    it("has css kind", () => {
      expect(CSSPlugin.kind).toBe("css");
    });

    it("supports expected extensions", () => {
      expect(CSSPlugin.extensions).toContain(".css");
      expect(CSSPlugin.extensions).toContain(".scss");
      expect(CSSPlugin.extensions).toContain(".sass");
      expect(CSSPlugin.extensions).toContain(".less");
    });
  });

  describe("basic parsing", () => {
    it("parses simple CSS", () => {
      const graph = buildGraph(`
        .button {
          color: red;
        }
      `);

      expect(graph.kind).toBe("css");
      expect(graph.files.length).toBe(1);
      expect(graph.rules.length).toBe(1);
      expect(graph.declarations.length).toBe(1);
    });

    it("parses multiple rules", () => {
      const graph = buildGraph(`
        .button { color: red; }
        .card { background: white; }
        #header { padding: 10px; }
      `);

      expect(graph.rules.length).toBe(3);
      expect(graph.declarations.length).toBe(3);
    });

    it("parses selectors", () => {
      const graph = buildGraph(`
        .button, .btn { color: red; }
      `);

      expect(graph.rules.length).toBe(1);
      expect(graph.selectors.length).toBe(2);
    });

    it("builds selector anchors for checkbox and table-cell targets", () => {
      const graph = buildGraph(`
        .row td:first-child input[type="checkbox"] { vertical-align: baseline; }
        td.checkbox-cell { vertical-align: top; }
      `);

      const checkboxSelector = graph.selectors.find((selector) =>
        selector.raw.includes('input[type="checkbox"]'),
      );
      const tableCellSelector = graph.selectors.find((selector) => selector.raw === "td.checkbox-cell");

      expect(checkboxSelector?.anchor.targetsCheckbox).toBe(true);
      expect(tableCellSelector?.anchor.targetsTableCell).toBe(true);
      expect(graph.selectorsTargetingCheckbox.length).toBeGreaterThan(0);
      expect(graph.selectorsTargetingTableCell.length).toBeGreaterThan(0);
    });

    it("stores deterministic source offsets for files, rules, and declarations", () => {
      const graph = buildGraph(`
        .a {
          line-height: 20px;
          transform: translateY(-1px);
        }
      `);

      const file = graph.files[0];
      if (!file) throw new Error("Expected file at index 0");
      const rule = graph.rules[0];
      if (!rule) throw new Error("Expected rule at index 0");
      const declaration = graph.declarations[0];
      if (!declaration) throw new Error("Expected declaration at index 0");

      expect(file.lineStartOffsets.length).toBe(file.lineCount);
      expect(rule.startOffset).toBeGreaterThanOrEqual(0);
      expect(rule.endOffset).toBeGreaterThan(rule.startOffset);
      expect(rule.blockEndOffset).toBeGreaterThan(rule.blockStartOffset);
      expect(declaration.startOffset).toBeGreaterThanOrEqual(0);
      expect(declaration.endOffset).toBeGreaterThan(declaration.startOffset);
    });
  });

  describe("CSS variables", () => {
    it("parses CSS custom properties", () => {
      const graph = buildGraph(`
        :root {
          --primary: blue;
          --secondary: green;
        }
      `);

      expect(graph.variables.length).toBe(2);
      expect(graph.globalVariables.length).toBe(2);
    });

    it("links var() references", () => {
      const graph = buildGraph(`
        :root {
          --primary: blue;
        }
        .button {
          color: var(--primary);
        }
      `);

      expect(graph.variables.length).toBe(1);
      expect(graph.variableRefs.length).toBe(1);
      const ref0 = graph.variableRefs[0];
      if (!ref0) throw new Error("Expected variableRef at index 0");
      expect(hasFlag(ref0._flags, REF_IS_RESOLVED)).toBe(true);
      expect(ref0.resolvedVariable?.name).toBe("--primary");
    });

    it("detects unresolved references", () => {
      const graph = buildGraph(`
        .button {
          color: var(--undefined-var);
        }
      `);

      expect(graph.variableRefs.length).toBe(1);
      const ref0 = graph.variableRefs[0];
      if (!ref0) throw new Error("Expected variableRef at index 0");
      expect(hasFlag(ref0._flags, REF_IS_RESOLVED)).toBe(false);
      expect(graph.unresolvedRefs.length).toBe(1);
    });

    it("tracks unused variables", () => {
      const graph = buildGraph(`
        :root {
          --used: blue;
          --unused: red;
        }
        .button {
          color: var(--used);
        }
      `);

      expect(graph.unusedVariables.length).toBe(1);
      const unused0 = graph.unusedVariables[0];
      if (!unused0) throw new Error("Expected unusedVariable at index 0");
      expect(unused0.name).toBe("--unused");
    });
  });

  describe("at-rules", () => {
    it("parses media queries", () => {
      const graph = buildGraph(`
        @media (min-width: 768px) {
          .button { color: red; }
        }
      `);

      expect(graph.mediaQueries.length).toBe(1);
    });

    it("parses keyframes", () => {
      const graph = buildGraph(`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `);

      expect(graph.keyframes.length).toBe(1);
    });

    it("parses layers", () => {
      const graph = buildGraph(`
        @layer base {
          .button { color: red; }
        }
      `);

      expect(graph.layers.length).toBe(1);
    });

    it("detects unused keyframes", () => {
      const graph = buildGraph(`
        @keyframes unused {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .button { color: red; }
      `);

      expect(graph.unusedKeyframes.length).toBe(1);
    });

    it("detects used keyframes", () => {
      const graph = buildGraph(`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .button { animation: fadeIn 1s; }
      `);

      expect(graph.unusedKeyframes.length).toBe(0);
    });
  });

  describe("multiple files", () => {
    it("parses multiple CSS files", () => {
      const graph = buildGraphMultiple([
        { path: "base.css", content: ":root { --primary: blue; }" },
        { path: "theme.css", content: ".button { color: var(--primary); }" },
      ]);

      expect(graph.files.length).toBe(2);
      expect(graph.variables.length).toBe(1);
      expect(graph.variableRefs.length).toBe(1);
      const ref0 = graph.variableRefs[0];
      if (!ref0) throw new Error("Expected variableRef at index 0");
      expect(hasFlag(ref0._flags, REF_IS_RESOLVED)).toBe(true);
    });
  });

  describe("error handling", () => {
    it("handles parse errors gracefully", () => {
      const graph = buildGraph(`
        .button { color: red
      `);

      expect(hasParseErrors(graph)).toBe(true);
      expect(graph.parseErrors.length).toBeGreaterThan(0);
    });
  });
});
