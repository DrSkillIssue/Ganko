/**
 * Inline style parser
 * Parses CSS inline style declarations into an AST.
 *
 * Based on:
 * - http://www.w3.org/TR/CSS21/grammar.html
 * - https://github.com/visionmedia/css-parse/pull/49#issuecomment-30088027
 *
 */
import {
  CHAR_NEWLINE,
  CHAR_SLASH,
  CHAR_ASTERISK,
  CHAR_COLON,
  WHITESPACE_TABLE,
  SEMICOLON_OR_WHITESPACE_TABLE,
} from "./chars";

// Regex patterns with sticky flag for index-based matching
const PROPERTY_REGEX = /(\*?[-#/*\\\w]+(\[[0-9a-z_-]+\])?)\s*/y;
const VALUE_REGEX = /((?:'(?:\\'|.)*?'|"(?:\\"|.)*?"|\([^)]*?\)|[^};])+)/y;

/**
 * Position information for a parsed node.
 */
export interface Position {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly source: string | undefined;
  readonly content: string;
}

/**
 * A CSS declaration node (property: value pair).
 */
export interface Declaration {
  readonly type: "declaration";
  readonly property: string;
  readonly value: string;
  readonly position: Position;
}

/**
 * A CSS comment node.
 */
export interface Comment {
  readonly type: "comment";
  readonly comment: string;
  readonly position: Position;
}

/**
 * Union type representing any node in the parsed style AST.
 */
export type StyleNode = Declaration | Comment;

/** Frozen empty array returned for empty input strings */
const EMPTY_RESULT: readonly StyleNode[] = Object.freeze([]);

/**
 * Options for the inline style parser.
 */
export interface ParseOptions {
  readonly source?: string;
  readonly silent?: boolean;
}

/**
 * Error object thrown or collected when parsing fails.
 */
export interface ParseError extends Error {
  readonly reason: string;
  readonly filename: string | undefined;
  readonly line: number;
  readonly column: number;
  readonly source: string;
}

class InlineParseError extends Error implements ParseError {
  readonly reason: string;
  readonly filename: string | undefined;
  readonly line: number;
  readonly column: number;
  readonly source: string;

  /**
   * Create a new parse error with location information.
   *
   * @param message - Full error message
   * @param reason - Error reason
   * @param filename - Source filename
   * @param line - Line number
   * @param column - Column number
   * @param source - Source content
   */
  constructor(
    message: string,
    reason: string,
    filename: string | undefined,
    line: number,
    column: number,
    source: string,
  ) {
    super(message);
    this.name = "ParseError";
    this.reason = reason;
    this.filename = filename;
    this.line = line;
    this.column = column;
    this.source = source;
  }
}

/**
 * Trims whitespace from both ends of a string.
 *
 * @param str - The string to trim
 * @returns The trimmed string
 */
function trimString(str: string): string {
  const len = str.length;
  if (len === 0) return str;

  let start = 0;
  let end = len;

  while (start < end && WHITESPACE_TABLE[str.charCodeAt(start)]) {
    start++;
  }

  while (end > start && WHITESPACE_TABLE[str.charCodeAt(end - 1)]) {
    end--;
  }

  if (start === 0 && end === len) return str;
  return str.slice(start, end);
}

/**
 * Trims whitespace and strips CSS comments from a property or value string.
 *
 * @param str - The property or value string to clean
 * @returns The cleaned string with comments removed and whitespace trimmed
 */
function cleanPropertyOrValue(str: string): string {
  const len = str.length;
  if (len === 0) return str;

  let firstCommentStart = -1;
  for (let i = 0; i < len - 1; i++) {
    if (str.charCodeAt(i) === CHAR_SLASH && str.charCodeAt(i + 1) === CHAR_ASTERISK) {
      firstCommentStart = i;
      break;
    }
  }

  if (firstCommentStart === -1) {
    return trimString(str);
  }

  // Rare path: string contains comment(s) - must build new string
  const segments: string[] = [];

  if (firstCommentStart > 0) {
    segments.push(str.slice(0, firstCommentStart));
  }

  let pos = firstCommentStart + 2;

  while (pos < len) {

    let commentEnd = -1;
    for (let i = pos; i < len - 1; i++) {
      if (str.charCodeAt(i) === CHAR_ASTERISK && str.charCodeAt(i + 1) === CHAR_SLASH) {
        commentEnd = i;
        break;
      }
    }

    if (commentEnd === -1) {
      // Unterminated comment - stop
      break;
    }

    pos = commentEnd + 2;

    // Find next comment start (or end of string)
    let nextCommentStart = -1;
    for (let i = pos; i < len - 1; i++) {
      if (str.charCodeAt(i) === CHAR_SLASH && str.charCodeAt(i + 1) === CHAR_ASTERISK) {
        nextCommentStart = i;
        break;
      }
    }

    if (nextCommentStart === -1) {
      // No more comments - capture rest
      if (pos < len) {
        segments.push(str.slice(pos));
      }
      break;
    }

    if (nextCommentStart > pos) {
      segments.push(str.slice(pos, nextCommentStart));
    }

    pos = nextCommentStart + 2;
  }

  if (segments.length === 0) {
    return "";
  }

  return trimString(segments.join(""));
}

/**
 * Internal parser class for processing CSS inline style declarations.
 *
 * Maintains parsing state including position tracking for accurate
 * error messages and AST node positions.
 */
class InlineStyleParser {
  private readonly input: string;
  private readonly inputLen: number;
  private readonly source: string | undefined;
  private readonly silent: boolean;
  private errors: ParseError[] | null = null;

  private pos: number = 0;
  private lineno: number = 1;
  private column: number = 1;

  /**
   * Creates a new inline style parser.
   *
   * @param input - The CSS inline style string to parse
   * @param source - Optional source filename for error messages
   * @param silent - Whether to collect errors instead of throwing
   */
  constructor(input: string, source: string | undefined, silent: boolean) {
    this.input = input;
    this.inputLen = input.length;
    this.source = source;
    this.silent = silent;
  }

  /**
   * Updates line/column tracking based on consumed character range.
   *
   * @param start - Start index of consumed range (inclusive)
   * @param end - End index of consumed range (exclusive)
   */
  private updatePosition(start: number, end: number): void {
    const input = this.input;
    let count = 0;
    let lastNewlinePos = -1;

    for (let i = start; i < end; i++) {
      if (input.charCodeAt(i) === CHAR_NEWLINE) {
        count++;
        lastNewlinePos = i;
      }
    }

    if (count > 0) {
      this.lineno += count;
      this.column = end - lastNewlinePos;
    } else {
      this.column += end - start;
    }
  }

  /**
   * Reports a parsing error.
   *
   * In silent mode, collects errors. Otherwise, throws an error immediately.
   *
   * @param msg - The error message describing the issue
   * @returns undefined (allows use in return statements)
   * @throws Error with ParseError properties when not in silent mode
   */
  private error(msg: string): undefined {
    const message = (this.source ?? "") + ":" + this.lineno + ":" + this.column + ": " + msg;

    if (this.silent) {
      if (this.errors === null) {
        this.errors = [];
      }
      this.errors.push(
        new InlineParseError(message, msg, this.source, this.lineno, this.column, this.input),
      );
    } else {
      throw new InlineParseError(message, msg, this.source, this.lineno, this.column, this.input);
    }
    return undefined;
  }

  /**
   * Matches a sticky regex at current position.
   *
   * @param re - The sticky regex pattern to match
   * @returns The match result, or null if no match
   */
  private match(re: RegExp): RegExpExecArray | null {
    re.lastIndex = this.pos;
    const m = re.exec(this.input);

    if (m === null || m.index !== this.pos) {
      return null;
    }

    const start = this.pos;
    const end = start + m[0].length;
    this.pos = end;
    this.updatePosition(start, end);
    return m;
  }

  /**
   * Matches a colon at current position and consumes trailing whitespace.
   *
   * @returns true if a colon was found and consumed, false otherwise
   */
  private matchColon(): boolean {
    const input = this.input;
    const len = this.inputLen;

    if (this.pos >= len || input.charCodeAt(this.pos) !== CHAR_COLON) {
      return false;
    }

    this.pos++;
    this.column++;

    while (this.pos < len) {
      const code = input.charCodeAt(this.pos);
      if (!WHITESPACE_TABLE[code]) break;

      if (code === CHAR_NEWLINE) {
        this.lineno++;
        this.column = 1;
      } else {
        this.column++;
      }
      this.pos++;
    }

    return true;
  }

  /**
   * Consumes leading whitespace at current position.
   */
  private whitespace(): void {
    const input = this.input;
    const len = this.inputLen;
    let pos = this.pos;

    while (pos < len) {
      const code = input.charCodeAt(pos);
      if (!WHITESPACE_TABLE[code]) break;

      if (code === CHAR_NEWLINE) {
        this.lineno++;
        this.column = 1;
      } else {
        this.column++;
      }
      pos++;
    }

    this.pos = pos;
  }

  /**
   * Consumes semicolons and whitespace at current position.
   */
  private semicolonAndWhitespace(): void {
    const input = this.input;
    const len = this.inputLen;
    let pos = this.pos;

    while (pos < len) {
      const code = input.charCodeAt(pos);
      if (!SEMICOLON_OR_WHITESPACE_TABLE[code]) break;

      if (code === CHAR_NEWLINE) {
        this.lineno++;
        this.column = 1;
      } else {
        this.column++;
      }
      pos++;
    }

    this.pos = pos;
  }

  /**
   * Creates a position object for a parsed node.
   *
   * @param startLine - Starting line number (1-based)
   * @param startColumn - Starting column number (1-based)
   * @param endLine - Ending line number (1-based)
   * @param endColumn - Ending column number (1-based)
   * @returns Position object with source location information
   */
  private makePosition(
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number,
  ): Position {
    return {
      startLine,
      startColumn,
      endLine,
      endColumn,
      source: this.source,
      content: this.input,
    };
  }

  /**
   * Finds the end marker of a CSS comment.
   *
   * @param startPos - Position to start searching from
   * @returns Index of the asterisk in the end marker, or -1 if not found
   */
  private findCommentEnd(startPos: number): number {
    const input = this.input;
    const len = this.inputLen;

    for (let i = startPos; i < len - 1; i++) {
      if (input.charCodeAt(i) === CHAR_ASTERISK && input.charCodeAt(i + 1) === CHAR_SLASH) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Parses a CSS comment at current position.
   *
   * @returns The parsed Comment node, or null if no comment at current position
   */
  private parseComment(): Comment | null {
    const input = this.input;
    const pos = this.pos;

    if (input.charCodeAt(pos) !== CHAR_SLASH || input.charCodeAt(pos + 1) !== CHAR_ASTERISK) {
      return null;
    }

    const startLine = this.lineno;
    const startColumn = this.column;

    // Find end of comment using manual scan (no indexOf)
    const endMarkerIndex = this.findCommentEnd(pos + 2);

    if (endMarkerIndex === -1) {
      this.error("End of comment missing");
      return null;
    }

    const commentStart = pos + 2;
    const commentEnd = endMarkerIndex;

    this.column += 2;
    this.updatePosition(commentStart, commentEnd);
    this.pos = endMarkerIndex + 2;
    this.column += 2;

    const endLine = this.lineno;
    const endColumn = this.column;

    this.whitespace();

    return {
      type: "comment",
      comment: input.slice(commentStart, commentEnd),
      position: this.makePosition(startLine, startColumn, endLine, endColumn),
    };
  }

  /**
   * Parses a CSS declaration (property: value pair) at current position.
   *
   * @returns The parsed Declaration node, or null if no valid declaration found
   */
  private parseDeclaration(): Declaration | null {
    const startLine = this.lineno;
    const startColumn = this.column;

    const prop = this.match(PROPERTY_REGEX);
    if (prop === null) {
      return null;
    }

    this.parseComment();

    if (!this.matchColon()) {
      this.error("property missing ':'");
      return null;
    }

    const val = this.match(VALUE_REGEX);

    const property = cleanPropertyOrValue(prop[0]);
    const value = val !== null ? cleanPropertyOrValue(val[0]) : "";

    this.semicolonAndWhitespace();

    const endLine = this.lineno;
    const endColumn = this.column;

    this.whitespace();

    return {
      type: "declaration",
      property,
      value,
      position: this.makePosition(startLine, startColumn, endLine, endColumn),
    };
  }

  /**
   * Parses the entire input string into an array of style nodes.
   *
   * @returns Array of Declaration and Comment nodes
   */
  parse(): StyleNode[] {
    const results: StyleNode[] = [];

    this.whitespace();

    let comment = this.parseComment();
    while (comment !== null) {
      results.push(comment);
      comment = this.parseComment();
    }

    // Main parse loop: declarations with interleaved comments
    let decl = this.parseDeclaration();
    while (decl !== null) {
      results.push(decl);

      comment = this.parseComment();
      while (comment !== null) {
        results.push(comment);
        comment = this.parseComment();
      }

      decl = this.parseDeclaration();
    }

    return results;
  }
}

/**
 * Parses inline CSS style declarations.
 *
 * @param style - The CSS inline style string to parse
 * @param options - Parser options
 * @returns Array of parsed declarations and comments
 * @throws TypeError if style is not a string
 * @throws Error if parsing fails and silent mode is off
 */
export default function parseInlineStyle(
  style: string,
  options: ParseOptions = {},
): readonly StyleNode[] {
  if (typeof style !== "string") {
    throw new TypeError("First argument must be a string");
  }

  if (style.length === 0) {
    return EMPTY_RESULT;
  }

  const parser = new InlineStyleParser(style, options.source, options.silent ?? false);
  return parser.parse();
}

export { parseInlineStyle };
