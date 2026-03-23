/**
 * DocumentTracker — Pure document lifecycle state machine.
 *
 * Like typescript-language-server's LspDocuments: document open/close/change
 * flows through a single path with version tracking and URI↔path lookup.
 *
 * PURE STATE MACHINE. Does NOT hold a compilation reference. Does NOT
 * compute affected files. Returns DocumentChange events; the server's
 * change handler calls SessionMutator separately.
 *
 * Coalescing delay (200-300ms) gates diagnostic triggers. When the delay
 * fires, the server cancels the previous CancellationSource and starts
 * a new pipeline run.
 */

import { ALL_EXTENSIONS } from "@drskillissue/ganko-shared";
import type { ResourceIdentity } from "./resource-identity";
import { ResourceMap } from "./resource-map";

const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set<string>(ALL_EXTENSIONS);

export interface TrackedDocument {
  readonly uri: string
  readonly path: string
  readonly version: number
}

export interface DocumentChange {
  readonly path: string
  readonly content: string
  readonly version: number
}

interface TrackedDocumentInternal {
  readonly uri: string
  readonly path: string
  version: number
  isDirty: boolean
  /** Version at open time — suppress duplicate onDidChangeContent fired on open. */
  openVersion: number | null
}

interface PendingChange {
  readonly path: string
  content: string
  version: number
}

export class DocumentTracker {
  private readonly byUri = new Map<string, TrackedDocumentInternal>();
  private readonly pathToUriIndex = new ResourceMap<string>();
  private readonly pending = new Map<string, PendingChange>();
  private coalescingTimer: ReturnType<typeof setTimeout> | null = null;
  private changeListeners: (() => void)[] = [];

  constructor(
    private readonly identity: ResourceIdentity,
    readonly coalescingDelayMs: number = 250,
  ) {}

  open(uri: string, path: string, version: number, _content: string): DocumentChange | null {
    if (!isSupportedFile(path)) return null;

    const tracked: TrackedDocumentInternal = {
      uri,
      path,
      version,
      isDirty: false,
      openVersion: version,
    };

    this.byUri.set(uri, tracked);
    this.pathToUriIndex.set(path, uri);
    return { path, content: _content, version };
  }

  change(uri: string, version: number, content: string): boolean {
    const tracked = this.byUri.get(uri);
    if (!tracked) return false;

    if (tracked.openVersion !== null) {
      tracked.openVersion = null;
      return false;
    }

    tracked.version = version;
    tracked.isDirty = true;

    this.pending.set(uri, {
      path: tracked.path,
      content,
      version,
    });

    this.scheduleCoalescing();
    return true;
  }

  save(uri: string): string | null {
    const tracked = this.byUri.get(uri);
    if (!tracked) return null;
    tracked.isDirty = false;
    return tracked.path;
  }

  close(uri: string): string | null {
    const tracked = this.byUri.get(uri);
    if (!tracked) return null;

    this.byUri.delete(uri);
    this.pathToUriIndex.delete(tracked.path);
    this.pending.delete(uri);
    return tracked.path;
  }

  getByUri(uri: string): TrackedDocument | null {
    const tracked = this.byUri.get(uri);
    if (!tracked) return null;
    return { uri: tracked.uri, path: tracked.path, version: tracked.version };
  }

  getByPath(path: string): TrackedDocument | null {
    const uri = this.pathToUriIndex.get(path);
    if (uri === undefined) return null;
    const tracked = this.byUri.get(uri);
    if (!tracked) return null;
    return { uri: tracked.uri, path: tracked.path, version: tracked.version };
  }

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

  drainPendingChanges(): readonly DocumentChange[] {
    if (this.pending.size === 0) return [];
    const changes: DocumentChange[] = new Array(this.pending.size);
    let idx = 0;
    for (const change of this.pending.values()) {
      changes[idx++] = change;
    }
    this.pending.clear();
    return changes;
  }

  onCoalescedChanges(callback: () => void): void {
    this.changeListeners.push(callback);
  }

  flush(): void {
    if (this.coalescingTimer !== null) {
      clearTimeout(this.coalescingTimer);
      this.coalescingTimer = null;
    }
    this.fireCoalescedChanges();
  }

  dispose(): void {
    if (this.coalescingTimer !== null) {
      clearTimeout(this.coalescingTimer);
      this.coalescingTimer = null;
    }
  }

  private scheduleCoalescing(): void {
    if (this.coalescingTimer !== null) {
      clearTimeout(this.coalescingTimer);
    }
    this.coalescingTimer = setTimeout(() => {
      this.coalescingTimer = null;
      this.fireCoalescedChanges();
    }, this.coalescingDelayMs);
  }

  private fireCoalescedChanges(): void {
    if (this.pending.size === 0) return;
    for (let i = 0; i < this.changeListeners.length; i++) {
      const listener = this.changeListeners[i];
      if (listener) listener();
    }
  }
}

function isSupportedFile(path: string): boolean {
  if (path.endsWith(".d.ts")) return false;
  const extStart = path.lastIndexOf(".");
  if (extStart < 0) return false;
  return SUPPORTED_EXTENSIONS.has(path.slice(extStart));
}
