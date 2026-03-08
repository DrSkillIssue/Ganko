/**
 * References Handler
 *
 * Delegates to ts.LanguageService.findReferences().
 */
import type { ReferenceParams, Location } from "vscode-languageserver";
import type { HandlerContext } from "./handler-context";
import { positionToOffset, textSpanToRange } from "./ts-utils";
import { uriToPath, pathToUri } from "@drskillissue/ganko-shared";

/**
 * Handle textDocument/references request.
 */
export function handleReferences(
  params: ReferenceParams,
  ctx: HandlerContext,
): Location[] | null {
  const path = uriToPath(params.textDocument.uri);
  const tsFile = ctx.getTSFileInfo(path);
  if (!tsFile) return null;
  const { ls, sf } = tsFile;

  const offset = positionToOffset(sf, params.position);
  const refs = ls.findReferences(path, offset);
  if (!refs || refs.length === 0) return null;

  const program = ls.getProgram();
  const locations: Location[] = [];

  for (const group of refs) {
    for (const ref of group.references) {
      if (!params.context.includeDeclaration && ref.isDefinition) continue;
      const refSf = program?.getSourceFile(ref.fileName);
      if (!refSf) continue;
      locations.push({
        uri: pathToUri(ref.fileName),
        range: textSpanToRange(ref.textSpan, refSf),
      });
    }
  }

  return locations.length > 0 ? locations : null;
}
