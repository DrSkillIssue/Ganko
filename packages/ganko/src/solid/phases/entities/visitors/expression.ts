import ts from "typescript";
import type { VisitorContext } from "../context";
import { visitBlockStatement, visitClassBody } from "./statement";
import { visitTypeNode } from "./type";
import { handleCall } from "../handlers/call";
import { handleNewExpression, handleMemberExpression, handleAssignmentExpression, handleAwaitExpression } from "../handlers/misc";
import { handleFunction } from "../handlers/function";
import { handleClass } from "../handlers/class";
import { handleJSXElement, handleJSXSelfClosingElement, handleJSXFragment } from "../handlers/jsx";
import { handleObjectSpread, handleConditionalSpread } from "../handlers/spread";
import { handleTypeAssertion, handleNonNullAssertion } from "../handlers/assertion";
import { visitJSXAttributeValues, visitJSXChildren } from "./jsx";
export function visitExpression(ctx: VisitorContext, node: ts.Expression): void {
  ctx.graph.addToPositionIndex(node);

  if (ts.isCallExpression(node)) {
    handleCall(ctx, node);
    visitExpression(ctx, node.expression);
    for (let i = 0, len = node.arguments.length; i < len; i++) {
      const callArg = node.arguments[i];
      if (!callArg) continue;
      visitCallArgument(ctx, callArg);
    }
    return;
  }

  if (ts.isNewExpression(node)) {
    handleNewExpression(ctx, node);
    handleCall(ctx, node);
    visitExpression(ctx, node.expression);
    const newArgs = node.arguments ?? [];
    for (let i = 0, len = newArgs.length; i < len; i++) {
      const newArg = newArgs[i];
      if (!newArg) continue;
      visitCallArgument(ctx, newArg);
    }
    return;
  }

  if (ts.isArrowFunction(node)) {
    handleFunction(ctx, node);
    visitFunctionBody(ctx, node.body);
    ctx.functionStack.pop();
    return;
  }

  if (ts.isFunctionExpression(node)) {
    handleFunction(ctx, node);
    visitFunctionBody(ctx, node.body);
    ctx.functionStack.pop();
    return;
  }

  if (ts.isClassExpression(node)) {
    handleClass(ctx, node);
    visitClassBody(ctx, node);
    ctx.classStack.pop();
    return;
  }

  if (ts.isJsxElement(node)) {
    handleJSXElement(ctx, node);
    visitJSXAttributeValues(ctx, node.openingElement.attributes.properties);
    visitJSXChildren(ctx, node.children);
    ctx.jsxStack.pop();
    return;
  }

  if (ts.isJsxSelfClosingElement(node)) {
    handleJSXSelfClosingElement(ctx, node);
    visitJSXAttributeValues(ctx, node.attributes.properties);
    ctx.jsxStack.pop();
    return;
  }

  if (ts.isJsxFragment(node)) {
    handleJSXFragment(ctx, node);
    visitJSXChildren(ctx, node.children);
    ctx.jsxStack.pop();
    return;
  }

  if (ts.isArrayLiteralExpression(node)) {
    for (let i = 0, len = node.elements.length; i < len; i++) {
      const el = node.elements[i];
      if (el) {
        if (ts.isSpreadElement(el)) {
          ctx.graph.addSpreadElement(el);
          visitExpression(ctx, el.expression);
        } else {
          visitExpression(ctx, el);
        }
      }
    }
    return;
  }

  if (ts.isObjectLiteralExpression(node)) {
    for (let i = 0, len = node.properties.length; i < len; i++) {
      const prop = node.properties[i];
      if (!prop) continue;
      if (ts.isSpreadAssignment(prop)) {
        ctx.graph.addSpreadElement(prop);
        handleObjectSpread(ctx, prop, node);
        handleConditionalSpread(ctx, prop, node);
        visitExpression(ctx, prop.expression);
      } else if (ts.isPropertyAssignment(prop)) {
        const value = prop.initializer;
        if (
          !ts.isShorthandPropertyAssignment(prop) &&
          !ts.isIdentifier(value)
        ) {
          visitExpression(ctx, value);
        }
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        // shorthand — skip
      }
    }
    return;
  }

  if (ts.isPropertyAccessExpression(node)) {
    handleMemberExpression(ctx, node);
    visitExpression(ctx, node.expression);
    return;
  }

  if (ts.isElementAccessExpression(node)) {
    visitExpression(ctx, node.expression);
    visitExpression(ctx, node.argumentExpression);
    return;
  }

  if (ts.isConditionalExpression(node)) {
    visitExpression(ctx, node.condition);
    ctx.conditionalDepth++;
    visitExpression(ctx, node.whenTrue);
    visitExpression(ctx, node.whenFalse);
    ctx.conditionalDepth--;
    return;
  }

  if (ts.isBinaryExpression(node)) {
    const opKind = node.operatorToken.kind;
    // Assignment expressions
    if (opKind === ts.SyntaxKind.EqualsToken ||
        opKind === ts.SyntaxKind.PlusEqualsToken ||
        opKind === ts.SyntaxKind.MinusEqualsToken ||
        opKind === ts.SyntaxKind.AsteriskEqualsToken ||
        opKind === ts.SyntaxKind.SlashEqualsToken ||
        opKind === ts.SyntaxKind.PercentEqualsToken ||
        opKind === ts.SyntaxKind.AmpersandEqualsToken ||
        opKind === ts.SyntaxKind.BarEqualsToken ||
        opKind === ts.SyntaxKind.CaretEqualsToken ||
        opKind === ts.SyntaxKind.LessThanLessThanEqualsToken ||
        opKind === ts.SyntaxKind.GreaterThanGreaterThanEqualsToken ||
        opKind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken ||
        opKind === ts.SyntaxKind.AsteriskAsteriskEqualsToken ||
        opKind === ts.SyntaxKind.BarBarEqualsToken ||
        opKind === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
        opKind === ts.SyntaxKind.QuestionQuestionEqualsToken) {
      handleAssignmentExpression(ctx, node);
      visitExpression(ctx, node.right);
      return;
    }
    // Logical expressions
    if (opKind === ts.SyntaxKind.AmpersandAmpersandToken || opKind === ts.SyntaxKind.BarBarToken) {
      visitExpression(ctx, node.left);
      ctx.conditionalDepth++;
      visitExpression(ctx, node.right);
      ctx.conditionalDepth--;
      return;
    }
    if (opKind === ts.SyntaxKind.QuestionQuestionToken) {
      visitExpression(ctx, node.left);
      visitExpression(ctx, node.right);
      return;
    }
    // Regular binary expressions
    visitExpression(ctx, node.left);
    visitExpression(ctx, node.right);
    return;
  }

  if (ts.isPrefixUnaryExpression(node)) {
    ctx.graph.addUnaryExpression(node);
    visitExpression(ctx, node.operand);
    return;
  }

  if (ts.isDeleteExpression(node)) {
    ctx.graph.addDeleteExpression(node);
    visitExpression(ctx, node.expression);
    return;
  }

  if (ts.isPostfixUnaryExpression(node)) {
    visitExpression(ctx, node.operand);
    return;
  }

  if (ts.isParenthesizedExpression(node)) {
    visitExpression(ctx, node.expression);
    return;
  }

  if (ts.isCommaListExpression(node)) {
    for (let i = 0, len = node.elements.length; i < len; i++) {
      const seqExpr = node.elements[i];
      if (!seqExpr) continue;
      visitExpression(ctx, seqExpr);
    }
    return;
  }

  if (ts.isTemplateExpression(node)) {
    for (let i = 0, len = node.templateSpans.length; i < len; i++) {
      const span = node.templateSpans[i];
      if (!span) continue;
      visitExpression(ctx, span.expression);
    }
    return;
  }

  if (ts.isTaggedTemplateExpression(node)) {
    visitExpression(ctx, node.tag);
    if (ts.isTemplateExpression(node.template)) {
      visitExpression(ctx, node.template);
    }
    return;
  }

  if (ts.isAwaitExpression(node)) {
    handleAwaitExpression(ctx, node);
    visitExpression(ctx, node.expression);
    return;
  }

  if (ts.isYieldExpression(node)) {
    if (node.expression) visitExpression(ctx, node.expression);
    return;
  }

  if (ts.isAsExpression(node)) {
    handleTypeAssertion(ctx, node);
    visitExpression(ctx, node.expression);
    visitTypeNode(ctx, node.type);
    return;
  }

  if (ts.isTypeAssertionExpression(node)) {
    handleTypeAssertion(ctx, node);
    visitExpression(ctx, node.expression);
    visitTypeNode(ctx, node.type);
    return;
  }

  if (ts.isSatisfiesExpression(node)) {
    visitExpression(ctx, node.expression);
    visitTypeNode(ctx, node.type);
    return;
  }

  if (ts.isNonNullExpression(node)) {
    handleNonNullAssertion(ctx, node);
    visitExpression(ctx, node.expression);
    return;
  }

  if (ts.isIdentifier(node)) {
    ctx.graph.addIdentifierReference(node);
    return;
  }

  // Leaf nodes: literal, this, super, meta property, etc.
  // No further traversal needed
}

export function visitCallArgument(ctx: VisitorContext, node: ts.Expression): void {
  if (ts.isSpreadElement(node)) {
    visitExpression(ctx, node.expression);
  } else {
    visitExpression(ctx, node);
  }
}

export function visitChainElement(ctx: VisitorContext, node: ts.Expression): void {
  if (ts.isCallExpression(node)) {
    handleCall(ctx, node);
    visitExpression(ctx, node.expression);
    for (let i = 0, len = node.arguments.length; i < len; i++) {
      const chainArg = node.arguments[i];
      if (!chainArg) continue;
      visitCallArgument(ctx, chainArg);
    }
  } else if (ts.isPropertyAccessExpression(node)) {
    visitExpression(ctx, node.expression);
  } else if (ts.isElementAccessExpression(node)) {
    visitExpression(ctx, node.expression);
    visitExpression(ctx, node.argumentExpression);
  }
}

export function visitFunctionBody(ctx: VisitorContext, node: ts.Block | ts.Expression | ts.ConciseBody): void {
  if (ts.isBlock(node)) {
    visitBlockStatement(ctx, node);
  } else {
    visitExpression(ctx, node);
  }
}
