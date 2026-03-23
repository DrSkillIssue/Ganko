/**
 * Runtime detection for subprocess spawning.
 *
 * Compiled Bun binaries cannot re-exec themselves to run scripts —
 * process.execPath points to the binary, not a JS runtime.
 * All subprocess spawning must use the detected runtime binary name
 * so that both `bun` and `node` environments work correctly.
 */

/**
 * Returns `"bun"` or `"node"` — the runtime command that can execute JS files.
 *
 * In a compiled Bun binary, process.execPath is the binary itself (not `bun`).
 * In a `bun run` context, process.execPath is the bun binary.
 * In a `node` context, process.execPath is the node binary.
 *
 * For subprocess spawning, always use this instead of process.execPath
 * to ensure the spawned process can actually execute JavaScript.
 */
/** @returns `"bun"` when running under Bun, `"node"` when running under Node.js. */
export function getRuntime(): "bun" | "node" {
  return process.versions["bun"] !== undefined ? "bun" : "node";
}
