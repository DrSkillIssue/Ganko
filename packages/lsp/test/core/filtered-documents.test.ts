/**
 * FilteredTextDocuments Unit Tests
 *
 * Verifies that the filtered document manager rejects unsupported URIs
 * at the notification level — no TextDocument is allocated, stored, or evented.
 */
import { describe, it, expect, vi } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { FilteredTextDocuments } from "../../src/server/filtered-documents";
import type {
  DidOpenTextDocumentParams,
  DidChangeTextDocumentParams,
  DidCloseTextDocumentParams,
  DidSaveTextDocumentParams,
  Disposable,
  NotificationHandler,
} from "vscode-languageserver";

const NOOP_DISPOSABLE: Disposable = { dispose() {} };

/**
 * Build a mock connection that captures registered handlers.
 * Callers can simulate notifications by invoking the captured handlers directly.
 */
function createMockConnection() {
  let onOpen: NotificationHandler<DidOpenTextDocumentParams> = () => {};
  let onChange: NotificationHandler<DidChangeTextDocumentParams> = () => {};
  let onClose: NotificationHandler<DidCloseTextDocumentParams> = () => {};
  let onSave: NotificationHandler<DidSaveTextDocumentParams> = () => {};

  const connection = {
    __textDocumentSync: undefined,
    onDidOpenTextDocument(handler: NotificationHandler<DidOpenTextDocumentParams>) {
      onOpen = handler;
      return NOOP_DISPOSABLE;
    },
    onDidChangeTextDocument(handler: NotificationHandler<DidChangeTextDocumentParams>) {
      onChange = handler;
      return NOOP_DISPOSABLE;
    },
    onDidCloseTextDocument(handler: NotificationHandler<DidCloseTextDocumentParams>) {
      onClose = handler;
      return NOOP_DISPOSABLE;
    },
    onDidSaveTextDocument(handler: NotificationHandler<DidSaveTextDocumentParams>) {
      onSave = handler;
      return NOOP_DISPOSABLE;
    },
  };

  return {
    connection,
    simulateOpen(uri: string, content: string, languageId = "typescript", version = 1) {
      onOpen({ textDocument: { uri, languageId, version, text: content } });
    },
    simulateChange(uri: string, content: string, version = 2) {
      onChange({
        textDocument: { uri, version },
        contentChanges: [{ text: content }],
      });
    },
    simulateClose(uri: string) {
      onClose({ textDocument: { uri } });
    },
    simulateSave(uri: string) {
      onSave({ textDocument: { uri, version: 1 } });
    },
  };
}

/** Predicate: accept only .ts, .tsx, .css extensions. */
function acceptSupportedExtensions(uri: string): boolean {
  if (uri.endsWith(".d.ts")) return false;
  const dot = uri.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = uri.slice(dot);
  return [".ts", ".tsx", ".jsx", ".js", ".css", ".scss"].includes(ext);
}

describe("FilteredTextDocuments", () => {
  function setup() {
    const docs = new FilteredTextDocuments(TextDocument, acceptSupportedExtensions);
    const mock = createMockConnection();
    docs.listen(mock.connection);
    return { docs, mock };
  }

  describe("accepted files", () => {
    it("stores .ts documents", () => {
      const { docs, mock } = setup();
      mock.simulateOpen("file:///app/index.ts", "const x = 1;");

      expect(docs.get("file:///app/index.ts")).toBeDefined();
      expect(docs.all()).toHaveLength(1);
      expect(docs.keys()).toEqual(["file:///app/index.ts"]);
    });

    it("stores .tsx documents", () => {
      const { docs, mock } = setup();
      mock.simulateOpen("file:///app/App.tsx", "<div />");

      expect(docs.get("file:///app/App.tsx")).toBeDefined();
    });

    it("stores .css documents", () => {
      const { docs, mock } = setup();
      mock.simulateOpen("file:///app/styles.css", "body { margin: 0; }", "css");

      expect(docs.get("file:///app/styles.css")).toBeDefined();
    });

    it("stores .scss documents", () => {
      const { docs, mock } = setup();
      mock.simulateOpen("file:///app/styles.scss", "$color: red;", "scss");

      expect(docs.get("file:///app/styles.scss")).toBeDefined();
    });
  });

  describe("rejected files", () => {
    it("rejects .json files", () => {
      const { docs, mock } = setup();
      mock.simulateOpen("file:///app/package.json", "{}", "json");

      expect(docs.get("file:///app/package.json")).toBeUndefined();
      expect(docs.all()).toHaveLength(0);
    });

    it("rejects .md files", () => {
      const { docs, mock } = setup();
      mock.simulateOpen("file:///app/README.md", "# Readme", "markdown");

      expect(docs.get("file:///app/README.md")).toBeUndefined();
    });

    it("rejects .html files", () => {
      const { docs, mock } = setup();
      mock.simulateOpen("file:///app/index.html", "<html></html>", "html");

      expect(docs.get("file:///app/index.html")).toBeUndefined();
    });

    it("rejects .d.ts declaration files", () => {
      const { docs, mock } = setup();
      mock.simulateOpen("file:///app/types.d.ts", "declare const x: number;");

      expect(docs.get("file:///app/types.d.ts")).toBeUndefined();
    });

    it("rejects .yaml files", () => {
      const { docs, mock } = setup();
      mock.simulateOpen("file:///app/config.yaml", "key: value", "yaml");

      expect(docs.get("file:///app/config.yaml")).toBeUndefined();
    });

    it("rejects files without extensions", () => {
      const { docs, mock } = setup();
      mock.simulateOpen("file:///app/Makefile", "all:", "plaintext");

      expect(docs.get("file:///app/Makefile")).toBeUndefined();
    });
  });

  describe("events", () => {
    it("fires onDidOpen for accepted files", () => {
      const { docs, mock } = setup();
      const listener = vi.fn();
      docs.onDidOpen(listener);

      mock.simulateOpen("file:///app/index.ts", "const x = 1;");

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].document.uri).toBe("file:///app/index.ts");
    });

    it("does not fire onDidOpen for rejected files", () => {
      const { docs, mock } = setup();
      const listener = vi.fn();
      docs.onDidOpen(listener);

      mock.simulateOpen("file:///app/data.json", "{}");

      expect(listener).not.toHaveBeenCalled();
    });

    it("fires onDidChangeContent on open and on change for accepted files", () => {
      const { docs, mock } = setup();
      const listener = vi.fn();
      docs.onDidChangeContent(listener);

      mock.simulateOpen("file:///app/index.ts", "const x = 1;");
      expect(listener).toHaveBeenCalledOnce();

      mock.simulateChange("file:///app/index.ts", "const x = 2;");
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it("does not fire onDidChangeContent for rejected files", () => {
      const { docs, mock } = setup();
      const listener = vi.fn();
      docs.onDidChangeContent(listener);

      mock.simulateOpen("file:///app/data.json", "{}");
      mock.simulateChange("file:///app/data.json", '{"key": 1}');

      expect(listener).not.toHaveBeenCalled();
    });

    it("fires onDidClose for accepted files", () => {
      const { docs, mock } = setup();
      const listener = vi.fn();
      docs.onDidClose(listener);

      mock.simulateOpen("file:///app/index.ts", "const x = 1;");
      mock.simulateClose("file:///app/index.ts");

      expect(listener).toHaveBeenCalledOnce();
      expect(docs.get("file:///app/index.ts")).toBeUndefined();
    });

    it("does not fire onDidClose for rejected files", () => {
      const { docs, mock } = setup();
      const listener = vi.fn();
      docs.onDidClose(listener);

      mock.simulateOpen("file:///app/data.json", "{}");
      mock.simulateClose("file:///app/data.json");

      expect(listener).not.toHaveBeenCalled();
    });

    it("fires onDidSave for accepted files", () => {
      const { docs, mock } = setup();
      const listener = vi.fn();
      docs.onDidSave(listener);

      mock.simulateOpen("file:///app/index.ts", "const x = 1;");
      mock.simulateSave("file:///app/index.ts");

      expect(listener).toHaveBeenCalledOnce();
    });

    it("does not fire onDidSave for rejected files", () => {
      const { docs, mock } = setup();
      const listener = vi.fn();
      docs.onDidSave(listener);

      mock.simulateOpen("file:///app/data.json", "{}");
      mock.simulateSave("file:///app/data.json");

      expect(listener).not.toHaveBeenCalled();
    });

    it("listener disposal stops future notifications", () => {
      const { docs, mock } = setup();
      const listener = vi.fn();
      const disposable = docs.onDidOpen(listener);

      mock.simulateOpen("file:///app/a.ts", "a");
      expect(listener).toHaveBeenCalledOnce();

      disposable.dispose();

      mock.simulateOpen("file:///app/b.ts", "b");
      expect(listener).toHaveBeenCalledOnce();
    });
  });

  describe("document content", () => {
    it("updates document content on change", () => {
      const { docs, mock } = setup();
      mock.simulateOpen("file:///app/index.ts", "const x = 1;");

      const before = docs.get("file:///app/index.ts");
      expect(before?.getText()).toBe("const x = 1;");

      mock.simulateChange("file:///app/index.ts", "const x = 2;");

      const after = docs.get("file:///app/index.ts");
      expect(after?.getText()).toBe("const x = 2;");
    });

    it("ignores changes for non-tracked URIs", () => {
      const { docs, mock } = setup();
      mock.simulateChange("file:///app/nonexistent.ts", "content");

      expect(docs.all()).toHaveLength(0);
    });
  });

  describe("mixed workload", () => {
    it("only stores supported files from a batch of opens", () => {
      const { docs, mock } = setup();

      mock.simulateOpen("file:///app/index.ts", "ts");
      mock.simulateOpen("file:///app/package.json", "json");
      mock.simulateOpen("file:///app/App.tsx", "tsx");
      mock.simulateOpen("file:///app/README.md", "md");
      mock.simulateOpen("file:///app/styles.css", "css", "css");
      mock.simulateOpen("file:///app/.env", "env", "plaintext");
      mock.simulateOpen("file:///app/types.d.ts", "dts");

      expect(docs.all()).toHaveLength(3);
      expect(docs.keys()).toEqual(
        expect.arrayContaining([
          "file:///app/index.ts",
          "file:///app/App.tsx",
          "file:///app/styles.css",
        ]),
      );
    });
  });
});
