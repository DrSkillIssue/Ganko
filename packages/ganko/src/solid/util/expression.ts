/**
 * Expression Utilities
 *
 * Helper functions for working with expression nodes.
 */

import type { TSESTree as T } from "@typescript-eslint/utils";

/**
 * Get a human-readable descriptive name for an expression.
 *
 * Used for error messages to describe what value is being operated on.
 *
 * @param node - The expression node to describe
 * @returns A human-readable name for the expression
 *
 * @example
 * getExpressionName(identifierNode)        // "foo"
 * getExpressionName(memberExprNode)        // "bar" (property name)
 * getExpressionName(callExprNode)          // "getData()"
 * getExpressionName(awaitExprNode)         // "awaited value"
 * getExpressionName(literalNode)           // "123" or '"hello"'
 */
export function getExpressionName(node: T.Node): string {
  switch (node.type) {
    case "Identifier":
      return node.name;

    case "MemberExpression":
      if (node.property.type === "Identifier") {
        return node.property.name;
      }
      if (node.property.type === "Literal") {
        return String(node.property.value);
      }
      if (node.property.type === "PrivateIdentifier") {
        return `#${node.property.name}`;
      }
      return "property";

    case "CallExpression":
      return getCallExpressionName(node);

    case "NewExpression":
      if (node.callee.type === "Identifier") {
        return `new ${node.callee.name}()`;
      }
      return "new instance";

    case "AwaitExpression":
      return `await ${getExpressionName(node.argument)}`;

    case "YieldExpression":
      if (node.argument) {
        return `yield ${getExpressionName(node.argument)}`;
      }
      return "yield";

    case "UnaryExpression":
      return `${node.operator}${getExpressionName(node.argument)}`;

    case "UpdateExpression":
      return getExpressionName(node.argument);

    case "BinaryExpression":
    case "LogicalExpression":
      return "result";

    case "ConditionalExpression":
      return "conditional";

    case "AssignmentExpression":
      return getExpressionName(node.left);

    case "SequenceExpression": {
      const lastExpr = node.expressions[node.expressions.length - 1];
      if (lastExpr) {
        return getExpressionName(lastExpr);
      }
      return "sequence";
    }

    case "ArrayExpression":
      return "array";

    case "ObjectExpression":
      return "object";

    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return "function";

    case "ClassExpression":
      return node.id ? node.id.name : "class";

    case "TemplateLiteral":
      return "template";

    case "TaggedTemplateExpression":
      if (node.tag.type === "Identifier") {
        return `${node.tag.name}\`\``;
      }
      return "tagged template";

    case "ThisExpression":
      return "this";

    case "Super":
      return "super";

    case "MetaProperty":
      return `${node.meta.name}.${node.property.name}`;

    case "ImportExpression":
      return "dynamic import";

    case "ChainExpression":
      // ChainElement is CallExpression | MemberExpression | TSNonNullExpression
      return getExpressionName(node.expression);

    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
      return getExpressionName(node.expression);

    case "TSInstantiationExpression":
      return getExpressionName(node.expression);

    case "Literal":
      if (node.value === null) return "null";
      if (typeof node.value === "string") return `"${node.value}"`;
      if (typeof node.value === "boolean") return String(node.value);
      if (typeof node.value === "number") return String(node.value);
      if (typeof node.value === "bigint") return `${node.value}n`;
      // RegExpLiteral has value: RegExp | null, check for RegExp instance
      if (node.value instanceof RegExp) return String(node.value);
      return "literal";

    default:
      return "expression";
  }
}

/**
 * Get a descriptive name for a call expression.
 */
function getCallExpressionName(node: T.CallExpression): string {
  const callee = node.callee;

  if (callee.type === "Identifier") {
    return `${callee.name}()`;
  }

  if (callee.type === "MemberExpression") {
    if (callee.property.type === "Identifier") {
      return `${callee.property.name}()`;
    }
    if (callee.property.type === "Literal" && typeof callee.property.value === "string") {
      return `${callee.property.value}()`;
    }
    return "method()";
  }

  if (callee.type === "CallExpression") {
    return "chained call";
  }

  if (callee.type === "ArrowFunctionExpression" || callee.type === "FunctionExpression") {
    return "IIFE";
  }

  return "call result";
}

/**
 * Check if an expression is a simple identifier or member expression.
 * These are typically safe to reference multiple times.
 *
 * @param node - The expression to check
 * @returns True if simple (identifier or non-computed member chain)
 */
export function isSimpleExpression(node: T.Expression): boolean {
  switch (node.type) {
    case "Identifier":
    case "ThisExpression":
    case "Super":
      return true;
    case "MemberExpression":
      return !node.computed && isSimpleExpression(node.object);
    case "ChainExpression":
      return isSimpleExpression(node.expression);
    default:
      return false;
  }
}

/**
 * Check if evaluating an expression might modify state or trigger external behavior.
 *
 * Returns true for expressions that:
 * - Call functions (could do anything)
 * - Assign values (`x = 1`, `x++`)
 * - Use `await` or `yield`
 * - Use `delete`
 *
 * Returns false for expressions that only read values:
 * - Identifiers, literals, `this`
 * - Property access (without getters, which we can't detect)
 * - Object/array literals with safe contents
 * - Arithmetic, logical, comparison operators
 *
 * Conservative: returns true when uncertain.
 *
 * @param node - The expression to check
 * @returns True if evaluating this expression might modify state
 */
export function mayHaveSideEffects(node: T.Expression): boolean {
  switch (node.type) {
    case "Identifier":
    case "Literal":
    case "ThisExpression":
    case "Super":
    case "TemplateLiteral":
    case "ArrowFunctionExpression":
    case "FunctionExpression":
    case "ClassExpression":
      return false;

     // These always have or may have side effects
    case "CallExpression":
    case "NewExpression":
    case "AssignmentExpression":
    case "UpdateExpression":
    case "AwaitExpression":
    case "YieldExpression":
    case "ImportExpression":
    case "TaggedTemplateExpression":
      return true;

    case "MemberExpression":
      if (mayHaveSideEffects(node.object)) return true;
      // When computed: true, property is Expression
      if (node.computed) {
        return mayHaveSideEffects(node.property);
      }
      return false;

    case "ArrayExpression":
      for (const el of node.elements) {
        if (el && el.type !== "SpreadElement" && mayHaveSideEffects(el)) return true;
        if (el?.type === "SpreadElement" && mayHaveSideEffects(el.argument)) return true;
      }
      return false;

    case "ObjectExpression":
      for (const prop of node.properties) {
        if (prop.type === "SpreadElement" && mayHaveSideEffects(prop.argument)) return true;
        if (prop.type === "Property") {
          // When computed: true, key is Expression (PropertyNameComputed)
          if (prop.computed && mayHaveSideEffects(prop.key)) return true;
          // value can be Expression | AssignmentPattern | BindingName | TSEmptyBodyFunctionExpression
          // Only check Expression types, others are patterns/declarations (no side effects)
          const val = prop.value;
          if (val.type !== "AssignmentPattern" &&
              val.type !== "ArrayPattern" &&
              val.type !== "ObjectPattern" &&
              val.type !== "Identifier" &&
              val.type !== "TSEmptyBodyFunctionExpression") {
            return mayHaveSideEffects(val);
          }
        }
      }
      return false;

    case "UnaryExpression":
      if (node.operator === "delete") return true;
      return mayHaveSideEffects(node.argument);

    case "BinaryExpression":
      // Handle `#prop in obj` where left is PrivateIdentifier
      if (node.left.type === "PrivateIdentifier") {
        return mayHaveSideEffects(node.right);
      }
      return mayHaveSideEffects(node.left) || mayHaveSideEffects(node.right);

    case "LogicalExpression":
      return mayHaveSideEffects(node.left) || mayHaveSideEffects(node.right);

    case "ConditionalExpression":
      return mayHaveSideEffects(node.test) ||
        mayHaveSideEffects(node.consequent) ||
        mayHaveSideEffects(node.alternate);

    case "SequenceExpression":
      return node.expressions.some(mayHaveSideEffects);

    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "TSInstantiationExpression":
      return mayHaveSideEffects(node.expression);

    case "ChainExpression":
      // ChainElement is CallExpression | MemberExpression | TSNonNullExpression
      return mayHaveSideEffects(node.expression);

    default:
      return true;
  }
}

/**
 * O(1) lookup for TypeScript keyword and simple type names.
 * Keys are AST_NODE_TYPES values, values are the human-readable names.
 */
const TS_TYPE_NAMES: Readonly<Record<string, string>> = {
  // Keyword types
  TSAnyKeyword: "any",
  TSUnknownKeyword: "unknown",
  TSNeverKeyword: "never",
  TSVoidKeyword: "void",
  TSUndefinedKeyword: "undefined",
  TSNullKeyword: "null",
  TSStringKeyword: "string",
  TSNumberKeyword: "number",
  TSBooleanKeyword: "boolean",
  TSBigIntKeyword: "bigint",
  TSSymbolKeyword: "symbol",
  TSObjectKeyword: "object",
  TSIntrinsicKeyword: "intrinsic",
  // Simple named types
  TSThisType: "this",
  TSTypeLiteral: "object type",
  TSFunctionType: "function type",
  TSConstructorType: "constructor type",
  TSConditionalType: "conditional type",
  TSMappedType: "mapped type",
  TSImportType: "import type",
  TSTemplateLiteralType: "template literal type",
};

/**
 * Get a human-readable name for a TypeScript type annotation.
 *
 * Uses O(1) lookup for keyword types, recursion for compound types.
 *
 * @param node - The type node to describe
 * @returns A human-readable name for the type
 *
 * @example
 * getTypeName(stringKeyword)     // "string"
 * getTypeName(typeReference)     // "MyType"
 * getTypeName(arrayType)         // "string[]"
 * getTypeName(unionType)         // "string | number"
 */
export function getTypeName(node: T.TypeNode): string {
  // Fast path: direct lookup
  const name = TS_TYPE_NAMES[node.type];
  if (name) return name;

  // Compound types need recursion
  switch (node.type) {
    case "TSTypeReference":
      if (node.typeName.type === "Identifier") {
        return node.typeName.name;
      }
      if (node.typeName.type === "TSQualifiedName") {
        return getQualifiedName(node.typeName);
      }
      return "type";

    case "TSArrayType":
      return `${getTypeName(node.elementType)}[]`;

    case "TSUnionType":
      return joinTypeNames(node.types, " | ");

    case "TSIntersectionType":
      return joinTypeNames(node.types, " & ");

    case "TSTupleType":
      return `[${joinTypeNames(node.elementTypes, ", ")}]`;

    case "TSOptionalType":
      return `${getTypeName(node.typeAnnotation)}?`;

    case "TSRestType":
      return `...${getTypeName(node.typeAnnotation)}`;

    case "TSLiteralType":
      return getLiteralTypeName(node);

    case "TSIndexedAccessType":
      return `${getTypeName(node.objectType)}[${getTypeName(node.indexType)}]`;

    case "TSTypeOperator":
      if (node.typeAnnotation) {
        return `${node.operator} ${getTypeName(node.typeAnnotation)}`;
      }
      return node.operator;

    case "TSTypeQuery":
      if (node.exprName.type === "Identifier") {
        return `typeof ${node.exprName.name}`;
      }
      return "typeof expression";

    case "TSInferType":
      return `infer ${node.typeParameter.name.name}`;

    case "TSNamedTupleMember":
      return `${node.label.name}: ${getTypeName(node.elementType)}`;

    default:
      return "type";
  }
}

/**
 * Join type names with a separator, avoiding .map() allocation for small arrays.
 */
function joinTypeNames(types: readonly T.TypeNode[], sep: string): string {
  const len = types.length;
  if (len === 0) return "";
  const first = types[0];
  if (len === 1 && first) return getTypeName(first);

  const parts: string[] = [];
  for (let i = 0; i < len; i++) {
    const t = types[i];
    if (t) parts.push(getTypeName(t));
  }
  return parts.join(sep);
}

/**
 * Get name for TSLiteralType nodes.
 */
function getLiteralTypeName(node: T.TSLiteralType): string {
  const lit = node.literal;
  if (lit.type === "Literal") {
    if (typeof lit.value === "string") return `"${lit.value}"`;
    return String(lit.value);
  }
  if (lit.type === "UnaryExpression" && lit.argument.type === "Literal") {
    return `${lit.operator}${String(lit.argument.value)}`;
  }
  if (lit.type === "TemplateLiteral") {
    return "template literal type";
  }
  return "literal";
}

/**
 * Get the full name from a qualified name (e.g., `Namespace.Type`).
 */
function getQualifiedName(node: T.TSQualifiedName): string {
  const right = node.right.name;
  if (node.left.type === "Identifier") {
    return `${node.left.name}.${right}`;
  }
  if (node.left.type === "ThisExpression") {
    return `this.${right}`;
  }
  return `${getQualifiedName(node.left)}.${right}`;
}

/**
 * Check if a node is an empty object literal `{}`.
 *
 * @param node - The expression node to check
 * @returns True if node is an empty object literal
 */
export function isEmptyObjectLiteral(node: T.Expression): boolean {
  return node.type === "ObjectExpression" && node.properties.length === 0;
}

/**
 * Comparison operators that produce boolean results.
 */
export const COMPARISON_OPERATORS = new Set([
  "===",
  "!==",
  "==",
  "!=",
  ">",
  "<",
  ">=",
  "<=",
]);

/**
 * Logical operators that typically indicate intentional boolean context.
 */
const LOGICAL_OPERATORS = new Set(["&&", "||", "??"]);

/**
 * Check if a node is a comparison expression that produces a boolean.
 *
 * @param node - The AST node to check
 * @returns True if the node is a comparison expression
 */
export function isComparisonExpression(node: T.Node): boolean {
  return node.type === "BinaryExpression" && COMPARISON_OPERATORS.has(node.operator);
}

/**
 * Check if a node is a logical expression (&&, ||, ??).
 *
 * @param node - The AST node to check
 * @returns True if the node is a logical expression
 */
export function isLogicalExpression(node: T.Node): boolean {
  return node.type === "LogicalExpression" && LOGICAL_OPERATORS.has(node.operator);
}

/**
 * Check if a node is a unary NOT expression (!expr).
 *
 * @param node - The AST node to check
 * @returns True if the node is a NOT expression
 */
export function isNotExpression(node: T.Node): boolean {
  return node.type === "UnaryExpression" && node.operator === "!";
}

/**
 * Check if a node is a Boolean() call.
 *
 * @param node - The AST node to check
 * @returns True if the node is a Boolean() call
 */
export function isBooleanCall(node: T.Node): boolean {
  if (node.type !== "CallExpression") return false;
  const callee = node.callee;
  return callee.type === "Identifier" && callee.name === "Boolean";
}

/**
 * Check if a node is a double negation (!!expr).
 *
 * @param node - The AST node to check
 * @returns True if the node is a double negation expression
 */
export function isDoubleNegation(node: T.Node): boolean {
  if (node.type !== "UnaryExpression" || node.operator !== "!") return false;
  const arg = node.argument;
  return arg.type === "UnaryExpression" && arg.operator === "!";
}

/**
 * Check if a node is a ternary with null/undefined/false as the alternate.
 * Pattern: condition ? value : null (used with keyed Show)
 *
 * @param node - The AST node to check
 * @returns True if the node is a guarded ternary pattern
 */
export function isGuardedTernary(node: T.Node): boolean {
  if (node.type !== "ConditionalExpression") return false;
  const alt = node.alternate;
  if (alt.type === "Literal" && (alt.value === null || alt.value === false)) return true;
  if (alt.type === "Identifier" && alt.name === "undefined") return true;
  return false;
}

/**
 * Check if a node represents an explicitly boolean expression.
 * Returns true if the expression doesn't need a truthy/falsy warning.
 *
 * Detects:
 * - Comparison expressions (===, !==, <, >, etc.)
 * - Logical expressions (&&, ||, ??)
 * - NOT expressions (!x)
 * - Boolean() calls
 * - Double negation (!!x)
 * - Boolean literals
 * - Guarded ternaries (cond ? val : null)
 *
 * @param node - The AST node to check
 * @returns True if the node is an explicit boolean expression
 */
export function isExplicitBooleanExpression(node: T.Node): boolean {
  if (isComparisonExpression(node)) return true;
  if (isLogicalExpression(node)) return true;
  if (isNotExpression(node)) return true;
  if (isBooleanCall(node)) return true;
  if (isDoubleNegation(node)) return true;
  if (node.type === "Literal" && typeof node.value === "boolean") return true;
  if (isGuardedTernary(node)) return true;
  return false;
}

const LOOP_TYPES = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
]);

const CONDITIONAL_TYPES = new Set([
  "IfStatement",
  "ConditionalExpression",
  "SwitchStatement",
  "LogicalExpression",
]);

/**
 * Checks if a node is inside a loop construct.
 */
/**
 * Returns the nearest enclosing loop node, stopping at function boundaries.
 * @param node - Starting node
 * @returns The loop node, or null if not in a loop
 */
export function getEnclosingLoop(node: T.Node): T.Node | null {
  let current = node.parent;
  while (current) {
    if (LOOP_TYPES.has(current.type)) return current;
    if (current.type === "ArrowFunctionExpression" ||
        current.type === "FunctionExpression" ||
        current.type === "FunctionDeclaration") {
      return null;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Checks if a node is inside a loop construct.
 */
export function isInLoop(node: T.Node): boolean {
  return getEnclosingLoop(node) !== null;
}

/**
 * Checks if a node is inside a conditional construct.
 */
export function isInConditional(node: T.Node): boolean {
  let current = node.parent;
  while (current) {
    if (CONDITIONAL_TYPES.has(current.type)) return true;
    if (current.type === "ArrowFunctionExpression" ||
        current.type === "FunctionExpression" ||
        current.type === "FunctionDeclaration") {
      return false;
    }
    current = current.parent;
  }
  return false;
}

/** Initial stack size for expression traversal */


/**
 * Check if an expression tree contains any identifier matching the given names.
 *
 * This is useful for determining if an expression depends on specific variables,
 * such as loop callback parameters.
 *
 * @param node The expression node to search
 * @param names Set of identifier names to look for
 * @returns true if any identifier in the expression matches a name in the set
 */
export function expressionReferencesAny(node: T.Node, names: Set<string>): boolean {
  if (names.size === 0) return false;

  const stack: T.Node[] = [node];
  let top = 1;

  while (top > 0) {
    const current = stack[--top];
    if (!current) continue;

    switch (current.type) {
      case "Identifier":
        if (names.has(current.name)) return true;
        break;

      case "MemberExpression":
        stack[top++] = current.object;
        break;

      case "CallExpression":
      case "NewExpression": {
        stack[top++] = current.callee;
        const args = current.arguments;
        for (let i = args.length - 1; i >= 0; i--) {
          const arg = args[i];
          if (arg) stack[top++] = arg;
        }
        break;
      }

      case "BinaryExpression":
      case "LogicalExpression":
      case "AssignmentExpression":
        stack[top++] = current.left;
        stack[top++] = current.right;
        break;

      case "ConditionalExpression":
        stack[top++] = current.test;
        stack[top++] = current.consequent;
        stack[top++] = current.alternate;
        break;

      case "UnaryExpression":
      case "UpdateExpression":
      case "SpreadElement":
      case "AwaitExpression":
        stack[top++] = current.argument;
        break;

      case "YieldExpression":
        if (current.argument) stack[top++] = current.argument;
        break;

      case "ArrayExpression": {
        const elements = current.elements;
        for (let i = elements.length - 1; i >= 0; i--) {
          const el = elements[i];
          if (el) stack[top++] = el;
        }
        break;
      }

      case "ObjectExpression": {
        const props = current.properties;
        for (let i = props.length - 1; i >= 0; i--) {
          const prop = props[i];
          if (!prop) continue;
          if (prop.type === "Property") {
            if (prop.computed) stack[top++] = prop.key;
            stack[top++] = prop.value;
          } else if (prop.type === "SpreadElement") {
            stack[top++] = prop.argument;
          }
        }
        break;
      }

      case "TemplateLiteral":
      case "SequenceExpression": {
        const exprs = current.expressions;
        for (let i = exprs.length - 1; i >= 0; i--) {
          const expr = exprs[i];
          if (expr) stack[top++] = expr;
        }
        break;
      }

      case "TaggedTemplateExpression":
        stack[top++] = current.tag;
        stack[top++] = current.quasi;
        break;

      case "TSAsExpression":
      case "TSTypeAssertion":
      case "TSNonNullExpression":
      case "ChainExpression":
        stack[top++] = current.expression;
        break;

      // Don't descend into nested functions - they create new scope
      case "ArrowFunctionExpression":
      case "FunctionExpression":
      case "Literal":
      case "ThisExpression":
      case "Super":
      case "MetaProperty":
      case "JSXElement":
      case "JSXFragment":
        break;
    }
  }

  return false;
}

/**
 * Check if an expression tree contains any identifier matching the given names,
 * including inside nested function bodies (arrow functions and function expressions).
 *
 * Unlike `expressionReferencesAny` which stops at function boundaries, this variant
 * traverses into closures. This is needed for `expandWithDerivedLocals` where
 * `const needsAnim = () => !markers().has(id)` should be recognized as depending
 * on `id` even though `id` is captured inside an arrow function.
 *
 * @param node The expression node to search
 * @param names Set of identifier names to look for
 * @returns true if any identifier in the expression (including inside closures) matches
 */
export function expressionReferencesAnyDeep(node: T.Node, names: Set<string>): boolean {
  if (names.size === 0) return false;

  const stack: T.Node[] = [node];
  let top = 1;

  while (top > 0) {
    const current = stack[--top];
    if (!current) continue;

    switch (current.type) {
      case "Identifier":
        if (names.has(current.name)) return true;
        break;

      case "MemberExpression":
        stack[top++] = current.object;
        break;

      case "CallExpression":
      case "NewExpression": {
        stack[top++] = current.callee;
        const args = current.arguments;
        for (let i = args.length - 1; i >= 0; i--) {
          const arg = args[i];
          if (arg) stack[top++] = arg;
        }
        break;
      }

      case "BinaryExpression":
      case "LogicalExpression":
      case "AssignmentExpression":
        stack[top++] = current.left;
        stack[top++] = current.right;
        break;

      case "ConditionalExpression":
        stack[top++] = current.test;
        stack[top++] = current.consequent;
        stack[top++] = current.alternate;
        break;

      case "UnaryExpression":
      case "UpdateExpression":
      case "SpreadElement":
      case "AwaitExpression":
        stack[top++] = current.argument;
        break;

      case "YieldExpression":
        if (current.argument) stack[top++] = current.argument;
        break;

      case "ArrayExpression": {
        const elements = current.elements;
        for (let i = elements.length - 1; i >= 0; i--) {
          const el = elements[i];
          if (el) stack[top++] = el;
        }
        break;
      }

      case "ObjectExpression": {
        const props = current.properties;
        for (let i = props.length - 1; i >= 0; i--) {
          const prop = props[i];
          if (!prop) continue;
          if (prop.type === "Property") {
            if (prop.computed) stack[top++] = prop.key;
            stack[top++] = prop.value;
          } else if (prop.type === "SpreadElement") {
            stack[top++] = prop.argument;
          }
        }
        break;
      }

      case "TemplateLiteral":
      case "SequenceExpression": {
        const exprs = current.expressions;
        for (let i = exprs.length - 1; i >= 0; i--) {
          const expr = exprs[i];
          if (expr) stack[top++] = expr;
        }
        break;
      }

      case "TaggedTemplateExpression":
        stack[top++] = current.tag;
        stack[top++] = current.quasi;
        break;

      case "TSAsExpression":
      case "TSTypeAssertion":
      case "TSNonNullExpression":
      case "ChainExpression":
        stack[top++] = current.expression;
        break;

      // Traverse INTO function bodies — the key difference from expressionReferencesAny
      case "ArrowFunctionExpression":
      case "FunctionExpression":
        stack[top++] = current.body;
        break;

      // Statement traversal (needed for block-body arrow functions)
      case "BlockStatement": {
        const stmts = current.body;
        for (let i = stmts.length - 1; i >= 0; i--) {
          const stmt = stmts[i];
          if (stmt) stack[top++] = stmt;
        }
        break;
      }

      case "ReturnStatement":
        if (current.argument) stack[top++] = current.argument;
        break;

      case "ExpressionStatement":
        stack[top++] = current.expression;
        break;

      case "VariableDeclaration": {
        const decls = current.declarations;
        for (let i = decls.length - 1; i >= 0; i--) {
          const decl = decls[i];
          if (decl?.init) stack[top++] = decl.init;
        }
        break;
      }

      case "IfStatement":
        stack[top++] = current.test;
        stack[top++] = current.consequent;
        if (current.alternate) stack[top++] = current.alternate;
        break;

      case "Literal":
      case "ThisExpression":
      case "Super":
      case "MetaProperty":
      case "JSXElement":
      case "JSXFragment":
        break;
    }
  }

  return false;
}

/**
 * Find the containing expression that determines the context of a node.
 *
 * For example, for `theme()` in `theme() === "dark" ? "white" : "black"`,
 * this returns the ConditionalExpression.
 *
 * This walks up from a node to find the expression boundary, stopping at:
 * - Statement boundaries
 * - JSX attribute values
 * - Object property values
 *
 * @param node The starting node
 * @returns The containing expression, or the node itself if at expression root
 */
export function getContainingExpression(node: T.Node): T.Node {
  let current = node;
  let parent = node.parent;

  while (parent) {
    switch (parent.type) {
      // Expression or statement boundary - stop here
      case "ExpressionStatement":
      case "VariableDeclarator":
      case "ReturnStatement":
      case "ThrowStatement":
      case "JSXExpressionContainer":
      case "JSXAttribute":
      case "BlockStatement":
      case "IfStatement":
      case "ForStatement":
      case "WhileStatement":
      case "SwitchStatement":
      case "TryStatement":
        return current;

      // Object property - stop if current is the value
      case "Property":
        if (parent.value === current) {
          return current;
        }
        break;

      // CallExpression - stop if current is an argument
      case "CallExpression":
        if (parent.callee !== current) {
          return current;
        }
        break;

      // Expressions that contain our node - continue up
      case "ArrayExpression":
      case "ObjectExpression":
      case "BinaryExpression":
      case "LogicalExpression":
      case "ConditionalExpression":
      case "UnaryExpression":
      case "MemberExpression":
      case "SequenceExpression":
      case "AssignmentExpression":
      case "TemplateLiteral":
      case "TaggedTemplateExpression":
        break;
    }

    current = parent;
    parent = parent.parent;
  }

  return current;
}

/** Methods that return strings — evidence the receiver/result is string-typed. */
export const STRING_RETURNING_METHODS = new Set([
  "trim", "toLowerCase", "toUpperCase",
  "replace", "replaceAll", "slice",
  "substring", "substr", "concat",
  "normalize", "padStart", "padEnd",
]);

/**
 * Checks if an expression is provably a string value.
 */
export function isStringExpression(node: T.Expression): boolean {
  if (node.type === "Literal" && typeof node.value === "string") return true;
  if (node.type === "TemplateLiteral") return true;
  if (node.type === "CallExpression" &&
      node.callee.type === "MemberExpression" &&
      node.callee.property.type === "Identifier") {
    if (STRING_RETURNING_METHODS.has(node.callee.property.name)) return true;
  }
  return false;
}
