/**
 * Code Action Handler
 *
 * Converts ganko diagnostic fixes to LSP code actions.
 */

import {
  type CodeActionParams,
  type CodeAction,
  CodeActionKind,
  type TextEdit,
  type Position,
  type Diagnostic as LSPDiagnostic,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import type { Diagnostic, Fix, FixOperation } from "@drskillissue/ganko";
import type { FeatureHandlerContext } from "./handler-context";
import { toLSPDiagnostic } from "./diagnostics";
import { uriToCanonicalPath, Level } from "@drskillissue/ganko-shared";

const KIND_QUICKFIX = CodeActionKind.QuickFix;
const KIND_SUPPRESS = `${CodeActionKind.QuickFix}.suppress`;

/**
 * Handle textDocument/codeAction request.
 *
 * Returns quickfix actions from ganko diagnostics that have fixes.
 */
export function handleCodeAction(
  params: CodeActionParams,
  ctx: FeatureHandlerContext,
): CodeAction[] | null {
  const { log } = ctx;
  const path = uriToCanonicalPath(params.textDocument.uri);
  if (path === null) return null;
  const diagnostics = ctx.getDiagnostics(path);
  if (diagnostics.length === 0) return null;

  const requestedKinds = params.context.only;
  if (requestedKinds) {
    let wantsQuickfix = false;
    for (let i = 0; i < requestedKinds.length; i++) {
      const kind = requestedKinds[i];
      if (kind && kind.startsWith("quickfix")) {
        wantsQuickfix = true;
        break;
      }
    }
    if (!wantsQuickfix) return null;
  }

  const requestedDiagnostics = params.context.diagnostics;
  const hasSpecific = requestedDiagnostics.length > 0;

  /* When the client requests actions for specific diagnostics (cursor on
     a squiggle), pre-filter to matching internal diagnostics. If none
     match, skip TextDocument creation (O(n) line-offset index). */
  let filtered: readonly Diagnostic[];
  if (hasSpecific) {
    const matched: Diagnostic[] = [];
    for (let i = 0; i < diagnostics.length; i++) {
      const diag = diagnostics[i];
      if (!diag) continue;
      if (matchesRequestedDiagnostic(diag, requestedDiagnostics)) {
        matched.push(diag);
      }
    }
    if (matched.length === 0) return null;
    filtered = matched;
  } else {
    filtered = diagnostics;
  }

  const content = ctx.getContent(path);
  if (!content) return null;

  const doc = TextDocument.create("", "", 0, content);
  const uri = params.textDocument.uri;
  const actions: CodeAction[] = [];

  for (let i = 0; i < filtered.length; i++) {
    const diag = filtered[i];
    if (!diag) continue;
    const lspDiag = toLSPDiagnostic(diag);

    if (diag.fix) {
      const edits = fixToTextEdits(diag.fix, doc);
      if (edits.length > 0) {
        actions.push({
          title: `Fix: ${truncateMessage(diag.message)}`,
          kind: KIND_QUICKFIX,
          diagnostics: [lspDiag],
          isPreferred: true,
          edit: { changes: { [uri]: edits } },
        });
      }
    }

    if (diag.suggest) {
      for (let j = 0; j < diag.suggest.length; j++) {
        const suggestion = diag.suggest[j];
        if (!suggestion) continue;
        const edits = fixToTextEdits(suggestion.fix, doc);
        if (edits.length > 0) {
          actions.push({
            title: suggestion.message,
            kind: KIND_QUICKFIX,
            diagnostics: [lspDiag],
            isPreferred: false,
            edit: { changes: { [uri]: edits } },
          });
        }
      }
    }

    const suppressEdit = buildSuppressEdit(diag, doc, content);
    if (suppressEdit) {
      actions.push({
        title: `Suppress: ganko-disable-next-line ${diag.rule}`,
        kind: KIND_SUPPRESS,
        diagnostics: [lspDiag],
        isPreferred: false,
        edit: { changes: { [uri]: [suppressEdit] } },
      });
    }
  }

  if (log.isLevelEnabled(Level.Trace)) log.trace(`codeAction: ${actions.length} actions from ${filtered.length} diagnostics for ${path}`);
  return actions.length > 0 ? actions : null;
}

/**
 * Convert a ganko Fix to LSP TextEdits.
 *
 * Uses the caller-provided TextDocument for O(log n) positionAt() lookups.
 */
function fixToTextEdits(fix: Fix, doc: TextDocument): TextEdit[] {
  const edits: TextEdit[] = [];
  for (let i = 0; i < fix.length; i++) {
    const op = fix[i];
    if (!op) continue;
    edits.push(fixOpToTextEdit(op, doc));
  }
  return edits;
}

/**
 * Convert a single FixOperation to an LSP TextEdit.
 */
function fixOpToTextEdit(op: FixOperation, doc: TextDocument): TextEdit {
  const start = doc.positionAt(op.range[0]);
  const end = doc.positionAt(op.range[1]);
  return { range: { start, end }, newText: op.text };
}

/**
 * Check if a ganko diagnostic matches one of the LSP diagnostics
 * sent by the client (user clicked on a specific diagnostic).
 */
function matchesRequestedDiagnostic(
  internal: Diagnostic,
  lspDiags: readonly LSPDiagnostic[],
): boolean {
  for (let i = 0; i < lspDiags.length; i++) {
    const lsp = lspDiags[i];
    if (!lsp) continue;
    if (
      internal.rule === lsp.code &&
      internal.loc.start.line - 1 === lsp.range.start.line &&
      internal.loc.start.column === lsp.range.start.character &&
      internal.loc.end.line - 1 === lsp.range.end.line &&
      internal.loc.end.column === lsp.range.end.character
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Build a TextEdit that inserts a `// ganko-disable-next-line <rule>` comment
 * on the line above the diagnostic, matching the indentation of the flagged line.
 */
function buildSuppressEdit(diag: Diagnostic, doc: TextDocument, content: string): TextEdit | null {
  const diagLine = diag.loc.start.line - 1;
  const lineStart = doc.offsetAt({ line: diagLine, character: 0 });
  let indent = 0;
  while (lineStart + indent < content.length) {
    const ch = content.charCodeAt(lineStart + indent);
    if (ch !== 32 && ch !== 9) break;
    indent++;
  }
  const whitespace = content.slice(lineStart, lineStart + indent);
  const comment = `${whitespace}// ganko-disable-next-line ${diag.rule}\n`;
  const pos: Position = { line: diagLine, character: 0 };
  return { range: { start: pos, end: pos }, newText: comment };
}

/**
 * Truncate a message to a reasonable title length.
 */
function truncateMessage(msg: string): string {
  const dot = msg.indexOf(".");
  if (dot > 0 && dot < 80) return msg.slice(0, dot);
  if (msg.length > 80) return msg.slice(0, 80) + "...";
  return msg;
}
