import type { TSESTree as T } from "@typescript-eslint/utils";
import type { SolidGraph } from "../../impl";
import type { ScopeEntity } from "../../entities/scope";
import type { VariableEntity } from "../../entities/variable";
import type { JSXAttributeEntity, StyleComplexityInfo } from "../../entities/jsx";
import { classifyAttribute } from "../../util/jsx";
import { getVariableByNameInScope } from "../../queries/scope";

export function isEmptyObject(node: T.Expression): boolean {
  return node.type === "ObjectExpression" && node.properties.length === 0;
}

export function countConditionals(node: T.Node): number {
  let count = 0;

  if (node.type === "ConditionalExpression") {
    count = 1 + countConditionals(node.consequent) + countConditionals(node.alternate);
  } else if (node.type === "LogicalExpression") {
    count = countConditionals(node.left) + countConditionals(node.right);
  }

  return count;
}

export function analyzeStyleComplexity(obj: T.ObjectExpression): StyleComplexityInfo {
  let conditionalCount = 0;
  let hasConditionalSpread = false;

  for (let i = 0, len = obj.properties.length; i < len; i++) {
    const prop = obj.properties[i];
    if (!prop) continue;

    if (prop.type === "SpreadElement") {
      const arg = prop.argument;
      if (arg.type === "ConditionalExpression" || (arg.type === "LogicalExpression" && arg.operator === "&&")) {
        hasConditionalSpread = true;
      }
    } else if (prop.type === "Property") {
      conditionalCount += countConditionals(prop.value);
    }
  }

  return { conditionalCount, hasConditionalSpread };
}

export function getJSXChildKind(child: T.Node): "element" | "expression" | "text" {
  if (child.type === "JSXElement" || child.type === "JSXFragment") return "element";
  if (child.type === "JSXExpressionContainer" || child.type === "JSXSpreadChild") return "expression";
  return "text";
}

export function getImportedName(spec: T.ImportSpecifier | T.ImportDefaultSpecifier | T.ImportNamespaceSpecifier): string | null {
  if (spec.type === "ImportSpecifier") {
    return spec.imported.type === "Identifier" ? spec.imported.name : spec.imported.value;
  }
  return null;
}

export function getImportSpecifierKind(spec: T.ImportSpecifier | T.ImportDefaultSpecifier | T.ImportNamespaceSpecifier): "named" | "default" | "namespace" {
  if (spec.type === "ImportDefaultSpecifier") return "default";
  if (spec.type === "ImportNamespaceSpecifier") return "namespace";
  return "named";
}

export function getFunctionName(node: T.FunctionDeclaration | T.FunctionExpression | T.ArrowFunctionExpression): string | null {
  if (node.type === "FunctionDeclaration" && node.id) return node.id.name;
  if (node.type === "FunctionExpression" && node.id) return node.id.name;

  const parent = node.parent;
  if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier") {
    return parent.id.name;
  }
  if (parent?.type === "Property" && parent.key.type === "Identifier") {
    return parent.key.name;
  }
  if (parent?.type === "MethodDefinition" && parent.key.type === "Identifier") {
    return parent.key.name;
  }

  return null;
}

export function getFunctionVariableName(node: T.FunctionDeclaration | T.FunctionExpression | T.ArrowFunctionExpression): string | null {
  const parent = node.parent;
  if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier") {
    return parent.id.name;
  }
  return null;
}

export function getParameterName(param: T.Parameter): string | null {
  if (param.type === "Identifier") return param.name;
  if (param.type === "AssignmentPattern" && param.left.type === "Identifier") return param.left.name;
  if (param.type === "RestElement" && param.argument.type === "Identifier") return param.argument.name;
  return null;
}

export function getDeclarationNode(node: T.FunctionDeclaration | T.FunctionExpression | T.ArrowFunctionExpression): T.Node {
  const parent = node.parent;
  if (parent?.type === "VariableDeclarator") {
    const grandparent = parent.parent;
    if (grandparent?.type === "VariableDeclaration") {
      const greatGrandparent = grandparent.parent;
      if (greatGrandparent?.type === "ExportNamedDeclaration" || greatGrandparent?.type === "ExportDefaultDeclaration") {
        return greatGrandparent;
      }
      return grandparent;
    }
  }
  if (parent?.type === "ExportNamedDeclaration" || parent?.type === "ExportDefaultDeclaration") {
    return parent;
  }
  return node;
}

export function getJSXElementTag(node: T.JSXElement): string | null {
  const name = node.openingElement.name;
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXNamespacedName") return `${name.namespace.name}:${name.name.name}`;
  if (name.type === "JSXMemberExpression") {
    const parts: string[] = [];
    let current: T.JSXMemberExpression["object"] = name;
    while (current.type === "JSXMemberExpression") {
      parts.unshift(current.property.name);
      current = current.object;
    }
    // current is now JSXIdentifier (after exhausting JSXMemberExpression)
    if (current.type === "JSXIdentifier") {
      parts.unshift(current.name);
    }
    return parts.join(".");
  }
  return null;
}

export function buildJSXAttribute(attr: T.JSXAttribute | T.JSXSpreadAttribute, id: number): JSXAttributeEntity {
  if (attr.type === "JSXSpreadAttribute") {
    return {
      id,
      node: attr,
      name: null,
      kind: "spread",
      namespace: null,
      spreadProps: [],
      valueNode: attr.argument,
      styleComplexity: null,
      spreadInfo: null,
    };
  }

  const name = attr.name.type === "JSXIdentifier"
    ? attr.name.name
    : `${attr.name.namespace.name}:${attr.name.name.name}`;
  const namespace = attr.name.type === "JSXNamespacedName" ? attr.name.namespace.name : null;
  const kind = classifyAttribute(name);

  let styleComplexity: StyleComplexityInfo | null = null;
  if (kind === "style" && attr.value?.type === "JSXExpressionContainer") {
    const expr = attr.value.expression;
    if (expr.type === "ObjectExpression") {
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
    valueNode: attr.value,
    styleComplexity,
    spreadInfo: null,
  };
}

export function computeCaptures(
  node: T.FunctionDeclaration | T.FunctionExpression | T.ArrowFunctionExpression,
  fnScope: ScopeEntity,
  graph: SolidGraph,
): VariableEntity[] {
  const captures: VariableEntity[] = [];
  const seen = new Set<number>();

  // Get all references in the function body
  const scopeManager = graph.sourceCode.scopeManager;
  const eslintScope = scopeManager?.acquire(node);
  if (!eslintScope) return captures;

  const through = eslintScope.through;
  if (through.length === 0) return captures;

  for (let i = 0, len = through.length; i < len; i++) {
    const ref = through[i];
    if (!ref) continue;
    const name = ref.identifier.name;
    const variable = getVariableByNameInScope(graph, name, fnScope.parent ?? fnScope);
    if (variable && !seen.has(variable.id)) {
      seen.add(variable.id);
      captures.push(variable);
    }
  }

  return captures;
}
