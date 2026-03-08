/**
 * Server Capabilities Declaration
 *
 * Declares the capabilities of the Solid LSP server.
 * This determines what features the server advertises to clients.
 *
 * Removed features (pending re-implementation):
 * - documentSymbolProvider (required SolidGraph)
 * - workspaceSymbolProvider (required CrossFileIndex)
 * - semanticTokensProvider (required SolidGraph)
 * - inlayHintProvider (required SolidGraph)
 */

import {
  TextDocumentSyncKind,
  type ServerCapabilities,
} from "vscode-languageserver";
import { TOKEN_TYPES, TOKEN_MODIFIERS } from "./handlers/semantic-tokens";

/**
 * Trigger characters for completion.
 */
export const COMPLETION_TRIGGER_CHARS: string[] = [
  ".",  // Object property access
  "<",  // JSX tag start
  "\"", // String attributes
  "'",  // String attributes
  "/",  // Import paths
  "@",  // Decorators/directives
];

/**
 * Code action kinds supported by the server.
 */
export const CODE_ACTION_KINDS: string[] = [
  "quickfix",
];

/** Signature help trigger characters. */
const SIGNATURE_HELP_TRIGGER_CHARS: string[] = ["(", ","];
const SIGNATURE_HELP_RETRIGGER_CHARS: string[] = [")"];

/** Cached capabilities singleton. */
let cachedCapabilities: ServerCapabilities | null = null;

/**
 * Build server capabilities.
 *
 * Returns a frozen singleton for consistent capability reporting.
 *
 * @returns Server capabilities
 */
export function buildServerCapabilities(): ServerCapabilities {
  if (cachedCapabilities !== null) {
    return cachedCapabilities;
  }

  cachedCapabilities = {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    completionProvider: {
      triggerCharacters: COMPLETION_TRIGGER_CHARS,
      resolveProvider: false,
    },
    hoverProvider: true,
    definitionProvider: true,
    referencesProvider: true,
    renameProvider: {
      prepareProvider: true,
    },
    codeActionProvider: {
      codeActionKinds: CODE_ACTION_KINDS,
    },
    documentFormattingProvider: false,
    documentRangeFormattingProvider: false,
    documentHighlightProvider: true,
    documentSymbolProvider: true,
    workspaceSymbolProvider: true,
    semanticTokensProvider: {
      full: true,
      legend: {
        tokenTypes: TOKEN_TYPES,
        tokenModifiers: TOKEN_MODIFIERS,
      },
    },
    inlayHintProvider: true,
    linkedEditingRangeProvider: true,
    signatureHelpProvider: {
      triggerCharacters: SIGNATURE_HELP_TRIGGER_CHARS,
      retriggerCharacters: SIGNATURE_HELP_RETRIGGER_CHARS,
    },
    foldingRangeProvider: true,
    selectionRangeProvider: true,
    callHierarchyProvider: false,
    typeHierarchyProvider: false,
    workspace: {
      workspaceFolders: {
        supported: true,
        changeNotifications: true,
      },
      fileOperations: {
        didCreate: {
          filters: [
            { pattern: { glob: "**/eslint.config.{mjs,js,cjs}" } },
          ],
        },
        didRename: {
          filters: [
            { pattern: { glob: "**/eslint.config.{mjs,js,cjs}" } },
          ],
        },
        didDelete: {
          filters: [
            { pattern: { glob: "**/eslint.config.{mjs,js,cjs}" } },
          ],
        },
      },
    },
  };

  Object.freeze(cachedCapabilities);
  return cachedCapabilities;
}

/**
 * Minimal capabilities for degraded mode (no TypeScript project).
 *
 * @returns Minimal server capabilities
 */
export function buildMinimalCapabilities(): ServerCapabilities {
  return {
    textDocumentSync: TextDocumentSyncKind.Full,
    hoverProvider: false,
    definitionProvider: false,
    referencesProvider: false,
  };
}
