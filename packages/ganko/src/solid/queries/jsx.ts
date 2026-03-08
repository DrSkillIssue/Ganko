/**
 * JSX context and element query functions
 */
import type { TSESTree as T } from "@typescript-eslint/utils";
import type { SolidGraph } from "../impl";
import type { JSXElementEntity, JSXAttributeEntity, JSXContext } from "../entities/jsx";
import type { JSXAttributeKind } from "../util/jsx";
import { getStaticNumericValue, getStaticStringFromJSXValue } from "../util/static-value";

export function getJSXContext(graph: SolidGraph, node: T.Node): JSXContext | null {
  const cached = graph.jsxContextCache.get(node);
  if (cached !== undefined) return cached;
  const context = findJSXContext(graph, node);
  graph.jsxContextCache.set(node, context);
  return context;
}

export function findJSXContext(graph: SolidGraph, node: T.Node): JSXContext | null {
  if (!node.parent) return null;
  let current: T.Node | undefined = node.parent;
  let depth = 0;

  while (current && depth < 20) {
    const parentCached = graph.jsxContextCache.get(current);
    if (parentCached !== undefined) {
      graph.jsxContextCache.set(node, parentCached);
      return parentCached;
    }

    if (current.type === "JSXAttribute" || current.type === "JSXSpreadAttribute") {
      const openingElement = current.parent;
      if (openingElement?.type !== "JSXOpeningElement") {
        current = current.parent;
        depth++;
        continue;
      }
      const jsxElement = openingElement.parent;
      if (jsxElement?.type !== "JSXElement") {
        current = current.parent;
        depth++;
        continue;
      }
      const element = graph.jsxByNode.get(jsxElement);
      if (!element) {
        current = current.parent;
        depth++;
        continue;
      }
      let attribute: JSXAttributeEntity | null = null;
      const attrs = element.attributes;
      for (let i = 0, len = attrs.length; i < len; i++) {
        const a = attrs[i];
        if (!a) continue;
        if (a.node === current) {
          attribute = a;
          break;
        }
      }
      return { element, attribute, kind: "attribute", containerNode: null };
    }

    if (current.type === "JSXExpressionContainer") {
      const containerParent = current.parent;
      if (containerParent?.type !== "JSXElement" && containerParent?.type !== "JSXFragment") {
        current = current.parent;
        depth++;
        continue;
      }
      const element = graph.jsxByNode.get(containerParent);
      if (!element) {
        current = current.parent;
        depth++;
        continue;
      }
      return { element, attribute: null, kind: "child", containerNode: current };
    }

    if (current.type === "JSXElement" || current.type === "JSXFragment") {
      const element = graph.jsxByNode.get(current);
      if (!element) {
        current = current.parent;
        depth++;
        continue;
      }
      const elementParent = current.parent;
      const containerNode = elementParent?.type === "JSXExpressionContainer" ? elementParent : null;
      return { element, attribute: null, kind: "expression", containerNode };
    }

    current = current.parent;
    depth++;
  }

  return null;
}

export function getJSXAttributesByKind(graph: SolidGraph, kind: JSXAttributeKind): readonly { attr: JSXAttributeEntity; element: JSXElementEntity }[] {
  return graph.jsxAttrsByKind.get(kind) ?? [];
}

export function findAncestorElement(_graph: SolidGraph, element: JSXElementEntity, predicate: (el: JSXElementEntity) => boolean): JSXElementEntity | null {
  let current = element.parent;
  while (current) {
    if (predicate(current)) return current;
    current = current.parent;
  }
  return null;
}

export function findEnclosingDOMElement(graph: SolidGraph, element: JSXElementEntity): JSXElementEntity | null {
  return findAncestorElement(graph, element, el => el.isDomElement);
}

export function getJSXAttributeValue(graph: SolidGraph, element: JSXElementEntity, attrName: string): T.Node | null {
  const attribute = getJSXAttributeEntity(graph, element, attrName);
  if (!attribute) return null;
  return attribute.valueNode;
}

export function getJSXAttributeEntity(graph: SolidGraph, element: JSXElementEntity, attrName: string): JSXAttributeEntity | null {
  const attrs = graph.jsxAttributesByElementId.get(element.id);
  if (!attrs) return null;
  const needle = attrName.toLowerCase();
  return attrs.get(needle) ?? null;
}

export function hasJSXAttribute(graph: SolidGraph, element: JSXElementEntity, attrName: string): boolean {
  return getJSXAttributeEntity(graph, element, attrName) !== null;
}

export function getStaticStringJSXAttributeValue(graph: SolidGraph, element: JSXElementEntity, attrName: string): string | null {
  const attribute = getJSXAttributeEntity(graph, element, attrName);
  if (!attribute || !attribute.valueNode) return null;
  return getStaticStringFromJSXValue(attribute.valueNode);
}

export function getStaticNumericJSXAttributeValue(graph: SolidGraph, element: JSXElementEntity, attrName: string): number | null {
  const attribute = getJSXAttributeEntity(graph, element, attrName);
  if (!attribute || !attribute.valueNode) return null;

  const staticString = getStaticStringFromJSXValue(attribute.valueNode);
  if (staticString !== null) {
    const numeric = Number(staticString);
    if (!Number.isFinite(numeric)) return null;
    return numeric;
  }

  if (attribute.valueNode.type !== "JSXExpressionContainer") return null;
  if (attribute.valueNode.expression.type === "JSXEmptyExpression") return null;
  return getStaticNumericValue(attribute.valueNode.expression);
}

export function getChildElementsByTag(element: JSXElementEntity, tag: string): readonly JSXElementEntity[] {
  const out: JSXElementEntity[] = [];
  const needle = tag.toLowerCase();

  for (let i = 0; i < element.childElements.length; i++) {
    const child = element.childElements[i];
    if (!child) continue;
    if (!child.tagName) continue;
    if (child.tagName !== needle) continue;
    out.push(child);
  }

  return out;
}

export function getFirstChildElementByTag(element: JSXElementEntity, tag: string): JSXElementEntity | null {
  const needle = tag.toLowerCase();

  for (let i = 0; i < element.childElements.length; i++) {
    const child = element.childElements[i];
    if (!child) continue;
    if (!child.tagName) continue;
    if (child.tagName === needle) return child;
  }

  return null;
}
