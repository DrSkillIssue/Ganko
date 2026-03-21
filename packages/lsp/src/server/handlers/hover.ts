/**
 * Hover Handler
 *
 * Delegates to ts.LanguageService.getQuickInfoAtPosition().
 */
import { type HoverParams, type Hover, MarkupKind } from "vscode-languageserver";
import type { FeatureHandlerContext } from "./handler-context";
import { positionToOffset } from "./ts-utils";
import { uriToPath, Level } from "@drskillissue/ganko-shared";
import ts from "typescript";

/**
 * Handle textDocument/hover request.
 *
 * Only returns a result when we have Solid-specific information to add
 * (reactive primitive badges). For plain TS symbols, returns null to
 * avoid duplicating VS Code's built-in TypeScript hover.
 */
export function handleHover(
  params: HoverParams,
  ctx: FeatureHandlerContext,
): Hover | null {
  const { log } = ctx;
  const path = uriToPath(params.textDocument.uri);
  const tsFile = ctx.getTSFileInfo(path);
  if (!tsFile) return null;
  const { ls, sf } = tsFile;

  const offset = positionToOffset(sf, params.position);
  const info = ls.getQuickInfoAtPosition(path, offset);
  if (!info) return null;

  const display = ts.displayPartsToString(info.displayParts);
  if (!display) return null;

  const kind = detectReactiveKind(display);
  if (!kind) return null;
  if (log.isLevelEnabled(Level.Trace)) log.trace(`hover: reactive kind=${kind} at ${path}:${params.position.line}:${params.position.character}`);

  const parts: string[] = [];
  parts.push(`**${kind}** (Solid.js)`);
  parts.push("```typescript\n" + display + "\n```");

  const docs = ts.displayPartsToString(info.documentation);
  if (docs) {
    parts.push(docs);
  }

  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: parts.join("\n\n"),
    },
  };
}

/**
 * Detect if a display string represents a Solid.js reactive primitive.
 */
function detectReactiveKind(display: string): string | null {
  if (display.includes("Accessor<")) return "Signal";
  if (display.includes("Resource<")) return "Resource";
  if (display.includes("createSignal")) return "Signal";
  if (display.includes("createMemo")) return "Memo";
  if (display.includes("createResource")) return "Resource";
  if (display.includes("createStore")) return "Store";
  return null;
}
