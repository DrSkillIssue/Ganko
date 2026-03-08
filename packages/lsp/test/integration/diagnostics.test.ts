/**
 * Diagnostics Integration Tests
 *
 * Tests real ganko diagnostics via the TestServer:
 * - signal-call rule (signal used without () in JSX)
 * - async-tracked rule (async in createEffect/createMemo)
 * - Correct usage produces no false positives
 * - File updates clear/change diagnostics
 * - Edge cases: empty files, syntax errors, removal
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestServer } from "../helpers";

describe("diagnostics", () => {
  let server: ReturnType<typeof createTestServer>;

  beforeEach(() => {
    server = createTestServer();
  });

  describe("signal-call", () => {
    it("reports signal not called in JSX text", () => {
      server.addFile(
        "/test/signal-error.tsx",
        `import { createSignal } from "solid-js";
function App() {
  const [count] = createSignal(0);
  return <div>{count}</div>;
}`,
      );

      const diagnostics = server.getDiagnostics("/test/signal-error.tsx");
      const signal = diagnostics.find((d) => d.code === "signal-call");
      expect(signal).toBeDefined();
      expect(signal?.source).toBe("ganko");
      expect(signal?.message).toContain("count");
    });

    it("does not report correctly called signal", () => {
      server.addFile(
        "/test/signal-ok.tsx",
        `import { createSignal } from "solid-js";
function App() {
  const [count] = createSignal(0);
  return <div>{count()}</div>;
}`,
      );

      const diagnostics = server.getDiagnostics("/test/signal-ok.tsx");
      expect(diagnostics.find((d) => d.code === "signal-call")).toBeUndefined();
    });

    it("reports multiple signal errors in same file", () => {
      server.addFile(
        "/test/multi.tsx",
        `import { createSignal } from "solid-js";
function App() {
  const [a] = createSignal(1);
  const [b] = createSignal(2);
  return (
    <div>
      <span>{a}</span>
      <span>{b}</span>
    </div>
  );
}`,
      );

      const diagnostics = server.getDiagnostics("/test/multi.tsx");
      const signals = diagnostics.filter((d) => d.code === "signal-call");
      expect(signals.length).toBe(2);
    });

    it("reports signal in ternary without call", () => {
      server.addFile(
        "/test/ternary.tsx",
        `import { createSignal } from "solid-js";
function App() {
  const [show] = createSignal(true);
  return <div>{show ? "yes" : "no"}</div>;
}`,
      );

      const diagnostics = server.getDiagnostics("/test/ternary.tsx");
      expect(diagnostics.find((d) => d.code === "signal-call")).toBeDefined();
    });

    it("does not report signal passed to Show when prop", () => {
      server.addFile(
        "/test/show-prop.tsx",
        `import { createSignal, Show } from "solid-js";
function App() {
  const [visible] = createSignal(true);
  return (
    <Show when={visible()}>
      <div>Visible</div>
    </Show>
  );
}`,
      );

      const diagnostics = server.getDiagnostics("/test/show-prop.tsx");
      expect(diagnostics.find((d) => d.code === "signal-call")).toBeUndefined();
    });
  });

  describe("async-tracked", () => {
    it("reports async function in createEffect", () => {
      server.addFile(
        "/test/async-effect.tsx",
        `import { createEffect } from "solid-js";
function App() {
  createEffect(async () => {
    await fetch("/api/data");
  });
  return <div />;
}`,
      );

      const diagnostics = server.getDiagnostics("/test/async-effect.tsx");
      expect(diagnostics.find((d) => d.code === "async-tracked")).toBeDefined();
    });

    it("reports async function in createMemo", () => {
      server.addFile(
        "/test/async-memo.tsx",
        `import { createMemo } from "solid-js";
function App() {
  const data = createMemo(async () => {
    return await fetch("/api").then(r => r.json());
  });
  return <div>{JSON.stringify(data())}</div>;
}`,
      );

      const diagnostics = server.getDiagnostics("/test/async-memo.tsx");
      expect(diagnostics.find((d) => d.code === "async-tracked")).toBeDefined();
    });

    it("does not report async in event handlers", () => {
      server.addFile(
        "/test/async-handler.tsx",
        `function App() {
  const handleClick = async () => {
    await fetch("/api/data");
  };
  return <button onClick={handleClick}>Click</button>;
}`,
      );

      const diagnostics = server.getDiagnostics("/test/async-handler.tsx");
      expect(diagnostics.find((d) => d.code === "async-tracked")).toBeUndefined();
    });
  });

  describe("correct-usage", () => {
    it("produces no signal-call diagnostics for correct component", () => {
      server.addFile(
        "/test/correct.tsx",
        `import { createSignal, createMemo } from "solid-js";
function Counter() {
  const [count, setCount] = createSignal(0);
  const doubled = createMemo(() => count() * 2);
  return (
    <div>
      <span>{count()}</span>
      <span>{doubled()}</span>
      <button onClick={() => setCount(c => c + 1)}>+</button>
    </div>
  );
}`,
      );

      const diagnostics = server.getDiagnostics("/test/correct.tsx");
      expect(diagnostics.find((d) => d.code === "signal-call")).toBeUndefined();
    });

    it("handles For component correctly", () => {
      server.addFile(
        "/test/for.tsx",
        `import { createSignal, For } from "solid-js";
function App() {
  const [items] = createSignal([1, 2, 3]);
  return (
    <For each={items()}>
      {(item) => <div>{item}</div>}
    </For>
  );
}`,
      );

      const diagnostics = server.getDiagnostics("/test/for.tsx");
      expect(diagnostics.find((d) => d.code === "signal-call")).toBeUndefined();
    });

    it("handles Switch/Match correctly", () => {
      server.addFile(
        "/test/switch.tsx",
        `import { createSignal, Switch, Match } from "solid-js";
function App() {
  const [status] = createSignal<"loading" | "success">("loading");
  return (
    <Switch>
      <Match when={status() === "loading"}>Loading...</Match>
      <Match when={status() === "success"}>Done</Match>
    </Switch>
  );
}`,
      );

      const diagnostics = server.getDiagnostics("/test/switch.tsx");
      expect(diagnostics.find((d) => d.code === "signal-call")).toBeUndefined();
    });
  });

  describe("update-handling", () => {
    it("clears signal-call diagnostic after fix", () => {
      const path = "/test/update.tsx";
      server.addFile(
        path,
        `import { createSignal } from "solid-js";
function App() {
  const [count] = createSignal(0);
  return <div>{count}</div>;
}`,
      );

      const before = server.getDiagnostics(path);
      expect(before.find((d) => d.code === "signal-call")).toBeDefined();

      server.updateFile(
        path,
        `import { createSignal } from "solid-js";
function App() {
  const [count] = createSignal(0);
  return <div>{count()}</div>;
}`,
      );

      const after = server.getDiagnostics(path);
      expect(after.find((d) => d.code === "signal-call")).toBeUndefined();
    });

    it("returns empty diagnostics after file removal", () => {
      const path = "/test/remove.tsx";
      server.addFile(
        path,
        `import { createSignal } from "solid-js";
function App() {
  const [x] = createSignal(0);
  return <div>{x}</div>;
}`,
      );

      server.removeFile(path);
      expect(server.getDiagnostics(path)).toEqual([]);
    });

    it("introduces diagnostics when correct code is broken", () => {
      const path = "/test/break.tsx";
      server.addFile(
        path,
        `import { createSignal } from "solid-js";
function App() {
  const [count] = createSignal(0);
  return <div>{count()}</div>;
}`,
      );
      expect(server.getDiagnostics(path).find((d) => d.code === "signal-call")).toBeUndefined();

      server.updateFile(
        path,
        `import { createSignal } from "solid-js";
function App() {
  const [count] = createSignal(0);
  return <div>{count}</div>;
}`,
      );
      expect(server.getDiagnostics(path).find((d) => d.code === "signal-call")).toBeDefined();
    });
  });

  describe("edge-cases", () => {
    it("handles empty file", () => {
      server.addFile("/test/empty.tsx", "");
      const diagnostics = server.getDiagnostics("/test/empty.tsx");
      expect(Array.isArray(diagnostics)).toBe(true);
      expect(diagnostics.length).toBe(0);
    });

    it("handles file with only imports", () => {
      server.addFile(
        "/test/imports-only.tsx",
        `import { createSignal } from "solid-js";`,
      );
      const diagnostics = server.getDiagnostics("/test/imports-only.tsx");
      expect(Array.isArray(diagnostics)).toBe(true);
    });

    it("handles file with syntax errors gracefully", () => {
      server.addFile(
        "/test/syntax-error.tsx",
        `function App() {\n  const x =  // incomplete\n`,
      );
      const diagnostics = server.getDiagnostics("/test/syntax-error.tsx");
      expect(Array.isArray(diagnostics)).toBe(true);
    });

    it("handles nonexistent file", () => {
      expect(server.getDiagnostics("/test/nope.tsx")).toEqual([]);
    });

    it("handles unicode identifiers", () => {
      server.addFile(
        "/test/unicode.tsx",
        `import { createSignal } from "solid-js";
function App() {
  const [計數] = createSignal(0);
  return <div>{計數()}</div>;
}`,
      );
      const diagnostics = server.getDiagnostics("/test/unicode.tsx");
      expect(diagnostics.find((d) => d.code === "signal-call")).toBeUndefined();
    });

    it("handles deeply nested JSX without false positives", () => {
      server.addFile(
        "/test/nested.tsx",
        `import { createSignal } from "solid-js";
function App() {
  const [a] = createSignal(1);
  return (
    <div>
      <div>
        <div>
          <span>{a()}</span>
        </div>
      </div>
    </div>
  );
}`,
      );
      const diagnostics = server.getDiagnostics("/test/nested.tsx");
      expect(diagnostics.find((d) => d.code === "signal-call")).toBeUndefined();
    });
  });

  describe("raw-diagnostics", () => {
    it("returns raw ganko diagnostic format", () => {
      server.addFile(
        "/test/raw.tsx",
        `import { createSignal } from "solid-js";
function App() {
  const [count] = createSignal(0);
  return <div>{count}</div>;
}`,
      );

      const raw = server.getRawDiagnostics("/test/raw.tsx");
      const signal = raw.find((d) => d.rule === "signal-call");
      expect(signal).toBeDefined();
      expect(signal?.severity).toBe("error");
      expect(signal?.loc.start.line).toBeGreaterThan(0);
      expect(signal?.loc.start.column).toBeGreaterThanOrEqual(0);
    });
  });
});
