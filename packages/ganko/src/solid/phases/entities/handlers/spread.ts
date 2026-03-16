import ts from "typescript";
import type { VisitorContext } from "../context";
import type { SpreadAttributeContext, FixableSpreadPattern, SpreadSourceKind, ObjectSpreadEntity } from "../../../entities/spread";
import { isEmptyObject } from "../helpers";
import { getPropertyKeyName } from "../../../util/pattern-detection";
import { isDomElement } from "@drskillissue/ganko-shared";
import { unwrapParenthesized } from "../../../util/expression";

export function handleRestDestructure(ctx: VisitorContext,
  rest: ts.BindingElement,
  pattern: ts.ObjectBindingPattern,
  init: ts.Expression | null,
): void {
  const graph = ctx.graph;

  // Get source name from init expression (e.g., "props" from const { a, ...rest } = props)
  let sourceName: string | null = null;
  if (init && ts.isIdentifier(init)) {
    sourceName = init.text;
  } else if (init && ts.isPropertyAccessExpression(init)) {
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
    propertyCount: pattern.elements.length - 1, // Minus the rest element
    attributeContext: "other",
    targetTag: null,
    targetIsDom: false,
    sourceName,
    sourceKind: init ? getSpreadSourceKind(ctx, init) : "other",
  };

  graph.addObjectSpread(entity);
}

export function handleConditionalSpread(ctx: VisitorContext, spread: ts.SpreadAssignment, parentObject: ts.ObjectLiteralExpression): void {
  const arg = unwrapParenthesized(spread.expression);
  const graph = ctx.graph;

  // Check for ternary: ...(cond ? {...} : {})
  if (ts.isConditionalExpression(arg)) {
    const { whenTrue: consequent, whenFalse: alternate } = arg;
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
  if (ts.isBinaryExpression(arg) && arg.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    const right = unwrapParenthesized(arg.right);
    if (ts.isObjectLiteralExpression(right)) {
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

export function handleObjectSpread(ctx: VisitorContext, spread: ts.SpreadAssignment, parent: ts.ObjectLiteralExpression): void {
  const graph = ctx.graph;
  const arg = spread.expression;
  const isInJSX = isInJSXAttribute(ctx, parent);
  const parentJSX = isInJSX ? findParentJSXElement(ctx, parent) : null;

  let spreadCount = 0;
  let propertyCount = 0;
  for (let i = 0, len = parent.properties.length; i < len; i++) {
    const prop = parent.properties[i];
    if (!prop) continue;
    if (ts.isSpreadAssignment(prop)) spreadCount++;
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
  attr: ts.JsxSpreadAttribute,
  openingElement: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
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
    sourceName: getSpreadSourceName(ctx, attr.expression),
    sourceKind: getSpreadSourceKind(ctx, attr.expression),
  };

  graph.addObjectSpread(entity);
}

export function isInJSXAttribute(_ctx: VisitorContext, node: ts.ObjectLiteralExpression): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isJsxAttribute(current) || ts.isJsxSpreadAttribute(current)) return true;
    if (ts.isJsxElement(current) || ts.isJsxFragment(current)) return true;
    current = current.parent;
  }
  return false;
}

export function getSpreadAttributeContext(_ctx: VisitorContext, node: ts.ObjectLiteralExpression): SpreadAttributeContext {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isJsxAttribute(current)) {
      const name = current.name;
      if (ts.isIdentifier(name)) {
        if (name.text === "classList") return "classList";
        if (name.text === "style") return "style";
      }
      return "props";
    }
    if (ts.isJsxSpreadAttribute(current)) return "props";
    if (ts.isJsxElement(current) || ts.isJsxFragment(current)) break;
    current = current.parent;
  }
  return "other";
}

export function findParentJSXElement(_ctx: VisitorContext, node: ts.ObjectLiteralExpression): ts.JsxOpeningElement | null {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isJsxOpeningElement(current)) return current;
    if (ts.isJsxElement(current)) return current.openingElement;
    current = current.parent;
  }
  return null;
}

export function extractFixablePattern(ctx: VisitorContext, cond: ts.ConditionalExpression, conseqIsEmpty: boolean): FixableSpreadPattern | null {
  const nonEmptyBranch = unwrapParenthesized(conseqIsEmpty ? cond.whenFalse : cond.whenTrue);
  if (!ts.isObjectLiteralExpression(nonEmptyBranch)) return null;
  if (nonEmptyBranch.properties.length !== 1) return null;

  const prop = nonEmptyBranch.properties[0];
  if (!prop || !ts.isPropertyAssignment(prop)) return null;

  const key = prop.name;
  const value = prop.initializer;
  const isComputed = key !== undefined && ts.isComputedPropertyName(key);
  const keyText = key ? getKeyText(ctx, key, isComputed) : null;
  const valueText = getNodeText(ctx, value);
  if (!key || !keyText || !valueText) return null;

  const conditionText = getNodeText(ctx, cond.condition);
  const conditionMatchesKey = isComputed && conditionText === keyText;

  return {
    truthyBranch: !conseqIsEmpty,
    property: {
      key: keyText,
      keyRange: [key.pos, key.end],
      computed: isComputed,
      value: valueText,
      valueRange: [value.pos, value.end],
      isBooleanTrue: value.kind === ts.SyntaxKind.TrueKeyword,
    },
    conditionRange: [cond.condition.pos, cond.condition.end],
    conditionMatchesKey,
  };
}

export function extractLogicalAndFixablePattern(ctx: VisitorContext, expr: ts.BinaryExpression): FixableSpreadPattern | null {
  const right = unwrapParenthesized(expr.right);
  if (!ts.isObjectLiteralExpression(right)) return null;
  if (right.properties.length !== 1) return null;

  const prop = right.properties[0];
  if (!prop || !ts.isPropertyAssignment(prop)) return null;

  const key = prop.name;
  const value = prop.initializer;
  const isComputed = key !== undefined && ts.isComputedPropertyName(key);
  const keyText = key ? getKeyText(ctx, key, isComputed) : null;
  const valueText = getNodeText(ctx, value);
  if (!key || !keyText || !valueText) return null;

  const conditionText = getNodeText(ctx, expr.left);
  const conditionMatchesKey = isComputed && conditionText === keyText;

  return {
    truthyBranch: true,
    property: {
      key: keyText,
      keyRange: [key.pos, key.end],
      computed: isComputed,
      value: valueText,
      valueRange: [value.pos, value.end],
      isBooleanTrue: value.kind === ts.SyntaxKind.TrueKeyword,
    },
    conditionRange: [expr.left.pos, expr.left.end],
    conditionMatchesKey,
  };
}

export function getKeyText(_ctx: VisitorContext, key: ts.Node, computed: boolean): string | null {
  const name = getPropertyKeyName(key);
  if (name !== null) return name;
  if (computed) {
    return key.getText?.() ?? null;
  }
  return null;
}

export function getNodeText(_ctx: VisitorContext, node: ts.Node): string | null {
  return node.getText?.() ?? null;
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

export function getJSXOpeningElementTag(_ctx: VisitorContext, node: ts.JsxOpeningElement): string | null {
  const name = node.tagName;
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isPropertyAccessExpression(name)) {
    const parts: string[] = [];
    let current: ts.Expression = name;
    while (ts.isPropertyAccessExpression(current)) {
      parts.unshift(current.name.text);
      current = current.expression;
    }
    if (ts.isIdentifier(current)) parts.unshift(current.text);
    return parts.join(".");
  }
  return null;
}

export function getSpreadSourceName(_ctx: VisitorContext, node: ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    // Build full member expression path: props.nested.deep.classes
    const parts: string[] = [];
    let current: ts.Expression = node;
    while (ts.isPropertyAccessExpression(current)) {
      parts.unshift(current.name.text);
      current = current.expression;
    }
    if (ts.isIdentifier(current)) {
      parts.unshift(current.text);
      return parts.join(".");
    }
    return null;
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee)) return callee.text + "()";
  }
  return null;
}

export function getSpreadSourceKind(_ctx: VisitorContext, node: ts.Expression): SpreadSourceKind {
  if (ts.isIdentifier(node)) return "identifier";
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return "member";
  if (ts.isCallExpression(node)) return "call";
  if (ts.isObjectLiteralExpression(node)) return "literal";
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) return "logical";
  }
  if (ts.isConditionalExpression(node)) return "conditional";
  return "other";
}
