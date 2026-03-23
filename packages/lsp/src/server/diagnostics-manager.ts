/**
 * Diagnostics Manager — Aggregates diagnostics from all sources per file.
 *
 * Replaces the separate diagCache (Map<string, Diagnostic[]>) and
 * tsDiagCache (Map<string, LSPDiagnostic[]>) with a unified manager that
 * stores diagnostics by kind and publishes merged results per file.
 *
 * Each file has a FileDiagnostics instance that publishes immediately
 * when any diagnostic source updates — unless a batch is active, in which
 * case publication is deferred until the batch ends. Callers use
 * `beginBatch()` / `endBatch()` to coalesce multiple kind updates for
 * the same file into a single publish.
 *
 * Debouncing is handled upstream by DocumentManager (keystroke coalescing),
 * so no timer-based debounce is needed here.
 */

import type { Diagnostic as LSPDiagnostic } from "vscode-languageserver";
import type { Diagnostic as GankoDiagnostic } from "@drskillissue/ganko";
import type { ResourceIdentity } from "./resource-identity";
import { ResourceMap } from "./resource-map";

export const enum DiagnosticKind {
  /** Ganko single-file analysis (Solid rules). */
  Ganko = 0,
  /** Ganko cross-file analysis (layout, CSS cascade). */
  CrossFile = 1,
  /** TypeScript syntactic + semantic diagnostics. */
  TypeScript = 2,
}

/**
 * Per-file diagnostic state. Stores diagnostics separated by kind.
 * Publishes immediately on update unless suppressed by batch mode.
 */
class FileDiagnostics {
  private readonly byKind = new Map<DiagnosticKind, readonly LSPDiagnostic[]>();
  /** Raw ganko diagnostics (Ganko + CrossFile kinds). Used by code-action handler. */
  private readonly rawByKind = new Map<DiagnosticKind, readonly GankoDiagnostic[]>();
  private closed = false;
  suppressPublish = false;
  dirty = false;

  constructor(
    private readonly path: string,
    private readonly publishFn: (path: string, diagnostics: readonly LSPDiagnostic[]) => void,
  ) {}

  update(kind: DiagnosticKind, diagnostics: readonly LSPDiagnostic[], rawDiags?: readonly GankoDiagnostic[]): void {
    if (this.closed) return;
    const existing = this.byKind.get(kind);
    if (existing !== undefined && existing.length === 0 && diagnostics.length === 0) return;
    this.byKind.set(kind, diagnostics);
    if (rawDiags !== undefined) {
      this.rawByKind.set(kind, rawDiags);
    }
    if (this.suppressPublish) {
      this.dirty = true;
    } else if (!this.closed) {
      this.publishFn(this.path, this.getDiagnostics());
    }
  }

  clear(kind: DiagnosticKind): void {
    if (!this.byKind.has(kind)) return;
    this.byKind.delete(kind);
    this.rawByKind.delete(kind);
    if (this.suppressPublish) {
      this.dirty = true;
    } else if (!this.closed) {
      this.publishFn(this.path, this.getDiagnostics());
    }
  }

  clearAll(): void {
    this.byKind.clear();
    this.rawByKind.clear();
    this.publishFn(this.path, []);
  }

  flush(): void {
    if (this.dirty && !this.closed) {
      this.dirty = false;
      this.publishFn(this.path, this.getDiagnostics());
    }
  }

  getDiagnostics(): readonly LSPDiagnostic[] {
    const merged: LSPDiagnostic[] = [];
    for (const diags of this.byKind.values()) {
      for (let i = 0; i < diags.length; i++) {
        const d = diags[i];
        if (d) merged.push(d);
      }
    }
    return merged;
  }

  getDiagnosticsByKind(kind: DiagnosticKind): readonly LSPDiagnostic[] {
    return this.byKind.get(kind) ?? [];
  }

  /** Get merged raw ganko diagnostics (Ganko + CrossFile kinds). */
  getRawDiagnostics(): readonly GankoDiagnostic[] {
    const ganko = this.rawByKind.get(DiagnosticKind.Ganko);
    const crossFile = this.rawByKind.get(DiagnosticKind.CrossFile);
    if (ganko === undefined && crossFile === undefined) return [];
    if (ganko === undefined) return crossFile ?? [];
    if (crossFile === undefined) return ganko;
    const merged: GankoDiagnostic[] = new Array(ganko.length + crossFile.length);
    let idx = 0;
    for (let i = 0; i < ganko.length; i++) { const d = ganko[i]; if (d) merged[idx++] = d; }
    for (let i = 0; i < crossFile.length; i++) { const d = crossFile[i]; if (d) merged[idx++] = d; }
    return merged.length === idx ? merged : merged.slice(0, idx);
  }

  close(): void {
    this.closed = true;
    this.byKind.clear();
    this.rawByKind.clear();
    this.publishFn(this.path, []);
  }
}

/**
 * Aggregates diagnostics from all sources per file.
 *
 * Consumers call `update(path, kind, diagnostics)` from each diagnostic
 * source. Each update publishes immediately with all kinds merged, unless
 * inside a `beginBatch()` / `endBatch()` block which coalesces updates.
 */
export class DiagnosticsManager {
  private readonly files = new ResourceMap<FileDiagnostics>();
  private batchDepth = 0;
  private batchDirty: FileDiagnostics[] | null = null;

  constructor(
    private readonly identity: ResourceIdentity,
    private readonly publishFn: (uri: string, diagnostics: readonly LSPDiagnostic[]) => void,
  ) {}

  beginBatch(): void {
    if (this.batchDepth++ === 0) {
      this.batchDirty = [];
    }
  }

  endBatch(): void {
    if (--this.batchDepth === 0 && this.batchDirty !== null) {
      const dirty = this.batchDirty;
      this.batchDirty = null;
      for (let i = 0; i < dirty.length; i++) {
        const f = dirty[i];
        if (!f) continue;
        f.suppressPublish = false;
        f.flush();
      }
    }
  }

  update(path: string, kind: DiagnosticKind, diagnostics: readonly LSPDiagnostic[], rawDiags?: readonly GankoDiagnostic[]): void {
    let file = this.files.get(path);
    if (!file) {
      file = new FileDiagnostics(path, this.publish);
      this.files.set(path, file);
    }
    if (this.batchDepth > 0 && this.batchDirty !== null && !file.suppressPublish) {
      file.suppressPublish = true;
      this.batchDirty.push(file);
    }
    file.update(kind, diagnostics, rawDiags);
  }

  getDiagnostics(path: string): readonly LSPDiagnostic[] {
    return this.files.get(path)?.getDiagnostics() ?? [];
  }

  getDiagnosticsByKind(path: string, kind: DiagnosticKind): readonly LSPDiagnostic[] {
    return this.files.get(path)?.getDiagnosticsByKind(kind) ?? [];
  }

  /** Get raw ganko diagnostics for a file (Ganko + CrossFile kinds merged).
   *  Used by code-action handler for fix extraction. Replaces diagCache. */
  getRawDiagnostics(path: string): readonly GankoDiagnostic[] {
    return this.files.get(path)?.getRawDiagnostics() ?? [];
  }

  evict(path: string): void {
    const file = this.files.get(path);
    if (file) {
      this.files.delete(path);
    }
  }

  onClose(path: string): void {
    const file = this.files.get(path);
    if (file) {
      file.close();
      this.files.delete(path);
    }
  }

  republish(path: string): void {
    const file = this.files.get(path);
    if (file) this.publishFn(this.identity.pathToUri(path), file.getDiagnostics());
  }

  clear(): void {
    this.files.forEach((file) => file.clearAll());
    this.files.clear();
  }

  private publish = (path: string, diagnostics: readonly LSPDiagnostic[]): void => {
    this.publishFn(this.identity.pathToUri(path), diagnostics);
  };
}
