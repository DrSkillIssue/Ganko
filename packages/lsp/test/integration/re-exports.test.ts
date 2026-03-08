/**
 * Re-exports Integration Tests
 *
 * Tests that multiple files with import/export patterns work
 * without crashing. TS features (definition, references) return
 * null since there is no ts.LanguageService, but the server
 * should handle multi-file setups gracefully.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestServer } from "../helpers";

describe("re-exports", () => {
  let server: ReturnType<typeof createTestServer>;

  beforeEach(() => {
    server = createTestServer();
  });

  it("loads barrel file with re-exports", () => {
    server.addFile("/test/ui/Button.tsx", `export function Button() { return <button />; }`);
    server.addFile("/test/ui/Input.tsx", `export function Input() { return <input />; }`);
    server.addFile("/test/ui/index.ts", `export { Button } from "./Button";\nexport { Input } from "./Input";`);
    server.addFile("/test/App.tsx", `import { Button, Input } from "./ui";\nfunction App() { return <div><Button /><Input /></div>; }`);

    expect(server.getAllFiles().length).toBe(4);
    expect(server.hasFile("/test/ui/index.ts")).toBe(true);
  });

  it("loads renamed re-exports", () => {
    server.addFile("/test/Original.tsx", `export function Original() { return <div />; }`);
    server.addFile("/test/index.ts", `export { Original as Alias } from "./Original";`);
    server.addFile("/test/App.tsx", `import { Alias } from "./index";\nfunction App() { return <Alias />; }`);

    expect(server.getAllFiles().length).toBe(3);
  });

  it("loads namespace re-exports", () => {
    server.addFile("/test/math.ts", `export function add(a: number, b: number) { return a + b; }`);
    server.addFile("/test/index.ts", `export * from "./math";`);
    server.addFile("/test/App.tsx", `import { add } from "./index";\nfunction App() { return <div>{add(1, 2)}</div>; }`);

    expect(server.getAllFiles().length).toBe(3);
  });

  it("loads multi-level re-export chains", () => {
    server.addFile("/test/deep/Base.tsx", `export function Base() { return <div />; }`);
    server.addFile("/test/deep/level1.ts", `export { Base } from "./Base";`);
    server.addFile("/test/deep/index.ts", `export { Base } from "./level1";`);
    server.addFile("/test/App.tsx", `import { Base } from "./deep";\nfunction App() { return <Base />; }`);

    expect(server.getAllFiles().length).toBe(4);
  });

  it("handles circular re-exports without crashing", () => {
    server.addFile("/test/a.tsx", `export { B } from "./b";\nexport function A() { return <div />; }`);
    server.addFile("/test/b.tsx", `export { A } from "./a";\nexport function B() { return <div />; }`);

    expect(server.hasFile("/test/a.tsx")).toBe(true);
    expect(server.hasFile("/test/b.tsx")).toBe(true);
  });

  it("diagnostics work on files with re-export patterns", () => {
    server.addFile("/test/shared.ts", `export { createSignal } from "solid-js";`);
    server.addFile(
      "/test/App.tsx",
      `import { createSignal } from "solid-js";\nfunction App() {\n  const [c] = createSignal(0);\n  return <div>{c}</div>;\n}`,
    );

    const diags = server.getDiagnostics("/test/App.tsx");
    expect(diags.find((d) => d.code === "signal-call")).toBeDefined();
  });

  it("definition returns null through re-exports (no TS LS)", () => {
    server.addFile("/test/Button.tsx", `export function Button() { return <button />; }`);
    server.addFile("/test/index.ts", `export { Button } from "./Button";`);
    server.addFile("/test/App.tsx", `import { Button } from "./index";\nfunction App() { return <Button />; }`);

    expect(server.definition("/test/App.tsx", 1, 25)).toBeNull();
  });
});
