/**
 * Standalone file parsing for SolidPlugin.
 *
 * Parses TypeScript/JSX files using @typescript-eslint/parser
 * to produce SolidInput suitable for graph building.
 *
 * Two entry points:
 * - parseContent: lightweight, no type info (CLI, tests)
 * - parseContentWithProgram: full type info via existing ts.Program (LSP)
 */
import { SourceCode } from "@typescript-eslint/utils/ts-eslint"
import { parseForESLint } from "@typescript-eslint/parser"
import { simpleTraverse } from "@typescript-eslint/typescript-estree"
import type ts from "typescript"
import type { SolidInput } from "./input"
import { readFileSync } from "node:fs"
import type { Logger } from "@drskillissue/ganko-shared"

/**
 * Convert parser visitorKeys to SourceCode-compatible visitorKeys.
 *
 * The parser may return `undefined` for some keys; SourceCode requires
 * all values to be defined arrays.
 */
function toSourceCodeVisitorKeys(
  keys: Record<string, readonly string[] | undefined>,
): Record<string, readonly string[]> {
  const result: Record<string, readonly string[]> = {}
  for (const key in keys) {
    const value = keys[key]
    if (value !== undefined) {
      result[key] = value
    }
  }
  return result
}

/**
 * Parse a file from disk into SolidInput.
 *
 * Reads the file, parses with @typescript-eslint/parser,
 * and wraps into a SourceCode object.
 *
 * @param path - Absolute file path
 * @param logger - Logger for debug output
 * @returns Parsed SolidInput
 */
export function parseFile(path: string, logger?: Logger): SolidInput {
  const content = readFileSync(path, "utf-8")
  return parseContent(path, content, logger)
}

/**
 * Parse source content into SolidInput.
 *
 * Exposed for cases where content is already in memory
 * (e.g. LSP with unsaved changes, tests).
 *
 * @param path - Absolute file path
 * @param content - Source text
 * @param logger - Logger for debug output
 * @returns Parsed SolidInput
 */
export function parseContent(path: string, content: string, logger?: Logger): SolidInput {
  const result = parseForESLint(content, {
    ecmaVersion: 2022,
    sourceType: "module",
    ecmaFeatures: { jsx: true },
    range: true,
    loc: true,
  })

  const visitorKeys = toSourceCodeVisitorKeys(result.visitorKeys)

  simpleTraverse(result.ast, { enter: () => { } }, true)

  const sourceCode = new SourceCode({
    text: content,
    ast: result.ast,
    scopeManager: result.scopeManager,
    parserServices: result.services,
    visitorKeys,
  })

  const input: { -readonly [K in keyof SolidInput]: SolidInput[K] } = {
    file: path,
    sourceCode,
    parserServices: result.services ?? null,
    checker: null,
  }
  if (logger !== undefined) input.logger = logger
  return input
}

/**
 * Parse source content with an existing TypeScript Program for full type info.
 *
 * Uses parseAndGenerateServices with the `programs` option to build the
 * ESTree↔TSNode mapping against the caller's ts.Program. This gives the
 * SolidGraph access to getTypeAtLocation/getSymbolAtLocation for type-aware
 * rules and fixes (e.g. expanding JSX spreads into explicit props).
 *
 * @param path - Absolute file path (must be part of the program)
 * @param content - In-memory source content
 * @param program - TypeScript Program from the language service
 * @param logger - Logger for debug output
 * @returns Parsed SolidInput with full type info
 */
export function parseContentWithProgram(path: string, content: string, program: ts.Program, logger?: Logger): SolidInput {
  const result = parseForESLint(content, {
    ecmaVersion: 2022,
    sourceType: "module",
    ecmaFeatures: { jsx: true },
    range: true,
    loc: true,
    filePath: path,
    programs: [program],
    preserveNodeMaps: true,
  })

  const visitorKeys = toSourceCodeVisitorKeys(result.visitorKeys)

  simpleTraverse(result.ast, { enter: () => { } }, true)

  const sourceCode = new SourceCode({
    text: content,
    ast: result.ast,
    scopeManager: result.scopeManager,
    parserServices: result.services,
    visitorKeys,
  })

  const input: { -readonly [K in keyof SolidInput]: SolidInput[K] } = {
    file: path,
    sourceCode,
    parserServices: result.services ?? null,
    checker: program.getTypeChecker(),
  }
  if (logger !== undefined) input.logger = logger
  return input
}
