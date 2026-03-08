/**
 * Position and Range Utilities for Testing
 *
 * Helpers for working with LSP positions, ranges, and markers in test content.
 */

import type { Position, Range } from "vscode-languageserver";

/**
 * Result of parsing a marker from content.
 */
export interface MarkerResult {
  /** Content with marker removed */
  content: string;
  /** Position where marker was found */
  position: Position;
}

/**
 * Parse a marker from content and return the cleaned content with position.
 *
 * Markers are special strings like `|cursor|` or `^` that indicate a position.
 *
 * @param content - Content containing the marker
 * @param marker - Marker string to find (default: "|cursor|")
 * @returns Cleaned content and position, or null if marker not found
 */
export function parseMarker(content: string, marker: string = "|cursor|"): MarkerResult | null {
  const index = content.indexOf(marker);
  if (index === -1) return null;

  const cleaned = content.slice(0, index) + content.slice(index + marker.length);
  const position = offsetToPosition(content, index);

  return { content: cleaned, position };
}

/**
 * Parse multiple markers from content.
 *
 * Markers are numbered like `|1|`, `|2|`, etc.
 * Positions are calculated correctly on cleaned content.
 *
 * @param content - Content containing markers
 * @returns Cleaned content and array of positions
 */
export function parseMarkers(content: string): { content: string; positions: Position[] } {
  // First, find all markers and their original indices
  const markers: { num: number; index: number }[] = [];

  for (let i = 1; i <= 20; i++) {
    const marker = `|${i}|`;
    const index = content.indexOf(marker);
    if (index !== -1) {
      markers.push({ num: i, index });
    }
  }

  // Sort markers by their original index
  markers.sort((a, b) => a.index - b.index);

  // Remove markers from content and track position adjustments
  let cleaned = content;
  let totalRemoved = 0;
  const positions: Position[] = [];

  for (const { num, index } of markers) {
    const marker = `|${num}|`;
    const adjustedIndex = index - totalRemoved;
    positions.push(offsetToPosition(cleaned, adjustedIndex));

    // Remove marker from cleaned content
    cleaned = cleaned.slice(0, adjustedIndex) + cleaned.slice(adjustedIndex + marker.length);
    totalRemoved += marker.length;
  }

  return { content: cleaned, positions };
}

/**
 * Find the position of a search string in content.
 *
 * @param content - Content to search
 * @param search - String to find
 * @returns Position of the first character, or null if not found
 */
export function findPosition(content: string, search: string): Position | null {
  const index = content.indexOf(search);
  if (index === -1) return null;
  return offsetToPosition(content, index);
}

/**
 * Find the nth occurrence of a search string in content.
 *
 * @param content - Content to search
 * @param search - String to find
 * @param n - Which occurrence (1-based)
 * @returns Position of the first character, or null if not found
 */
export function findNthPosition(content: string, search: string, n: number): Position | null {
  let index = -1;
  let count = 0;

  while (count < n) {
    index = content.indexOf(search, index + 1);
    if (index === -1) return null;
    count++;
  }

  return offsetToPosition(content, index);
}

/**
 * Find all occurrences of a search string in content.
 *
 * @param content - Content to search
 * @param search - String to find
 * @returns Array of positions
 */
export function findAllPositions(content: string, search: string): Position[] {
  const positions: Position[] = [];
  let index = 0;

  while ((index = content.indexOf(search, index)) !== -1) {
    positions.push(offsetToPosition(content, index));
    index++;
  }

  return positions;
}

/**
 * Convert an offset to a Position.
 *
 * @param content - Full content
 * @param offset - Character offset
 * @returns Position (0-based line and character)
 */
export function offsetToPosition(content: string, offset: number): Position {
  let line = 0;
  let character = 0;
  let i = 0;

  while (i < offset && i < content.length) {
    if (content[i] === "\n") {
      line++;
      character = 0;
    } else {
      character++;
    }
    i++;
  }

  return { line, character };
}

/**
 * Convert a Position to an offset.
 *
 * @param content - Full content
 * @param position - Position to convert
 * @returns Character offset
 */
export function positionToOffset(content: string, position: Position): number {
  const lines = content.split("\n");
  let offset = 0;

  for (let i = 0; i < position.line && i < lines.length; i++) {
    offset += lines[i].length + 1;
  }

  offset += position.character;
  return offset;
}

/**
 * Create a Range from line/character values.
 *
 * @param startLine - Start line (0-based)
 * @param startChar - Start character (0-based)
 * @param endLine - End line (0-based)
 * @param endChar - End character (0-based)
 * @returns Range
 */
export function range(
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number,
): Range {
  return {
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar },
  };
}

/**
 * Create a Range for a word on a specific line.
 *
 * @param content - Full content
 * @param line - Line number (0-based)
 * @param search - Word to find on that line
 * @returns Range or null if not found
 */
export function wordRange(content: string, line: number, search: string): Range | null {
  const lines = content.split("\n");
  if (line < 0 || line >= lines.length) return null;

  const lineContent = lines[line];
  const charStart = lineContent.indexOf(search);
  if (charStart === -1) return null;

  return {
    start: { line, character: charStart },
    end: { line, character: charStart + search.length },
  };
}

/**
 * Create a single-character Range at a Position.
 *
 * @param pos - Position
 * @returns Range spanning one character
 */
export function pointRange(pos: Position): Range {
  return {
    start: pos,
    end: { line: pos.line, character: pos.character + 1 },
  };
}

/**
 * Create a Range covering an entire line.
 *
 * @param content - Full content
 * @param line - Line number (0-based)
 * @returns Range or null if line doesn't exist
 */
export function lineRange(content: string, line: number): Range | null {
  const lines = content.split("\n");
  if (line < 0 || line >= lines.length) return null;

  return {
    start: { line, character: 0 },
    end: { line, character: lines[line].length },
  };
}

/**
 * Check if two positions are equal.
 */
export function positionsEqual(a: Position, b: Position): boolean {
  return a.line === b.line && a.character === b.character;
}

/**
 * Check if two ranges are equal.
 */
export function rangesEqual(a: Range, b: Range): boolean {
  return positionsEqual(a.start, b.start) && positionsEqual(a.end, b.end);
}

/**
 * Check if a position is within a range.
 */
export function positionInRange(pos: Position, r: Range): boolean {
  if (pos.line < r.start.line || pos.line > r.end.line) return false;
  if (pos.line === r.start.line && pos.character < r.start.character) return false;
  if (pos.line === r.end.line && pos.character > r.end.character) return false;
  return true;
}
