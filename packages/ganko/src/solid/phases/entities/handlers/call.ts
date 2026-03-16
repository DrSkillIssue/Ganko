import ts from "typescript";
import type { VisitorContext } from "../context";
import type { ArgumentEntity, PrimitiveInfo, ArgumentSemantic } from "../../../entities/call";
import { createCall } from "../../../entities/call";
import { getScopeFor } from "../../../queries/scope";
import { getPrimitiveByName, toPrimitiveInfo } from "../../../queries/get";

export function handleCall(ctx: VisitorContext, node: ts.CallExpression | ts.NewExpression): void {
  const graph = ctx.graph;
  const file = ctx.file;
  const scope = getScopeFor(graph, node as any);
  const callee = node.expression;

  // Detect if this is a Solid primitive call
  let primitive: PrimitiveInfo | null = null;
  let argumentSemantics: ArgumentSemantic[] = [];

  if (ts.isIdentifier(callee)) {
    const def = getPrimitiveByName(callee.text);
    if (def) {
      primitive = toPrimitiveInfo(def);
      argumentSemantics = def.argumentSemantics;
    }
  }

  // Build argument entities with semantics applied
  const args: ArgumentEntity[] = [];
  const nodeArgs = node.arguments ?? [];
  for (let i = 0, len = nodeArgs.length; i < len; i++) {
    const arg = nodeArgs[i];
    let semantic: ArgumentSemantic | null = null;

    // Find matching semantic for this position
    for (let j = 0, slen = argumentSemantics.length; j < slen; j++) {
      const sem = argumentSemantics[j];
      if (!sem) continue;
      if (sem.position === i) {
        semantic = sem;
        break;
      }
    }

    if (!arg) continue;
    args.push({
      id: graph.nextMiscId(),
      node: arg,
      index: i,
      semantic,
    });
  }

  const call = createCall({
    id: graph.nextCallId(),
    node,
    file,
    callee,
    arguments: args,
    scope,
    resolvedTargetId: -1,
    primitive,
    argumentSemantics,
  });

  graph.addCall(call);

  const enclosingFn = ctx.functionStack[ctx.functionStack.length - 1];
  if (enclosingFn) {
    enclosingFn.callSites.push(call);
  }
}
