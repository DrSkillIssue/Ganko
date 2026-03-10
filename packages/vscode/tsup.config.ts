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
    const serverDistDir = resolve(serverDir, "dist");
    mkdirSync(serverDistDir, { recursive: true });

    const lspDist = resolve("..", "lsp", "dist");
    cpSync(resolve(lspDist, "entry.js"), resolve(serverDistDir, "entry.js"));
    cpSync(resolve("..", "lsp", "package.json"), resolve(serverDir, "package.json"));

    const webviewDir = resolve("dist", "webview");
    mkdirSync(webviewDir, { recursive: true });
    cpSync(resolve("src", "webview"), webviewDir, { recursive: true });
  },
});
