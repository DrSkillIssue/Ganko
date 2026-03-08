import type { TSESTree as T } from "@typescript-eslint/utils";
import type { VisitorContext } from "../context";
import type { JSXAttributeEntity, JSXChildEntity } from "../../../entities/jsx";
import { getScopeFor } from "../../../queries/scope";
import { createJSXElement } from "../../../entities/jsx";
import { handleJSXSpread } from "./spread";
import { getJSXElementTag, buildJSXAttribute, getJSXChildKind } from "../helpers";
import { isDomElement } from "@drskillissue/ganko-shared";

export function handleJSXElement(ctx: VisitorContext, node: T.JSXElement): void {
  const graph = ctx.graph;
  const file = ctx.file;
  const scope = getScopeFor(graph, node);
  const tag = getJSXElementTag(node);

  // Build attributes and register JSX spread entities
  const attributes: JSXAttributeEntity[] = [];
  const openingElement = node.openingElement;
  const openingAttrs = openingElement.attributes;
  for (let i = 0, len = openingAttrs.length; i < len; i++) {
    const attr = openingAttrs[i];
    if (!attr) continue;
    attributes.push(buildJSXAttribute(attr, graph.nextMiscId()));
    
    // Register JSX spread attributes as ObjectSpreadEntity
    if (attr.type === "JSXSpreadAttribute") {
      handleJSXSpread(ctx, attr, openingElement, tag);
    }
  }

  // Build children
  const children: JSXChildEntity[] = [];
  for (let i = 0, len = node.children.length; i < len; i++) {
    const child = node.children[i];
    if (!child) continue;
    children.push({
      id: graph.nextMiscId(),
      node: child,
      kind: getJSXChildKind(child),
    });
  }

  const element = createJSXElement({
    id: graph.nextJsxId(),
    node,
    file,
    tag,
    isDomElement: isDomElement(tag),
    attributes,
    children,
    scope,
  });

  graph.addJSXElement(element);
  ctx.jsxStack.push(element);
}

export function handleJSXFragment(ctx: VisitorContext, node: T.JSXFragment): void {
  const graph = ctx.graph;
  const file = ctx.file;
  const scope = getScopeFor(graph, node);

  const children: JSXChildEntity[] = [];
  for (let i = 0, len = node.children.length; i < len; i++) {
    const child = node.children[i];
    if (!child) continue;
    children.push({
      id: graph.nextMiscId(),
      node: child,
      kind: getJSXChildKind(child),
    });
  }

  const element = createJSXElement({
    id: graph.nextJsxId(),
    node,
    file,
    tag: null,
    isDomElement: false,
    attributes: [],
    children,
    scope,
  });

  graph.addJSXElement(element);
  ctx.jsxStack.push(element);
}
