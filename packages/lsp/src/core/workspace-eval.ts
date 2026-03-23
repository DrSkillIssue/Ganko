/**
 * Workspace Evaluator — Persistent subprocess for project-context module evaluation.
 *
 * The compiled ganko binary runs in Bun's embedded virtual filesystem where
 * `import()` cannot resolve the target project's dependencies. The evaluator
 * spawns a single persistent `bun` subprocess in the project's cwd, which
 * has the project's full module resolution context.
 *
 * The subprocess accepts newline-delimited JSON requests on stdin and writes
 * newline-delimited JSON responses to stdout. It stays alive for the lifetime
 * of the analysis run, handling:
 *
 * 1. ESLint config evaluation
 * 2. Tailwind design system loading
 * 3. Tailwind class validation batches (candidatesToCss)
 *
 * One subprocess, one persistent connection, zero per-query spawn overhead.
 */
import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from "node:child_process";
import type { Logger } from "@drskillissue/ganko-shared";
import { Level, getRuntime } from "@drskillissue/ganko-shared";

export interface WorkspaceEvalRequest {
  readonly id: number
  readonly type: "eslint" | "tailwind-init" | "tailwind-validate" | "tailwind-resolve"
  readonly eslintConfigPath?: string
  readonly tailwindModulePath?: string
  readonly tailwindEntryCss?: string
  readonly tailwindEntryBase?: string
  readonly classNames?: readonly string[]
  readonly className?: string
}

export interface WorkspaceEvalResponse {
  readonly id: number
  readonly eslint?: {
    readonly configs: readonly {
      rules?: Record<string, unknown>
      ignores?: string[]
      files?: true
      plugins?: true
    }[]
  }
  readonly tailwind?: {
    readonly utilities: string[]
    readonly variants: { name: string; values: string[]; hasDash: boolean; isArbitrary: boolean }[]
  }
  readonly validation?: readonly (boolean)[]
  readonly resolution?: string | null
  readonly error?: string
}

/**
 * Subprocess script. Reads newline-delimited JSON from stdin, processes each
 * request, writes newline-delimited JSON to stdout.
 *
 * Keeps the Tailwind DesignSystem in memory after init for subsequent
 * validate/resolve calls.
 */
const EVAL_SCRIPT = `
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";

let design = null;

const rl = createInterface({ input: process.stdin });

for await (const line of rl) {
  if (line.length === 0) continue;
  const req = JSON.parse(line);
  const res = { id: req.id };

  try {
    if (req.type === "eslint" && req.eslintConfigPath) {
      const mod = await import(pathToFileURL(req.eslintConfigPath).href);
      const raw = mod.default ?? mod;
      const configs = Array.isArray(raw) ? raw : [raw];
      const out = [];
      for (const c of configs) {
        if (c === null || c === undefined || typeof c !== "object") continue;
        const entry = {};
        if (c.rules && typeof c.rules === "object") {
          const rules = {};
          for (const [k, v] of Object.entries(c.rules)) {
            if (Array.isArray(v)) rules[k] = v[0];
            else rules[k] = v;
          }
          entry.rules = rules;
        }
        if (c.ignores && Array.isArray(c.ignores)) entry.ignores = c.ignores;
        if (c.files !== undefined) entry.files = true;
        if (c.plugins !== undefined) entry.plugins = true;
        out.push(entry);
      }
      res.eslint = { configs: out };
    }

    if (req.type === "tailwind-init" && req.tailwindModulePath) {
      const { __unstable__loadDesignSystem } = await import(req.tailwindModulePath);
      design = await __unstable__loadDesignSystem(
        req.tailwindEntryCss,
        { base: req.tailwindEntryBase },
      );
      const utilities = design.getClassList().map(e => e[0]);
      const variants = design.getVariants().map(v => ({
        name: v.name,
        values: v.values ?? [],
        hasDash: v.hasDash ?? false,
        isArbitrary: v.isArbitrary ?? false,
      }));
      res.tailwind = { utilities, variants };
    }

    if (req.type === "tailwind-validate" && design && req.classNames) {
      const results = design.candidatesToCss(req.classNames);
      res.validation = results.map(r => r !== null);
    }

    if (req.type === "tailwind-resolve" && design && req.className) {
      const results = design.candidatesToCss([req.className]);
      res.resolution = results[0] ?? null;
    }
  } catch (e) {
    res.error = e instanceof Error ? e.message : String(e);
  }

  process.stdout.write(JSON.stringify(res) + "\\n");
}
`;

export interface WorkspaceEvaluator {
  request(req: WorkspaceEvalRequest): Promise<WorkspaceEvalResponse>
  dispose(): void
}

/**
 * Spawn a persistent workspace evaluator subprocess.
 *
 * @param cwd - Project root directory
 * @param log - Logger
 * @returns Evaluator with request/response interface
 */
export function spawnWorkspaceEvaluator(cwd: string, log?: Logger): WorkspaceEvaluator {
  const proc = nodeSpawn(getRuntime(), ["-e", EVAL_SCRIPT], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let nextId = 1;
  const pending = new Map<number, { resolve: (r: WorkspaceEvalResponse) => void; reject: (e: Error) => void }>();
  let buffer = "";

  function processChunk(chunk: string): void {
    buffer += chunk;
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      if (line.length === 0) continue;
      try {
        const response: WorkspaceEvalResponse = JSON.parse(line);
        const entry = pending.get(response.id);
        if (entry) {
          pending.delete(response.id);
          entry.resolve(response);
        }
      } catch {
        if (log?.isLevelEnabled(Level.Warning)) log.warning(`workspaceEval: failed to parse response: ${line.slice(0, 100)}`);
      }
    }
  }

  const stdout = proc.stdout;
  if (!stdout) throw new Error("workspace evaluator: stdout not available (stdio misconfigured)");
  stdout.setEncoding("utf-8");
  stdout.on("data", (chunk: string) => processChunk(chunk));
  proc.on("close", () => {
    for (const [, entry] of pending) {
      entry.reject(new Error("workspace evaluator subprocess exited"));
    }
    pending.clear();
  });

  return {
    request(req: WorkspaceEvalRequest): Promise<WorkspaceEvalResponse> {
      const id = nextId++;
      const reqWithId = { ...req, id };
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        proc.stdin!.write(JSON.stringify(reqWithId) + "\n");
      });
    },

    dispose(): void {
      proc.stdin!.end();
      proc.kill();
    },
  };
}

/**
 * One-shot evaluation — spawns, sends one request, reads one response, kills.
 *
 * Used when a persistent evaluator isn't needed (e.g. ESLint config reload).
 *
 * @param cwd - Project root directory
 * @param req - Request to evaluate
 * @param log - Logger
 * @returns Response, or null on failure
 */
export async function evaluateWorkspace(
  cwd: string,
  req: Omit<WorkspaceEvalRequest, "id">,
  log?: Logger,
): Promise<WorkspaceEvalResponse | null> {
  const evaluator = spawnWorkspaceEvaluator(cwd, log);
  try {
    return await evaluator.request({ ...req, id: 1 });
  } catch (e) {
    if (log?.isLevelEnabled(Level.Warning)) log.warning(`workspaceEval: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    evaluator.dispose();
  }
}

/**
 * Synchronous one-shot evaluation using Bun.spawnSync.
 *
 * @param cwd - Project root directory
 * @param req - Request to evaluate
 * @returns Response, or null on failure
 */
export function evaluateWorkspaceSync(
  cwd: string,
  req: Omit<WorkspaceEvalRequest, "id">,
): WorkspaceEvalResponse | null {
  const reqJson = JSON.stringify({ ...req, id: 1 });
  const script = `
import { pathToFileURL } from "node:url";
const req = JSON.parse(${JSON.stringify(reqJson)});
const res = { id: 1 };
try {
  if (req.type === "eslint" && req.eslintConfigPath) {
    const mod = await import(pathToFileURL(req.eslintConfigPath).href);
    const raw = mod.default ?? mod;
    const configs = Array.isArray(raw) ? raw : [raw];
    const out = [];
    for (const c of configs) {
      if (!c || typeof c !== "object") continue;
      const entry = {};
      if (c.rules && typeof c.rules === "object") {
        const rules = {};
        for (const [k, v] of Object.entries(c.rules)) {
          rules[k] = Array.isArray(v) ? v[0] : v;
        }
        entry.rules = rules;
      }
      if (c.ignores && Array.isArray(c.ignores)) entry.ignores = c.ignores;
      if (c.files !== undefined) entry.files = true;
      if (c.plugins !== undefined) entry.plugins = true;
      out.push(entry);
    }
    res.eslint = { configs: out };
  }
  if (req.type === "tailwind-init" && req.tailwindModulePath) {
    const { __unstable__loadDesignSystem } = await import(req.tailwindModulePath);
    const d = await __unstable__loadDesignSystem(req.tailwindEntryCss, { base: req.tailwindEntryBase });
    res.tailwind = {
      utilities: d.getClassList().map(e => e[0]),
      variants: d.getVariants().map(v => ({ name: v.name, values: v.values ?? [], hasDash: v.hasDash ?? false, isArbitrary: v.isArbitrary ?? false })),
    };
  }
} catch (e) { res.error = e instanceof Error ? e.message : String(e); }
process.stdout.write(JSON.stringify(res));
`;

  try {
    const result = nodeSpawnSync(getRuntime(), ["-e", script], { cwd, encoding: "utf-8", timeout: 30000 });
    if (result.status !== 0 && (!result.stdout || result.stdout.length === 0)) return null;
    const text = typeof result.stdout === "string" ? result.stdout : String(result.stdout ?? "");
    if (text.length === 0) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}
