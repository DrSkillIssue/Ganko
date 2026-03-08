import { describe, it, expect } from "vitest";
import { buildGraph, buildGraphMultiple, at } from "./test-utils";
import {
  hasFlag,
  REF_IS_RESOLVED,
  INCLUDE_IS_RESOLVED,
  EXTEND_IS_RESOLVED,
  EXTEND_IS_OPTIONAL,
  MIXIN_HAS_CONTENT_BLOCK,
  SEL_HAS_ATTRIBUTE,
} from "../../src/css/entities";

describe("Real-World CSS Scenarios", () => {

  describe("Tailwind-Style Design Token System", () => {
    it("infers tokens, detects unused variables, and validates scales", () => {
      const graph = buildGraph(`
        :root {
          --color-primary-50: #eff6ff;
          --color-primary-100: #dbeafe;
          --color-primary-200: #bfdbfe;
          --color-primary-300: #93c5fd;
          --color-primary-400: #60a5fa;
          --color-primary-500: #3b82f6;
          --color-primary-600: #2563eb;
          --color-primary-700: #1d4ed8;
          --color-primary-800: #1e40af;
          --color-primary-900: #1e3a8a;

          --spacing-0: 0px;
          --spacing-1: 0.25rem;
          --spacing-2: 0.5rem;
          --spacing-4: 1rem;
          --spacing-8: 2rem;

          --font-size-xs: 0.75rem;
          --font-size-sm: 0.875rem;
          --font-size-md: 1rem;
          --font-size-lg: 1.125rem;
          --font-size-xl: 1.25rem;

          --color-deprecated-accent: #ff0000;
        }

        .button {
          background-color: var(--color-primary-500);
          padding: var(--spacing-4);
          font-size: var(--font-size-md);
        }
      `);

      expect(graph.variables.length).toBeGreaterThanOrEqual(16);
      expect(graph.globalVariables.length).toBeGreaterThanOrEqual(16);
      expect(graph.unusedVariables.some(v => v.name === "--color-deprecated-accent")).toBe(true);
      expect(graph.variableRefs.length).toBe(3);
      expect(graph.variableRefs.every(r => hasFlag(r._flags, REF_IS_RESOLVED))).toBe(true);
    });
  });

  describe("Cascade Layer Architecture (ITCSS-Style)", () => {
    it("parses layers and tracks layer ordering", () => {
      const graph = buildGraph(`
        @layer reset, base, components, utilities;

        @layer reset {
          *, *::before, *::after {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }
        }

        @layer base {
          :root {
            --base-color: #333;
          }
          
          body {
            color: var(--base-color);
            line-height: 1.5;
          }
          
          a {
            color: blue;
            text-decoration: none;
          }
        }

        @layer components {
          .card {
            padding: 1rem;
            border: 1px solid #ccc;
          }
          
          .card a {
            color: inherit;
          }
          
          .button {
            color: white;
            background: blue;
          }
        }

        @layer utilities {
          .text-red {
            color: red !important;
          }
          
          .mt-4 {
            margin-top: 1rem;
          }
        }
      `);

      expect(graph.layers.length).toBe(5);

      const resetOrder = graph.layerOrder.get("reset");
      const baseOrder = graph.layerOrder.get("base");
      const utilitiesOrder = graph.layerOrder.get("utilities");

      expect(resetOrder).toBeDefined();
      expect(baseOrder).toBeDefined();
      expect(utilitiesOrder).toBeDefined();
      expect(resetOrder!).toBeLessThan(baseOrder!);
      expect(baseOrder!).toBeLessThan(utilitiesOrder!);
    });
  });

  describe("BEM Component with Specificity Analysis", () => {
    it("detects duplicate selectors and tracks specificity", () => {
      const graph = buildGraph(`
        .card {
          display: flex;
          flex-direction: column;
          background: white;
          border-radius: 8px;
        }

        .card__header {
          padding: 1rem;
          border-bottom: 1px solid #eee;
        }

        .card__title {
          font-size: 1.25rem;
          font-weight: 600;
          color: #333;
        }

        .card__body {
          padding: 1rem;
          flex: 1;
        }

        .card--featured {
          border: 2px solid gold;
        }

        .card--featured .card__title {
          color: gold;
        }

        .card__title {
          color: #222;
        }

        #main .card .card__title {
          color: purple;
        }
      `);

      expect(graph.duplicateSelectors.has(".card__title")).toBe(true);
      expect(graph.duplicateSelectors.get(".card__title")?.rules.length).toBe(2);

      const idSelector = graph.selectors.find(s => s.raw === "#main .card .card__title");
      expect(idSelector).toBeDefined();
      expect(idSelector!.specificity[1]).toBe(1);
    });
  });

  describe("Responsive Design with Media Queries", () => {
    it("parses media queries and tracks nested rules", () => {
      const graph = buildGraph(`
        :root {
          --content-width: 100%;
          --sidebar-width: 0;
        }

        .layout {
          display: grid;
          grid-template-columns: var(--sidebar-width) var(--content-width);
        }

        .sidebar {
          display: none;
        }

        @media screen and (min-width: 768px) {
          :root {
            --content-width: 1fr;
            --sidebar-width: 250px;
          }
          
          .sidebar {
            display: block;
          }
        }

        @media screen and (min-width: 1024px) {
          :root {
            --sidebar-width: 300px;
          }
        }

        @media print {
          .sidebar {
            display: none !important;
          }
          
          .no-print {
            display: none !important;
          }
        }
      `);

      expect(graph.mediaQueries.length).toBe(3);

      const printMedia = graph.mediaQueries.find(m => m.params.includes("print"));
      expect(printMedia).toBeDefined();
    });
  });

  describe("Animation System with Keyframes Detection", () => {
    it("detects used and unused keyframes", () => {
      const graph = buildGraph(`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes slideInLeft {
          0% { transform: translateX(-100%); opacity: 0; }
          100% { transform: translateX(0); opacity: 1; }
        }

        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-20px); }
        }

        .modal {
          animation: fadeIn 0.3s ease-out;
        }

        .drawer {
          animation-name: slideInLeft;
          animation-duration: 0.4s;
        }

        .notification {
          animation: pulse 2s infinite;
        }
      `);

      expect(graph.keyframes.length).toBe(5);
      expect(graph.unusedKeyframes.length).toBe(2);

      const unusedNames = graph.unusedKeyframes.map(k => k.parsedParams.animationName);
      expect(unusedNames).toContain("spin");
      expect(unusedNames).toContain("bounce");
    });
  });

  describe("Multi-File Theme Architecture", () => {
    it("resolves variables across files and detects unresolved refs", () => {
      const graph = buildGraphMultiple([
        {
          path: "tokens/colors.css",
          content: `
            :root {
              --color-brand-primary: #3b82f6;
              --color-brand-secondary: #64748b;
              --color-text-primary: #1f2937;
              --color-text-secondary: #6b7280;
              --color-bg-primary: #ffffff;
              --color-bg-secondary: #f3f4f6;
              --color-border: #e5e7eb;
            }
          `,
        },
        {
          path: "tokens/spacing.css",
          content: `
            :root {
              --space-1: 0.25rem;
              --space-2: 0.5rem;
              --space-4: 1rem;
              --space-6: 1.5rem;
              --space-8: 2rem;
            }
          `,
        },
        {
          path: "components/button.css",
          content: `
            .button {
              display: inline-flex;
              padding: var(--space-2) var(--space-4);
              background-color: var(--color-brand-primary);
              color: var(--color-bg-primary);
              border: 1px solid var(--color-border);
              border-radius: var(--space-1);
            }

            .button:hover {
              background-color: var(--color-brand-secondary);
            }
          `,
        },
        {
          path: "themes/dark.css",
          content: `
            .dark {
              --color-text-primary: #f9fafb;
              --color-bg-primary: #111827;
              --color-border: #374151;
            }
          `,
        },
        {
          path: "pages/home.css",
          content: `
            .hero {
              padding: var(--space-8);
              background-color: var(--color-bg-secondary);
              color: var(--color-text-primary);
            }

            .hero-badge {
              background: var(--color-accent);
            }
          `,
        },
      ]);

      expect(graph.files.length).toBe(5);
      expect(graph.variables.length).toBeGreaterThanOrEqual(12);
      expect(graph.unresolvedRefs.length).toBe(1);
      expect(at(graph.unresolvedRefs, 0).name).toBe("--color-accent");

      const textPrimaryVars = graph.variablesByName.get("--color-text-primary");
      expect(textPrimaryVars?.length).toBe(2);
    });
  });

  describe("CSS Variable Reference Chains with Fallbacks", () => {
    it("parses nested fallbacks and tracks chain depth", () => {
      const graph = buildGraph(`
        :root {
          --color-primary-hue: 220;
          --color-primary-sat: 90%;
          --color-primary-light: 50%;
          --color-primary: hsl(
            var(--color-primary-hue), 
            var(--color-primary-sat), 
            var(--color-primary-light)
          );

          --space-unit: 4px;
          --space-1: var(--space-unit);
          --space-2: calc(var(--space-unit) * 2);

          --unused-var: red;
        }

        .button {
          background: var(--button-bg, var(--color-primary, var(--fallback-color, blue)));
          padding: var(--space-2);
        }

        .card {
          padding: var(--space-1);
        }
      `);

      expect(graph.variables.length).toBeGreaterThanOrEqual(7);
      expect(graph.unusedVariables.some(v => v.name === "--unused-var")).toBe(true);

      const deepFallbacks = graph.variableRefs.filter(r => r.fallbackChainDepth >= 1);
      expect(deepFallbacks.length).toBeGreaterThan(0);

      const buttonBgRef = graph.variableRefs.find(r => r.name === "--button-bg");
      expect(buttonBgRef).toBeDefined();
      if (!buttonBgRef) throw new Error("expected buttonBgRef");
      expect(hasFlag(buttonBgRef._flags, REF_IS_RESOLVED)).toBe(false);
    });
  });

  describe("SCSS Design System with Mixins and Functions", () => {
    it("parses mixins, functions, placeholders and detects unused", () => {
      const graph = buildGraph(
        `
        $primary: #3b82f6;
        $secondary: #64748b;

        @function rem($px) {
          @return ($px / 16) * 1rem;
        }

        @function deprecated-calc($n) {
          @return $n * 2;
        }

        @mixin button-variant($bg-color) {
          background-color: $bg-color;
          padding: rem(12px);
        }

        @mixin respond-to($breakpoint) {
          @media (min-width: $breakpoint) {
            @content;
          }
        }

        @mixin deprecated-shadow() {
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        %flex-center {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        %deprecated-layout {
          display: block;
          margin: 0 auto;
        }

        .button {
          @extend %flex-center;
          @include button-variant($primary);
          
          @include respond-to(768px) {
            padding: rem(16px);
          }
        }

        .icon-button {
          @extend %flex-center;
        }
      `,
        "design-system.scss",
      );

      expect(graph.mixins.length).toBe(3);
      expect(graph.functions.length).toBe(2);
      expect(graph.placeholders.length).toBe(2);

      expect(graph.unusedMixins.length).toBe(1);
      expect(at(graph.unusedMixins, 0).name).toBe("deprecated-shadow");

      expect(graph.unusedFunctions.some(f => f.name === "deprecated-calc")).toBe(true);

      expect(graph.unusedPlaceholders.length).toBe(1);
      expect(at(graph.unusedPlaceholders, 0).name).toBe("deprecated-layout");

      expect(graph.includes.every(i => hasFlag(i._flags, INCLUDE_IS_RESOLVED))).toBe(true);
      expect(graph.extends.every(e => hasFlag(e._flags, EXTEND_IS_RESOLVED))).toBe(true);
    });
  });

  describe("Bootstrap-Style Mixin System", () => {
    it("handles complex mixin parameters and @content blocks", () => {
      const graph = buildGraph(
        `
        @mixin clearfix {
          &::after {
            display: block;
            clear: both;
            content: "";
          }
        }

        @mixin media-breakpoint-up($min) {
          @media (min-width: $min) {
            @content;
          }
        }

        @mixin button-size($padding-y, $padding-x, $font-size: 1rem) {
          padding: $padding-y $padding-x;
          font-size: $font-size;
        }

        .btn {
          @include clearfix;
          display: inline-block;
        }

        .btn-primary {
          @include button-size(0.375rem, 0.75rem);
        }

        .btn-lg {
          @include button-size(0.5rem, 1rem, 1.25rem);
        }

        .container {
          @include media-breakpoint-up(768px) {
            max-width: 720px;
          }
          
          @include media-breakpoint-up(1024px) {
            max-width: 960px;
          }
        }
      `,
        "bootstrap.scss",
      );

      expect(graph.mixins.length).toBe(3);
      expect(graph.unusedMixins.length).toBe(0);

      const buttonSize = graph.mixinsByName.get("button-size");
      if (!buttonSize) throw new Error("expected buttonSize");
      expect(buttonSize.parameters.length).toBe(3);
      expect(at(buttonSize.parameters, 2).defaultValue).toBe("1rem");

      const mediaBreakpoint = graph.mixinsByName.get("media-breakpoint-up");
      expect(mediaBreakpoint).toBeDefined();
      if (!mediaBreakpoint) throw new Error("expected mediaBreakpoint");
      expect(hasFlag(mediaBreakpoint._flags, MIXIN_HAS_CONTENT_BLOCK)).toBe(true);
    });
  });

  describe("Placeholder Selectors with @extend Chains", () => {
    it("resolves extends and detects optional extends", () => {
      const graph = buildGraph(
        `
        %visually-hidden {
          position: absolute !important;
          width: 1px !important;
          height: 1px !important;
          overflow: hidden !important;
        }

        %flex-center {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        %card-base {
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        %unused-placeholder {
          color: red;
        }

        .sr-only {
          @extend %visually-hidden;
        }

        .skip-link {
          @extend %visually-hidden;
        }

        .icon-button {
          @extend %flex-center;
        }

        .card {
          @extend %card-base;
        }

        .legacy {
          @extend .nonexistent !optional;
        }
      `,
        "extends.scss",
      );

      expect(graph.placeholders.length).toBe(4);
      expect(graph.unusedPlaceholders.length).toBe(1);
      expect(at(graph.unusedPlaceholders, 0).name).toBe("unused-placeholder");

      const visuallyHidden = graph.placeholdersByName.get("visually-hidden");
      expect(visuallyHidden?.extends.length).toBe(2);

      const optionalExtend = graph.extends.find(e => hasFlag(e._flags, EXTEND_IS_OPTIONAL));
      if (!optionalExtend) throw new Error("expected optionalExtend");
      expect(hasFlag(optionalExtend._flags, EXTEND_IS_RESOLVED)).toBe(false);
    });
  });

  describe("Container Queries with Named Containers", () => {
    it("parses @container rules with named and unnamed containers", () => {
      const graph = buildGraph(`
        .card-container {
          container-type: inline-size;
          container-name: card;
        }

        .sidebar {
          container-type: size;
          container-name: sidebar;
        }

        @container card (min-width: 400px) {
          .card {
            display: grid;
            grid-template-columns: 1fr 2fr;
          }
        }

        @container card (min-width: 600px) {
          .card {
            grid-template-columns: 1fr 3fr;
          }
        }

        @container sidebar (max-width: 200px) {
          .nav-item {
            flex-direction: column;
          }
        }

        @container (width > 300px) {
          .inline-card {
            flex-direction: row;
          }
        }
      `);

      const containerQueries = graph.atRulesByKind.get("container");
      expect(containerQueries?.length).toBe(4);
    });
  });

  describe("@supports Feature Detection", () => {
    it("parses @supports rules with various conditions", () => {
      const graph = buildGraph(`
        :root {
          --fallback-layout: block;
        }

        .grid-layout {
          display: var(--fallback-layout);
        }

        @supports (display: grid) {
          .grid-layout {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          }
        }

        @supports (display: flex) and (gap: 1rem) {
          .flex-gap-layout {
            display: flex;
            gap: 1rem;
          }
        }

        @supports not (backdrop-filter: blur(10px)) {
          .modal-backdrop {
            background: rgba(0, 0, 0, 0.8);
          }
        }

        @supports selector(:has(*)) {
          .form-group:has(:invalid) {
            border-color: red;
          }
        }
      `);

      expect(graph.supportsRules.length).toBe(4);
      expect(graph.supportsRules.every(r => r.kind === "supports")).toBe(true);
    });
  });

  describe("Complex Attribute Selectors and :nth-child Patterns", () => {
    it("parses data attributes, ARIA selectors, and nth-child patterns", () => {
      const graph = buildGraph(`
        [data-testid="submit-button"] {
          cursor: pointer;
        }

        [data-state="loading"] {
          opacity: 0.6;
          pointer-events: none;
        }

        [data-theme="dark"] [data-component="card"] {
          background: #1f2937;
        }

        [aria-expanded="true"] > .accordion-content {
          display: block;
        }

        [aria-disabled="true"],
        [aria-busy="true"] {
          cursor: not-allowed;
        }

        a[href^="https://external.com"] {
          color: purple;
        }

        a[href$=".pdf"]::after {
          content: " (PDF)";
        }

        img[src*="placeholder"] {
          filter: blur(5px);
        }

        tr:nth-child(odd) {
          background: #f9fafb;
        }

        .grid-item:nth-child(3n+1) {
          grid-column: span 2;
        }

        li:nth-child(-n+3) {
          font-weight: bold;
        }
      `);

      expect(graph.selectors.length).toBeGreaterThanOrEqual(11);

      const attrSelectors = graph.selectors.filter(s => hasFlag(s.complexity._flags, SEL_HAS_ATTRIBUTE));
      expect(attrSelectors.length).toBeGreaterThanOrEqual(8);

      const nthChildSelectors = graph.selectors.filter(s =>
        s.raw.includes(":nth-child"),
      );
      expect(nthChildSelectors.length).toBe(3);
    });
  });

  describe("@font-face Typography System", () => {
    it("parses @font-face declarations and tracks font families", () => {
      const graph = buildGraph(`
        @font-face {
          font-family: "Inter";
          font-style: normal;
          font-weight: 400;
          font-display: swap;
          src: url("/fonts/inter-regular.woff2") format("woff2");
        }

        @font-face {
          font-family: "Inter";
          font-style: normal;
          font-weight: 700;
          font-display: swap;
          src: url("/fonts/inter-bold.woff2") format("woff2");
        }

        @font-face {
          font-family: "Fira Code";
          font-style: normal;
          font-weight: 400;
          src: url("/fonts/fira-code.woff2") format("woff2");
        }

        :root {
          --font-sans: "Inter", system-ui, sans-serif;
          --font-mono: "Fira Code", monospace;
        }

        body {
          font-family: var(--font-sans);
        }

        code, pre {
          font-family: var(--font-mono);
        }
      `);

      expect(graph.fontFaces.length).toBe(3);
      expect(graph.fontFaces.every(f => f.kind === "font-face")).toBe(true);
      expect(graph.variableRefs.every(r => hasFlag(r._flags, REF_IS_RESOLVED))).toBe(true);
    });
  });

  describe("Specificity Wars and Legacy Override Patterns", () => {
    it("detects specificity escalation and !important abuse", () => {
      const graph = buildGraph(`
        .button {
          background: gray;
          color: white;
        }

        #app .button {
          background: blue;
        }

        .wrapper .container .content .button {
          background: green;
        }

        #app .wrapper .button.btn {
          background: red;
        }

        #app #main .button {
          background: purple;
        }

        .button {
          background: orange !important;
        }

        #app .button {
          background: pink !important;
        }

        #app #main #content .wrapper .button.btn.active {
          background: black !important;
        }

        body > #app > main > section.content > article.post > .post-body > .post-content > p > a.link {
          color: inherit;
        }
      `);

      expect(graph.duplicateSelectors.has(".button")).toBe(true);

      const highSpecSelector = graph.selectors.find(s =>
        s.raw.includes("#app #main #content"),
      );
      expect(highSpecSelector).toBeDefined();
      expect(highSpecSelector!.specificity[1]).toBe(3);

      const longChain = graph.selectors.find(s =>
        s.raw.includes("body > #app > main"),
      );
      expect(longChain).toBeDefined();
      expect(longChain!.complexity.depth).toBeGreaterThanOrEqual(8);
    });
  });

  describe("Dashboard Data Table with Sort/Filter States", () => {
    it("parses complex table styling with attribute and nth-child selectors", () => {
      const graph = buildGraph(`
        :root {
          --table-header-bg: #f9fafb;
          --table-border-color: #e5e7eb;
          --table-row-hover-bg: #f3f4f6;
        }

        .data-table {
          width: 100%;
          border-collapse: collapse;
        }

        .data-table th,
        .data-table td {
          padding: 0.75rem 1rem;
          border-bottom: 1px solid var(--table-border-color);
        }

        .data-table th {
          background: var(--table-header-bg);
          font-weight: 600;
        }

        .data-table th[data-sortable] {
          cursor: pointer;
        }

        .data-table th[data-sort="asc"]::after {
          content: "↑";
        }

        .data-table th[data-sort="desc"]::after {
          content: "↓";
        }

        .data-table tbody tr:nth-child(even) {
          background: rgba(0, 0, 0, 0.02);
        }

        .data-table tbody tr:hover {
          background: var(--table-row-hover-bg);
        }

        .data-table tbody tr[data-selected] {
          background: #dbeafe;
        }

        @media print {
          .data-table th {
            background: #fff;
          }
        }
      `);

      expect(graph.variables.length).toBe(3);
      expect(graph.variableRefs.every(r => hasFlag(r._flags, REF_IS_RESOLVED))).toBe(true);
      expect(graph.mediaQueries.length).toBe(1);

      const sortableSelectors = graph.selectors.filter(s =>
        s.raw.includes("[data-sort"),
      );
      expect(sortableSelectors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Headless UI / Radix-Style Dialog Primitives", () => {
    it("parses data-attribute component patterns with keyframe animations", () => {
      const graph = buildGraph(`
        :root {
          --dialog-backdrop-bg: rgba(0, 0, 0, 0.5);
          --dialog-content-bg: #ffffff;
          --dialog-transition-duration: 150ms;
        }

        [data-dialog-backdrop] {
          position: fixed;
          inset: 0;
          background: var(--dialog-backdrop-bg);
        }

        [data-dialog-backdrop][data-state="open"] {
          animation: fadeIn var(--dialog-transition-duration) ease-out;
        }

        [data-dialog-backdrop][data-state="closed"] {
          animation: fadeOut var(--dialog-transition-duration) ease-in;
        }

        [data-dialog-content] {
          background: var(--dialog-content-bg);
          border-radius: 0.5rem;
          max-width: 28rem;
        }

        [data-dialog-content][data-state="open"] {
          animation: scaleIn var(--dialog-transition-duration) ease-out;
        }

        [data-dialog-content]:focus-visible {
          outline: 2px solid #3b82f6;
        }

        [data-dialog-close]:hover {
          background: #f3f4f6;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }

        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `);

      expect(graph.keyframes.length).toBe(3);
      expect(graph.unusedKeyframes.length).toBe(0);

      const attrSelectors = graph.selectors.filter(s => hasFlag(s.complexity._flags, SEL_HAS_ATTRIBUTE));
      expect(attrSelectors.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe("CSS Custom Property Theming (Light/Dark/High-Contrast)", () => {
    it("tracks variable shadowing across theme scopes", () => {
      const graph = buildGraph(`
        :root {
          --color-surface-primary: #ffffff;
          --color-text-primary: #111827;
          --color-border-default: #e5e7eb;
          --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.07);
        }

        @media (prefers-color-scheme: dark) {
          :root {
            --color-surface-primary: #111827;
            --color-text-primary: #f9fafb;
            --color-border-default: #374151;
            --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.4);
          }
        }

        @media (prefers-contrast: more) {
          :root {
            --color-surface-primary: #ffffff;
            --color-text-primary: #000000;
            --color-border-default: #000000;
          }
        }

        [data-theme="dark"] {
          --color-surface-primary: #111827;
          --color-text-primary: #f9fafb;
        }

        .card {
          background: var(--color-surface-primary);
          color: var(--color-text-primary);
          border: 1px solid var(--color-border-default);
        }
      `);

      const surfaceVars = graph.variablesByName.get("--color-surface-primary");
      expect(surfaceVars?.length).toBeGreaterThanOrEqual(3);

      expect(graph.mediaQueries.length).toBe(2);
      expect(graph.variableRefs.every(r => hasFlag(r._flags, REF_IS_RESOLVED))).toBe(true);
    });
  });

  describe("Form Validation Styling with Input States", () => {
    it("parses :valid/:invalid/:placeholder-shown and sibling combinators", () => {
      const graph = buildGraph(
        `
        :root {
          --input-border-color: #d1d5db;
          --input-border-color-error: #dc2626;
          --input-border-color-success: #059669;
        }

        .form-input {
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--input-border-color);
          border-radius: 0.375rem;
        }

        .form-input::placeholder {
          color: #9ca3af;
        }

        .form-input:focus {
          outline: none;
          border-color: #3b82f6;
        }

        .form-input:disabled {
          background: #f3f4f6;
          cursor: not-allowed;
        }

        .form-input:not(:placeholder-shown):valid {
          border-color: var(--input-border-color-success);
        }

        .form-input:not(:placeholder-shown):invalid {
          border-color: var(--input-border-color-error);
        }

        .form-input[aria-invalid="true"] {
          border-color: var(--input-border-color-error);
        }

        .form-error {
          display: none;
          color: var(--input-border-color-error);
        }

        .form-input:not(:placeholder-shown):invalid + .form-error {
          display: block;
        }

        .form-input[aria-invalid="true"] + .form-error {
          display: block;
        }
      `,
        "form.scss",
      );

      expect(graph.variables.length).toBe(3);
      expect(graph.variableRefs.every(r => hasFlag(r._flags, REF_IS_RESOLVED))).toBe(true);

      const pseudoSelectors = graph.selectors.filter(
        s => s.raw.includes(":valid") || s.raw.includes(":invalid"),
      );
      expect(pseudoSelectors.length).toBeGreaterThanOrEqual(2);

      const siblingSelectors = graph.selectors.filter(s => s.raw.includes("+"));
      expect(siblingSelectors.length).toBe(2);
    });
  });

  describe("CSS Grid Dashboard Layout", () => {
    it("parses grid properties and container queries for responsive layouts", () => {
      const graph = buildGraph(`
        :root {
          --layout-sidebar-width: 280px;
          --layout-header-height: 64px;
          --layout-gap: 1.5rem;
        }

        .dashboard-layout {
          display: grid;
          grid-template-columns: var(--layout-sidebar-width) 1fr;
          grid-template-rows: var(--layout-header-height) 1fr;
          grid-template-areas:
            "sidebar header"
            "sidebar main";
          min-height: 100vh;
        }

        .dashboard-layout[data-sidebar-collapsed] {
          grid-template-columns: 64px 1fr;
        }

        .dashboard-layout__header {
          grid-area: header;
        }

        .dashboard-layout__sidebar {
          grid-area: sidebar;
        }

        .dashboard-layout__main {
          grid-area: main;
          container-type: inline-size;
          container-name: main-content;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: var(--layout-gap);
        }

        @container main-content (min-width: 800px) {
          .stats-grid {
            grid-template-columns: repeat(4, 1fr);
          }
        }

        @container main-content (max-width: 500px) {
          .stats-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 768px) {
          .dashboard-layout {
            grid-template-columns: 1fr;
            grid-template-areas:
              "header"
              "main";
          }

          .dashboard-layout__sidebar {
            display: none;
          }
        }
      `);

      expect(graph.variables.length).toBe(3);
      expect(graph.variableRefs.every(r => hasFlag(r._flags, REF_IS_RESOLVED))).toBe(true);

      const containerQueries = graph.atRulesByKind.get("container");
      expect(containerQueries?.length).toBe(2);

      expect(graph.mediaQueries.length).toBe(1);

      const gridDecls = graph.declarationsByProperty.get("grid-template-columns");
      expect(gridDecls?.length).toBeGreaterThanOrEqual(4);
    });
  });
});
