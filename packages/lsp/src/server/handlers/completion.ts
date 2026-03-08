/**
 * Completion Handler
 *
 * Delegates to ts.LanguageService.getCompletionsAtPosition().
 */
import type { CompletionParams, CompletionItem } from "vscode-languageserver";
import { CompletionItemKind } from "vscode-languageserver";
import type { HandlerContext } from "./handler-context";
import { positionToOffset } from "./ts-utils";
import { uriToPath } from "@ganko/shared";
import type ts from "typescript";

const SOLID_CONTROL_FLOW: readonly CompletionItem[] = [
  { label: "Show", kind: CompletionItemKind.Class, insertText: "Show", detail: "solid-js" },
  { label: "For", kind: CompletionItemKind.Class, insertText: "For", detail: "solid-js" },
  { label: "Switch", kind: CompletionItemKind.Class, insertText: "Switch", detail: "solid-js" },
  { label: "Match", kind: CompletionItemKind.Class, insertText: "Match", detail: "solid-js" },
  { label: "Index", kind: CompletionItemKind.Class, insertText: "Index", detail: "solid-js" },
  { label: "ErrorBoundary", kind: CompletionItemKind.Class, insertText: "ErrorBoundary", detail: "solid-js" },
  { label: "Suspense", kind: CompletionItemKind.Class, insertText: "Suspense", detail: "solid-js" },
  { label: "Portal", kind: CompletionItemKind.Class, insertText: "Portal", detail: "solid-js/web" },
  { label: "Dynamic", kind: CompletionItemKind.Class, insertText: "Dynamic", detail: "solid-js/web" },
];

/** Map ts.ScriptElementKind to LSP CompletionItemKind */
const KIND_MAP: Record<string, CompletionItemKind> = {
  "keyword": CompletionItemKind.Keyword,
  "script": CompletionItemKind.File,
  "module": CompletionItemKind.Module,
  "class": CompletionItemKind.Class,
  "local class": CompletionItemKind.Class,
  "interface": CompletionItemKind.Interface,
  "type": CompletionItemKind.Interface,
  "enum": CompletionItemKind.Enum,
  "enum member": CompletionItemKind.EnumMember,
  "var": CompletionItemKind.Variable,
  "local var": CompletionItemKind.Variable,
  "function": CompletionItemKind.Function,
  "local function": CompletionItemKind.Function,
  "method": CompletionItemKind.Method,
  "getter": CompletionItemKind.Property,
  "setter": CompletionItemKind.Property,
  "property": CompletionItemKind.Property,
  "constructor": CompletionItemKind.Constructor,
  "parameter": CompletionItemKind.Variable,
  "type parameter": CompletionItemKind.TypeParameter,
  "primitive type": CompletionItemKind.Keyword,
  "label": CompletionItemKind.Text,
  "alias": CompletionItemKind.Variable,
  "const": CompletionItemKind.Constant,
  "let": CompletionItemKind.Variable,
  "string": CompletionItemKind.Value,
};

/**
 * Handle textDocument/completion request.
 */
export function handleCompletion(
  params: CompletionParams,
  ctx: HandlerContext,
): CompletionItem[] | null {
  const path = uriToPath(params.textDocument.uri);
  const tsFile = ctx.getTSFileInfo(path);
  if (!tsFile) return null;
  const { ls, sf } = tsFile;

  const offset = positionToOffset(sf, params.position);
  const info = ls.getCompletionsAtPosition(path, offset, undefined);

  const items: CompletionItem[] = [];
  if (info) {
    for (const entry of info.entries) {
      items.push(toCompletionItem(entry));
    }
  }

  if (isJSXTagContext(sf.text, offset)) {
    for (let ci = 0; ci < SOLID_CONTROL_FLOW.length; ci++) {
      const cf = SOLID_CONTROL_FLOW[ci];
      if (!cf) continue;
      let found = false;
      for (let j = 0; j < items.length; j++) {
        const item = items[j];
        if (item && item.label === cf.label) {
          found = true;
          break;
        }
      }
      if (!found) {
        items.push(cf);
      }
    }
  }

  return items.length > 0 ? items : null;
}

/**
 * Check if cursor is in a JSX tag context (after `<` with optional identifier).
 */
function isJSXTagContext(text: string, offset: number): boolean {
  for (let i = offset - 1; i >= 0; i--) {
    const ch = text.charCodeAt(i);
    if (ch === 60) return true;
    if (ch === 32 || ch === 10 || ch === 13 || ch === 9) continue;
    if ((ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122)) continue;
    return false;
  }
  return false;
}

/**
 * Convert a TS completion entry to an LSP CompletionItem.
 */
function toCompletionItem(entry: ts.CompletionEntry): CompletionItem {
  const result: CompletionItem = {
    label: entry.name,
    kind: KIND_MAP[entry.kind] ?? CompletionItemKind.Text,
    sortText: entry.sortText,
    insertText: entry.insertText ?? entry.name,
  };
  const detail = entry.kindModifiers ?? undefined;
  if (detail !== undefined) result.detail = detail;
  return result;
}
