/**
 * Document Highlight Handler
 *
 * Delegates to ts.LanguageService.getDocumentHighlights().
 */
import type {
  DocumentHighlightParams,
  DocumentHighlight,
} from "vscode-languageserver";
import { DocumentHighlightKind } from "vscode-languageserver";
import type { FeatureHandlerContext } from "./handler-context";
import { positionToOffset, textSpanToRange } from "./ts-utils";
import { uriToPath, Level } from "@drskillissue/ganko-shared";

/**
 * Handle textDocument/documentHighlight request.
 */
export function handleDocumentHighlight(
  params: DocumentHighlightParams,
  ctx: FeatureHandlerContext,
): DocumentHighlight[] | null {
  const { log } = ctx;
  const path = uriToPath(params.textDocument.uri);
  const tsFile = ctx.getTSFileInfo(path);
  if (!tsFile) return null;
  const { ls, sf } = tsFile;

  const offset = positionToOffset(sf, params.position);
  const highlights = ls.getDocumentHighlights(path, offset, [path]);
  if (!highlights || highlights.length === 0) return null;

  const result: DocumentHighlight[] = [];
  for (const group of highlights) {
    for (const span of group.highlightSpans) {
      result.push({
        range: textSpanToRange(span.textSpan, sf),
        kind: span.kind === "writtenReference"
          ? DocumentHighlightKind.Write
          : DocumentHighlightKind.Read,
      });
    }
  }

  if (log.isLevelEnabled(Level.Trace)) log.trace(`documentHighlight: ${result.length} highlights at ${path}:${params.position.line}:${params.position.character}`);
  return result.length > 0 ? result : null;
}
