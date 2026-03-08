import type { TSESTree as T } from "@typescript-eslint/utils";
import type { VisitorContext } from "../context";
import type { PropertyEntity } from "../../../entities/property";
import type { ClassEntity } from "../../../entities/class";
import { createClass } from "../../../entities/class";
import { getScopeFor, getVariableByNameInScope } from "../../../queries/scope";

export function handleClass(ctx: VisitorContext, node: T.ClassDeclaration | T.ClassExpression): void {
  const graph = ctx.graph;
  const file = ctx.file;
  const name = node.id?.name ?? null;
  const scope = getScopeFor(graph, node);
  const classVariable = name ? getVariableByNameInScope(graph, name, scope) : null;

  const cls = createClass({
    id: graph.nextClassId(),
    node,
    file,
    name,
    abstract: node.abstract ?? false,
    declarationNode: node,
    classVariable,
  });

  graph.addClass(cls);
  ctx.classStack.push(cls);
}

export function handleProperty(ctx: VisitorContext, node: T.PropertyDefinition, cls: ClassEntity): void {
  const graph = ctx.graph;
  const keyNode = node.key;
  const name = keyNode.type === "Identifier" ? keyNode.name : null;

  const prop: PropertyEntity = {
    id: graph.nextPropertyId(),
    node,
    class: cls,
    name,
    static: node.static,
    readonly: node.readonly ?? false,
    accessibility: node.accessibility ?? undefined,
    declarationNode: node,
  };

  graph.addProperty(prop);
  cls.properties.push(prop);
}
