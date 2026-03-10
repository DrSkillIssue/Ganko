/**
 * Daemon Protocol
 *
 * Cross-platform IPC path computation, Zod-validated message schemas, and
 * Content-Length framing for the ganko daemon. The daemon keeps a
 * TypeScript project service warm between `ganko lint` invocations
 * to avoid the ~2-5s startup cost on each run.
 *
 * IPC transport:
 * - Unix/macOS: Unix domain socket in $XDG_RUNTIME_DIR or /tmp
 * - Windows: Named pipe via \\.\pipe\ganko-<hash>-<version>
 *
 * Protocol: JSON-RPC 2.0 with LSP-style Content-Length framing,
 * matching the same framing the LSP server already uses.
 *
 * All message types carry a `kind` discriminant and are parsed by Zod
 * schemas — no type assertions, no type predicate functions.
 */
import { z } from "zod/v4";
import type { Diagnostic } from "@drskillissue/ganko";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve, isAbsolute } from "node:path";
import { readFileSync } from "node:fs";
import type { Socket } from "node:net";
import { LOG_LEVELS } from "@drskillissue/ganko-shared";

/** Default idle timeout before the daemon shuts itself down (5 minutes). */
export const DAEMON_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** Maximum connection retry attempts when auto-starting the daemon. */
export const MAX_CONNECT_RETRIES = 20;

/** Delay between connection retry attempts in milliseconds. */
export const CONNECT_RETRY_DELAY_MS = 100;

/** Connection timeout per attempt in milliseconds. */
export const CONNECT_TIMEOUT_MS = 2_000;

/** Maximum frame size (64 MB) to reject absurdly large messages. */
const MAX_FRAME_SIZE = 64 * 1024 * 1024;

/** Zod schema for package.json version extraction. */
const PackageJsonSchema = z.object({ version: z.string() });

/**
 * Read the ganko package version from the bundled package.json.
 *
 * Fails loudly if the file is missing or malformed — a silent fallback
 * to "0.0.0" would produce a different socket path, causing the client
 * and daemon to silently miss each other.
 */
let cachedVersion: string | undefined;

export function getVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion;
  const pkgPath = resolve(__dirname, "..", "package.json");
  let raw: string;
  try {
    raw = readFileSync(pkgPath, "utf-8");
  } catch (err) {
    throw new Error(`failed to read ${pkgPath}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  try {
    cachedVersion = PackageJsonSchema.parse(JSON.parse(raw)).version;
  } catch (err) {
    throw new Error(`failed to parse ${pkgPath}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  return cachedVersion;
}

function projectHash(projectRoot: string): string {
  return createHash("sha256").update(projectRoot).digest("hex").slice(0, 12);
}

/**
 * Compute the daemon IPC directory (platform-appropriate).
 *
 * - Unix/macOS: $XDG_RUNTIME_DIR or /tmp
 * - Windows: N/A (named pipes don't use a directory)
 */
function ipcDir(): string {
  const runtimeDir = process.env["XDG_RUNTIME_DIR"];
  return runtimeDir ?? tmpdir();
}

/**
 * Compute the platform-appropriate IPC path for a project root.
 *
 * - Unix: `/tmp/ganko-<hash>-<version>.sock`
 * - Windows: `\\.\pipe\ganko-<hash>-<version>`
 */
export function daemonSocketPath(projectRoot: string): string {
  const hash = projectHash(projectRoot);
  const version = getVersion();
  const name = `ganko-${hash}-${version}`;

  if (process.platform === "win32") {
    return `\\\\.\\pipe\\${name}`;
  }

  return resolve(ipcDir(), `${name}.sock`);
}

/**
 * PID file path, colocated with the socket for easy discovery.
 *
 * On Windows, named pipes don't use the filesystem, so the PID file
 * goes into the temp directory (same as Unix).
 */
export function daemonPidPath(projectRoot: string): string {
  const hash = projectHash(projectRoot);
  const version = getVersion();
  const name = `ganko-${hash}-${version}.pid`;
  return resolve(ipcDir(), name);
}

/**
 * Daemon log file path. Daemon logs go here since the spawned daemon
 * process has stdio: "ignore" and cannot write to the client's stderr.
 */
export function daemonLogPath(projectRoot: string): string {
  const hash = projectHash(projectRoot);
  const version = getVersion();
  const name = `ganko-${hash}-${version}.log`;
  return resolve(ipcDir(), name);
}

const LogLevelSchema = z.enum(LOG_LEVELS);

const AbsolutePathSchema = z.string().check(
  z.refine((val) => isAbsolute(val), { message: "path must be absolute" }),
);

const LintRequestParamsSchema = z.object({
  projectRoot: AbsolutePathSchema,
  files: z.array(z.string()).readonly(),
  exclude: z.array(z.string()).readonly(),
  crossFile: z.boolean(),
  eslintConfigPath: z.string().exactOptional(),
  noEslintConfig: z.boolean(),
  logLevel: LogLevelSchema,
}).readonly();

export type LintRequestParams = z.infer<typeof LintRequestParamsSchema>;

const LintRequestSchema = z.object({
  kind: z.literal("lint-request"),
  id: z.number(),
  params: LintRequestParamsSchema,
});

const ShutdownRequestSchema = z.object({
  kind: z.literal("shutdown-request"),
  id: z.number(),
});

const StatusRequestSchema = z.object({
  kind: z.literal("status-request"),
  id: z.number(),
});

const DaemonRequestSchema = z.discriminatedUnion("kind", [
  LintRequestSchema,
  ShutdownRequestSchema,
  StatusRequestSchema,
]);

export type DaemonRequest = z.infer<typeof DaemonRequestSchema>;
export type LintRequest = z.infer<typeof LintRequestSchema>;

const SourceLocationSchema = z.object({
  start: z.object({ line: z.number(), column: z.number() }).readonly(),
  end: z.object({ line: z.number(), column: z.number() }).readonly(),
}).readonly();

const FixOperationSchema = z.object({
  range: z.tuple([z.number(), z.number()]).readonly(),
  text: z.string(),
}).readonly();

const SuggestionSchema = z.object({
  messageId: z.string(),
  message: z.string(),
  fix: z.array(FixOperationSchema).readonly(),
}).readonly();

const DiagnosticSchema = z.object({
  file: z.string(),
  rule: z.string(),
  messageId: z.string(),
  message: z.string(),
  severity: z.enum(["error", "warn"]),
  loc: SourceLocationSchema,
  fix: z.array(FixOperationSchema).readonly().exactOptional(),
  suggest: z.array(SuggestionSchema).readonly().exactOptional(),
}).readonly();

/**
 * Compile-time bidirectional type check: the Zod-inferred Diagnostic
 * must be structurally identical to the canonical Diagnostic from ganko.
 * A mismatch here means the schema drifted from the source of truth.
 */
type InferredDiagnostic = z.infer<typeof DiagnosticSchema>;
type _DiagnosticForward = InferredDiagnostic extends Diagnostic ? true : never;
type _DiagnosticReverse = Diagnostic extends InferredDiagnostic ? true : never;
function _assertDiagnosticMatch<_T extends true>(): void { /* compile-time only */ }
_assertDiagnosticMatch<_DiagnosticForward>();
_assertDiagnosticMatch<_DiagnosticReverse>();

const LintResponseSchema = z.object({
  kind: z.literal("lint-response"),
  id: z.number(),
  diagnostics: z.array(DiagnosticSchema).readonly(),
});

const StatusResponseSchema = z.object({
  kind: z.literal("status-response"),
  id: z.number(),
  uptime: z.number(),
  projectRoot: z.string(),
  version: z.string(),
});

const ErrorResponseSchema = z.object({
  kind: z.literal("error-response"),
  id: z.number(),
  code: z.number(),
  message: z.string(),
});

const DaemonResponseSchema = z.discriminatedUnion("kind", [
  LintResponseSchema,
  StatusResponseSchema,
  ErrorResponseSchema,
]);

export type DaemonResponse = z.infer<typeof DaemonResponseSchema>;
export type LintResponse = z.infer<typeof LintResponseSchema>;
export type StatusResponse = z.infer<typeof StatusResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/**
 * Write a JSON-RPC message with Content-Length framing to a socket.
 *
 * Returns false if the socket is already destroyed (M4/H7 fix).
 */
export function writeMessage(socket: Socket, message: DaemonRequest | DaemonResponse): boolean {
  if (socket.destroyed) return false;
  const body = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`;
  return socket.write(header + body);
}

/** Pre-compiled regex for Content-Length header extraction. */
const CONTENT_LENGTH_RE = /Content-Length:\s*(\d+)/i;

/** CRLFCRLF separator as a Buffer for byte-accurate searching. */
const HEADER_SEPARATOR = Buffer.from("\r\n\r\n");

/**
 * Create a request reader that parses and validates incoming messages
 * as DaemonRequest via Zod schema. Invalid messages trigger the
 * onError callback so the daemon can respond with an error frame
 * instead of silently dropping them.
 */
export function createRequestReader(
  onMessage: (message: DaemonRequest) => void,
  onError?: (id: number | null, message: string) => void,
): (chunk: Buffer) => void {
  const onFrameError = onError !== undefined
    ? (msg: string) => { onError(null, msg); }
    : undefined;
  return createFrameReader((json) => {
    const result = DaemonRequestSchema.safeParse(json);
    if (result.success) {
      onMessage(result.data);
    } else if (onError !== undefined) {
      const idField = typeof json === "object" && json !== null && "id" in json ? json.id : null;
      const id = typeof idField === "number" ? idField : null;
      onError(id, `Invalid request: ${result.error.message}`);
    }
  }, onFrameError);
}

/**
 * Create a response reader that parses and validates incoming messages
 * as DaemonResponse via Zod schema.
 */
export function createResponseReader(
  onMessage: (message: DaemonResponse) => void,
  onError?: (message: string) => void,
): (chunk: Buffer) => void {
  return createFrameReader((json) => {
    const result = DaemonResponseSchema.safeParse(json);
    if (result.success) {
      onMessage(result.data);
    } else if (onError !== undefined) {
      onError(`Invalid daemon response: ${result.error.message}`);
    }
  }, onError);
}

/**
 * Low-level Content-Length frame reader.
 *
 * Uses Buffer throughout to handle multi-byte UTF-8 correctly —
 * Content-Length is in bytes, not JavaScript string characters. CJK
 * file paths, emoji in diagnostic messages, or any non-ASCII content
 * would corrupt a string-based reader.
 *
 * @param onParsed - Callback receiving parsed but unvalidated JSON
 */
function createFrameReader(
  onParsed: (json: unknown) => void,
  onFrameError?: (message: string) => void,
): (chunk: Buffer) => void {
  let buffer: Buffer = Buffer.alloc(0);
  let contentLength = -1;

  return (chunk: Buffer): void => {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);

    for (;;) {
      if (contentLength < 0) {
        // eslint-disable-next-line solid/prefer-set-lookup-in-loop -- Buffer.indexOf is a byte scan, not a collection lookup
        const sepIndex = buffer.indexOf(HEADER_SEPARATOR);
        if (sepIndex < 0) return;

        const headerStr = buffer.subarray(0, sepIndex).toString("utf-8");
        const match = CONTENT_LENGTH_RE.exec(headerStr);
        if (!match?.[1]) {
          buffer = buffer.subarray(sepIndex + 4);
          continue;
        }
        contentLength = Number(match[1]);
        if (contentLength <= 0) {
          if (onFrameError !== undefined) {
            onFrameError(`invalid Content-Length: ${contentLength}`);
          }
          buffer = buffer.subarray(sepIndex + 4);
          contentLength = -1;
          continue;
        }
        if (contentLength > MAX_FRAME_SIZE) {
          if (onFrameError !== undefined) {
            onFrameError(`frame size ${contentLength} exceeds maximum ${MAX_FRAME_SIZE}`);
          }
          buffer = buffer.subarray(sepIndex + 4);
          contentLength = -1;
          continue;
        }
        buffer = buffer.subarray(sepIndex + 4);
      }

      if (buffer.length < contentLength) return;

      const body = buffer.subarray(0, contentLength).toString("utf-8");
      buffer = buffer.subarray(contentLength);
      contentLength = -1;

      // eslint-disable-next-line solid/avoid-unsafe-type-annotations -- JSON.parse returns unknown; Zod validates in onParsed
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        if (onFrameError !== undefined) {
          onFrameError("invalid JSON in frame body");
        }
        continue;
      }
      onParsed(parsed);
    }
  };
}
