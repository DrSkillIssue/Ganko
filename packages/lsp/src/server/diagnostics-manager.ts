/**
 * Diagnostics Manager — Aggregates diagnostics from all sources per file.
 *
 * Replaces the separate diagCache (Map<string, Diagnostic[]>) and
 * tsDiagCache (Map<string, LSPDiagnostic[]>) with a unified manager that
 * stores diagnostics by kind and publishes merged results per file.
 *
 * Each file has a FileDiagnostics instance that debounces publication
 * to prevent rapid republish when multiple sources update simultaneously.
 *
 * Modeled after typescript-language-server's DiagnosticsManager which
 * separates syntax/semantic/suggestion diagnostics per file and debounces
 * publication through FileDiagnostics.
 */

import type { Diagnostic as LSPDiagnostic } from "vscode-languageserver"
import type { ResourceIdentity } from "./resource-identity"
import { ResourceMap } from "./resource-map"

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
 * Debounces publication to prevent rapid republish when multiple
 * diagnostic sources update the same file in quick succession.
 */
class FileDiagnostics {
  private readonly byKind = new Map<DiagnosticKind, readonly LSPDiagnostic[]>()
  private publishTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  constructor(
    private readonly path: string,
    private readonly publishFn: (path: string, diagnostics: readonly LSPDiagnostic[]) => void,
    private readonly debounceMs: number,
  ) {}

  update(kind: DiagnosticKind, diagnostics: readonly LSPDiagnostic[]): void {
    if (this.closed) return
    const existing = this.byKind.get(kind)
    if (existing !== undefined && existing.length === 0 && diagnostics.length === 0) return
    this.byKind.set(kind, diagnostics)
    this.schedulePublish()
  }

  clear(kind: DiagnosticKind): void {
    if (!this.byKind.has(kind)) return
    this.byKind.delete(kind)
    this.schedulePublish()
  }

  clearAll(): void {
    this.byKind.clear()
    this.cancelPending()
    this.publishFn(this.path, [])
  }

  getDiagnostics(): readonly LSPDiagnostic[] {
    let total = 0
    for (const diags of this.byKind.values()) total += diags.length
    if (total === 0) return []
    const merged = new Array<LSPDiagnostic>(total)
    let idx = 0
    for (const diags of this.byKind.values()) {
      for (let i = 0; i < diags.length; i++) {
        const d = diags[i]
        if (d) merged[idx++] = d
      }
    }
    return merged
  }

  getDiagnosticsByKind(kind: DiagnosticKind): readonly LSPDiagnostic[] {
    return this.byKind.get(kind) ?? []
  }

  close(): void {
    this.closed = true
    this.cancelPending()
    this.byKind.clear()
    this.publishFn(this.path, [])
  }

  private schedulePublish(): void {
    if (this.publishTimer !== null) return
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null
      if (!this.closed) this.publishFn(this.path, this.getDiagnostics())
    }, this.debounceMs)
  }

  private cancelPending(): void {
    if (this.publishTimer !== null) {
      clearTimeout(this.publishTimer)
      this.publishTimer = null
    }
  }
}

/**
 * Aggregates diagnostics from all sources per file.
 *
 * Consumers call `update(path, kind, diagnostics)` from each diagnostic
 * source. Publication is debounced per file — rapid updates from ganko
 * single-file + cross-file + TypeScript coalesce into a single publish.
 */
export class DiagnosticsManager {
  private readonly files = new ResourceMap<FileDiagnostics>()

  constructor(
    private readonly identity: ResourceIdentity,
    private readonly publishFn: (uri: string, diagnostics: readonly LSPDiagnostic[]) => void,
    private readonly debounceMs = 50,
  ) {}

  update(path: string, kind: DiagnosticKind, diagnostics: readonly LSPDiagnostic[]): void {
    let file = this.files.get(path)
    if (!file) {
      file = new FileDiagnostics(path, this.publish, this.debounceMs)
      this.files.set(path, file)
    }
    file.update(kind, diagnostics)
  }

  getDiagnostics(path: string): readonly LSPDiagnostic[] {
    return this.files.get(path)?.getDiagnostics() ?? []
  }

  getDiagnosticsByKind(path: string, kind: DiagnosticKind): readonly LSPDiagnostic[] {
    return this.files.get(path)?.getDiagnosticsByKind(kind) ?? []
  }

  evict(path: string): void {
    this.files.get(path)?.clearAll()
  }

  onClose(path: string): void {
    const file = this.files.get(path)
    if (file) {
      file.close()
      this.files.delete(path)
    }
  }

  republish(path: string): void {
    const file = this.files.get(path)
    if (file) this.publishFn(this.identity.pathToUri(path), file.getDiagnostics())
  }

  clear(): void {
    this.files.forEach((file) => file.clearAll())
    this.files.clear()
  }

  private publish = (path: string, diagnostics: readonly LSPDiagnostic[]): void => {
    this.publishFn(this.identity.pathToUri(path), diagnostics)
  }
}
