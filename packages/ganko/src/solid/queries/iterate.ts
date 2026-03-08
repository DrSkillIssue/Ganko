/**
 * Iteration generators for entity collections
 */
import type { SolidGraph } from "../impl";
import type { ScopeEntity } from "../entities/scope";
import type { VariableEntity, ReadEntity } from "../entities/variable";
import type { FunctionEntity } from "../entities/function";
import type { CallEntity } from "../entities/call";
import type { JSXElementEntity } from "../entities/jsx";
import type { ImportEntity } from "../entities/import";
import type { ClassEntity } from "../entities/class";
import type { PropertyEntity } from "../entities/property";

export function* iterateFunctions(graph: SolidGraph): IterableIterator<FunctionEntity> {
  yield* graph.functions;
}

export function* iterateCalls(graph: SolidGraph): IterableIterator<CallEntity> {
  yield* graph.calls;
}

export function* iterateVariables(graph: SolidGraph): IterableIterator<VariableEntity> {
  yield* graph.variables;
}

export function* iterateScopes(graph: SolidGraph): IterableIterator<ScopeEntity> {
  yield* graph.scopes;
}

export function* iterateJSXElements(graph: SolidGraph): IterableIterator<JSXElementEntity> {
  yield* graph.jsxElements;
}

export function* iterateImports(graph: SolidGraph): IterableIterator<ImportEntity> {
  yield* graph.imports;
}

export function* iterateClasses(graph: SolidGraph): IterableIterator<ClassEntity> {
  yield* graph.classes;
}

export function* iterateProperties(graph: SolidGraph): IterableIterator<PropertyEntity> {
  yield* graph.properties;
}

export function iterateReactiveReads(graph: SolidGraph, callback: (variable: VariableEntity, read: ReadEntity) => boolean | void): void {
  const reactive = graph.reactiveVariables;
  for (let i = 0, len = reactive.length; i < len; i++) {
    const v = reactive[i];
    if (!v) continue;
    const reads = v.reads;
    for (let j = 0, rlen = reads.length; j < rlen; j++) {
      const read = reads[j];
      if (!read) continue;
      if (callback(v, read) === false) return;
    }
  }
}

export function iterateSignalLikeReads(graph: SolidGraph, callback: (variable: VariableEntity, read: ReadEntity) => boolean | void): void {
  const reactive = graph.reactiveVariables;
  for (let i = 0, len = reactive.length; i < len; i++) {
    const v = reactive[i];
    if (!v) continue;
    if (!v.isSignalLike) continue;
    const reads = v.reads;
    for (let j = 0, rlen = reads.length; j < rlen; j++) {
      const read = reads[j];
      if (!read) continue;
      if (callback(v, read) === false) return;
    }
  }
}

export function* getAsyncFunctions(graph: SolidGraph): IterableIterator<FunctionEntity> {
  const fns = graph.functions;
  for (let i = 0, len = fns.length; i < len; i++) {
    const fn = fns[i];
    if (!fn) continue;
    if (fn.async) yield fn;
  }
}

export function* getGeneratorFunctions(graph: SolidGraph): IterableIterator<FunctionEntity> {
  const fns = graph.functions;
  for (let i = 0, len = fns.length; i < len; i++) {
    const fn = fns[i];
    if (!fn) continue;
    if (fn.generator) yield fn;
  }
}

export function* getDOMElements(graph: SolidGraph): IterableIterator<JSXElementEntity> {
  const els = graph.jsxElements;
  for (let i = 0, len = els.length; i < len; i++) {
    const el = els[i];
    if (!el) continue;
    if (el.isDomElement) yield el;
  }
}

export function* getComponentElements(graph: SolidGraph): IterableIterator<JSXElementEntity> {
  const els = graph.jsxElements;
  for (let i = 0, len = els.length; i < len; i++) {
    const el = els[i];
    if (!el) continue;
    if (el.tag && !el.isDomElement) yield el;
  }
}
