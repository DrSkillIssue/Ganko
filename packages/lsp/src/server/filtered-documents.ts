/**
 * Filtered Text Document Manager
 *
 * Drop-in replacement for vscode-languageserver's TextDocuments that gates
 * document storage on a URI predicate. Documents that fail the predicate
 * are never allocated, stored, or evented — the editor's didOpen notification
 * is silently consumed and no TextDocument is created.
 *
 * This prevents unbounded memory growth when editors send notifications for
 * file types the server does not analyze (e.g., .json, .md, .html).
 */
import {
  TextDocumentSyncKind,
  type DidOpenTextDocumentParams,
  type DidChangeTextDocumentParams,
  type DidCloseTextDocumentParams,
  type DidSaveTextDocumentParams,
  type NotificationHandler,
  type Disposable,
} from "vscode-languageserver";
import type { TextDocument, TextDocumentContentChangeEvent } from "vscode-languageserver-textdocument";

/**
 * Minimal connection interface for text document notifications.
 * Matches the subset of Connection used by TextDocuments.listen().
 */
interface DocumentConnection {
  onDidOpenTextDocument(handler: NotificationHandler<DidOpenTextDocumentParams>): Disposable
  onDidChangeTextDocument(handler: NotificationHandler<DidChangeTextDocumentParams>): Disposable
  onDidCloseTextDocument(handler: NotificationHandler<DidCloseTextDocumentParams>): Disposable
  onDidSaveTextDocument(handler: NotificationHandler<DidSaveTextDocumentParams>): Disposable
  __textDocumentSync?: TextDocumentSyncKind
}

/** Event payload for document lifecycle events. */
interface DocumentChangeEvent {
  readonly document: TextDocument
}

/**
 * Factory interface for creating and updating TextDocument instances.
 * Matches the TextDocumentsConfiguration<T> contract from vscode-languageserver.
 */
interface DocumentFactory {
  create(uri: string, languageId: string, version: number, content: string): TextDocument
  update(document: TextDocument, changes: TextDocumentContentChangeEvent[], version: number): TextDocument
}

/**
 * Predicate that determines whether a URI should be accepted by the document manager.
 * Receives the raw URI string from the LSP notification (e.g., "file:///path/to/file.ts").
 */
type UriPredicate = (uri: string) => boolean;

/** Event subscription function matching vscode-languageserver's Event<T> contract. */
type EventSubscription<T> = (listener: (e: T) => void) => Disposable;

/**
 * Minimal event emitter.
 *
 * Implements the Event<T> callable contract without depending on
 * vscode-jsonrpc's Emitter class (which is not part of the public API).
 */
interface MiniEmitter<T> {
  readonly event: EventSubscription<T>
  fire(data: T): void
}

function createEmitter<T>(): MiniEmitter<T> {
  const listeners: Array<(e: T) => void> = [];

  const event: EventSubscription<T> = (listener) => {
    listeners.push(listener);
    let removed = false;
    return {
      dispose() {
        if (removed) return;
        removed = true;
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      },
    };
  };

  return {
    event,
    fire(data: T) {
      for (let i = 0; i < listeners.length; i++) {
        listeners[i]?.(data);
      }
    },
  };
}

/**
 * Filtered text document manager.
 *
 * Identical API surface to vscode-languageserver's TextDocuments but gates all
 * storage behind a URI predicate. Documents whose URI fails the predicate are
 * never created, stored, or evented — zero memory allocated for rejected files.
 */
export class FilteredTextDocuments {
  private readonly _factory: DocumentFactory;
  private readonly _accept: UriPredicate;
  private readonly _documents = new Map<string, TextDocument>();

  private readonly _onDidOpen = createEmitter<DocumentChangeEvent>();
  private readonly _onDidChangeContent = createEmitter<DocumentChangeEvent>();
  private readonly _onDidSave = createEmitter<DocumentChangeEvent>();
  private readonly _onDidClose = createEmitter<DocumentChangeEvent>();

  constructor(factory: DocumentFactory, accept: UriPredicate) {
    this._factory = factory;
    this._accept = accept;
  }

  /** Event fired when a supported document is opened. */
  get onDidOpen() { return this._onDidOpen.event; }

  /** Event fired when a supported document's content changes (including initial open). */
  get onDidChangeContent() { return this._onDidChangeContent.event; }

  /** Event fired when a supported document is saved. */
  get onDidSave() { return this._onDidSave.event; }

  /** Event fired when a supported document is closed. */
  get onDidClose() { return this._onDidClose.event; }

  /**
   * Retrieve a stored document by URI.
   *
   * @param uri - Document URI
   * @returns The TextDocument, or undefined if not stored
   */
  get(uri: string): TextDocument | undefined {
    return this._documents.get(uri);
  }

  /**
   * Return all stored documents.
   *
   * @returns Array of TextDocument instances (only accepted documents)
   */
  all(): TextDocument[] {
    return Array.from(this._documents.values());
  }

  /**
   * Return URIs of all stored documents.
   *
   * @returns Array of URI strings
   */
  keys(): string[] {
    return Array.from(this._documents.keys());
  }

  /**
   * Register notification handlers on the LSP connection.
   *
   * Replaces the connection's textDocument/didOpen, didChange, didClose,
   * and didSave handlers. Only documents passing the URI predicate are stored.
   *
   * @param connection - LSP connection to listen on
   * @returns Disposable to unregister all handlers
   */
  listen(connection: DocumentConnection): Disposable {
    connection.__textDocumentSync = TextDocumentSyncKind.Incremental;

    const disposables: Disposable[] = [];

    disposables.push(connection.onDidOpenTextDocument((params: DidOpenTextDocumentParams) => {
      const td = params.textDocument;
      if (!this._accept(td.uri)) return;

      const document = this._factory.create(td.uri, td.languageId, td.version, td.text);
      this._documents.set(td.uri, document);

      const frozen = Object.freeze({ document });
      this._onDidOpen.fire(frozen);
      this._onDidChangeContent.fire(frozen);
    }));

    disposables.push(connection.onDidChangeTextDocument((params: DidChangeTextDocumentParams) => {
      const changes = params.contentChanges;
      if (changes.length === 0) return;

      const td = params.textDocument;
      const { version } = td;
      if (version === null || version === undefined) {
        throw new Error(`Received document change event for ${td.uri} without valid version identifier`);
      }

      let synced = this._documents.get(td.uri);
      if (synced === undefined) return;

      synced = this._factory.update(synced, changes, version);
      this._documents.set(td.uri, synced);
      this._onDidChangeContent.fire(Object.freeze({ document: synced }));
    }));

    disposables.push(connection.onDidCloseTextDocument((params: DidCloseTextDocumentParams) => {
      const synced = this._documents.get(params.textDocument.uri);
      if (synced === undefined) return;

      this._documents.delete(params.textDocument.uri);
      this._onDidClose.fire(Object.freeze({ document: synced }));
    }));

    disposables.push(connection.onDidSaveTextDocument((params: DidSaveTextDocumentParams) => {
      const synced = this._documents.get(params.textDocument.uri);
      if (synced === undefined) return;

      this._onDidSave.fire(Object.freeze({ document: synced }));
    }));

    return {
      dispose() {
        for (const d of disposables) d.dispose();
      },
    };
  }
}
