/**
 * Rename Integration Tests
 *
 * No ts.LanguageService is available, so all rename
 * operations return null. These tests verify no crashes occur.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestServer } from "../helpers";

describe("rename", () => {
  let server: ReturnType<typeof createTestServer>;

  beforeEach(() => {
    server = createTestServer();
  });

  it("prepareRename returns null (no TS LS)", () => {
    server.addFile("/test/app.tsx", `function App() { return <div />; }`);
    expect(server.prepareRename("/test/app.tsx", 0, 10)).toBeNull();
  });

  it("rename returns null (no TS LS)", () => {
    server.addFile("/test/app.tsx", `function App() { return <div />; }`);
    expect(server.rename("/test/app.tsx", 0, 10, "NewApp")).toBeNull();
  });

  it("returns null for nonexistent file", () => {
    expect(server.rename("/test/nope.tsx", 0, 0, "x")).toBeNull();
    expect(server.prepareRename("/test/nope.tsx", 0, 0)).toBeNull();
  });

  it("does not crash on out-of-range position", () => {
    server.addFile("/test/edge.tsx", "const x = 1;");
    expect(server.rename("/test/edge.tsx", 1000, 0, "y")).toBeNull();
    expect(server.prepareRename("/test/edge.tsx", 1000, 0)).toBeNull();
  });
});
