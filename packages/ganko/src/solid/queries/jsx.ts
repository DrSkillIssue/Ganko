/**
 * JSX context and element query functions
 */
import ts from "typescript";
import type { SolidGraph } from "../impl";
import type { JSXElementEntity, JSXAttributeEntity, JSXContext } from "../entities/jsx";
import type { JSXAttributeKind } from "../util/jsx";
import { getStaticNumericValue, getStaticStringFromJSXValue } from "../util/static-value";

export function getJSXContext(graph: SolidGraph, node: ts.Node): JSXContext | null {
  const cached = graph.jsxContextCache.get(node);
  if (cached !== undefined) return cached;
  const context = findJSXContext(graph, node);
  graph.jsxContextCache.set(node, context);
  return context;
}

export function findJSXContext(graph: SolidGraph, node: ts.Node): JSXContext | null {
  if (!node.parent) return null;
  let current: ts.Node | undefined = node.parent;
  let depth = 0;

  while (current && depth < 20) {
    const parentCached = graph.jsxContextCache.get(current);
    if (parentCached !== undefined) {
      graph.jsxContextCache.set(node, parentCached);
      return parentCached;
    }

    if (ts.isJsxAttribute(current) || ts.isJsxSpreadAttribute(current)) {
      const openingElement = current.parent;
      if (!openingElement || !ts.isJsxAttributes(openingElement)) {
        current = current.parent;
        depth++;
        continue;
      }
      const jsxOpeningOrSelf = openingElement.parent;
      if (!jsxOpeningOrSelf || (!ts.isJsxOpeningElement(jsxOpeningOrSelf) && !ts.isJsxSelfClosingElement(jsxOpeningOrSelf))) {
        current = current.parent;
        depth++;
        continue;
      }
      const jsxElement = ts.isJsxOpeningElement(jsxOpeningOrSelf) ? jsxOpeningOrSelf.parent : jsxOpeningOrSelf;
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

    if (ts.isJsxExpression(current)) {
      const containerParent = current.parent;
      if (!containerParent || (!ts.isJsxElement(containerParent) && !ts.isJsxFragment(containerParent))) {
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

    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current) || ts.isJsxFragment(current)) {
      const element = graph.jsxByNode.get(current);
      if (!element) {
        current = current.parent;
        depth++;
        continue;
      }
      const elementParent = current.parent;
      const containerNode = (elementParent && ts.isJsxExpression(elementParent)) ? elementParent : null;
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

export function getJSXAttributeValue(graph: SolidGraph, element: JSXElementEntity, attrName: string): ts.Node | null {
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

  if (!ts.isJsxExpression(attribute.valueNode)) return null;
  if (!attribute.valueNode.expression) return null;
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
