/**
 * Rename Handler
 *
 * Delegates to ts.LanguageService.findRenameLocations().
 */
import type {
  Range,
  RenameParams,
  PrepareRenameParams,
  WorkspaceEdit,
  TextEdit,
} from "vscode-languageserver";
import ts from "typescript";
import type { HandlerContext } from "./handler-context";
import { positionToOffset, textSpanToRange } from "./ts-utils";
import { uriToPath, pathToUri, Level } from "@drskillissue/ganko-shared";

/**
 * Handle textDocument/prepareRename request.
 */
export function handlePrepareRename(
  params: PrepareRenameParams,
  ctx: HandlerContext,
): { range: Range; placeholder: string } | null {
  const { log } = ctx;
  const path = uriToPath(params.textDocument.uri);
  const tsFile = ctx.getTSFileInfo(path);
  if (!tsFile) return null;
  const { ls, sf } = tsFile;

  const offset = positionToOffset(sf, params.position);
  const locations = ls.findRenameLocations(path, offset, false, false);
  if (!locations || locations.length === 0) {
    if (log.isLevelEnabled(Level.Trace)) log.trace(`prepareRename: no locations at ${path}:${params.position.line}:${params.position.character}`);
    return null;
  }

  const first = locations[0];
  if (!first) return null;
  const firstSf = ls.getProgram()?.getSourceFile(first.fileName);
  if (!firstSf) return null;

  if (log.isLevelEnabled(Level.Trace)) log.trace(`prepareRename: ${locations.length} locations at ${path}:${params.position.line}:${params.position.character}`);
  return {
    range: textSpanToRange(first.textSpan, firstSf),
    placeholder: firstSf.text.slice(first.textSpan.start, ts.textSpanEnd(first.textSpan)),
  };
}

/**
 * Handle textDocument/rename request.
 */
export function handleRename(
  params: RenameParams,
  ctx: HandlerContext,
): WorkspaceEdit | null {
  const { log } = ctx;
  const path = uriToPath(params.textDocument.uri);
  const tsFile = ctx.getTSFileInfo(path);
  if (!tsFile) return null;
  const { ls, sf } = tsFile;

  const offset = positionToOffset(sf, params.position);
  const locations = ls.findRenameLocations(path, offset, false, false);
  if (!locations || locations.length === 0) {
    if (log.isLevelEnabled(Level.Trace)) log.trace(`rename: no locations at ${path}:${params.position.line}:${params.position.character}`);
    return null;
  }

  const program = ls.getProgram();
  const changes: Record<string, TextEdit[]> = {};

  for (const loc of locations) {
    const locSf = program?.getSourceFile(loc.fileName);
    if (!locSf) continue;
    const uri = pathToUri(loc.fileName);
    const edits = changes[uri] ?? (changes[uri] = []);
    edits.push({
      range: textSpanToRange(loc.textSpan, locSf),
      newText: params.newName,
    });
  }

  if (log.isLevelEnabled(Level.Trace)) log.trace(`rename: ${locations.length} locations, ${Object.keys(changes).length} files`);
  return { changes };
}
