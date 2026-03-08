/**
 * WebView panel management for the reactive dependency graph.
 *
 * Sends `solid/showReactiveGraph` to the LSP server and renders
 * the resulting Mermaid diagram in a WebView panel.
 *
 * NOTE: The server handler does not exist yet — this will fail at
 * runtime until one is implemented in ganko.
 */
import { window, workspace, ViewColumn, Uri, type ExtensionContext, type WebviewPanel } from "vscode";
import { State, type LanguageClient } from "vscode-languageclient/node";
import type { ReactiveGraphResult } from "./protocol";
import type { Logger } from "./log";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const BACKSLASH_G = /\\/g;
const BACKTICK_G = /`/g;
const DOLLAR_G = /\$/g;
const NONCE_PLACEHOLDER_G = /\{\{NONCE\}\}/g;
const HYPHEN_G = /-/g;

interface PanelState {
  panel: WebviewPanel | null
}

const state: PanelState = { panel: null };

/** Load the HTML template and substitute placeholders. */
function renderHtml(mermaid: string, nonce: string, templatePath: string): string {
  const template = fs.readFileSync(templatePath, "utf-8");
  const escaped = mermaid
    .replace(BACKSLASH_G, "\\\\")
    .replace(BACKTICK_G, "\\`")
    .replace(DOLLAR_G, "\\$");
  return template
    .replace(NONCE_PLACEHOLDER_G, nonce)
    .replace("{{MERMAID_CODE}}", escaped);
}

/** Show the reactive graph for the active editor's file. */
export async function showReactiveGraph(
  context: ExtensionContext,
  client: LanguageClient | null,
  log: Logger,
): Promise<void> {
  const editor = window.activeTextEditor;
  if (!editor) {
    window.showWarningMessage("Solid LSP: No active editor");
    return;
  }

  if (!client || client.state !== State.Running) {
    window.showWarningMessage("Solid LSP: Language server is not running");
    return;
  }

  const uri = editor.document.uri.toString();
  log.info(`Requesting reactive graph for: ${uri}`);

  try {
    const result = await client.sendRequest<ReactiveGraphResult | null>(
      "solid/showReactiveGraph",
      { textDocument: { uri } },
    );

    if (!result) {
      window.showInformationMessage("Solid LSP: No reactive graph available for this file");
      return;
    }

    log.info(`Received reactive graph: ${result.nodes.length} nodes, ${result.edges.length} edges`);

    if (!state.panel) {
      state.panel = window.createWebviewPanel(
        "solidReactiveGraph",
        "Reactive Graph",
        ViewColumn.Beside,
        { enableScripts: true },
      );
      state.panel.onDidDispose(() => { state.panel = null; });
      state.panel.webview.onDidReceiveMessage(async (msg: { type: string; data: string }) => {
        if (msg.type === "download-svg") {
          const uri = await window.showSaveDialog({
            defaultUri: Uri.file("reactive-graph.svg"),
            filters: { "SVG Images": ["svg"] },
          });
          if (uri) {
            await workspace.fs.writeFile(uri, new TextEncoder().encode(msg.data));
          }
        }
      });
      context.subscriptions.push(state.panel);
    }
    state.panel.reveal(ViewColumn.Beside);

    const nonce = crypto.randomUUID().replace(HYPHEN_G, "");
    const templatePath = path.join(context.extensionPath, "dist", "webview", "reactive-graph.html");
    state.panel.webview.html = renderHtml(result.mermaid, nonce, templatePath);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error("Failed to get reactive graph", error);
    window.showErrorMessage(`Solid LSP: Failed to get reactive graph - ${error.message}`);
  }
}
