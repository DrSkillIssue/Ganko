import { describe, it, expect } from "vitest";
import { buildGraph, at } from "../test-utils";
import { hasFlag, INCLUDE_IS_RESOLVED, FCALL_IS_RESOLVED, EXTEND_IS_RESOLVED } from "../../../src/css/entities";

describe("SCSS Phase", () => {

  describe("mixins", () => {
    it("parses mixin definitions", () => {
      const graph = buildGraph(`
        @mixin button-style {
          padding: 10px;
          border-radius: 4px;
        }
      `, "test.scss");

      expect(graph.mixins.length).toBe(1);
      expect(at(graph.mixins, 0).name).toBe("button-style");
    });

    it("parses mixin parameters", () => {
      const graph = buildGraph(`
        @mixin button($color, $size: 16px) {
          color: $color;
          font-size: $size;
        }
      `, "test.scss");

      const mixin = at(graph.mixins, 0);
      expect(mixin.parameters.length).toBe(2);
      expect(at(mixin.parameters, 0).name).toBe("$color");
      expect(at(mixin.parameters, 1).defaultValue).toBe("16px");
    });

    it("links @include to mixin", () => {
      const graph = buildGraph(`
        @mixin button-style {
          padding: 10px;
        }
        .button {
          @include button-style;
        }
      `, "test.scss");

      expect(graph.includes.length).toBe(1);
      const include0 = at(graph.includes, 0);
      expect(hasFlag(include0._flags, INCLUDE_IS_RESOLVED)).toBe(true);
      expect(include0.resolvedMixin?.name).toBe("button-style");
    });

    it("detects unused mixins", () => {
      const graph = buildGraph(`
        @mixin unused-mixin {
          padding: 10px;
        }
      `, "test.scss");

      expect(graph.unusedMixins.length).toBe(1);
      expect(at(graph.unusedMixins, 0).name).toBe("unused-mixin");
    });

    it("detects unresolved includes", () => {
      const graph = buildGraph(`
        .button {
          @include undefined-mixin;
        }
      `, "test.scss");

      expect(graph.unresolvedMixinIncludes.length).toBe(1);
    });
  });

  describe("functions", () => {
    it("parses function definitions", () => {
      const graph = buildGraph(`
        @function double($n) {
          @return $n * 2;
        }
      `, "test.scss");

      expect(graph.functions.length).toBe(1);
      expect(at(graph.functions, 0).name).toBe("double");
    });

    it("links function calls", () => {
      const graph = buildGraph(`
        @function double($n) {
          @return $n * 2;
        }
        .box {
          width: double(10px);
        }
      `, "test.scss");

      expect(graph.functionCalls.length).toBe(1);
      expect(hasFlag(at(graph.functionCalls, 0)._flags, FCALL_IS_RESOLVED)).toBe(true);
    });

    it("detects unused functions", () => {
      const graph = buildGraph(`
        @function unused($n) {
          @return $n;
        }
      `, "test.scss");

      expect(graph.unusedFunctions.length).toBe(1);
    });
  });

  describe("placeholders", () => {
    it("parses placeholder selectors", () => {
      const graph = buildGraph(`
        %button-base {
          padding: 10px;
        }
      `, "test.scss");

      expect(graph.placeholders.length).toBe(1);
      expect(at(graph.placeholders, 0).name).toBe("button-base");
    });

    it("links @extend to placeholder", () => {
      const graph = buildGraph(`
        %button-base {
          padding: 10px;
        }
        .button {
          @extend %button-base;
        }
      `, "test.scss");

      expect(graph.extends.length).toBe(1);
      const extend0 = at(graph.extends, 0);
      expect(hasFlag(extend0._flags, EXTEND_IS_RESOLVED)).toBe(true);
      expect(extend0.resolvedPlaceholder?.name).toBe("button-base");
    });

    it("detects unused placeholders", () => {
      const graph = buildGraph(`
        %unused-placeholder {
          padding: 10px;
        }
      `, "test.scss");

      expect(graph.unusedPlaceholders.length).toBe(1);
    });
  });

  describe("SCSS variables", () => {
    it("parses SCSS variables", () => {
      const graph = buildGraph(`
        $primary: blue;
        $secondary: green;
      `, "test.scss");

      expect(graph.scssVariables.length).toBe(2);
    });
  });

  describe("skips non-SCSS files", () => {
    it("does not process mixins in CSS files", () => {
      const graph = buildGraph(`
        .button { color: red; }
      `, "test.css");

      expect(graph.mixins.length).toBe(0);
      expect(graph.hasScssFiles).toBe(false);
    });
  });
});
