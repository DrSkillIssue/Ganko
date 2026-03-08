import { defineConfig } from "tsup";
import { cpSync, mkdirSync } from "fs";
import { resolve } from "path";

export default defineConfig({
  entry: ["src/extension.ts"],
  format: ["cjs"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  external: ["vscode"],
  noExternal: ["vscode-languageclient", /^@drskillissue\/ganko/],
  async onSuccess() {
    const serverDir = resolve("dist", "server");
    mkdirSync(serverDir, { recursive: true });

    const lspPath = resolve("..", "lsp");
    cpSync(resolve(lspPath, "dist"), resolve(serverDir, "dist"), { recursive: true });
    cpSync(resolve(lspPath, "package.json"), resolve(serverDir, "package.json"));

    const webviewDir = resolve("dist", "webview");
    mkdirSync(webviewDir, { recursive: true });
    cpSync(resolve("src", "webview"), webviewDir, { recursive: true });
  },
});
