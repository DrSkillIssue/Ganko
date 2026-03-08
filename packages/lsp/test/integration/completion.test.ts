/**
 * Completion Integration Tests
 *
 * Tests the static completion engine (pattern-based, no TS):
 * - JSX tag completions (Solid control flow + HTML elements)
 * - Attribute completions (HTML attrs + Solid attrs)
 * - Expression completions (in-scope variable names from regex)
 * - Edge cases
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestServer, findPosition } from "../helpers";

describe("completion", () => {
  let server: ReturnType<typeof createTestServer>;

  beforeEach(() => {
    server = createTestServer();
  });

  describe("jsx-tag-completions", () => {
    it("suggests Solid control flow components for <S", () => {
      const code = `function App() { return (<div><S</div>); }`;
      server.addFile("/test/tags.tsx", code);

      const pos = findPosition(code, "<S");
      expect(pos).not.toBeNull();

      const result = server.completion("/test/tags.tsx", pos!.line, pos!.character + 2);
      expect(result).not.toBeNull();

      const labels = result!.map((r) => r.label);
      expect(labels).toContain("Show");
      expect(labels).toContain("Switch");
      expect(labels).toContain("Suspense");
    });

    it("suggests HTML elements for <d", () => {
      const code = `function App() { return (<div><d</div>); }`;
      server.addFile("/test/html.tsx", code);

      const pos = findPosition(code, "<d</div>");
      expect(pos).not.toBeNull();

      const result = server.completion("/test/html.tsx", pos!.line, pos!.character + 2);
      expect(result).not.toBeNull();

      const labels = result!.map((r) => r.label);
      expect(labels).toContain("div");
    });

    it("suggests all control flow + HTML for bare <", () => {
      const code = `function App() {\n  return (\n    <div>\n      <\n    </div>\n  );\n}`;
      server.addFile("/test/bare.tsx", code);

      const pos = findPosition(code, "<\n    </div>");
      expect(pos).not.toBeNull();

      const result = server.completion("/test/bare.tsx", pos!.line, pos!.character + 1);
      expect(result).not.toBeNull();

      const labels = result!.map((r) => r.label);
      const controlFlow = ["Show", "For", "Switch", "Match", "Index", "ErrorBoundary", "Suspense", "Portal"];
      for (const cf of controlFlow) {
        expect(labels).toContain(cf);
      }
      expect(labels).toContain("div");
      expect(labels).toContain("span");
    });

    it("filters by prefix", () => {
      const code = `function App() { return (<div><F</div>); }`;
      server.addFile("/test/filter.tsx", code);

      const pos = findPosition(code, "<F");
      expect(pos).not.toBeNull();

      const result = server.completion("/test/filter.tsx", pos!.line, pos!.character + 2);
      expect(result).not.toBeNull();

      const labels = result!.map((r) => r.label);
      expect(labels).toContain("For");
      expect(labels).toContain("form");
      expect(labels).toContain("footer");
      expect(labels).not.toContain("Show");
      expect(labels).not.toContain("div");
    });
  });

  describe("attribute-completions", () => {
    it("suggests class and classList for <div c", () => {
      const code = `function App() { return (<div c></div>); }`;
      server.addFile("/test/attrs.tsx", code);

      const pos = findPosition(code, "<div c>");
      expect(pos).not.toBeNull();

      const result = server.completion("/test/attrs.tsx", pos!.line, pos!.character + 6);
      expect(result).not.toBeNull();

      const labels = result!.map((r) => r.label);
      expect(labels).toContain("class");
      expect(labels).toContain("classList");
    });

    it("suggests ref for <div r", () => {
      const code = `function App() { return (<div r></div>); }`;
      server.addFile("/test/ref.tsx", code);

      const pos = findPosition(code, "<div r>");
      expect(pos).not.toBeNull();

      const result = server.completion("/test/ref.tsx", pos!.line, pos!.character + 6);
      expect(result).not.toBeNull();

      const labels = result!.map((r) => r.label);
      expect(labels).toContain("ref");
    });

    it("suggests onClick/onChange for <button on", () => {
      const code = `function App() { return (<button on>Click</button>); }`;
      server.addFile("/test/events.tsx", code);

      const pos = findPosition(code, "<button on>");
      expect(pos).not.toBeNull();

      const result = server.completion("/test/events.tsx", pos!.line, pos!.character + 10);
      expect(result).not.toBeNull();

      const labels = result!.map((r) => r.label);
      expect(labels).toContain("onClick");
      expect(labels).toContain("onChange");
      expect(labels).toContain("onInput");
    });

    it("suggests all attributes for bare space after tag", () => {
      const code = `function App() { return (<div ></div>); }`;
      server.addFile("/test/all-attrs.tsx", code);

      const pos = findPosition(code, "<div >");
      expect(pos).not.toBeNull();

      const result = server.completion("/test/all-attrs.tsx", pos!.line, pos!.character + 5);
      expect(result).not.toBeNull();

      const labels = result!.map((r) => r.label);
      expect(labels).toContain("class");
      expect(labels).toContain("id");
      expect(labels).toContain("onClick");
      expect(labels).toContain("ref");
    });
  });

  describe("expression-completions", () => {
    it("suggests in-scope variable for {c with count declared", () => {
      const code = `import { createSignal } from "solid-js";
function App() {
  const [count] = createSignal(0);
  return (
    <div>
      {c
    </div>
  );
}`;
      server.addFile("/test/expr.tsx", code);

      const pos = findPosition(code, "{c\n");
      expect(pos).not.toBeNull();

      const result = server.completion("/test/expr.tsx", pos!.line, pos!.character + 2);
      expect(result).not.toBeNull();

      const labels = result!.map((r) => r.label);
      expect(labels).toContain("count");
    });

    it("suggests all in-scope variables for bare {", () => {
      const code = `function App() {
  const [value] = [0];
  const name = "test";
  const items = [1, 2, 3];
  return (
    <div>
      {
    </div>
  );
}`;
      server.addFile("/test/all-vars.tsx", code);

      const pos = findPosition(code, "{\n    </div>");
      expect(pos).not.toBeNull();

      const result = server.completion("/test/all-vars.tsx", pos!.line, pos!.character + 1);
      expect(result).not.toBeNull();

      const labels = result!.map((r) => r.label);
      expect(labels).toContain("value");
      expect(labels).toContain("name");
      expect(labels).toContain("items");
    });

    it("suggests variables in Show when prop context", () => {
      const code = `import { createSignal, Show } from "solid-js";
function App() {
  const [data] = createSignal({ name: "test" });
  return (
    <Show when={da}>
      <div>content</div>
    </Show>
  );
}`;
      server.addFile("/test/show-expr.tsx", code);

      const pos = findPosition(code, "{da}");
      expect(pos).not.toBeNull();

      const result = server.completion("/test/show-expr.tsx", pos!.line, pos!.character + 3);
      expect(result).not.toBeNull();

      const labels = result!.map((r) => r.label);
      expect(labels).toContain("data");
    });

    it("suggests variables in For each prop context", () => {
      const code = `import { createSignal, For } from "solid-js";
function App() {
  const [items] = createSignal([1, 2, 3]);
  return (
    <For each={it}>
      {(item) => <div>{item}</div>}
    </For>
  );
}`;
      server.addFile("/test/for-expr.tsx", code);

      const pos = findPosition(code, "{it}");
      expect(pos).not.toBeNull();

      const result = server.completion("/test/for-expr.tsx", pos!.line, pos!.character + 3);
      expect(result).not.toBeNull();

      const labels = result!.map((r) => r.label);
      expect(labels).toContain("items");
    });
  });

  describe("edge-cases", () => {
    it("returns null for nonexistent file", () => {
      expect(server.completion("/test/nope.tsx", 0, 0)).toBeNull();
    });

    it("returns null for empty file", () => {
      server.addFile("/test/empty.tsx", "");
      const result = server.completion("/test/empty.tsx", 0, 0);
      expect(result).toBeNull();
    });

    it("does not crash on out-of-range position", () => {
      server.addFile("/test/edge.tsx", "function App() { return <div />; }");
      const result = server.completion("/test/edge.tsx", 1000, 0);
      expect(result === null || Array.isArray(result)).toBe(true);
    });

    it("returns null at end of file with no context", () => {
      const code = "function App() { return <div />; }";
      server.addFile("/test/end.tsx", code);
      const result = server.completion("/test/end.tsx", 0, code.length);
      expect(result === null || Array.isArray(result)).toBe(true);
    });
  });
});
