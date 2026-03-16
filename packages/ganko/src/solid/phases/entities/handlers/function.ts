import ts from "typescript";
import type { VisitorContext } from "../context";
import type { ParameterEntity } from "../../../entities/function";
import { createFunction } from "../../../entities/function";
import { getScopeFor, getVariableByNameInScope } from "../../../queries/scope";
import { isComponentName, containsJSX } from "../../../util/function";
import { getFunctionName, getFunctionVariableName, getParameterName, getDeclarationNode, computeCaptures } from "../helpers";
import { visitParameterTypeAnnotation, visitTypeNode } from "../visitors/type";
import { handleTypePredicate } from "./assertion";

export function handleFunction(ctx: VisitorContext, node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | ts.ConstructorDeclaration): void {
  const graph = ctx.graph;
  const file = ctx.file;
  const scope = getScopeFor(graph, node);
  const name = getFunctionName(node);
  const variableName = getFunctionVariableName(node);

  const params: ParameterEntity[] = [];
  for (let i = 0, len = node.parameters.length; i < len; i++) {
    const param = node.parameters[i];
    if (!param) continue;
    params.push({
      id: graph.nextMiscId(),
      node: param,
      name: getParameterName(param),
      index: i,
    });
    visitParameterTypeAnnotation(ctx, param);
  }

  if (node.type) {
    const returnTypeNode = node.type;
    visitTypeNode(ctx, returnTypeNode);

    if (ts.isTypePredicateNode(returnTypeNode)) {
      handleTypePredicate(ctx, node, returnTypeNode);
    }
  }

  const captures = computeCaptures(node, scope, graph);
  const parentScope = scope.parent;
  const fnVariable = variableName && parentScope
    ? getVariableByNameInScope(graph, variableName, parentScope)
    : null;

  const fn = createFunction({
    id: graph.nextFunctionId(),
    node,
    file,
    name,
    variableName,
    params,
    captures,
    scope,
    fnVariable,
    declarationNode: getDeclarationNode(node),
    hasNonVoidReturn: false,
    hasJSXReturn: containsJSX(node.body),
  });

  graph.addFunction(fn);
  ctx.functionStack.push(fn);

  if (fn.name && isComponentName(fn.name)) {
    ctx.componentFunctions.push(fn);
    graph.componentScopes.set(scope, { scope, name: fn.name });
  }
}
