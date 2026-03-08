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

import type { TSESTree as T } from "@typescript-eslint/utils";
import type { FunctionEntity } from "../../entities/function";
import { defineSolidRule } from "../../rule";
import type { Fix } from "../../../diagnostic"
import { createDiagnostic } from "../../../diagnostic";
import { isJSXElementOrFragment } from "../../util";
import { getSourceCode } from "../../queries/get";

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
  lastReturn: T.ReturnStatement | null;
  earlyReturns: readonly T.ReturnStatement[];
}

const EMPTY_RETURN_INFO: ReturnInfo = Object.freeze({
  lastReturn: null,
  earlyReturns: Object.freeze([]),
});

const returnInfoCache = new WeakMap<FunctionEntity, ReturnInfo>();

/**
 * Find the last non-declaration statement in a block using indexed reverse loop.
 */
function findLastNonDeclaration(statements: readonly T.Statement[]): T.Statement | null {
  for (let i = statements.length - 1; i >= 0; i--) {
    const stmt = statements[i];
    if (!stmt) continue;
    if (stmt.type.indexOf("Declaration") !== stmt.type.length - 11) {
      return stmt;
    }
  }
  return null;
}

/**
 * Collect return statements from a block of statements.
 */
function collectReturnsImpl(
  statements: readonly T.Statement[],
  lastReturn: T.ReturnStatement | null,
  earlyReturns: T.ReturnStatement[],
): void {
  const len = statements.length;
  for (let i = 0; i < len; i++) {
    const stmt = statements[i];
    if (!stmt) continue;

    if (stmt.type === "ReturnStatement") {
      if (stmt !== lastReturn) {
        earlyReturns.push(stmt);
      }
    } else if (stmt.type === "IfStatement") {
      const consequent = stmt.consequent;
      if (consequent.type === "BlockStatement") {
        collectReturnsImpl(consequent.body, lastReturn, earlyReturns);
      } else if (consequent.type === "ReturnStatement") {
        if (consequent !== lastReturn) {
          earlyReturns.push(consequent);
        }
      }

      const alternate = stmt.alternate;
      if (alternate) {
        if (alternate.type === "BlockStatement") {
          collectReturnsImpl(alternate.body, lastReturn, earlyReturns);
        } else if (alternate.type === "ReturnStatement") {
          if (alternate !== lastReturn) {
            earlyReturns.push(alternate);
          }
        } else if (alternate.type === "IfStatement") {
          collectReturnsImpl([alternate], lastReturn, earlyReturns);
        }
      }
    } else if (stmt.type === "SwitchStatement") {
      const cases = stmt.cases;
      const casesLen = cases.length;
      for (let j = 0; j < casesLen; j++) {
        const switchCase = cases[j];
        if (!switchCase) continue;
        collectReturnsImpl(switchCase.consequent, lastReturn, earlyReturns);
      }
    } else if (stmt.type === "TryStatement") {
      collectReturnsImpl(stmt.block.body, lastReturn, earlyReturns);
      if (stmt.handler) {
        collectReturnsImpl(stmt.handler.body.body, lastReturn, earlyReturns);
      }
      if (stmt.finalizer) {
        collectReturnsImpl(stmt.finalizer.body, lastReturn, earlyReturns);
      }
    } else if (stmt.type === "WithStatement" && stmt.body.type === "BlockStatement") {
      collectReturnsImpl(stmt.body.body, lastReturn, earlyReturns);
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

  if (body.type !== "BlockStatement") {
    returnInfoCache.set(fn, EMPTY_RETURN_INFO);
    return EMPTY_RETURN_INFO;
  }

  const lastStatement = findLastNonDeclaration(body.body);
  const lastReturn = lastStatement?.type === "ReturnStatement" ? lastStatement : null;

  const earlyReturns: T.ReturnStatement[] = [];
  collectReturnsImpl(body.body, lastReturn, earlyReturns);

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
function isNothing(node: T.Node | undefined): boolean {
  if (!node) return true;

  switch (node.type) {
    case "Literal": {
      const value = node.value;
      return value === null || value === undefined || value === false || value === "";
    }
    case "JSXFragment": {
      if (!node.children) return true;
      const children = node.children;
      const len = children.length;
      for (let i = 0; i < len; i++) {
        if (!isNothing(children[i])) return false;
      }
      return true;
    }
    default:
      return false;
  }
}

/**
 * Get the number of lines a source location spans.
 */
function getLineLength(loc: T.SourceLocation): number {
  return loc.end.line - loc.start.line + 1;
}

/**
 * Convert a node to JSX string format.
 */
function nodeToJSXString(node: T.Node, sourceText: string): string {
  const text = sourceText.slice(node.range[0], node.range[1]);
  return isJSXElementOrFragment(node) ? text : `{${text}}`;
}

/**
 * Get source text from a node.
 */
function getText(node: T.Node, sourceText: string): string {
  return sourceText.slice(node.range[0], node.range[1]);
}

/**
 * Generate a fix for a conditional expression in a return statement.
 */
function generateConditionalFix(
  argument: T.ConditionalExpression,
  sourceText: string,
): Fix | undefined {
  const { test, consequent, alternate } = argument;
  const conditions = [{ test, consequent }];
  let fallback = alternate;

  while (fallback.type === "ConditionalExpression") {
    conditions.push({ test: fallback.test, consequent: fallback.consequent });
    fallback = fallback.alternate;
  }

  // Case 1: Nested ternary -> <Switch><Match /></Switch>
  if (conditions.length >= 2) {
    const fallbackStr = !isNothing(fallback) ? ` fallback={${getText(fallback, sourceText)}}` : "";

    const condLen = conditions.length;
    const matchParts: string[] = [];
    for (let i = 0; i < condLen; i++) {
      const cond = conditions[i];
      if (!cond) continue;
      const { test: t, consequent: c } = cond;
      matchParts.push(
        `<Match when={${getText(t, sourceText)}}>${nodeToJSXString(c, sourceText)}</Match>`);
    }

    return [{
      range: [argument.range[0], argument.range[1]],
      text: `<Switch${fallbackStr}>\n${matchParts.join("\n")}\n</Switch>`,
    }];
  }

  // Case 2: Consequent is nothing -> negate condition and use <Show>
  if (isNothing(consequent)) {
    return [{
      range: [argument.range[0], argument.range[1]],
      text: `<Show when={!(${getText(test, sourceText)})}>${nodeToJSXString(alternate, sourceText)}</Show>`,
    }];
  }

  // Case 3: Fallback is nothing or consequent is significantly longer -> <Show>
  if (
    isNothing(fallback) ||
    getLineLength(consequent.loc) >= getLineLength(alternate.loc) * 1.5
  ) {
    const fallbackStr = !isNothing(fallback) ? ` fallback={${getText(fallback, sourceText)}}` : "";

    return [{
      range: [argument.range[0], argument.range[1]],
      text: `<Show when={${getText(test, sourceText)}}${fallbackStr}>${nodeToJSXString(consequent, sourceText)}</Show>`,
    }];
  }

  // Case 4: Balanced ternary -> wrap in fragment
  return [{
    range: [argument.range[0], argument.range[1]],
    text: `<>${nodeToJSXString(argument, sourceText)}</>`,
  }];
}

/**
 * Generate a fix for a logical expression in a return statement.
 */
function generateLogicalFix(
  argument: T.LogicalExpression,
  sourceText: string,
): Fix | undefined {
  if (argument.operator !== "&&") return undefined;

  const { left: test, right: consequent } = argument;
  return [{
    range: [argument.range[0], argument.range[1]],
    text: `<Show when={${getText(test, sourceText)}}>${nodeToJSXString(consequent, sourceText)}</Show>`,
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

    const sourceText = getSourceCode(graph).text;

    for (let i = 0, len = componentFunctions.length; i < len; i++) {
      const fn = componentFunctions[i];
      if (!fn) continue;

      if (fn.body.type !== "BlockStatement") {
        continue;
      }

      const { lastReturn, earlyReturns } = analyzeReturns(fn);

      const earlyLen = earlyReturns.length;
      for (let j = 0; j < earlyLen; j++) {
        const earlyReturn = earlyReturns[j];
        if (!earlyReturn) continue;
        emit(createDiagnostic(graph.file, earlyReturn, "components-return-once", "noEarlyReturn", messages.noEarlyReturn, "error"));
      }

      const argument = lastReturn?.argument;
      if (!argument) continue;

      if (argument.type === "ConditionalExpression") {
        emit(
          createDiagnostic(
            graph.file,
            lastReturn,
            "components-return-once",
            "noConditionalReturn",
            messages.noConditionalReturn,
            "error",
            generateConditionalFix(argument, sourceText),
          ),
        );
      } else if (argument.type === "LogicalExpression") {
        emit(
          createDiagnostic(
            graph.file,
            argument,
            "components-return-once",
            "noConditionalReturn",
            messages.noConditionalReturn,
            "error",
            generateLogicalFix(argument, sourceText),
          ),
        );
      }
    }
  },
});
