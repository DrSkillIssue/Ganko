/**
 * Workspace Symbol Handler
 *
 * Delegates to ts.LanguageService.getNavigateToItems().
 */
import type {
  WorkspaceSymbolParams,
  WorkspaceSymbol,
} from "vscode-languageserver";
import { SymbolKind } from "vscode-languageserver";
import type { HandlerContext } from "./handler-context";
import { textSpanToRange, SCRIPT_ELEMENT_KIND_TO_SYMBOL_KIND } from "./ts-utils";
import { pathToUri, Level } from "@drskillissue/ganko-shared";

/**
 * Handle workspace/symbol request.
 *
 * Uses a seed path to obtain the language service.
 */
export function handleWorkspaceSymbol(
  params: WorkspaceSymbolParams,
  ctx: HandlerContext,
  seedPath: string,
): WorkspaceSymbol[] | null {
  const { log } = ctx;
  const ls = ctx.getLanguageService(seedPath);
  if (!ls) return null;

  const query = params.query;
  if (query.length === 0) return null;

  const items = ls.getNavigateToItems(query, 100);
  if (!items || items.length === 0) return null;

  const program = ls.getProgram();
  const symbols: WorkspaceSymbol[] = [];

  for (const item of items) {
    const sf = program?.getSourceFile(item.fileName);
    if (!sf) continue;

    symbols.push({
      name: item.name,
      kind: SCRIPT_ELEMENT_KIND_TO_SYMBOL_KIND[item.kind] ?? SymbolKind.Variable,
      location: {
        uri: pathToUri(item.fileName),
        range: textSpanToRange(item.textSpan, sf),
      },
    });
  }

  if (log.isLevelEnabled(Level.Trace)) log.trace(`workspaceSymbol: query="${query}" → ${symbols.length} results`);
  return symbols.length > 0 ? symbols : null;
}
