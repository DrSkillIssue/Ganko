import type { TSESTree as T } from "@typescript-eslint/utils";
import type { VisitorContext } from "../context";
import { visitExpression } from "./expression";
import { handleJSXElement, handleJSXFragment } from "../handlers/jsx";
export function visitJSXAttributeValues(ctx: VisitorContext, attrs: (T.JSXAttribute | T.JSXSpreadAttribute)[]): void {
  if (attrs.length === 0) return;

  for (let i = 0, len = attrs.length; i < len; i++) {
    const attr = attrs[i];
    if (!attr) continue;
    if (attr.type === "JSXAttribute") {
      const value = attr.value;
      if (value?.type === "JSXExpressionContainer") {
        const expr = value.expression;
        if (expr.type !== "JSXEmptyExpression") {
          visitExpression(ctx, expr);
        }
      }
    } else {
      // JSXSpreadAttribute
      visitExpression(ctx, attr.argument);
    }
  }
}

export function visitJSXChildren(ctx: VisitorContext, children: T.JSXChild[]): void {
  if (children.length === 0) return;

  for (let i = 0, len = children.length; i < len; i++) {
    const child = children[i];
    if (!child) continue;
    switch (child.type) {
      case "JSXElement":
        handleJSXElement(ctx, child);
        visitJSXAttributeValues(ctx, child.openingElement.attributes);
        visitJSXChildren(ctx, child.children);
        ctx.jsxStack.pop();
        break;
      case "JSXFragment":
        handleJSXFragment(ctx, child);
        visitJSXChildren(ctx, child.children);
        ctx.jsxStack.pop();
        break;
      case "JSXExpressionContainer": {
        const expr = child.expression;
        if (expr.type !== "JSXEmptyExpression") {
          visitExpression(ctx, expr);
        }
        break;
      }
      case "JSXSpreadChild":
        if (child.expression.type !== "JSXEmptyExpression") {
          visitExpression(ctx, child.expression);
        }
        break;
      case "JSXText":
        break;
    }
  }
}
