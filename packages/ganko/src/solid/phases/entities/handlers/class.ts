import ts from "typescript";
import type { VisitorContext } from "../context";
import type { PropertyEntity } from "../../../entities/property";
import type { ClassEntity } from "../../../entities/class";
import { createClass } from "../../../entities/class";
import { getScopeFor, getVariableByNameInScope } from "../../../queries/scope";

export function handleClass(ctx: VisitorContext, node: ts.ClassDeclaration | ts.ClassExpression): void {
  const graph = ctx.graph;
  const file = ctx.file;
  const name = node.name?.text ?? null;
  const scope = getScopeFor(graph, node);
  const classVariable = name ? getVariableByNameInScope(graph, name, scope) : null;

  const hasAbstractModifier = node.modifiers?.some(
    (m) => m.kind === ts.SyntaxKind.AbstractKeyword,
  ) ?? false;

  const cls = createClass({
    id: graph.nextClassId(),
    node,
    file,
    name,
    abstract: hasAbstractModifier,
    declarationNode: node,
    classVariable,
  });

  graph.addClass(cls);
  ctx.classStack.push(cls);
}

export function handleProperty(ctx: VisitorContext, node: ts.PropertyDeclaration, cls: ClassEntity): void {
  const graph = ctx.graph;
  const keyNode = node.name;
  const name = ts.isIdentifier(keyNode) ? keyNode.text : null;

  const hasStaticModifier = node.modifiers?.some(
    (m) => m.kind === ts.SyntaxKind.StaticKeyword,
  ) ?? false;
  const hasReadonlyModifier = node.modifiers?.some(
    (m) => m.kind === ts.SyntaxKind.ReadonlyKeyword,
  ) ?? false;
  const accessibility = getAccessibility(node);

  const prop: PropertyEntity = {
    id: graph.nextPropertyId(),
    node,
    class: cls,
    name,
    static: hasStaticModifier,
    readonly: hasReadonlyModifier,
    accessibility,
    declarationNode: node,
  };

  graph.addProperty(prop);
  cls.properties.push(prop);
}

function getAccessibility(node: ts.PropertyDeclaration): "public" | "protected" | "private" | undefined {
  if (!node.modifiers) return undefined;
  for (const mod of node.modifiers) {
    if (mod.kind === ts.SyntaxKind.PublicKeyword) return "public";
    if (mod.kind === ts.SyntaxKind.ProtectedKeyword) return "protected";
    if (mod.kind === ts.SyntaxKind.PrivateKeyword) return "private";
  }
  return undefined;
}
