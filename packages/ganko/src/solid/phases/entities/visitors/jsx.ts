import ts from "typescript";
import type { VisitorContext } from "../context";
import { visitExpression } from "./expression";
import { handleJSXElement, handleJSXSelfClosingElement, handleJSXFragment } from "../handlers/jsx";
export function visitJSXAttributeValues(ctx: VisitorContext, attrs: ts.NodeArray<ts.JsxAttributeLike>): void {
  if (attrs.length === 0) return;

  for (let i = 0, len = attrs.length; i < len; i++) {
    const attr = attrs[i];
    if (!attr) continue;
    if (ts.isJsxAttribute(attr)) {
      const value = attr.initializer;
      if (value && ts.isJsxExpression(value)) {
        const expr = value.expression;
        if (expr) {
          visitExpression(ctx, expr);
        }
      }
    } else {
      // JsxSpreadAttribute
      visitExpression(ctx, attr.expression);
    }
  }
}

export function visitJSXChildren(ctx: VisitorContext, children: ts.NodeArray<ts.JsxChild>): void {
  if (children.length === 0) return;

  for (let i = 0, len = children.length; i < len; i++) {
    const child = children[i];
    if (!child) continue;

    if (ts.isJsxElement(child)) {
      handleJSXElement(ctx, child);
      visitJSXAttributeValues(ctx, child.openingElement.attributes.properties);
      visitJSXChildren(ctx, child.children);
      ctx.jsxStack.pop();
    } else if (ts.isJsxSelfClosingElement(child)) {
      handleJSXSelfClosingElement(ctx, child);
      visitJSXAttributeValues(ctx, child.attributes.properties);
      ctx.jsxStack.pop();
    } else if (ts.isJsxFragment(child)) {
      handleJSXFragment(ctx, child);
      visitJSXChildren(ctx, child.children);
      ctx.jsxStack.pop();
    } else if (ts.isJsxExpression(child)) {
      const expr = child.expression;
      if (expr) {
        visitExpression(ctx, expr);
      }
    } else if (ts.isJsxText(child)) {
      // skip text
    }
  }
}
