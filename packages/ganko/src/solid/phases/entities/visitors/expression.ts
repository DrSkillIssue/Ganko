import type { TSESTree as T } from "@typescript-eslint/utils";
import type { VisitorContext } from "../context";
import { visitBlockStatement, visitClassBody } from "./statement";
import { visitTypeNode } from "./type";
import { handleCall } from "../handlers/call";
import { handleNewExpression, handleMemberExpression, handleAssignmentExpression, handleAwaitExpression } from "../handlers/misc";
import { handleFunction } from "../handlers/function";
import { handleClass } from "../handlers/class";
import { handleJSXElement, handleJSXFragment } from "../handlers/jsx";
import { handleObjectSpread, handleConditionalSpread } from "../handlers/spread";
import { handleTypeAssertion, handleNonNullAssertion } from "../handlers/assertion";
import { visitJSXAttributeValues, visitJSXChildren } from "./jsx";
export function visitExpression(ctx: VisitorContext, node: T.Expression): void {
  ctx.graph.addToPositionIndex(node);
  switch (node.type) {
    case "CallExpression":
      handleCall(ctx, node);
      visitExpression(ctx, node.callee);
      for (let i = 0, len = node.arguments.length; i < len; i++) {
        const callArg = node.arguments[i];
        if (!callArg) continue;
        visitCallArgument(ctx, callArg);
      }
      break;
    case "NewExpression":
      handleNewExpression(ctx, node);
      handleCall(ctx, node);
      visitExpression(ctx, node.callee);
      for (let i = 0, len = node.arguments.length; i < len; i++) {
        const newArg = node.arguments[i];
        if (!newArg) continue;
        visitCallArgument(ctx, newArg);
      }
      break;
    case "ArrowFunctionExpression":
      handleFunction(ctx, node);
      visitFunctionBody(ctx, node.body);
      ctx.functionStack.pop();
      break;
    case "FunctionExpression":
      handleFunction(ctx, node);
      visitFunctionBody(ctx, node.body);
      ctx.functionStack.pop();
      break;
    case "ClassExpression":
      handleClass(ctx, node);
      visitClassBody(ctx, node.body);
      ctx.classStack.pop();
      break;
    case "JSXElement":
      handleJSXElement(ctx, node);
      visitJSXAttributeValues(ctx, node.openingElement.attributes);
      visitJSXChildren(ctx, node.children);
      ctx.jsxStack.pop();
      break;
    case "JSXFragment":
      handleJSXFragment(ctx, node);
      visitJSXChildren(ctx, node.children);
      ctx.jsxStack.pop();
      break;
    case "ArrayExpression":
      for (let i = 0, len = node.elements.length; i < len; i++) {
        const el = node.elements[i];
        if (el) {
          if (el.type === "SpreadElement") {
            ctx.graph.addSpreadElement(el);
            visitExpression(ctx, el.argument);
          } else {
            visitExpression(ctx, el);
          }
        }
      }
      break;
    case "ObjectExpression":
      for (let i = 0, len = node.properties.length; i < len; i++) {
        const prop = node.properties[i];
        if (!prop) continue;
        if (prop.type === "SpreadElement") {
          ctx.graph.addSpreadElement(prop);
          handleObjectSpread(ctx, prop, node);
          handleConditionalSpread(ctx, prop, node);
          visitExpression(ctx, prop.argument);
        } else if (prop.type === "Property") {
          const value = prop.value;
          if (
            !prop.shorthand &&
            value.type !== "AssignmentPattern" &&
            value.type !== "Identifier" &&
            value.type !== "TSEmptyBodyFunctionExpression"
          ) {
            visitExpression(ctx, value);
          }
        }
      }
      break;
    case "MemberExpression":
      handleMemberExpression(ctx, node);
      visitExpression(ctx, node.object);
      if (node.computed) {
        visitExpression(ctx, node.property);
      }
      break;
    case "ConditionalExpression":
      visitExpression(ctx, node.test);
      ctx.conditionalDepth++;
      visitExpression(ctx, node.consequent);
      visitExpression(ctx, node.alternate);
      ctx.conditionalDepth--;
      break;
    case "LogicalExpression":
      visitExpression(ctx, node.left);
      if (node.operator === "&&" || node.operator === "||") {
        ctx.conditionalDepth++;
        visitExpression(ctx, node.right);
        ctx.conditionalDepth--;
      } else {
        visitExpression(ctx, node.right);
      }
      break;
    case "BinaryExpression":
      if (node.left.type !== "PrivateIdentifier") {
        visitExpression(ctx, node.left);
      }
      visitExpression(ctx, node.right);
      break;
    case "AssignmentExpression":
      handleAssignmentExpression(ctx, node);
      visitExpression(ctx, node.right);
      break;
    case "UnaryExpression":
      ctx.graph.addUnaryExpression(node);
      visitExpression(ctx, node.argument);
      break;
    case "UpdateExpression":
      visitExpression(ctx, node.argument);
      break;
    case "SequenceExpression":
      for (let i = 0, len = node.expressions.length; i < len; i++) {
        const seqExpr = node.expressions[i];
        if (!seqExpr) continue;
        visitExpression(ctx, seqExpr);
      }
      break;
    case "TemplateLiteral":
      for (let i = 0, len = node.expressions.length; i < len; i++) {
        const tmplExpr = node.expressions[i];
        if (!tmplExpr) continue;
        visitExpression(ctx, tmplExpr);
      }
      break;
    case "TaggedTemplateExpression":
      visitExpression(ctx, node.tag);
      visitExpression(ctx, node.quasi);
      break;
    case "AwaitExpression":
      handleAwaitExpression(ctx, node);
      if (node.argument) visitExpression(ctx, node.argument);
      break;
    case "YieldExpression":
      if (node.argument) visitExpression(ctx, node.argument);
      break;
    case "TSAsExpression":
      handleTypeAssertion(ctx, node);
      visitExpression(ctx, node.expression);
      visitTypeNode(ctx, node.typeAnnotation);
      break;
    case "TSTypeAssertion":
      handleTypeAssertion(ctx, node);
      visitExpression(ctx, node.expression);
      visitTypeNode(ctx, node.typeAnnotation);
      break;
    case "TSSatisfiesExpression":
      visitExpression(ctx, node.expression);
      visitTypeNode(ctx, node.typeAnnotation);
      break;
    case "TSNonNullExpression":
      handleNonNullAssertion(ctx, node);
      visitExpression(ctx, node.expression);
      break;
    case "Identifier":
      ctx.graph.addIdentifierReference(node);
      break;
    case "Literal":
    case "ThisExpression":
    case "Super":
    case "MetaProperty":
    case "TSInstantiationExpression":
      break;
    case "ChainExpression":
      visitChainElement(ctx, node.expression);
      break;
    case "ImportExpression":
      visitExpression(ctx, node.source);
      break;
  }
}

export function visitCallArgument(ctx: VisitorContext, node: T.CallExpressionArgument): void {
  if (node.type === "SpreadElement") {
    visitExpression(ctx, node.argument);
  } else {
    visitExpression(ctx, node);
  }
}

export function visitChainElement(ctx: VisitorContext, node: T.ChainElement): void {
  switch (node.type) {
    case "CallExpression":
      handleCall(ctx, node);
      visitExpression(ctx, node.callee);
      for (let i = 0, len = node.arguments.length; i < len; i++) {
        const chainArg = node.arguments[i];
        if (!chainArg) continue;
        visitCallArgument(ctx, chainArg);
      }
      break;
    case "MemberExpression":
      visitExpression(ctx, node.object);
      if (node.computed) visitExpression(ctx, node.property);
      break;
  }
}

export function visitFunctionBody(ctx: VisitorContext, node: T.BlockStatement | T.Expression): void {
  if (node.type === "BlockStatement") {
    visitBlockStatement(ctx, node);
  } else {
    visitExpression(ctx, node);
  }
}
