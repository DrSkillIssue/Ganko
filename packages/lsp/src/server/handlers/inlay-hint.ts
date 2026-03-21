/**
 * Inlay Hint Handler
 *
 * Delegates to ts.LanguageService.provideInlayHints().
 */
import type {
  InlayHintParams,
  InlayHint,
} from "vscode-languageserver";
import { InlayHintKind } from "vscode-languageserver";
import type { FeatureHandlerContext } from "./handler-context";
import { positionToOffset } from "./ts-utils";
import { uriToPath, Level } from "@drskillissue/ganko-shared";

/**
 * Handle textDocument/inlayHint request.
 */
export function handleInlayHint(
  params: InlayHintParams,
  ctx: FeatureHandlerContext,
): InlayHint[] | null {
  const { log } = ctx;
  const path = uriToPath(params.textDocument.uri);
  const tsFile = ctx.getTSFileInfo(path);
  if (!tsFile) return null;
  const { ls, sf } = tsFile;

  const start = positionToOffset(sf, params.range.start);
  const end = positionToOffset(sf, params.range.end);
  const span = { start, length: end - start };

  const hints = ls.provideInlayHints(path, span, undefined);
  if (!hints || hints.length === 0) return null;

  const result: InlayHint[] = [];
  for (const hint of hints) {
    const pos = sf.getLineAndCharacterOfPosition(hint.position);
    const paddingLeft = hint.whitespaceBefore ?? undefined;
    const paddingRight = hint.whitespaceAfter ?? undefined;
    const item: InlayHint = {
      position: { line: pos.line, character: pos.character },
      label: hint.text,
      kind: hint.kind === "Type" ? InlayHintKind.Type : InlayHintKind.Parameter,
    };
    if (paddingLeft !== undefined) item.paddingLeft = paddingLeft;
    if (paddingRight !== undefined) item.paddingRight = paddingRight;
    result.push(item);
  }

  if (log.isLevelEnabled(Level.Trace)) log.trace(`inlayHint: ${result.length} hints for ${path}`);
  return result.length > 0 ? result : null;
}
