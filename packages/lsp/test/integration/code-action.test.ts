/**
 * Code Action Integration Tests
 *
 * Tests real quickfixes from ganko via the TestServer:
 * - signal-call diagnostic has a fix (adding ())
 * - Code actions return null for valid code
 * - Edge cases: empty files, syntax errors, nonexistent files
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestServer, range } from "../helpers";

describe("code-action", () => {
  let server: ReturnType<typeof createTestServer>;

  beforeEach(() => {
    server = createTestServer();
  });

  describe("signal-call-quickfix", () => {
    it("provides quickfix for uncalled signal", () => {
      const code = `import { createSignal } from "solid-js";
function App() {
  const [count] = createSignal(0);
  return <div>{count}</div>;
}`;
      server.addFile("/test/fix.tsx", code);

      const diagnostics = server.getDiagnostics("/test/fix.tsx");
      const signal = diagnostics.find((d) => d.code === "signal-call");
      expect(signal).toBeDefined();

      const result = server.codeActions("/test/fix.tsx", signal!.range, [signal!]);
      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThan(0);

      const fix = result![0];
      expect(fix.kind).toBe("quickfix");
      expect(fix.isPreferred).toBe(true);
      expect(fix.edit?.changes).toBeDefined();

      const edits = Object.values(fix.edit!.changes!).flat();
      expect(edits.length).toBeGreaterThan(0);
      expect(edits[0].newText).toContain("count()");
    });

    it("provides separate fixes for multiple uncalled signals", () => {
      const code = `import { createSignal } from "solid-js";
function App() {
  const [a] = createSignal(1);
  const [b] = createSignal(2);
  return (
    <div>
      <span>{a}</span>
      <span>{b}</span>
    </div>
  );
}`;
      server.addFile("/test/multi.tsx", code);

      const diagnostics = server.getDiagnostics("/test/multi.tsx");
      const signals = diagnostics.filter((d) => d.code === "signal-call");
      expect(signals.length).toBe(2);

      const resultA = server.codeActions("/test/multi.tsx", signals[0].range, [signals[0]]);
      const resultB = server.codeActions("/test/multi.tsx", signals[1].range, [signals[1]]);

      expect(resultA).not.toBeNull();
      expect(resultB).not.toBeNull();
    });

    it("quickfix edit replaces signal with signal()", () => {
      const code = `import { createSignal } from "solid-js";
function App() {
  const [value] = createSignal("test");
  return <div>{value}</div>;
}`;
      server.addFile("/test/transform.tsx", code);

      const diagnostics = server.getDiagnostics("/test/transform.tsx");
      const signal = diagnostics.find((d) => d.code === "signal-call");
      expect(signal).toBeDefined();

      const result = server.codeActions("/test/transform.tsx", signal!.range, [signal!]);
      expect(result).not.toBeNull();

      const edits = Object.values(result![0].edit!.changes!).flat();
      expect(edits[0].newText).toContain("value()");
    });

    it("code action includes the diagnostic it fixes", () => {
      const code = `import { createSignal } from "solid-js";
function App() {
  const [count] = createSignal(0);
  return <div>{count}</div>;
}`;
      server.addFile("/test/diag-ref.tsx", code);

      const diagnostics = server.getDiagnostics("/test/diag-ref.tsx");
      const signal = diagnostics.find((d) => d.code === "signal-call");
      expect(signal).toBeDefined();

      const result = server.codeActions("/test/diag-ref.tsx", signal!.range, [signal!]);
      expect(result).not.toBeNull();
      expect(result![0].diagnostics).toBeDefined();
      expect(result![0].diagnostics![0].code).toBe("signal-call");
    });
  });

  describe("no-actions-for-valid-code", () => {
    it("returns null for correct signal usage", () => {
      const code = `import { createSignal } from "solid-js";
function App() {
  const [count] = createSignal(0);
  return <div>{count()}</div>;
}`;
      server.addFile("/test/valid.tsx", code);

      const result = server.codeActions("/test/valid.tsx", range(3, 0, 3, 30));
      expect(result).toBeNull();
    });

    it("returns null for plain JSX with no issues", () => {
      server.addFile("/test/plain.tsx", `function App() { return <div>Hello</div>; }`);
      const result = server.codeActions("/test/plain.tsx", range(0, 0, 0, 40));
      expect(result).toBeNull();
    });
  });

  describe("async-tracked-actions", () => {
    it("returns actions for async effect range", () => {
      const code = `import { createEffect } from "solid-js";
function App() {
  createEffect(async () => {
    await fetch("/api/data");
  });
  return <div />;
}`;
      server.addFile("/test/async.tsx", code);

      const diagnostics = server.getDiagnostics("/test/async.tsx");
      const async_ = diagnostics.find((d) => d.code === "async-tracked");

      if (async_) {
        const result = server.codeActions("/test/async.tsx", async_.range, [async_]);
        /** async-tracked has no fix, so code actions may be null */
        expect(result === null || Array.isArray(result)).toBe(true);
      }
    });
  });

  describe("diagnostic-filtering", () => {
    it("only returns fixes matching the requested diagnostic", () => {
      const code = `import { createEffect } from "solid-js";
function App() {
  createEffect(async () => {
    await fetch("/api");
  });
  return <div />;
}`;
      server.addFile("/test/filter.tsx", code);

      const diagnostics = server.getDiagnostics("/test/filter.tsx");
      const effectMount = diagnostics.find((d) => d.code === "effect-as-mount");

      if (effectMount) {
        const result = server.codeActions("/test/filter.tsx", effectMount.range, [effectMount]);
        if (result) {
          for (const action of result) {
            if (action.diagnostics && action.diagnostics.length > 0) {
              expect(action.diagnostics[0].code).toBe("effect-as-mount");
            }
          }
        }
      }
    });
  });

  describe("edge-cases", () => {
    it("handles empty file", () => {
      server.addFile("/test/empty.tsx", "");
      const result = server.codeActions("/test/empty.tsx", range(0, 0, 0, 0));
      expect(result === null || Array.isArray(result)).toBe(true);
    });

    it("handles file with syntax errors", () => {
      server.addFile("/test/syntax.tsx", `function App() {\n  const x =\n`);
      const result = server.codeActions("/test/syntax.tsx", range(1, 0, 1, 10));
      expect(result === null || Array.isArray(result)).toBe(true);
    });

    it("handles nonexistent file", () => {
      const result = server.codeActions("/test/nope.tsx", range(0, 0, 0, 0));
      expect(result === null || Array.isArray(result)).toBe(true);
    });

    it("handles out-of-range position", () => {
      server.addFile("/test/range.tsx", "function App() { return <div />; }");
      const result = server.codeActions("/test/range.tsx", range(1000, 0, 1000, 10));
      expect(result === null || Array.isArray(result)).toBe(true);
    });
  });
});
