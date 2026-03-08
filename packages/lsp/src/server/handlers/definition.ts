/**
 * Definition Handler
 *
 * Delegates to ts.LanguageService.getDefinitionAtPosition().
 */
import type { DefinitionParams, Definition } from "vscode-languageserver";
import type { HandlerContext } from "./handler-context";
import { positionToOffset, textSpanToRange } from "./ts-utils";
import { uriToPath, pathToUri } from "@drskillissue/ganko-shared";

/**
 * Handle textDocument/definition request.
 */
export function handleDefinition(
  params: DefinitionParams,
  ctx: HandlerContext,
): Definition | null {
  const path = uriToPath(params.textDocument.uri);
  const tsFile = ctx.getTSFileInfo(path);
  if (!tsFile) return null;
  const { ls, sf } = tsFile;

  const offset = positionToOffset(sf, params.position);
  const defs = ls.getDefinitionAtPosition(path, offset);
  if (!defs || defs.length === 0) return null;

  return defs.map(def => {
    const defSf = ls.getProgram()?.getSourceFile(def.fileName);
    const range = defSf
      ? textSpanToRange(def.textSpan, defSf)
      : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    return { uri: pathToUri(def.fileName), range };
  });
}
