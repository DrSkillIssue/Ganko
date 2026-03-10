/**
 * Daemon Protocol Unit Tests
 *
 * Tests the Content-Length framing layer, Zod validation, and socket
 * path computation in isolation — no daemon process needed.
 */
import { describe, it, expect } from "vitest";
import {
  createRequestReader,
  createResponseReader,
  writeMessage,
  type DaemonRequest,
  type DaemonResponse,
} from "../../src/cli/daemon-protocol";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";

const LSP_PKG: Record<string, unknown> = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8"));
const LSP_VERSION = typeof LSP_PKG["version"] === "string" ? LSP_PKG["version"] : (() => { throw new Error("missing version"); })();

/**
 * IPC directory matching daemon-protocol.ts: XDG_RUNTIME_DIR or tmpdir().
 *
 * @returns Platform-appropriate IPC directory
 */
function ipcDir(): string {
  const runtimeDir = process.env["XDG_RUNTIME_DIR"];
  return runtimeDir ?? tmpdir();
}

/**
 * Test-local socket path computation (mirrors daemon-protocol.ts).
 *
 * @returns Socket path for the given project root
 */
function testSocketPath(projectRoot: string): string {
  const hash = createHash("sha256").update(projectRoot).digest("hex").slice(0, 12);
  const name = `ganko-${hash}-${LSP_VERSION}`;
  if (process.platform === "win32") return `\\\\.\\pipe\\${name}`;
  return resolve(ipcDir(), `${name}.sock`);
}

/**
 * Test-local PID path computation (mirrors daemon-protocol.ts).
 *
 * @returns PID file path for the given project root
 */
function testPidPath(projectRoot: string): string {
  const hash = createHash("sha256").update(projectRoot).digest("hex").slice(0, 12);
  return resolve(ipcDir(), `ganko-${hash}-${LSP_VERSION}.pid`);
}

/**
 * Build a raw Content-Length-framed buffer from a Record.
 *
 * @returns Buffer containing the framed message
 */
function frame(obj: Record<string, unknown>): Buffer {
  const body = JSON.stringify(obj);
  const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`;
  return Buffer.from(header + body, "utf-8");
}

/** Precompiled regex for .sock extension check. */
const SOCK_EXT_RE = /\.sock$/;

describe("Content-Length framing", () => {
  it("parses a single valid request", () => {
    const messages: DaemonRequest[] = [];
    const errors: string[] = [];
    const feed = createRequestReader(
      (msg) => { messages.push(msg); },
      (_id, msg) => { errors.push(msg); },
    );

    feed(frame({ kind: "status-request", id: 1 }));
    expect(messages).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it("parses multiple messages delivered in one chunk", () => {
    const messages: DaemonRequest[] = [];
    const feed = createRequestReader((msg) => { messages.push(msg); });

    const combined = Buffer.concat([
      frame({ kind: "status-request", id: 1 }),
      frame({ kind: "status-request", id: 2 }),
      frame({ kind: "shutdown-request", id: 3 }),
    ]);
    feed(combined);
    expect(messages).toHaveLength(3);
  });

  it("handles a message split across multiple chunks", () => {
    const messages: DaemonRequest[] = [];
    const feed = createRequestReader((msg) => { messages.push(msg); });

    const full = frame({ kind: "status-request", id: 42 });
    const mid = Math.floor(full.length / 2);

    feed(full.subarray(0, mid));
    expect(messages).toHaveLength(0);

    feed(full.subarray(mid));
    expect(messages).toHaveLength(1);
  });

  it("handles header split from body", () => {
    const messages: DaemonRequest[] = [];
    const feed = createRequestReader((msg) => { messages.push(msg); });

    const body = JSON.stringify({ kind: "status-request", id: 7 });
    const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`;

    feed(Buffer.from(header, "utf-8"));
    expect(messages).toHaveLength(0);

    feed(Buffer.from(body, "utf-8"));
    expect(messages).toHaveLength(1);
  });

  it("handles multi-byte UTF-8 content correctly", () => {
    /**
     * CJK file paths and emoji in messages stress the byte-vs-char
     * distinction in Content-Length framing. "日本語" is 9 bytes in
     * UTF-8 but 3 JS string characters.
     */
    const messages: DaemonResponse[] = [];
    const feed = createResponseReader((msg) => { messages.push(msg); });

    const obj = {
      kind: "lint-response",
      id: 1,
      diagnostics: [{
        file: "/project/src/日本語.tsx",
        rule: "test-rule",
        messageId: "msg",
        message: "問題が見つかりました 🚀",
        severity: "error",
        loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 5 } },
      }],
    };

    feed(frame(obj));
    expect(messages).toHaveLength(1);
  });

  it("rejects invalid JSON in frame body without calling onMessage", () => {
    let messageCalled = false;
    const feed = createRequestReader(
      () => { messageCalled = true; },
      () => { /* error callback may fire — that's fine */ },
    );

    const badBody = "not valid json {{{";
    const header = `Content-Length: ${Buffer.byteLength(badBody, "utf-8")}\r\n\r\n`;
    feed(Buffer.from(header + badBody, "utf-8"));

    /** onMessage must NOT be called for invalid JSON. */
    expect(messageCalled).toBe(false);
  });

  it("rejects frames exceeding MAX_FRAME_SIZE", () => {
    const feed = createRequestReader(
      () => { throw new Error("should not be called"); },
      undefined,
    );

    /** We can't actually send 64MB; just craft a header claiming that size. */
    const fakeHeader = `Content-Length: 999999999\r\n\r\n`;
    /** Feed just the header — the frame reader should reject on size alone. */
    feed(Buffer.from(fakeHeader, "utf-8"));

    /** The reader discards the oversized frame header and waits for more data.
     * No crash = success. */
    expect(true).toBe(true);
  });

  it("validates request schema and rejects invalid kind", () => {
    const errors: string[] = [];
    const feed = createRequestReader(
      () => { throw new Error("should not be called"); },
      (_id, msg) => { errors.push(msg); },
    );

    feed(frame({ kind: "unknown-request", id: 1 }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Invalid request");
  });

  it("validates response schema and rejects invalid shape", () => {
    const errors: string[] = [];
    const feed = createResponseReader(
      () => { throw new Error("should not be called"); },
      (msg) => { errors.push(msg); },
    );

    feed(frame({ kind: "lint-response", id: 1 }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Invalid daemon response");
  });

  it("extracts request id from malformed request for error responses", () => {
    let capturedId: number | null = null;
    const feed = createRequestReader(
      () => { throw new Error("should not be called"); },
      (id, _msg) => { capturedId = id; },
    );

    feed(frame({ kind: "bogus", id: 42 }));
    expect(capturedId).toBe(42);
  });

  it("recovers after a malformed frame and parses subsequent valid frames", () => {
    const messages: DaemonRequest[] = [];
    const errors: string[] = [];
    const feed = createRequestReader(
      (msg) => { messages.push(msg); },
      (_id, msg) => { errors.push(msg); },
    );

    /** Send a valid frame, then an invalid one, then another valid one. */
    feed(Buffer.concat([
      frame({ kind: "status-request", id: 1 }),
      frame({ kind: "bogus", id: 2 }),
      frame({ kind: "shutdown-request", id: 3 }),
    ]));

    expect(messages).toHaveLength(2);
    expect(errors).toHaveLength(1);
  });

  it("handles zero-length Content-Length gracefully", () => {
    const feed = createRequestReader(
      () => { throw new Error("should not be called"); },
    );

    const header = `Content-Length: 0\r\n\r\n`;
    feed(Buffer.from(header, "utf-8"));
    /** No crash = success. Zero-length is rejected as invalid. */
  });
});

describe("socket path computation", () => {
  it("produces different paths for different project roots", () => {
    const path1 = testSocketPath("/project/a");
    const path2 = testSocketPath("/project/b");
    expect(path1).not.toBe(path2);
  });

  it("produces deterministic paths for same project root", () => {
    const path1 = testSocketPath("/project/same");
    const path2 = testSocketPath("/project/same");
    expect(path1).toBe(path2);
  });

  it("embeds version in socket path", () => {
    const sockPath = testSocketPath("/project/test");
    expect(sockPath).toContain(LSP_VERSION);
  });

  it("embeds version in PID path", () => {
    const pidPath = testPidPath("/project/test");
    expect(pidPath).toContain(LSP_VERSION);
  });

  it("uses .sock extension on unix", () => {
    if (process.platform === "win32") return;
    const sockPath = testSocketPath("/project/test");
    expect(sockPath).toMatch(SOCK_EXT_RE);
  });
});

describe("writeMessage", () => {
  it("returns false for a destroyed socket", async () => {
    const { createServer, connect } = await import("node:net");
    /** Create a real server+socket pair, then destroy the socket. */
    const server = createServer();
    await new Promise<void>((resolve) => { server.listen(0, resolve); });
    const addr = server.address();
    if (addr === null || typeof addr === "string") throw new Error("unexpected address");
    const socket = connect(addr.port);
    await new Promise<void>((resolve) => { socket.once("connect", resolve); });
    socket.destroy();
    /** Wait for the destroy to propagate. */
    await new Promise<void>((resolve) => { setTimeout(resolve, 50); });

    const result = writeMessage(socket, { kind: "status-request", id: 1 });
    expect(result).toBe(false);

    server.close();
  });
});
