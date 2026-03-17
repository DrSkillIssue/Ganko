/**
 * LSP Protocol Test Client
 *
 * Spawns the real ganko LSP server as a child process and communicates
 * via JSON-RPC over stdio. Provides typed helpers for the LSP lifecycle
 * (initialize → initialized → didOpen → didChange) and collects
 * `textDocument/publishDiagnostics` notifications for assertions.
 *
 * This exercises the full server pipeline including debounce timers,
 * cross-file analysis, and cache invalidation — none of which are
 * reachable through the simplified TestServer.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Diagnostic as LSPDiagnostic } from "vscode-languageserver";

const ENTRY = join(__dirname, "../../dist/entry.js");
const CONTENT_LENGTH_RE = /Content-Length:\s*(\d+)/i;

/** Published diagnostics for a single file. */
export interface PublishedDiagnostics {
  uri: string;
  version?: number | undefined;
  diagnostics: LSPDiagnostic[];
}

interface JsonRpcParams {
  [key: string]: JsonRpcParams | string | number | boolean | null | undefined | ReadonlyArray<JsonRpcParams | string | number | boolean | null>;
}

interface JsonRpcOutbound {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params: JsonRpcParams | null;
}

/**
 * Wire shape for JSON-RPC 2.0 messages. This is the type we assign to
 * `JSON.parse` output — all fields are optional because we validate
 * `jsonrpc === "2.0"` before use.
 */
interface JsonRpcWire {
  jsonrpc: string;
  id?: number;
  method?: string;
  params?: JsonRpcParams | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Validated JSON-RPC 2.0 message. `jsonrpc` is narrowed to the literal. */
interface JsonRpcMessage extends JsonRpcWire {
  jsonrpc: "2.0";
}

/** Parse raw JSON body into a validated JsonRpcMessage. Returns null on invalid input. */
function parseJsonRpcMessage(body: string): JsonRpcMessage | null {
  let raw: JsonRpcWire;
  try {
    raw = JSON.parse(body) as JsonRpcWire;
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || raw.jsonrpc !== "2.0") return null;
  return { ...raw, jsonrpc: "2.0" };
}

/**
 * LSP test client that spawns the real server and talks JSON-RPC over stdio.
 *
 * Usage:
 * ```ts
 * const client = new LSPClient(fixtureDir);
 * await client.initialize();
 * await client.openFile("/absolute/path/to/file.tsx", content);
 * await client.changeFile("/absolute/path/to/file.tsx", newContent, 2);
 * await client.waitForDiagnostics("/absolute/path/to/file.tsx");
 * client.shutdown();
 * ```
 */
export class LSPClient {
  private readonly proc: ChildProcess;
  private nextId = 1;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
  }>();
  private readonly diagnostics = new Map<string, PublishedDiagnostics>();
  private readonly diagnosticListeners: Array<(pub: PublishedDiagnostics) => void> = [];
  private buffer = "";
  private readonly rootUri: string;

  constructor(rootPath: string, logFile?: string) {
    this.rootUri = pathToFileURL(rootPath).toString();

    const args = ["--stdio"];
    if (logFile) {
      args.push("--log-file", logFile);
    }

    this.proc = spawn("node", [ENTRY, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.proc.stdout?.setEncoding("utf-8");
    this.proc.stdout?.on("data", (chunk: string) => this.onData(chunk));
    this.proc.stderr?.setEncoding("utf-8");
    this.proc.stderr?.on("data", () => { /* suppress stderr noise */ });
  }

  /** Send initialize + initialized, wait for server to be ready. */
  async initialize(extraOptions?: Record<string, unknown>): Promise<void> {
    await this.sendRequest("initialize", {
      processId: process.pid,
      rootUri: this.rootUri,
      capabilities: {
        textDocument: {
          synchronization: {
            didSave: true,
            dynamicRegistration: false,
          },
          publishDiagnostics: {
            relatedInformation: true,
            versionSupport: true,
          },
        },
        workspace: {
          didChangeWatchedFiles: { dynamicRegistration: false },
        },
      },
      initializationOptions: {
        logLevel: "warning",
        useESLintConfig: false,
        ...extraOptions,
      },
    });

    this.sendNotification("initialized", {});

    // Wait for project setup to complete — the server fires diagnostics
    // for all open files after initialized. Give it time to set up.
    await this.delay(500);
  }

  /** Open a file in the server. */
  openFile(filePath: string, content: string, languageId?: string): void {
    const uri = pathToFileURL(filePath).toString();
    const ext = filePath.slice(filePath.lastIndexOf("."));
    const lang = languageId ?? (ext === ".tsx" || ext === ".ts" ? "typescriptreact" : "css");

    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: lang,
        version: 1,
        text: content,
      },
    });
  }

  /** Send a full-content change to an open file (triggers debounce). */
  changeFile(filePath: string, content: string, version: number): void {
    const uri = pathToFileURL(filePath).toString();

    this.sendNotification("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text: content }],
    });
  }

  /** Send a workspace/didChangeWatchedFiles notification (simulates external file write). */
  sendWatchedFilesChanged(changes: ReadonlyArray<{ filePath: string; type: 1 | 2 | 3 }>): void {
    this.sendNotification("workspace/didChangeWatchedFiles", {
      changes: changes.map(c => ({
        uri: pathToFileURL(c.filePath).toString(),
        type: c.type,
      })),
    });
  }

  /** Send a save notification for an open file. */
  saveFile(filePath: string, content: string, version: number): void {
    const uri = pathToFileURL(filePath).toString();

    this.sendNotification("textDocument/didSave", {
      textDocument: { uri, version },
      text: content,
    });
  }

  /** Send a workspace/didChangeConfiguration notification. */
  sendConfigurationChange(settings: JsonRpcParams): void {
    this.sendNotification("workspace/didChangeConfiguration", { settings });
  }

  /** Close a file in the server. */
  closeFile(filePath: string): void {
    const uri = pathToFileURL(filePath).toString();
    this.sendNotification("textDocument/didClose", {
      textDocument: { uri },
    });
  }

  /** Get the latest published diagnostics for a file. */
  getPublishedDiagnostics(filePath: string): PublishedDiagnostics | undefined {
    const uri = pathToFileURL(filePath).toString();
    return this.diagnostics.get(uri);
  }

  /**
   * Wait until a `textDocument/publishDiagnostics` notification arrives
   * for the given file. Returns the diagnostics.
   *
   * @param filePath Absolute file path
   * @param timeoutMs Maximum wait time (default 10s)
   */
  waitForDiagnostics(filePath: string, timeoutMs = 10000): Promise<PublishedDiagnostics> {
    const uri = pathToFileURL(filePath).toString();

    const existing = this.diagnostics.get(uri);
    if (existing) {
      return Promise.resolve(existing);
    }

    return new Promise<PublishedDiagnostics>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.diagnosticListeners.indexOf(listener);
        if (idx >= 0) this.diagnosticListeners.splice(idx, 1);
        reject(new Error(`Timed out waiting for diagnostics for ${filePath} (${timeoutMs}ms)`));
      }, timeoutMs);

      const listener = (pub: PublishedDiagnostics) => {
        if (pub.uri === uri) {
          clearTimeout(timer);
          const idx = this.diagnosticListeners.indexOf(listener);
          if (idx >= 0) this.diagnosticListeners.splice(idx, 1);
          resolve(pub);
        }
      };

      this.diagnosticListeners.push(listener);
    });
  }

  /**
   * Wait for the NEXT diagnostics publication for a file, ignoring any
   * already-received publications. Use this after a change to wait for
   * the debounce to fire and produce fresh diagnostics.
   */
  waitForNextDiagnostics(filePath: string, timeoutMs = 10000): Promise<PublishedDiagnostics> {
    const uri = pathToFileURL(filePath).toString();

    // Clear existing so we wait for a fresh publication
    this.diagnostics.delete(uri);

    return new Promise<PublishedDiagnostics>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.diagnosticListeners.indexOf(listener);
        if (idx >= 0) this.diagnosticListeners.splice(idx, 1);
        reject(new Error(`Timed out waiting for next diagnostics for ${filePath} (${timeoutMs}ms)`));
      }, timeoutMs);

      const listener = (pub: PublishedDiagnostics) => {
        if (pub.uri === uri) {
          clearTimeout(timer);
          const idx = this.diagnosticListeners.indexOf(listener);
          if (idx >= 0) this.diagnosticListeners.splice(idx, 1);
          resolve(pub);
        }
      };

      this.diagnosticListeners.push(listener);
    });
  }

  /**
   * Collect diagnostics publications for a file. Resolves once publications
   * stop arriving (no new publication within `settleMs`) or `timeoutMs` is
   * reached. This avoids waiting the full timeout when diagnostics arrive
   * quickly.
   */
  collectDiagnostics(filePath: string, timeoutMs: number, settleMs = 800): Promise<PublishedDiagnostics[]> {
    const uri = pathToFileURL(filePath).toString();
    const collected: PublishedDiagnostics[] = [];

    return new Promise<PublishedDiagnostics[]>((resolve) => {
      let settleTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (settleTimer !== null) clearTimeout(settleTimer);
        const idx = this.diagnosticListeners.indexOf(listener);
        if (idx >= 0) this.diagnosticListeners.splice(idx, 1);
      };

      const done = () => {
        cleanup();
        resolve(collected);
      };

      const resetSettle = () => {
        if (settleTimer !== null) clearTimeout(settleTimer);
        settleTimer = setTimeout(done, settleMs);
      };

      const listener = (pub: PublishedDiagnostics) => {
        if (pub.uri === uri) {
          collected.push(pub);
          resetSettle();
        }
      };

      this.diagnosticListeners.push(listener);

      // Start initial settle timer (handles case where diagnostics arrive before this call)
      resetSettle();

      // Hard timeout — resolve with whatever we have
      setTimeout(done, timeoutMs);
    });
  }

  /** Delay helper. */
  delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Send shutdown + exit. */
  async shutdown(): Promise<void> {
    try {
      await this.sendRequest("shutdown", null, 2000);
      this.sendNotification("exit", null);
    } catch {
      // Server may already be gone
    }
    this.proc.kill();
  }

  // ── JSON-RPC transport ─────────────────────────────────────────────

  private sendRequest(method: string, params: JsonRpcParams | null, timeoutMs = 10000): Promise<unknown> {
    const id = this.nextId++;
    const msg: JsonRpcOutbound = { jsonrpc: "2.0", id, method, params };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${method} (id=${id}) timed out (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });

      this.writeMessage(msg);
    });
  }

  private sendNotification(method: string, params: JsonRpcParams | null): void {
    const msg: JsonRpcOutbound = { jsonrpc: "2.0", method, params };
    this.writeMessage(msg);
  }

  private writeMessage(msg: JsonRpcOutbound): void {
    const json = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`;
    this.proc.stdin?.write(header + json);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;

    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) break;

      const header = this.buffer.slice(0, headerEnd);
      const match = CONTENT_LENGTH_RE.exec(header);
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1] ?? "0", 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + contentLength) break;

      const body = this.buffer.slice(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.slice(bodyStart + contentLength);

      const msg = parseJsonRpcMessage(body);
      if (!msg) continue;

      this.handleMessage(msg);
    }
  }

  private handleMessage(msg: JsonRpcMessage): void {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(`LSP error: ${msg.error.message}`));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    if (msg.method !== undefined && msg.id === undefined) {
      if (msg.method === "textDocument/publishDiagnostics" && msg.params != null) {
        const p = msg.params;
        if (typeof p === "object" && "uri" in p && "diagnostics" in p) {
          const pub: PublishedDiagnostics = {
            uri: String(p["uri"]),
            diagnostics: Array.isArray(p["diagnostics"]) ? p["diagnostics"] : [],
            version: typeof p["version"] === "number" ? p["version"] : undefined,
          };
          this.diagnostics.set(pub.uri, pub);
          for (const listener of this.diagnosticListeners) {
            listener(pub);
          }
        }
      }
      return;
    }
  }
}
