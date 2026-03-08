/**
 * Flags chained array method calls that create multiple intermediate arrays.
 * Suggests combining into a reduce() or loop when 3+ arrays are created,
 * or when filter().map() pattern is detected (common bottleneck).
 */

import type { TSESTree as T } from "@typescript-eslint/utils";
import type { SolidGraph } from "../../impl";
import { createDiagnostic, resolveMessage } from "../../../diagnostic";
import { defineSolidRule } from "../../rule";
import type { CallEntity } from "../../entities/call";
import { getCallsByMethodName, getTypeInfo, getMethodChain } from "../../queries";
import { CHAR_OPEN_BRACKET, CHAR_R } from "@drskillissue/ganko-shared";
import { isInLoop } from "../../util";

/** Array methods that return new arrays. */
const ARRAY_ALLOCATING_METHODS = new Set([
  "map",
  "filter",
  "slice",
  "concat",
  "flatMap",
  "flat",
]);

const SPLIT_PASS_METHODS = new Set([
  "map",
  "filter",
  "flatMap",
  "slice",
]);

/**
 * Counts how many methods in the chain create intermediate arrays.
 * The last method is excluded since its result is the final value.
 *
 * @param methods - Array of method names in the chain
 * @returns Count of array-creating methods (excluding terminal)
 */
function countIntermediates(methods: string[]): number {
  let count = 0;

  for (let i = 0; i < methods.length - 1; i++) {
    const method = methods[i];
    if (method && ARRAY_ALLOCATING_METHODS.has(method)) {
      count++;
    }
  }

  return count;
}



/**
 * Checks if the chain contains both filter and map.
 *
 * @param methods - Array of method names in the chain
 * @returns True if both filter and map are present
 */
function hasFilterMapPattern(methods: string[]): boolean {
  let mask = 0;
  for (let i = 0, len = methods.length; i < len; i++) {
    const m = methods[i];
    if (m === "filter") mask |= 1;
    else if (m === "map") mask |= 2;
  }
  return mask === 3;
}

function shouldDeferToMultipassSplitRule(methods: readonly string[]): boolean {
  const splitIndex = methods.indexOf("split");
  if (splitIndex === -1) return false;

  let passCount = 0;
  for (let i = splitIndex + 1; i < methods.length; i++) {
    const method = methods[i];
    if (!method) continue;
    if (SPLIT_PASS_METHODS.has(method)) passCount++;
  }
  return passCount >= 2;
}

/**
 * Checks if a node's type is a tuple type.
 * Tuples start with "[" or "readonly [" and contain a comma.
 *
 * @param graph - The SolidGraph instance
 * @param node - The root node of the chain to check
 * @returns True if the type is a tuple
 */
function isTupleType(graph: SolidGraph, node: T.Node | null): boolean {
  if (!node) return false;

  const typeInfo = getTypeInfo(graph, node);
  if (!typeInfo) return false;

  const raw = typeInfo.raw;
  const len = raw.length;
  if (len < 3) return false;

  const first = raw.charCodeAt(0);

  if (first === CHAR_OPEN_BRACKET) {
    return raw.indexOf(",") !== -1;
  }

  if (first === CHAR_R && len > 10 && raw.charCodeAt(9) === CHAR_OPEN_BRACKET) {
    return raw.indexOf(",") !== -1;
  }

  return false;
}

const messages = {
  avoidChainedArrayMethods:
    "Chain creates {{count}} intermediate array(s). Consider reduce() or a loop. Chain: {{chain}}",
  mapJoinHotPath:
    "map().join() inside loops allocates intermediate arrays on a hot path. Prefer single-pass string construction.",
} as const;

const options = {};

export const avoidChainedArrayMethods = defineSolidRule({
  id: "avoid-chained-array-methods",
  severity: "warn",
  messages,
  meta: {
    description: "Flags chained array methods creating 3+ intermediate arrays, or filter().map() pattern.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    const terminalMethodNames = ["reduce", "join", "forEach"];
    const allocatingMethodNames = ["map", "filter", "slice"];

    let hasCalls = false;
    for (const methodName of terminalMethodNames) {
      if (getCallsByMethodName(graph, methodName).length > 0) {
        hasCalls = true;
        break;
      }
    }

    if (!hasCalls) {
      for (const methodName of allocatingMethodNames) {
        if (getCallsByMethodName(graph, methodName).length > 0) {
          hasCalls = true;
          break;
        }
      }
    }

    if (!hasCalls) return;

    const reported = new Set<CallEntity>();

    for (const methodName of terminalMethodNames) {
      const calls = getCallsByMethodName(graph, methodName);

      for (const call of calls) {
        if (reported.has(call)) continue;

        const { calls: chainCalls, methods, root } = getMethodChain(graph, call);

        if (methods.length < 2) continue;
        if (shouldDeferToMultipassSplitRule(methods)) continue;

        if (isTupleType(graph, root)) continue;

        const intermediateCount = countIntermediates([...methods]);

        const mapJoinHotPath = methods[methods.length - 1] === "join" &&
          methods.includes("map") &&
          isInLoop(call.node);

        const shouldFlag = intermediateCount >= 3 ||
          (intermediateCount === 2 && hasFilterMapPattern([...methods])) ||
          mapJoinHotPath;

        if (shouldFlag) {
          const rootCall = chainCalls[0];
          if (!rootCall) continue;

          for (const c of chainCalls) {
            reported.add(c);
          }

          const chainStr = methods.join("().");

          const msg = mapJoinHotPath
            ? messages.mapJoinHotPath
            : resolveMessage(messages.avoidChainedArrayMethods, {
              count: String(intermediateCount),
              chain: chainStr + "()",
            });
          emit(
            createDiagnostic(graph.file, call.node, "avoid-chained-array-methods", "avoidChainedArrayMethods", msg, "warn"),
          );
        }
      }
    }

    for (const methodName of allocatingMethodNames) {
      const calls = getCallsByMethodName(graph, methodName);

      for (const call of calls) {
        if (reported.has(call)) continue;

        const { calls: chainCalls, methods, root } = getMethodChain(graph, call);

        const lastCall = chainCalls[chainCalls.length - 1];
        if (lastCall !== call) continue;

        if (methods.length < 2) continue;
        if (shouldDeferToMultipassSplitRule(methods)) continue;

        if (isTupleType(graph, root)) continue;

        const intermediateCount = countIntermediates([...methods]);

        const mapJoinHotPath = methods[methods.length - 1] === "join" &&
          methods.includes("map") &&
          isInLoop(call.node);

        const shouldFlag = intermediateCount >= 3 ||
          (intermediateCount === 2 && hasFilterMapPattern([...methods])) ||
          mapJoinHotPath;

        if (shouldFlag) {
          const rootCall = chainCalls[0];
          if (!rootCall) continue;

          for (const c of chainCalls) {
            reported.add(c);
          }

          const chainStr = methods.join("().");

          const msg = mapJoinHotPath
            ? messages.mapJoinHotPath
            : resolveMessage(messages.avoidChainedArrayMethods, {
              count: String(intermediateCount),
              chain: chainStr + "()",
            });
          emit(
            createDiagnostic(graph.file, call.node, "avoid-chained-array-methods", "avoidChainedArrayMethods", msg, "warn"),
          );
        }
      }
    }
  },
});
