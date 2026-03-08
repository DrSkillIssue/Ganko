/**
 * Imports Rule
 *
 * Enforce consistent imports from "solid-js", "solid-js/web", and "solid-js/store".
 *
 * This rule detects when Solid.js primitives, functions, or types are imported
 * from the wrong source module and provides auto-fixes to move them to the
 * correct source.
 *
 * @example
 * // Wrong - createEffect should be from "solid-js"
 * import { createEffect } from "solid-js/web";
 *
 * // Correct
 * import { createEffect } from "solid-js";
 *
 * // Wrong - render should be from "solid-js/web"
 * import { render } from "solid-js";
 *
 * // Correct
 * import { render } from "solid-js/web";
 */

import type { TSESTree as T } from "@typescript-eslint/utils"
import type { ImportEntity, ImportSpecifierEntity } from "../../entities/import"
import type { Diagnostic } from "../../../diagnostic"
import type { Emit } from "../../../graph"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { iterateImports } from "../../queries/iterate"

const messages = {
  preferSource: 'Prefer importing {{name}} from "{{source}}".',
} as const

/** Valid Solid.js source modules. */
type Source = "solid-js" | "solid-js/web" | "solid-js/store"

/**
 * Solid.js primitives and functions mapped to their canonical source modules.
 *
 * This map contains runtime values (functions, components, constants) that
 * must be imported from specific Solid.js packages.
 */
const primitiveMap = new Map<string, Source>([
  // solid-js primitives - reactive core
  ["createSignal", "solid-js"],
  ["createEffect", "solid-js"],
  ["createMemo", "solid-js"],
  ["createResource", "solid-js"],
  ["onMount", "solid-js"],
  ["onCleanup", "solid-js"],
  ["onError", "solid-js"],
  ["untrack", "solid-js"],
  ["batch", "solid-js"],
  ["on", "solid-js"],
  ["createRoot", "solid-js"],
  ["getOwner", "solid-js"],
  ["runWithOwner", "solid-js"],
  ["mergeProps", "solid-js"],
  ["splitProps", "solid-js"],
  ["useTransition", "solid-js"],
  ["observable", "solid-js"],
  ["from", "solid-js"],
  ["mapArray", "solid-js"],
  ["indexArray", "solid-js"],
  ["createContext", "solid-js"],
  ["useContext", "solid-js"],
  ["children", "solid-js"],
  ["lazy", "solid-js"],
  ["createUniqueId", "solid-js"],
  ["createDeferred", "solid-js"],
  ["createRenderEffect", "solid-js"],
  ["createComputed", "solid-js"],
  ["createReaction", "solid-js"],
  ["createSelector", "solid-js"],
  ["DEV", "solid-js"],
  ["For", "solid-js"],
  ["Show", "solid-js"],
  ["Switch", "solid-js"],
  ["Match", "solid-js"],
  ["Index", "solid-js"],
  ["ErrorBoundary", "solid-js"],
  ["Suspense", "solid-js"],
  ["SuspenseList", "solid-js"],
  // solid-js/web primitives - DOM rendering and SSR
  ["Portal", "solid-js/web"],
  ["render", "solid-js/web"],
  ["hydrate", "solid-js/web"],
  ["renderToString", "solid-js/web"],
  ["renderToStream", "solid-js/web"],
  ["isServer", "solid-js/web"],
  ["renderToStringAsync", "solid-js/web"],
  ["generateHydrationScript", "solid-js/web"],
  ["HydrationScript", "solid-js/web"],
  ["Dynamic", "solid-js/web"],
  // solid-js/store primitives - state management
  ["createStore", "solid-js/store"],
  ["produce", "solid-js/store"],
  ["reconcile", "solid-js/store"],
  ["unwrap", "solid-js/store"],
  ["createMutable", "solid-js/store"],
  ["modifyMutable", "solid-js/store"],
])

/**
 * Solid.js types mapped to their canonical source modules.
 *
 * This map contains TypeScript types that must be imported from
 * specific Solid.js packages when using `import type`.
 */
const typeMap = new Map<string, Source>([
  // solid-js types - core type definitions
  ["Signal", "solid-js"],
  ["Accessor", "solid-js"],
  ["Setter", "solid-js"],
  ["Resource", "solid-js"],
  ["ResourceActions", "solid-js"],
  ["ResourceOptions", "solid-js"],
  ["ResourceReturn", "solid-js"],
  ["ResourceFetcher", "solid-js"],
  ["InitializedResourceReturn", "solid-js"],
  ["Component", "solid-js"],
  ["VoidProps", "solid-js"],
  ["VoidComponent", "solid-js"],
  ["ParentProps", "solid-js"],
  ["ParentComponent", "solid-js"],
  ["FlowProps", "solid-js"],
  ["FlowComponent", "solid-js"],
  ["ValidComponent", "solid-js"],
  ["ComponentProps", "solid-js"],
  ["Ref", "solid-js"],
  ["MergeProps", "solid-js"],
  ["SplitPrips", "solid-js"],
  ["Context", "solid-js"],
  ["JSX", "solid-js"],
  ["ResolvedChildren", "solid-js"],
  ["MatchProps", "solid-js"],
  // solid-js/web types
  ["MountableElement", "solid-js/web"],
  // solid-js/store types
  ["StoreNode", "solid-js/store"],
  ["Store", "solid-js/store"],
  ["SetStoreFunction", "solid-js/store"],
])

/**
 * Check if an import specifier represents a type import.
 *
 * A specifier is a type import if either:
 * - The specifier itself has `type` modifier (e.g., `import { type Foo }`)
 * - The declaration has `type` modifier (e.g., `import type { Foo }`)
 *
 * @param specifier - The import specifier node
 * @param declaration - The parent import declaration node
 * @returns True if this is a type-only import
 */
function isTypeImport(specifier: T.ImportSpecifier, declaration: T.ImportDeclaration): boolean {
  return specifier.importKind === "type" || declaration.importKind === "type"
}



function checkSpecifier(
  specEntity: ImportSpecifierEntity,
  declaration: T.ImportDeclaration,
  source: Source,
  file: string,
): Diagnostic | undefined {
  if (specEntity.kind !== "named") return undefined

  const name = specEntity.importedName
  if (name === null) return undefined

  const specNode = specEntity.node
  if (specNode.type !== "ImportSpecifier") return undefined

  const isType = isTypeImport(specNode, declaration)
  const map = isType ? typeMap : primitiveMap
  const correctSource = map.get(name)

  if (correctSource === undefined || correctSource === source) return undefined

  return createDiagnostic(
    file,
    specNode,
    "imports",
    "preferSource",
    resolveMessage(messages.preferSource, { name, source: correctSource }),
    "error",
  )
}

function checkImport(entity: ImportEntity, emit: Emit, file: string): void {
  const source = entity.source
  let validSource: Source
  if (source === "solid-js") {
    validSource = "solid-js"
  } else if (source === "solid-js/web") {
    validSource = "solid-js/web"
  } else if (source === "solid-js/store") {
    validSource = "solid-js/store"
  } else {
    return
  }

  const declaration = entity.node
  const specifiers = entity.specifiers

  for (let i = 0, len = specifiers.length; i < len; i++) {
    const spec = specifiers[i];
    if (!spec) continue;
    const diagnostic = checkSpecifier(spec, declaration, validSource, file)
    if (diagnostic) {
      emit(diagnostic)
    }
  }
}

const options = {}

export const imports = defineSolidRule({
  id: "imports",
  severity: "error",
  messages,
  meta: {
    description:
      'Enforce consistent imports from "solid-js", "solid-js/web", and "solid-js/store".',
    fixable: false,
    category: "solid",
  },
  options,
  check(graph, emit) {
    for (const entity of iterateImports(graph)) {
      checkImport(entity, emit, graph.file)
    }
  },
})
