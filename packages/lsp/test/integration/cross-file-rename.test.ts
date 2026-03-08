/**
 * Cross-File Rename Integration Tests
 *
 * No ts.LanguageService is available, so all rename
 * operations return null. These tests verify no crashes occur
 * even with multiple files loaded.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestServer } from "../helpers";

describe("cross-file-rename", () => {
  let server: ReturnType<typeof createTestServer>;

  beforeEach(() => {
    server = createTestServer();
  });

  it("returns null for rename across multiple files (no TS LS)", () => {
    server.addFile("/test/Button.tsx", `export function Button() { return <button />; }`);
    server.addFile("/test/App.tsx", `import { Button } from "./Button";\nfunction App() { return <Button />; }`);

    expect(server.rename("/test/Button.tsx", 0, 17, "Btn")).toBeNull();
  });

  it("returns null for rename from usage site (no TS LS)", () => {
    server.addFile("/test/Shared.tsx", `export function Shared() { return <div />; }`);
    server.addFile("/test/Consumer.tsx", `import { Shared } from "./Shared";\nfunction X() { return <Shared />; }`);

    expect(server.rename("/test/Consumer.tsx", 1, 24, "New")).toBeNull();
  });

  it("does not crash with circular imports", () => {
    server.addFile("/test/A.tsx", `import { B } from "./B";\nexport function A() { return <B />; }`);
    server.addFile("/test/B.tsx", `import { A } from "./A";\nexport function B() { return <A />; }`);

    expect(server.rename("/test/A.tsx", 1, 17, "AA")).toBeNull();
  });
});
