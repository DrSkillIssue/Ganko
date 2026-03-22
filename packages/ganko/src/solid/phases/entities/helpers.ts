import ts from "typescript";
import type { SolidBuildContext } from "../../build-context"
import type { ScopeEntity } from "../../entities/scope";
import type { VariableEntity } from "../../entities/variable";
import type { JSXAttributeEntity, StyleComplexityInfo } from "../../entities/jsx";
import { classifyAttribute } from "../../util/jsx";
import { getVariableByNameInScope } from "../../queries/scope";
import { unwrapParenthesized } from "../../util/expression";

export function isEmptyObject(node: ts.Expression): boolean {
  const unwrapped = unwrapParenthesized(node);
  return ts.isObjectLiteralExpression(unwrapped) && unwrapped.properties.length === 0;
}

export function countConditionals(node: ts.Node): number {
  let count = 0;

  if (ts.isConditionalExpression(node)) {
    count = 1 + countConditionals(node.whenTrue) + countConditionals(node.whenFalse);
  } else if (ts.isBinaryExpression(node) && (
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    node.operatorToken.kind === ts.SyntaxKind.BarBarToken
  )) {
    count = countConditionals(node.left) + countConditionals(node.right);
  }

  return count;
}

export function analyzeStyleComplexity(obj: ts.ObjectLiteralExpression): StyleComplexityInfo {
  let conditionalCount = 0;
  let hasConditionalSpread = false;

  for (let i = 0, len = obj.properties.length; i < len; i++) {
    const prop = obj.properties[i];
    if (!prop) continue;

    if (ts.isSpreadAssignment(prop)) {
      const arg = unwrapParenthesized(prop.expression);
      if (ts.isConditionalExpression(arg) || (ts.isBinaryExpression(arg) && arg.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)) {
        hasConditionalSpread = true;
      }
    } else if (ts.isPropertyAssignment(prop)) {
      conditionalCount += countConditionals(prop.initializer);
    }
  }

  return { conditionalCount, hasConditionalSpread };
}

export function getJSXChildKind(child: ts.Node): "element" | "expression" | "text" {
  if (ts.isJsxElement(child) || ts.isJsxFragment(child)) return "element";
  if (ts.isJsxExpression(child) || ts.isJsxText(child) === false && child.kind === ts.SyntaxKind.JsxExpression) return "expression";
  return "text";
}

export function getImportedName(spec: ts.ImportSpecifier | ts.ImportClause | ts.NamespaceImport): string | null {
  if (ts.isImportSpecifier(spec)) {
    return spec.propertyName ? spec.propertyName.text : spec.name.text;
  }
  return null;
}

export function getImportSpecifierKind(spec: ts.ImportSpecifier | ts.ImportClause | ts.NamespaceImport): "named" | "default" | "namespace" {
  if (ts.isImportClause(spec)) return "default";
  if (ts.isNamespaceImport(spec)) return "namespace";
  return "named";
}

export function getFunctionName(node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | ts.ConstructorDeclaration): string | null {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isFunctionExpression(node) && node.name) return node.name.text;
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isConstructorDeclaration(node)) return "constructor";

  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (parent && ts.isMethodDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }

  return null;
}

export function getFunctionVariableName(node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | ts.ConstructorDeclaration): string | null {
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return null;
}

export function getParameterName(param: ts.ParameterDeclaration): string | null {
  if (ts.isIdentifier(param.name)) return param.name.text;
  if (ts.isObjectBindingPattern(param.name) || ts.isArrayBindingPattern(param.name)) return null;
  return null;
}

export function getDeclarationNode(node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | ts.ConstructorDeclaration): ts.Node {
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent)) {
    const grandparent = parent.parent;
    if (grandparent && ts.isVariableDeclarationList(grandparent)) {
      const greatGrandparent = grandparent.parent;
      if (greatGrandparent && ts.isVariableStatement(greatGrandparent)) {
        // Check if the variable statement has export modifier
        if (greatGrandparent.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
          return greatGrandparent;
        }
        return greatGrandparent;
      }
    }
  }
  if (parent && ts.isFunctionDeclaration(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
    return node;
  }
  return node;
}

export function getJSXElementTag(node: ts.JsxElement | ts.JsxSelfClosingElement): string | null {
  const name = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isPropertyAccessExpression(name)) {
    const parts: string[] = [];
    let current: ts.Expression = name;
    while (ts.isPropertyAccessExpression(current)) {
      parts.unshift(current.name.text);
      current = current.expression;
    }
    // current is now Identifier (after exhausting PropertyAccessExpression)
    if (ts.isIdentifier(current)) {
      parts.unshift(current.text);
    }
    return parts.join(".");
  }
  return null;
}

export function buildJSXAttribute(attr: ts.JsxAttributeLike, id: number): JSXAttributeEntity {
  if (ts.isJsxSpreadAttribute(attr)) {
    return {
      id,
      node: attr,
      name: null,
      kind: "spread",
      namespace: null,
      spreadProps: [],
      valueNode: attr.expression,
      styleComplexity: null,
      spreadInfo: null,
    };
  }

  const nameNode = attr.name;
  let name: string;
  let namespace: string | null = null;

  if (ts.isIdentifier(nameNode)) {
    name = nameNode.text;
  } else {
    // JsxNamespacedName — after isIdentifier check, nameNode is ts.JsxNamespacedName
    name = `${nameNode.namespace.text}:${nameNode.name.text}`;
    namespace = nameNode.namespace.text;
  }
  const kind = classifyAttribute(name);

  let styleComplexity: StyleComplexityInfo | null = null;
  if (kind === "style" && attr.initializer && ts.isJsxExpression(attr.initializer)) {
    const expr = attr.initializer.expression;
    if (expr && ts.isObjectLiteralExpression(expr)) {
      styleComplexity = analyzeStyleComplexity(expr);
    }
  }

  return {
    id,
    node: attr,
    name,
    kind,
    namespace,
    spreadProps: [],
    valueNode: attr.initializer ?? null,
    styleComplexity,
    spreadInfo: null,
  };
}

/**
 * Computes captured variables for a function by collecting identifiers
 * in the function body that resolve to variables in an enclosing scope.
 *
 * Walks the TypeScript AST to find Identifier nodes and checks them against
 * the scope chain. Variables declared within the function scope are excluded.
 */
export function computeCaptures(
  node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | ts.ConstructorDeclaration,
  fnScope: ScopeEntity,
  graph: SolidBuildContext,
): VariableEntity[] {
  const captures: VariableEntity[] = [];
  const seen = new Set<number>();

  // Collect all variable names declared within this function's scope
  const ownNames = new Set<string>();
  collectOwnNames(fnScope, ownNames);

  // Walk the function body to find identifier references
  const body = node.body;
  if (!body) return captures;

  collectIdentifierCaptures(body, ownNames, fnScope, graph, seen, captures);

  return captures;
}

function collectOwnNames(scope: ScopeEntity, names: Set<string>): void {
  const vars = scope.variables;
  for (let i = 0, len = vars.length; i < len; i++) {
    const v = vars[i];
    if (v) names.add(v.name);
  }
  const children = scope.children;
  for (let i = 0, len = children.length; i < len; i++) {
    const child = children[i];
    if (child) collectOwnNames(child, names);
  }
}

function collectIdentifierCaptures(
  node: ts.Node,
  ownNames: Set<string>,
  fnScope: ScopeEntity,
  graph: SolidBuildContext,
  seen: Set<number>,
  captures: VariableEntity[],
): void {
  if (ts.isIdentifier(node)) {
    const name = node.text;
    if (!ownNames.has(name)) {
      const variable = getVariableByNameInScope(graph, name, fnScope.parent ?? fnScope);
      if (variable && !seen.has(variable.id)) {
        seen.add(variable.id);
        captures.push(variable);
      }
    }
    return;
  }

  // Don't descend into nested function declarations/expressions
  if (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node)) {
    return;
  }

  // Walk children using ts.forEachChild
  ts.forEachChild(node, (child) => {
    collectIdentifierCaptures(child, ownNames, fnScope, graph, seen, captures);
  });
}
