/**
 * missing-jsdoc-comments
 *
 * Flags functions, classes, and class members missing required JSDoc documentation.
 */

import ts from "typescript"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage} from "../../../diagnostic"
import type { CommentEntry } from "../../../diagnostic"
import type { FunctionEntity, PropertyEntity } from "../../entities/index"
import { isFunctionExported } from "../../queries/entity"
import { CHAR_NEWLINE, CHAR_ASTERISK, CHAR_SPACE, CHAR_TAB } from "@drskillissue/ganko-shared"

const PARAM_TAG = /@param\s+(?:\{[^}]*\}\s+)?(\w+)/

interface JsDocInfo {
  hasDescription: boolean
  params: Set<string>
  hasReturn: boolean
  hasThrows: boolean
  hasExample: boolean
}

/**
 * Parses a JSDoc comment and extracts tag information.
 *
 * @param comment - The comment text (without delimiters)
 * @returns Parsed JSDoc information
 */
function parseJsDoc(comment: string): JsDocInfo {
  const params = new Set<string>()
  let hasDescription = false
  let hasReturn = false
  let hasThrows = false
  let hasExample = false

  const len = comment.length
  let lineStart = 0

  for (let i = 0; i <= len; i++) {
    if (i === len || comment.charCodeAt(i) === CHAR_NEWLINE) {
      const line = extractLine(comment, lineStart, i)

      if (line.startsWith("@param")) {
        const match = line.match(PARAM_TAG)
        if (match) {
          const paramName = match[1];
          if (paramName) params.add(paramName)
        }
      } else if (line.startsWith("@returns") || line.startsWith("@return")) {
        hasReturn = true
      } else if (line.startsWith("@throws") || line.startsWith("@throw")) {
        hasThrows = true
      } else if (line.startsWith("@example")) {
        hasExample = true
      } else if (line.length > 0 && !line.startsWith("@")) {
        hasDescription = true
      }

      lineStart = i + 1
    }
  }

  return { hasDescription, params, hasReturn, hasThrows, hasExample }
}

/**
 * Extracts and trims a line from a JSDoc comment, removing leading asterisks.
 *
 * @param str - The full comment string
 * @param start - Start index of the line
 * @param end - End index of the line
 * @returns Trimmed line content
 */
function extractLine(str: string, start: number, end: number): string {
  // Skip leading whitespace
  while (start < end) {
    const code = str.charCodeAt(start)
    if (code !== CHAR_SPACE && code !== CHAR_TAB) break
    start++
  }

  // Skip leading asterisk and space after it
  if (start < end && str.charCodeAt(start) === CHAR_ASTERISK) {
    start++
    if (start < end && str.charCodeAt(start) === CHAR_SPACE) {
      start++
    }
  }

  // Skip trailing whitespace
  while (end > start) {
    const code = str.charCodeAt(end - 1)
    if (code !== CHAR_SPACE && code !== CHAR_TAB) break
    end--
  }

  return str.substring(start, end)
}

/**
 * Finds the JSDoc comment immediately preceding a node.
 *
 * @param node - The declaration node to check
 * @param comments - All comments extracted from the source file
 * @param sourceFile - The TypeScript source file
 * @returns The JSDoc comment or null if not found
 */
function findJsDoc(node: ts.Node, comments: readonly CommentEntry[], sourceFile: ts.SourceFile): CommentEntry | null {
  const nodeStart = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile)).line + 1

  // Find the last block comment that ends just before this node and starts with '*'
  let best: CommentEntry | null = null
  for (let i = 0, len = comments.length; i < len; i++) {
    const comment = comments[i]
    if (!comment) continue
    if (comment.kind !== ts.SyntaxKind.MultiLineCommentTrivia) continue
    if (!comment.value.startsWith("*")) continue
    if (comment.endLine >= nodeStart) continue
    if (nodeStart - comment.endLine > 1) continue
    best = comment
  }

  return best
}

interface Options extends Record<string, boolean> {
  checkExportedFunctions: boolean
  checkPrivateFunctions: boolean
  checkAllFunctions: boolean
  checkAllClassMethods: boolean
  checkPublicClassMethods: boolean
  checkPrivateClassMethods: boolean
  checkProtectedClassMethods: boolean
  checkPublicClassProperties: boolean
  checkPrivateClassProperties: boolean
  checkProtectedClassProperties: boolean
  checkClasses: boolean
  requireParam: boolean
  requireReturn: boolean
  requireThrows: boolean
  requireExample: boolean
}

/**
 * Checks if a function should be skipped (arrow functions, expressions, nested).
 *
 * @param fn - The function entity
 * @returns True if the function should be skipped
 */
function shouldSkipFunction(fn: FunctionEntity): boolean {
  if (ts.isMethodDeclaration(fn.declarationNode)) return false

  const node = fn.node
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return true

  if (ts.isFunctionDeclaration(node)) {
    const parentScope = fn.scope.parent
    if (parentScope !== null && parentScope.kind === "function") return true
  }

  return false
}

/**
 * Checks if a method should be checked based on accessibility options.
 *
 * @param fn - The function entity
 * @param opts - Rule options
 * @returns True if the method should be checked
 */
function shouldCheckMethod(fn: FunctionEntity, opts: Options): boolean {
  const decl = fn.declarationNode
  if (!ts.isMethodDeclaration(decl)) return false
  if (opts.checkAllClassMethods) return true

  const modifiers = ts.getModifiers(decl)
  const hasPrivate = modifiers?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword) ?? false
  const hasProtected = modifiers?.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword) ?? false

  if (!hasPrivate && !hasProtected) return opts.checkPublicClassMethods
  if (hasPrivate) return opts.checkPrivateClassMethods
  if (hasProtected) return opts.checkProtectedClassMethods
  return false
}

/**
 * Checks if a property should be checked based on accessibility options.
 *
 * @param prop - The property entity
 * @param opts - Rule options
 * @returns True if the property should be checked
 */
function shouldCheckProperty(prop: PropertyEntity, opts: Options): boolean {
  const access = prop.accessibility
  if (opts.checkPublicClassProperties && (access === undefined || access === "public")) return true
  if (opts.checkPrivateClassProperties && access === "private") return true
  if (opts.checkProtectedClassProperties && access === "protected") return true
  return false
}

/**
 * Determines if a function should be checked based on options.
 *
 * @param fn - The function entity
 * @param isExported - Whether the function is exported
 * @param opts - Rule options
 * @returns True if the function should be checked
 */
function shouldCheckFunction(
  fn: FunctionEntity,
  isExported: boolean,
  opts: Options,
): boolean {
  if (ts.isMethodDeclaration(fn.declarationNode)) {
    return shouldCheckMethod(fn, opts)
  }
  if (opts.checkAllFunctions) return true
  if (opts.checkExportedFunctions && isExported) return true
  if (opts.checkPrivateFunctions && !isExported) return true
  return false
}

const messages = {
  missingJsdoc: "Function '{{name}}' is missing a JSDoc comment.",
  missingParam: "JSDoc for '{{name}}' is missing @param tag for '{{param}}'.",
  missingReturn: "JSDoc for '{{name}}' is missing @returns tag.",
  missingThrows: "JSDoc for '{{name}}' is missing @throws tag.",
  missingExample: "JSDoc for '{{name}}' is missing @example tag.",
  missingClassJsdoc: "Class '{{name}}' is missing a JSDoc comment.",
  missingPropertyJsdoc: "Property '{{name}}' is missing a JSDoc comment.",
} as const

const options: Options = {
  checkExportedFunctions: true,
  checkPrivateFunctions: false,
  checkAllFunctions: false,
  checkAllClassMethods: false,
  checkPublicClassMethods: false,
  checkPrivateClassMethods: false,
  checkProtectedClassMethods: false,
  checkPublicClassProperties: false,
  checkPrivateClassProperties: false,
  checkProtectedClassProperties: false,
  checkClasses: false,
  requireParam: true,
  requireReturn: true,
  requireThrows: true,
  requireExample: false,
}

export const missingJsdocComments = defineSolidRule({
  id: "missing-jsdoc-comments",
  severity: "error",
  messages,
  meta: {
    description:
      "Require JSDoc comments on functions with appropriate tags for parameters, return values, and throws.",
    fixable: false,
    category: "correctness",
  },
  options,
  check(graph, emit) {
    const sourceFile = graph.sourceFile
    const comments = graph.comments

    if (options.checkClasses) {
      for (const cls of graph.classes) {
        if (findJsDoc(cls.declarationNode, comments, sourceFile) !== null) continue

        const name = cls.name ?? "<anonymous>"
        emit(
          createDiagnostic(graph.filePath, cls.node, sourceFile, "missing-jsdoc-comments", "missingClassJsdoc", resolveMessage(messages.missingClassJsdoc, { name }), "error"),
        )
      }
    }

    for (const prop of graph.properties) {
      if (!shouldCheckProperty(prop, options)) continue
      if (findJsDoc(prop.declarationNode, comments, sourceFile) !== null) continue

      const name = prop.name ?? "<anonymous>"
      emit(
        createDiagnostic(graph.filePath, prop.node, sourceFile, "missing-jsdoc-comments", "missingPropertyJsdoc", resolveMessage(messages.missingPropertyJsdoc, { name }), "error"),
      )
    }

    for (const fn of graph.functions) {
      if (shouldSkipFunction(fn)) continue

      const isExported = isFunctionExported(graph, fn)
      if (!shouldCheckFunction(fn, isExported, options)) continue

      const name = fn.name ?? fn.variableName ?? "<anonymous>"
      const jsDocComment = findJsDoc(fn.declarationNode, comments, sourceFile)

      if (jsDocComment === null) {
        emit(createDiagnostic(graph.filePath, fn.node, sourceFile, "missing-jsdoc-comments", "missingJsdoc", resolveMessage(messages.missingJsdoc, { name }), "error"))
        continue
      }

      const jsDoc = parseJsDoc(jsDocComment.value)

      if (options.requireParam) {
        const params = fn.params
        for (let i = 0; i < params.length; i++) {
          const param = params[i]
          if (!param) continue;
          if (param.name !== null && !jsDoc.params.has(param.name)) {
            emit(
              createDiagnostic(graph.filePath, fn.node, sourceFile, "missing-jsdoc-comments", "missingParam", resolveMessage(messages.missingParam, { name, param: param.name }), "error"),
            )
          }
        }
      }

      if (options.requireReturn && fn.hasNonVoidReturn && !jsDoc.hasReturn) {
        emit(createDiagnostic(graph.filePath, fn.node, sourceFile, "missing-jsdoc-comments", "missingReturn", resolveMessage(messages.missingReturn, { name }), "error"))
      }

      if (options.requireThrows && fn.hasThrowStatement && !jsDoc.hasThrows) {
        emit(createDiagnostic(graph.filePath, fn.node, sourceFile, "missing-jsdoc-comments", "missingThrows", resolveMessage(messages.missingThrows, { name }), "error"))
      }

      if (options.requireExample && !jsDoc.hasExample) {
        emit(createDiagnostic(graph.filePath, fn.node, sourceFile, "missing-jsdoc-comments", "missingExample", resolveMessage(messages.missingExample, { name }), "error"))
      }
    }
  },
})
