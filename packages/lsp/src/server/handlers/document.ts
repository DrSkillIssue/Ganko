/**
 * Document Handlers
 *
 * Handles document lifecycle events: didOpen, didChange, didSave, didClose.
 */

import type {
  TextDocumentChangeEvent,
} from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";

import { uriToPath, ALL_EXTENSIONS, canonicalPath } from "@drskillissue/ganko-shared";

/** File extensions the LSP supports for analysis (derived from @drskillissue/ganko-shared). */
const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set<string>(ALL_EXTENSIONS);

/**
 * Document state tracking.
 */
export interface DocumentState {
  readonly openDocuments: Map<string, DocumentInfo>
  readonly pathIndex: Map<string, string>
  readonly pendingChanges: Map<string, PendingChange>
  debounceTimer: ReturnType<typeof setTimeout> | null
}

/**
 * Information about an open document.
 */
export interface DocumentInfo {
  readonly uri: string
  readonly path: string
  version: number
  isDirty: boolean
  /** Version at open time — used to suppress the duplicate onDidChangeContent fired on open. */
  openVersion: number | null
}

/**
 * Pending change awaiting processing.
 */
export interface PendingChange {
  readonly uri: string
  readonly path: string
  content: string
  version: number
  timestamp: number
}

/**
 * Create initial document state.
 *
 * @returns Empty document state
 */
export function createDocumentState(): DocumentState {
  return {
    openDocuments: new Map(),
    pathIndex: new Map(),
    pendingChanges: new Map(),
    debounceTimer: null,
  };
}

/**
 * Handle document open.
 *
 * @param event - Text document change event
 * @param state - Document state to update
 * @returns Document path if supported file, null otherwise
 */
export function handleDidOpen(
  event: TextDocumentChangeEvent<TextDocument>,
  state: DocumentState,
): string | null {
  const document = event.document;
  const uri = document.uri;
  const path = uriToPath(uri);

  if (!isSupportedFile(path)) return null;

  const info: DocumentInfo = {
    uri,
    path,
    version: document.version,
    isDirty: false,
    openVersion: document.version,
  };

  state.openDocuments.set(uri, info);
  state.pathIndex.set(path, uri);

  return path;
}

/**
 * Handle document change.
 *
 * Queues the change for deferred processing. The caller is responsible
 * for debounce timer management.
 *
 * @param event - Text document change event
 * @param state - Document state to update
 * @returns True if change was queued
 */
export function handleDidChange(
  event: TextDocumentChangeEvent<TextDocument>,
  state: DocumentState,
): boolean {
  const document = event.document;
  const uri = document.uri;

  const info = state.openDocuments.get(uri);
  if (!info) return false;

  /* TextDocuments fires onDidChangeContent for the initial didOpen too.
     Skip it — onDidOpen already diagnosed this version. */
  if (info.openVersion !== null) {
    info.openVersion = null;
    return false;
  }

  info.version = document.version;
  info.isDirty = true;

  state.pendingChanges.set(uri, {
    uri,
    path: info.path,
    content: document.getText(),
    version: document.version,
    timestamp: Date.now(),
  });

  return true;
}

/**
 * Handle document save.
 *
 * @param event - Document save event
 * @param state - Document state to update
 * @returns Document path if tracked, null otherwise
 */
export function handleDidSave(
  event: TextDocumentChangeEvent<TextDocument>,
  state: DocumentState,
): string | null {
  const uri = event.document.uri;
  const info = state.openDocuments.get(uri);

  if (!info) return null;

  info.isDirty = false;
  return info.path;
}

/**
 * Handle document close.
 *
 * @param event - Text document change event
 * @param state - Document state to update
 * @returns Document path if was tracked, null otherwise
 */
export function handleDidClose(
  event: TextDocumentChangeEvent<TextDocument>,
  state: DocumentState,
): string | null {
  const uri = event.document.uri;
  const info = state.openDocuments.get(uri);

  if (!info) return null;

  state.openDocuments.delete(uri);
  state.pathIndex.delete(info.path);
  state.pendingChanges.delete(uri);

  return info.path;
}

/**
 * Get pending changes that are ready for processing.
 *
 * @param state - Document state
 * @returns Array of pending changes
 */
export function getPendingChanges(state: DocumentState): PendingChange[] {
  if (state.pendingChanges.size === 0) return [];

  const changes: PendingChange[] = new Array(state.pendingChanges.size);
  let idx = 0;
  for (const change of state.pendingChanges.values()) {
    changes[idx++] = change;
  }
  return changes;
}

/**
 * Clear pending changes after processing.
 *
 * @param state - Document state
 */
export function clearPendingChanges(state: DocumentState): void {
  state.pendingChanges.clear();
}

/**
 * Flush pending changes immediately.
 *
 * @param state - Document state
 * @returns Pending changes to process
 */
export function flushPendingChanges(state: DocumentState): PendingChange[] {
  if (state.debounceTimer !== null) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }

  const changes = getPendingChanges(state);
  clearPendingChanges(state);
  return changes;
}

/**
 * Check if debounce timer is active.
 *
 * @param state - Document state
 * @returns True if waiting for debounce
 */
export function isDebouncing(state: DocumentState): boolean {
  return state.debounceTimer !== null;
}

/**
 * Get document info by URI.
 *
 * @param state - Document state
 * @param uri - Document URI
 * @returns Document info or null
 */
export function getDocumentInfo(state: DocumentState, uri: string): DocumentInfo | null {
  return state.openDocuments.get(uri) ?? null;
}

/**
 * Get document info by path.
 *
 * @param state - Document state
 * @param path - File path
 * @returns Document info or null
 */
export function getDocumentByPath(state: DocumentState, path: string): DocumentInfo | null {
  const uri = state.pathIndex.get(canonicalPath(path));
  if (uri === undefined) return null;
  return state.openDocuments.get(uri) ?? null;
}

/**
 * Get all open document paths.
 *
 * @param state - Document state
 * @returns Array of file paths
 */
export function getOpenDocumentPaths(state: DocumentState): string[] {
  const paths: string[] = new Array(state.openDocuments.size);
  let idx = 0;
  for (const info of state.openDocuments.values()) {
    paths[idx++] = info.path;
  }
  return paths;
}

/**
 * Check if file is supported for analysis.
 * Excludes TypeScript declaration files (.d.ts) as they are type definitions, not source code.
 *
 * @param path - File path
 * @returns True if supported
 */
function isSupportedFile(path: string): boolean {
  if (path.endsWith(".d.ts")) return false;

  const extStart = path.lastIndexOf(".");
  if (extStart < 0) return false;
  const ext = path.slice(extStart);
  return SUPPORTED_EXTENSIONS.has(ext);
}
