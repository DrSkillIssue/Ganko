/**
 * Components Return Once Rule
 *
 * Enforce that Solid.js components return JSX only once.
 *
 * In Solid.js, components should not have early returns or conditional returns of JSX.
 * A component should build its JSX structure once and return it.
 *
 * Solid handles reactivity internally, so instead of returning different JSX based on
 * conditions, use reactive components like `<Show>`, `<Switch>`, `<For>`, etc.
 *
 * This rule detects:
 * - Early return statements with JSX
 * - Conditional returns of JSX (if/else)
 * - Multiple return paths in a component
 */

import ts from "typescript";
import type { FunctionEntity } from "../../entities/function";
import { defineSolidRule } from "../../rule";
import type { Fix } from "../../../diagnostic"
import { createDiagnostic } from "../../../diagnostic";
import { isJSXElementOrFragment } from "../../util";

const messages = {
  noEarlyReturn:
    "Early returns in Solid components break reactivity because the component function only runs once. Use <Show> or <Switch>/<Match> inside the JSX to conditionally render content instead of returning early from the function.",
  noConditionalReturn:
    "Conditional expressions in return statements break reactivity because Solid components only run once. Wrap the condition in <Show when={...}> for a single condition, or <Switch>/<Match> for multiple conditions.",
} as const;

/**
 * Information about returns in a function body.
 */
interface ReturnInfo {
  lastReturn: ts.ReturnStatement | null;
  earlyReturns: readonly ts.ReturnStatement[];
}

const EMPTY_RETURN_INFO: ReturnInfo = Object.freeze({
  lastReturn: null,
  earlyReturns: Object.freeze([]),
});

const returnInfoCache = new WeakMap<FunctionEntity, ReturnInfo>();

/**
 * Check if a statement is a declaration (TS SyntaxKind ending with "Declaration").
 */
function isDeclarationStatement(stmt: ts.Statement): boolean {
  return ts.isFunctionDeclaration(stmt) ||
    ts.isClassDeclaration(stmt) ||
    ts.isInterfaceDeclaration(stmt) ||
    ts.isTypeAliasDeclaration(stmt) ||
    ts.isEnumDeclaration(stmt) ||
    ts.isModuleDeclaration(stmt) ||
    ts.isImportDeclaration(stmt) ||
    ts.isExportDeclaration(stmt) ||
    ts.isVariableStatement(stmt);
}

/**
 * Find the last non-declaration statement in a block using indexed reverse loop.
 */
function findLastNonDeclaration(statements: ts.NodeArray<ts.Statement>): ts.Statement | null {
  for (let i = statements.length - 1; i >= 0; i--) {
    const stmt = statements[i];
    if (!stmt) continue;
    if (!isDeclarationStatement(stmt)) {
      return stmt;
    }
  }
  return null;
}

/**
 * Collect return statements from a block of statements.
 */
function collectReturnsImpl(
  statements: readonly ts.Statement[],
  lastReturn: ts.ReturnStatement | null,
  earlyReturns: ts.ReturnStatement[],
): void {
  const len = statements.length;
  for (let i = 0; i < len; i++) {
    const stmt = statements[i];
    if (!stmt) continue;

    if (ts.isReturnStatement(stmt)) {
      if (stmt !== lastReturn) {
        earlyReturns.push(stmt);
      }
    } else if (ts.isIfStatement(stmt)) {
      const consequent = stmt.thenStatement;
      if (ts.isBlock(consequent)) {
        collectReturnsImpl(Array.from(consequent.statements), lastReturn, earlyReturns);
      } else if (ts.isReturnStatement(consequent)) {
        if (consequent !== lastReturn) {
          earlyReturns.push(consequent);
        }
      }

      const alternate = stmt.elseStatement;
      if (alternate) {
        if (ts.isBlock(alternate)) {
          collectReturnsImpl(Array.from(alternate.statements), lastReturn, earlyReturns);
        } else if (ts.isReturnStatement(alternate)) {
          if (alternate !== lastReturn) {
            earlyReturns.push(alternate);
          }
        } else if (ts.isIfStatement(alternate)) {
          collectReturnsImpl([alternate], lastReturn, earlyReturns);
        }
      }
    } else if (ts.isSwitchStatement(stmt)) {
      const clauses = stmt.caseBlock.clauses;
      const clausesLen = clauses.length;
      for (let j = 0; j < clausesLen; j++) {
        const switchClause = clauses[j];
        if (!switchClause) continue;
        collectReturnsImpl(Array.from(switchClause.statements), lastReturn, earlyReturns);
      }
    } else if (ts.isTryStatement(stmt)) {
      collectReturnsImpl(Array.from(stmt.tryBlock.statements), lastReturn, earlyReturns);
      if (stmt.catchClause) {
        collectReturnsImpl(Array.from(stmt.catchClause.block.statements), lastReturn, earlyReturns);
      }
      if (stmt.finallyBlock) {
        collectReturnsImpl(Array.from(stmt.finallyBlock.statements), lastReturn, earlyReturns);
      }
    } else if (ts.isWithStatement(stmt) && ts.isBlock(stmt.statement)) {
      collectReturnsImpl(Array.from(stmt.statement.statements), lastReturn, earlyReturns);
    }
  }
}

/**
 * Analyze a function body to find early returns and the last return.
 * Results are cached in a WeakMap.
 */
function analyzeReturns(fn: FunctionEntity): ReturnInfo {
  const cached = returnInfoCache.get(fn);
  if (cached) return cached;

  const body = fn.body;

  if (!body || !ts.isBlock(body)) {
    returnInfoCache.set(fn, EMPTY_RETURN_INFO);
    return EMPTY_RETURN_INFO;
  }

  const lastStatement = findLastNonDeclaration(body.statements);
  const lastReturn = lastStatement && ts.isReturnStatement(lastStatement) ? lastStatement : null;

  const earlyReturns: ts.ReturnStatement[] = [];
  collectReturnsImpl(Array.from(body.statements), lastReturn, earlyReturns);

  const result: ReturnInfo = {
    lastReturn,
    earlyReturns: earlyReturns.length > 0 ? earlyReturns : EMPTY_RETURN_INFO.earlyReturns,
  };
  returnInfoCache.set(fn, result);
  return result;
}

/**
 * Check if a node represents a "nothing" value (null, undefined, false, empty string, empty fragment).
 */
function isNothing(node: ts.Node | undefined): boolean {
  if (!node) return true;

  if (node.kind === ts.SyntaxKind.NullKeyword) return true;
  if (node.kind === ts.SyntaxKind.UndefinedKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (ts.isStringLiteral(node) && node.text === "") return true;
  if (ts.isNumericLiteral(node) && node.text === "0") return true;

  if (ts.isJsxFragment(node)) {
    const children = node.children;
    const len = children.length;
    for (let i = 0; i < len; i++) {
      if (!isNothing(children[i])) return false;
    }
    return true;
  }

  return false;
}

/**
 * Get the number of lines a source location spans.
 */
function getLineLength(node: ts.Node, sourceFile: ts.SourceFile): number {
  const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
  const endLine = sourceFile.getLineAndCharacterOfPosition(node.end).line;
  return endLine - startLine + 1;
}

/**
 * Convert a node to JSX string format.
 */
function nodeToJSXString(node: ts.Node, sourceFile: ts.SourceFile): string {
  const text = node.getText(sourceFile);
  return isJSXElementOrFragment(node) ? text : `{${text}}`;
}

/**
 * Get source text from a node.
 */
function getText(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile);
}

/**
 * Generate a fix for a conditional expression in a return statement.
 */
function generateConditionalFix(
  argument: ts.ConditionalExpression,
  sourceFile: ts.SourceFile,
): Fix | undefined {
  const { condition: test, whenTrue: consequent, whenFalse: alternate } = argument;
  const conditions = [{ test, consequent }];
  let fallback: ts.Expression = alternate;

  while (ts.isConditionalExpression(fallback)) {
    conditions.push({ test: fallback.condition, consequent: fallback.whenTrue });
    fallback = fallback.whenFalse;
  }

  // Case 1: Nested ternary -> <Switch><Match /></Switch>
  if (conditions.length >= 2) {
    const fallbackStr = !isNothing(fallback) ? ` fallback={${getText(fallback, sourceFile)}}` : "";

    const condLen = conditions.length;
    const matchParts: string[] = [];
    for (let i = 0; i < condLen; i++) {
      const cond = conditions[i];
      if (!cond) continue;
      const { test: t, consequent: c } = cond;
      matchParts.push(
        `<Match when={${getText(t, sourceFile)}}>${nodeToJSXString(c, sourceFile)}</Match>`);
    }

    return [{
      range: [argument.getStart(sourceFile), argument.end],
      text: `<Switch${fallbackStr}>\n${matchParts.join("\n")}\n</Switch>`,
    }];
  }

  // Case 2: Consequent is nothing -> negate condition and use <Show>
  if (isNothing(consequent)) {
    return [{
      range: [argument.getStart(sourceFile), argument.end],
      text: `<Show when={!(${getText(test, sourceFile)})}>${nodeToJSXString(alternate, sourceFile)}</Show>`,
    }];
  }

  // Case 3: Fallback is nothing or consequent is significantly longer -> <Show>
  if (
    isNothing(fallback) ||
    getLineLength(consequent, sourceFile) >= getLineLength(alternate, sourceFile) * 1.5
  ) {
    const fallbackStr = !isNothing(fallback) ? ` fallback={${getText(fallback, sourceFile)}}` : "";

    return [{
      range: [argument.getStart(sourceFile), argument.end],
      text: `<Show when={${getText(test, sourceFile)}}${fallbackStr}>${nodeToJSXString(consequent, sourceFile)}</Show>`,
    }];
  }

  // Case 4: Balanced ternary -> wrap in fragment
  return [{
    range: [argument.getStart(sourceFile), argument.end],
    text: `<>${nodeToJSXString(argument, sourceFile)}</>`,
  }];
}

/**
 * Generate a fix for a logical expression in a return statement.
 */
function generateLogicalFix(
  argument: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
): Fix | undefined {
  if (argument.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) return undefined;

  const test = argument.left;
  const consequent = argument.right;
  return [{
    range: [argument.getStart(sourceFile), argument.end],
    text: `<Show when={${getText(test, sourceFile)}}>${nodeToJSXString(consequent, sourceFile)}</Show>`,
  }];
}

const options = {}

export const componentsReturnOnce = defineSolidRule({
  id: "components-return-once",
  severity: "error",
  messages,
  meta: {
    description:
      "Disallow early returns in components. Solid components only run once, and so conditionals should be inside JSX.",
    fixable: true,
    category: "jsx",
  },
  options,
  check(graph, emit) {
    const componentFunctions = graph.componentFunctions;

    if (componentFunctions.length === 0) {
      return;
    }

    const sourceFile = graph.sourceFile;

    for (let i = 0, len = componentFunctions.length; i < len; i++) {
      const fn = componentFunctions[i];
      if (!fn) continue;

      if (!fn.body || !ts.isBlock(fn.body)) {
        continue;
      }

      const { lastReturn, earlyReturns } = analyzeReturns(fn);

      const earlyLen = earlyReturns.length;
      for (let j = 0; j < earlyLen; j++) {
        const earlyReturn = earlyReturns[j];
        if (!earlyReturn) continue;
        emit(createDiagnostic(graph.file, earlyReturn, graph.sourceFile, "components-return-once", "noEarlyReturn", messages.noEarlyReturn, "error"));
      }

      const argument = lastReturn?.expression;
      if (!argument) continue;

      if (ts.isConditionalExpression(argument)) {
        emit(
          createDiagnostic(
            graph.file,
            lastReturn,
            graph.sourceFile,
            "components-return-once",
            "noConditionalReturn",
            messages.noConditionalReturn,
            "error",
            generateConditionalFix(argument, sourceFile),
          ),
        );
      } else if (ts.isBinaryExpression(argument) && (argument.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || argument.operatorToken.kind === ts.SyntaxKind.BarBarToken || argument.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
        emit(
          createDiagnostic(
            graph.file,
            argument,
            graph.sourceFile,
            "components-return-once",
            "noConditionalReturn",
            messages.noConditionalReturn,
            "error",
            generateLogicalFix(argument, sourceFile),
          ),
        );
      }
    }
  },
});
