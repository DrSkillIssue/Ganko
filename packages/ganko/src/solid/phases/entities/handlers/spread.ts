import type { TSESTree as T } from "@typescript-eslint/utils";
import type { VisitorContext } from "../context";
import type { SpreadAttributeContext, FixableSpreadPattern, SpreadSourceKind, ObjectSpreadEntity } from "../../../entities/spread";
import { isEmptyObject } from "../helpers";
import { getPropertyKeyName } from "../../../util/pattern-detection";
import { isDomElement } from "@ganko/shared";

export function handleRestDestructure(ctx: VisitorContext, 
  rest: T.RestElement,
  pattern: T.ObjectPattern,
  init: T.Expression | null,
): void {
  const graph = ctx.graph;
  
  // Get source name from init expression (e.g., "props" from const { a, ...rest } = props)
  let sourceName: string | null = null;
  if (init?.type === "Identifier") {
    sourceName = init.name;
  } else if (init?.type === "MemberExpression") {
    sourceName = getSpreadSourceName(ctx, init);
  }

  const entity: ObjectSpreadEntity = {
    id: graph.nextMiscId(),
    node: rest,
    kind: "rest-destructure",
    parentObject: null,
    parentJSXElement: null,
    parentPattern: pattern,
    isInJSX: false,
    spreadCount: 1,
    propertyCount: pattern.properties.length - 1, // Minus the rest element
    attributeContext: "other",
    targetTag: null,
    targetIsDom: false,
    sourceName,
    sourceKind: init ? getSpreadSourceKind(ctx, init) : "other",
  };

  graph.addObjectSpread(entity);
}

export function handleConditionalSpread(ctx: VisitorContext, spread: T.SpreadElement, parentObject: T.ObjectExpression): void {
  const arg = spread.argument;
  const graph = ctx.graph;

  // Check for ternary: ...(cond ? {...} : {})
  if (arg.type === "ConditionalExpression") {
    const { consequent, alternate } = arg;
    const conseqIsEmpty = isEmptyObject(consequent);
    const altIsEmpty = isEmptyObject(alternate);

    // Only register if exactly one branch is an empty object
    if (conseqIsEmpty !== altIsEmpty) {
      const isInJSX = isInJSXAttribute(ctx, parentObject);
      const attributeContext = getSpreadAttributeContext(ctx, parentObject);
      const fixablePattern = extractFixablePattern(ctx, arg, conseqIsEmpty);

      graph.addConditionalSpread({
        id: graph.nextConditionalSpreadId(),
        node: spread,
        spreadType: "ternary",
        parentObject,
        parentJSXElement: isInJSX ? findParentJSXElement(ctx, parentObject) : null,
        isInJSX,
        attributeContext,
        fixablePattern,
      });
    }
    return;
  }

  // Check for logical AND: ...(cond && {...})
  if (arg.type === "LogicalExpression" && arg.operator === "&&") {
    const right = arg.right;
    if (right.type === "ObjectExpression") {
      const isInJSX = isInJSXAttribute(ctx, parentObject);
      const attributeContext = getSpreadAttributeContext(ctx, parentObject);
      const fixablePattern = extractLogicalAndFixablePattern(ctx, arg);

      graph.addConditionalSpread({
        id: graph.nextConditionalSpreadId(),
        node: spread,
        spreadType: "logical-and",
        parentObject,
        parentJSXElement: isInJSX ? findParentJSXElement(ctx, parentObject) : null,
        isInJSX,
        attributeContext,
        fixablePattern,
      });
    }
  }
}

export function handleObjectSpread(ctx: VisitorContext, spread: T.SpreadElement, parent: T.ObjectExpression): void {
  const graph = ctx.graph;
  const arg = spread.argument;
  const isInJSX = isInJSXAttribute(ctx, parent);
  const parentJSX = isInJSX ? findParentJSXElement(ctx, parent) : null;

  let spreadCount = 0;
  let propertyCount = 0;
  for (let i = 0, len = parent.properties.length; i < len; i++) {
    const prop = parent.properties[i];
    if (!prop) continue;
    if (prop.type === "SpreadElement") spreadCount++;
    else propertyCount++;
  }

  const kind = getObjectSpreadKind(ctx, spreadCount, propertyCount, isInJSX);
  const targetTag = parentJSX ? getJSXOpeningElementTag(ctx, parentJSX) : null;
  const targetIsDom = isDomElement(targetTag);

  const entity: ObjectSpreadEntity = {
    id: graph.nextMiscId(),
    node: spread,
    kind,
    parentObject: parent,
    parentJSXElement: parentJSX,
    parentPattern: null,
    isInJSX,
    spreadCount,
    propertyCount,
    attributeContext: getSpreadAttributeContext(ctx, parent),
    targetTag,
    targetIsDom,
    sourceName: getSpreadSourceName(ctx, arg),
    sourceKind: getSpreadSourceKind(ctx, arg),
  };

  graph.addObjectSpread(entity);
}

export function handleJSXSpread(ctx: VisitorContext, 
  attr: T.JSXSpreadAttribute,
  openingElement: T.JSXOpeningElement,
  tag: string | null,
): void {
  const graph = ctx.graph;
  const targetIsDom = isDomElement(tag);

  const entity: ObjectSpreadEntity = {
    id: graph.nextMiscId(),
    node: attr,
    kind: "jsx-spread",
    parentObject: null,
    parentJSXElement: openingElement,
    parentPattern: null,
    isInJSX: true,
    spreadCount: 1,
    propertyCount: 0,
    attributeContext: "props",
    targetTag: tag,
    targetIsDom,
    sourceName: getSpreadSourceName(ctx, attr.argument),
    sourceKind: getSpreadSourceKind(ctx, attr.argument),
  };

  graph.addObjectSpread(entity);
}

export function isInJSXAttribute(_ctx: VisitorContext, node: T.ObjectExpression): boolean {
  let current: T.Node | undefined = node.parent;
  while (current) {
    if (current.type === "JSXAttribute" || current.type === "JSXSpreadAttribute") return true;
    if (current.type === "JSXElement" || current.type === "JSXFragment") return true;
    current = current.parent;
  }
  return false;
}

export function getSpreadAttributeContext(_ctx: VisitorContext, node: T.ObjectExpression): SpreadAttributeContext {
  let current: T.Node | undefined = node.parent;
  while (current) {
    if (current.type === "JSXAttribute") {
      const name = current.name;
      if (name.type === "JSXIdentifier") {
        if (name.name === "classList") return "classList";
        if (name.name === "style") return "style";
      }
      return "props";
    }
    if (current.type === "JSXSpreadAttribute") return "props";
    if (current.type === "JSXElement" || current.type === "JSXFragment") break;
    current = current.parent;
  }
  return "other";
}

export function findParentJSXElement(_ctx: VisitorContext, node: T.ObjectExpression): T.JSXOpeningElement | null {
  let current: T.Node | undefined = node.parent;
  while (current) {
    if (current.type === "JSXOpeningElement") return current;
    if (current.type === "JSXElement") return current.openingElement;
    current = current.parent;
  }
  return null;
}

export function extractFixablePattern(ctx: VisitorContext, cond: T.ConditionalExpression, conseqIsEmpty: boolean): FixableSpreadPattern | null {
  const nonEmptyBranch = conseqIsEmpty ? cond.alternate : cond.consequent;
  if (nonEmptyBranch.type !== "ObjectExpression") return null;
  if (nonEmptyBranch.properties.length !== 1) return null;

  const prop = nonEmptyBranch.properties[0];
  if (!prop || prop.type !== "Property") return null;

  const key = prop.key;
  const value = prop.value;
  const keyText = getKeyText(ctx, key, prop.computed);
  const valueText = getNodeText(ctx, value);
  if (!keyText || !valueText) return null;

  const conditionText = getNodeText(ctx, cond.test);
  const conditionMatchesKey = prop.computed && conditionText === keyText;

  return {
    truthyBranch: !conseqIsEmpty,
    property: {
      key: keyText,
      keyRange: key.range ?? [0, 0],
      computed: prop.computed,
      value: valueText,
      valueRange: value.range ?? [0, 0],
      isBooleanTrue: value.type === "Literal" && value.value === true,
    },
    conditionRange: cond.test.range ?? [0, 0],
    conditionMatchesKey,
  };
}

export function extractLogicalAndFixablePattern(ctx: VisitorContext, expr: T.LogicalExpression): FixableSpreadPattern | null {
  const right = expr.right;
  if (right.type !== "ObjectExpression") return null;
  if (right.properties.length !== 1) return null;

  const prop = right.properties[0];
  if (!prop || prop.type !== "Property") return null;

  const key = prop.key;
  const value = prop.value;
  const keyText = getKeyText(ctx, key, prop.computed);
  const valueText = getNodeText(ctx, value);
  if (!keyText || !valueText) return null;

  const conditionText = getNodeText(ctx, expr.left);
  const conditionMatchesKey = prop.computed && conditionText === keyText;

  return {
    truthyBranch: true,
    property: {
      key: keyText,
      keyRange: key.range ?? [0, 0],
      computed: prop.computed,
      value: valueText,
      valueRange: value.range ?? [0, 0],
      isBooleanTrue: value.type === "Literal" && value.value === true,
    },
    conditionRange: expr.left.range ?? [0, 0],
    conditionMatchesKey,
  };
}

export function getKeyText(ctx: VisitorContext, key: T.Node, computed: boolean): string | null {
  const name = getPropertyKeyName(key);
  if (name !== null) return name;
  if (computed && key.range) {
    return ctx.graph.sourceCode.getText(key);
  }
  return null;
}

export function getNodeText(ctx: VisitorContext, node: T.Node): string | null {
  if (!node.range) return null;
  return ctx.graph.sourceCode.getText(node);
}

export function getObjectSpreadKind(_ctx: VisitorContext, 
  spreadCount: number,
  propertyCount: number,
  _isInJSX: boolean,
): ObjectSpreadEntity["kind"] {
  // Note: jsx-spread is only for JSXSpreadAttribute nodes (handled in handleJSXSpread)
  // SpreadElements inside object expressions are always object spreads, even in JSX context
  if (spreadCount > 1) return "object-merge";
  if (propertyCount > 0) return "object-update";
  return "object-copy";
}

export function getJSXOpeningElementTag(_ctx: VisitorContext, node: T.JSXOpeningElement): string | null {
  const name = node.name;
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXNamespacedName") return `${name.namespace.name}:${name.name.name}`;
  if (name.type === "JSXMemberExpression") {
    const parts: string[] = [];
    let current: T.JSXMemberExpression["object"] = name;
    while (current.type === "JSXMemberExpression") {
      parts.unshift(current.property.name);
      current = current.object;
    }
    if (current.type === "JSXIdentifier") parts.unshift(current.name);
    return parts.join(".");
  }
  return null;
}

export function getSpreadSourceName(_ctx: VisitorContext, node: T.Expression): string | null {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") {
    // Build full member expression path: props.nested.deep.classes
    const parts: string[] = [];
    let current: T.Expression = node;
    while (current.type === "MemberExpression") {
      const prop = current.property;
      if (prop.type === "Identifier") parts.unshift(prop.name);
      else return null; // computed property, bail
      current = current.object;
    }
    if (current.type === "Identifier") {
      parts.unshift(current.name);
      return parts.join(".");
    }
    return null;
  }
  if (node.type === "CallExpression") {
    const callee = node.callee;
    if (callee.type === "Identifier") return callee.name + "()";
  }
  return null;
}

export function getSpreadSourceKind(_ctx: VisitorContext, node: T.Expression): SpreadSourceKind {
  switch (node.type) {
    case "Identifier": return "identifier";
    case "MemberExpression": return "member";
    case "CallExpression": return "call";
    case "ObjectExpression": return "literal";
    case "LogicalExpression": return "logical";
    case "ConditionalExpression": return "conditional";
    default: return "other";
  }
}
