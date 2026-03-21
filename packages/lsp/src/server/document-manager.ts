/**
 * Document Manager — Coherent document lifecycle state machine.
 *
 * Replaces DocumentState (three separate Maps + manual debounce timer)
 * with a single manager that encapsulates open/change/close transitions,
 * debounced change batching, and URI↔path bidirectional lookup.
 *
 * Modeled after typescript-language-server's LspDocuments which manages
 * open/close/change as a coherent state machine with version tracking
 * and diagnostic triggering through a single path.
 */

import type { TextDocumentChangeEvent } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { ALL_EXTENSIONS } from "@drskillissue/ganko-shared";
import type { ResourceIdentity } from "./resource-identity";
import { ResourceMap } from "./resource-map";

const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set<string>(ALL_EXTENSIONS);

export const enum DocumentStatus {
  Open = 0,
  PendingChange = 1,
}

export interface TrackedDocument {
  readonly uri: string
  readonly path: string
  version: number
  isDirty: boolean
  status: DocumentStatus
  /** Version at open time — suppress duplicate onDidChangeContent fired on open. */
  openVersion: number | null
}

interface PendingChange {
  readonly uri: string
  readonly path: string
  content: string
  version: number
  timestamp: number
}

type DebouncedChangesCallback = (paths: readonly string[]) => void;

export class DocumentManager {
  /** URI → TrackedDocument */
  private readonly byUri = new Map<string, TrackedDocument>();
  /** Canonical path → URI (bidirectional lookup) */
  private readonly pathToUriIndex = new ResourceMap<string>();
  /** URI → PendingChange (queued changes awaiting debounce) */
  private readonly pending = new Map<string, PendingChange>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private changeListeners: DebouncedChangesCallback[] = [];

  constructor(
    private readonly identity: ResourceIdentity,
    private readonly debounceMs: number = 300,
  ) {}

  open(event: TextDocumentChangeEvent<TextDocument>): string | null {
    const document = event.document;
    const uri = document.uri;
    const path = this.identity.uriToPath(uri);
    if (!isSupportedFile(path)) return null;

    const tracked: TrackedDocument = {
      uri,
      path,
      version: document.version,
      isDirty: false,
      status: DocumentStatus.Open,
      openVersion: document.version,
    };

    this.byUri.set(uri, tracked);
    this.pathToUriIndex.set(path, uri);
    return path;
  }

  change(event: TextDocumentChangeEvent<TextDocument>): boolean {
    const document = event.document;
    const uri = document.uri;
    const tracked = this.byUri.get(uri);
    if (!tracked) return false;

    // TextDocuments fires onDidChangeContent for the initial didOpen too.
    // Skip it — onDidOpen already diagnosed this version.
    if (tracked.openVersion !== null) {
      tracked.openVersion = null;
      return false;
    }

    tracked.version = document.version;
    tracked.isDirty = true;
    tracked.status = DocumentStatus.PendingChange;

    this.pending.set(uri, {
      uri,
      path: tracked.path,
      content: document.getText(),
      version: document.version,
      timestamp: Date.now(),
    });

    this.scheduleDebounce();
    return true;
  }

  save(event: TextDocumentChangeEvent<TextDocument>): string | null {
    const uri = event.document.uri;
    const tracked = this.byUri.get(uri);
    if (!tracked) return null;
    tracked.isDirty = false;
    return tracked.path;
  }

  close(event: TextDocumentChangeEvent<TextDocument>): string | null {
    const uri = event.document.uri;
    const tracked = this.byUri.get(uri);
    if (!tracked) return null;

    this.byUri.delete(uri);
    this.pathToUriIndex.delete(tracked.path);
    this.pending.delete(uri);
    return tracked.path;
  }

  getByPath(path: string): TrackedDocument | null {
    const uri = this.pathToUriIndex.get(path);
    if (uri === undefined) return null;
    return this.byUri.get(uri) ?? null;
  }

  getByUri(uri: string): TrackedDocument | null {
    return this.byUri.get(uri) ?? null;
  }

  /** URI for a canonical path, or falls back to pathToUri conversion. */
  uriForPath(path: string): string {
    return this.pathToUriIndex.get(path) ?? this.identity.pathToUri(path);
  }

  openPaths(): readonly string[] {
    const paths: string[] = new Array(this.byUri.size);
    let idx = 0;
    for (const tracked of this.byUri.values()) {
      paths[idx++] = tracked.path;
    }
    return paths;
  }

  get openCount(): number {
    return this.byUri.size;
  }

  /** Consume pending changes. Returns the paths and clears the queue. */
  drainPendingChanges(): PendingChange[] {
    if (this.pending.size === 0) return [];
    const changes: PendingChange[] = new Array(this.pending.size);
    let idx = 0;
    for (const change of this.pending.values()) {
      changes[idx++] = change;
    }
    this.pending.clear();
    return changes;
  }

  onDebouncedChanges(callback: DebouncedChangesCallback): void {
    this.changeListeners.push(callback);
  }

  flush(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.fireDebouncedChanges();
  }

  get isDebouncing(): boolean {
    return this.debounceTimer !== null;
  }

  private scheduleDebounce(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.fireDebouncedChanges();
    }, this.debounceMs);
  }

  private fireDebouncedChanges(): void {
    const changes = this.drainPendingChanges();
    if (changes.length === 0) return;
    const paths = changes.map((c) => c.path);
    for (let i = 0; i < this.changeListeners.length; i++) {
      const listener = this.changeListeners[i];
      if (listener) listener(paths);
    }
  }
}

function isSupportedFile(path: string): boolean {
  if (path.endsWith(".d.ts")) return false;
  const extStart = path.lastIndexOf(".");
  if (extStart < 0) return false;
  return SUPPORTED_EXTENSIONS.has(path.slice(extStart));
}
