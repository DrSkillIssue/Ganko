/**
 * Document Symbol Handler
 *
 * Delegates to ts.LanguageService.getNavigationTree().
 */
import type {
  DocumentSymbolParams,
  DocumentSymbol,
} from "vscode-languageserver";
import { SymbolKind } from "vscode-languageserver";
import type { HandlerContext } from "./handler-context";
import { textSpanToRange, SCRIPT_ELEMENT_KIND_TO_SYMBOL_KIND } from "./ts-utils";
import { uriToPath, Level } from "@drskillissue/ganko-shared";
import type ts from "typescript";

/**
 * Handle textDocument/documentSymbol request.
 */
export function handleDocumentSymbol(
  params: DocumentSymbolParams,
  ctx: HandlerContext,
): DocumentSymbol[] | null {
  const { log } = ctx;
  const path = uriToPath(params.textDocument.uri);
  const tsFile = ctx.getTSFileInfo(path);
  if (!tsFile) return null;
  const { ls, sf } = tsFile;

  const tree = ls.getNavigationTree(path);
  if (!tree) return null;

  const symbols = convertTree(tree, sf);
  if (log.isLevelEnabled(Level.Trace)) log.trace(`documentSymbol: ${symbols.length} symbols for ${path}`);
  return symbols.length > 0 ? symbols : null;
}

function convertTree(item: ts.NavigationTree, sf: ts.SourceFile): DocumentSymbol[] {
  if (item.kind === "module" && item.text === "<global>") {
    if (!item.childItems) return [];
    const result: DocumentSymbol[] = [];
    for (const child of item.childItems) {
      for (const s of convertTree(child, sf)) {
        result.push(s);
      }
    }
    return result;
  }

  const spans = item.spans;
  if (spans.length === 0) return [];

  const firstSpan = spans[0];
  if (!firstSpan) return [];
  const range = textSpanToRange(firstSpan, sf);
  const secondSpan = spans[1];
  const selectionRange = spans.length > 1 && secondSpan ? textSpanToRange(secondSpan, sf) : range;

  const children: DocumentSymbol[] = [];
  if (item.childItems) {
    for (const child of item.childItems) {
      for (const s of convertTree(child, sf)) {
        children.push(s);
      }
    }
  }

  const symbol: DocumentSymbol = {
    name: item.text,
    kind: SCRIPT_ELEMENT_KIND_TO_SYMBOL_KIND[item.kind] ?? SymbolKind.Variable,
    range,
    selectionRange,
  };
  if (children.length > 0) symbol.children = children;
  return [symbol];
}
