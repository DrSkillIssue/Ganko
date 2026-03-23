/**
 * Server Capabilities Declaration
 *
 * Declares the capabilities of the Solid LSP server.
 * This determines what features the server advertises to clients.
 *
 * Removed features (pending re-implementation):
 * - documentSymbolProvider (required SolidSyntaxTree)
 * - workspaceSymbolProvider (required CrossFileIndex)
 * - semanticTokensProvider (required SolidSyntaxTree)
 * - inlayHintProvider (required SolidSyntaxTree)
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

/**
 * Build server capabilities.
 *
 * @param pullDiagnostics - Advertise `diagnosticProvider` (LSP 3.17 pull model).
 *   Set to `true` only when the client is an AI agent that will use pull
 *   diagnostics exclusively (e.g. `--warnings-as-errors` mode).
 *
 *   **Why this matters:** When a server advertises `diagnosticProvider`, VS Code
 *   and other pull-capable clients enter pull-exclusive mode and suppress push
 *   (`publishDiagnostics`) notifications for open files. If we unconditionally
 *   advertise pull, interactive editing in VS Code stops receiving real-time
 *   diagnostic updates (push notifications are silently dropped). AI agents
 *   like opencode use pull exclusively anyway, so they are unaffected by the
 *   absence of push — but they benefit from pull's synchronous guarantee.
 *
 * @returns Server capabilities
 */
export function buildServerCapabilities(pullDiagnostics = false): ServerCapabilities {
  const caps: ServerCapabilities = {
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

  if (pullDiagnostics) {
    caps.diagnosticProvider = {
      interFileDependencies: true,
      workspaceDiagnostics: false,
    };
  }

  return caps;
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
