import type ts from "typescript"
import type { SourceLocation } from "./diagnostic"

export function nodeToSourceLocation(node: ts.Node, sourceFile: ts.SourceFile): SourceLocation {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  const end = sourceFile.getLineAndCharacterOfPosition(node.end)
  return {
    start: { line: start.line + 1, column: start.character },
    end: { line: end.line + 1, column: end.character },
  }
}

export function nodeRange(node: ts.Node, sf: ts.SourceFile): [number, number] {
  return [node.getStart(sf), node.end]
}
