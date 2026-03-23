/**
 * Definition Handler
 *
 * Delegates to ts.LanguageService.getDefinitionAtPosition().
 */
import type { DefinitionParams, Definition } from "vscode-languageserver";
import type { FeatureHandlerContext } from "./handler-context";
import { positionToOffset, textSpanToRange } from "./ts-utils";
import { uriToCanonicalPath, pathToUri, Level } from "@drskillissue/ganko-shared";

/**
 * Handle textDocument/definition request.
 */
export function handleDefinition(
  params: DefinitionParams,
  ctx: FeatureHandlerContext,
): Definition | null {
  const { log } = ctx;
  const path = uriToCanonicalPath(params.textDocument.uri);
  if (path === null) return null;
  const tsFile = ctx.getTSFileInfo(path);
  if (!tsFile) {
    if (log.isLevelEnabled(Level.Trace)) log.trace(`definition: no TS file for ${path}`);
    return null;
  }
  const { ls, sf } = tsFile;

  const offset = positionToOffset(sf, params.position);
  const defs = ls.getDefinitionAtPosition(path, offset);
  if (!defs || defs.length === 0) {
    if (log.isLevelEnabled(Level.Trace)) log.trace(`definition: no definitions at ${path}:${params.position.line}:${params.position.character}`);
    return null;
  }

  if (log.isLevelEnabled(Level.Trace)) log.trace(`definition: ${defs.length} definitions at ${path}:${params.position.line}:${params.position.character}`);
  return defs.map(def => {
    const defSf = ls.getProgram()?.getSourceFile(def.fileName);
    const range = defSf
      ? textSpanToRange(def.textSpan, defSf)
      : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    return { uri: pathToUri(def.fileName), range };
  });
}
