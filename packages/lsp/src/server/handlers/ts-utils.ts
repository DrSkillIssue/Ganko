/**
 * TypeScript ↔ LSP conversion utilities.
 *
 * Shared helpers for converting between TypeScript compiler
 * positions/spans and LSP positions/ranges.
 */
import ts from "typescript";
import type { Position, Range } from "vscode-languageserver";
import { SymbolKind } from "vscode-languageserver";

/**
 * Convert an LSP Position to a TypeScript offset.
 */
export function positionToOffset(sourceFile: ts.SourceFile, position: Position): number {
  return sourceFile.getPositionOfLineAndCharacter(position.line, position.character);
}

/**
 * Convert a TypeScript TextSpan to an LSP Range.
 */
export function textSpanToRange(span: ts.TextSpan, sourceFile: ts.SourceFile): Range {
  const start = sourceFile.getLineAndCharacterOfPosition(span.start);
  const end = sourceFile.getLineAndCharacterOfPosition(ts.textSpanEnd(span));
  return { start, end };
}

/**
 * Pack line and column into a single number for position comparison.
 *
 * Uses multiplication instead of bitwise shift to avoid 32-bit signed overflow
 * for files with >32767 lines.
 *
 * @param line - Line number
 * @param col - Column number
 * @returns Packed numeric position
 */
export function packPos(line: number, col: number): number {
  return line * 0x10000 + col;
}

/**
 * Map TypeScript ScriptElementKind strings to LSP SymbolKind.
 *
 * Used by document-symbol and workspace-symbol handlers. Entries
 * cover every ScriptElementKind that ts.NavigationTree / ts.NavigateToItem
 * emits in practice.
 */
export const SCRIPT_ELEMENT_KIND_TO_SYMBOL_KIND: Readonly<Record<string, SymbolKind>> = {
  "module": SymbolKind.Module,
  "class": SymbolKind.Class,
  "local class": SymbolKind.Class,
  "interface": SymbolKind.Interface,
  "type": SymbolKind.Interface,
  "enum": SymbolKind.Enum,
  "enum member": SymbolKind.EnumMember,
  "function": SymbolKind.Function,
  "local function": SymbolKind.Function,
  "var": SymbolKind.Variable,
  "local var": SymbolKind.Variable,
  "let": SymbolKind.Variable,
  "const": SymbolKind.Constant,
  "property": SymbolKind.Property,
  "method": SymbolKind.Method,
  "getter": SymbolKind.Property,
  "setter": SymbolKind.Property,
  "constructor": SymbolKind.Constructor,
  "parameter": SymbolKind.Variable,
};
