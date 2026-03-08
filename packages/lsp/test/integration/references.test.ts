/**
 * References Integration Tests
 *
 * No ts.LanguageService is available, so all reference
 * lookups return null. These tests verify no crashes occur.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestServer } from "../helpers";

describe("references", () => {
  let server: ReturnType<typeof createTestServer>;

  beforeEach(() => {
    server = createTestServer();
  });

  it("returns null for valid file (no TS LS)", () => {
    server.addFile(
      "/test/app.tsx",
      `import { createSignal } from "solid-js";
function App() {
  const [count] = createSignal(0);
  return <div>{count()}</div>;
}`,
    );
    expect(server.references("/test/app.tsx", 2, 10)).toBeNull();
  });

  it("returns null for nonexistent file", () => {
    expect(server.references("/test/nope.tsx", 0, 0)).toBeNull();
  });

  it("returns null for empty file", () => {
    server.addFile("/test/empty.tsx", "");
    expect(server.references("/test/empty.tsx", 0, 0)).toBeNull();
  });

  it("does not crash on out-of-range position", () => {
    server.addFile("/test/edge.tsx", "function App() { return <div />; }");
    expect(server.references("/test/edge.tsx", 1000, 0)).toBeNull();
  });
});
