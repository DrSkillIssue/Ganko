# Implementation Plan: Touch-Target False Positives on Component-Authored Elements

## Problem Statement

`jsx-layout-policy-touch-target` reports `padding-right: 0px` on component-authored interactive elements (Button, DropdownMenu.Trigger, Dialog.CloseButton, etc.) when the actual rendered padding is `8px` from component CSS. The rule cannot see the component's CSS or resolve dynamic attribute values that gate CSS selectors.

## Root Cause Analysis

Three structural gaps in the LayoutGraph/CSSGraph pipeline:

### Gap 1: Cross-Component CSS Scope Propagation

**Location**: `scope.ts` → `selector-dispatch.ts:151`

`buildSelectorCandidatesByNode` looks up selectors using `node.solidFile` — the call-site file. The CSS scope for that file includes co-located CSS, direct CSS imports, and global side-effect CSS. It does NOT include CSS co-located with imported component files.

When `abuseipdb-blacklist.tsx` uses `<Button>`, the Button component's `button.css` (which defines `[data-component="button"][data-size="md"] { padding: 0 var(--size-padding-x-md); }`) is not in the call-site's scope. Only `base.css`'s `* { padding: 0 }` matches → `padding-right: 0px`.

**Data flow today**:
```
abuseipdb-blacklist.tsx
  imports { Button } from "@org/ui"
  → resolveCss("@org/ui") → null (package exports point to .tsx, not .css)
  → button.css NOT in scope
  → only base.css's * { padding: 0 } matches
  → padding-right: 0px
```

**Existing foundation**:
- `resolveSolid(file, source)` resolves component imports to `.tsx` files
- `resolveColocatedCss(solidFilePath, ...)` finds co-located CSS for any solid file
- `getOrCollectTransitiveScope()` handles `@import` chains
- `hostElementRefsByNodeMutable` (built at `build.ts:235-237`) maps nodes → host `SolidGraph.file`

**Fix**: In `collectCSSScopeBySolidFile` (`scope.ts`), for each non-CSS import in a solid file:
1. `resolveSolid(solidFile, import.source)` → get the component's file path
2. `resolveColocatedCss(componentFilePath, cssFileIndex)` → find co-located CSS
3. `getOrCollectTransitiveScope(colocatedCss, ...)` → include transitive @imports
4. Add to the importing file's local scope

Every function in this chain already exists. They need to be connected for component (non-CSS) imports.

### Gap 2: Cross-Component Attribute Value Propagation

**Location**: `component-host.ts:1016-1039` → `element-record.ts:357-375`

Even with Gap 1 fixed, `[data-component="button"][data-size="md"]` gets a `Conditional` match because `data-size` is `null` in the merged attributes map.

**Data flow today**:
```
Button template: <Base data-size={local.size ?? "sm"}>
  → collectStaticAttributes() → {data-size: null}  (expression is dynamic)

Call site: <Button size="md">
  → collectStaticAttributes() → {size: "md"}

mergeAttributes({size: "md"}, {data-size: null})
  → {data-size: null, size: "md"}

Selector [data-size="md"]: data-size = null → Conditional match
  → cascade guard = Conditional → readKnownPx rejects → no warning
```

**Existing foundation**:
- `LayoutComponentHostDescriptor` carries `staticAttributes` per component (cached, not per call-site)
- `hostElementRef` provides full AST access to host element's JSX attribute value nodes
- `mergeAttributes` is the per-call-site merge point
- `getStaticStringFromJSXValue` extracts static values from JSX expressions

**Fix**: Add `attributePropBindings: ReadonlyMap<string, string>` to `LayoutComponentHostDescriptor`. This maps host attribute names to the prop member name they reference (e.g., `data-size → size`).

Extraction: When `collectStaticAttributes` encounters a dynamic expression for an attribute, extract the prop member name from patterns like:
- `props.size` → member name `size`
- `local.size` → member name `size`
- `props.size ?? "sm"` → member name `size` (unwrap nullish coalescing)
- `local.size ?? "sm"` → member name `size`

This extraction happens once per component definition. Then at `mergeAttributes` time (per call-site), for each `null`-valued host attribute with a prop binding, look up the call-site's attribute by the bound prop name and substitute:
```
data-size: null + binding "size" + call-site {size: "md"} → data-size: "md"
```

### Gap 3: CSS Custom Property Value Substitution in Cascade

**Location**: `signal-normalization.ts:375-384` → `cascade-builder.ts`

Even with Gaps 1+2 fixed, the cascade declaration value is `var(--size-padding-x-md)`. Signal normalization's `hasDynamicExpression` blanket-rejects ALL `var()` as Unknown:

```typescript
// signal-normalization.ts:375-384
function hasDynamicExpression(raw: string): boolean {
  if (raw.includes("var(")) return true  // ← blanket rejection, never consults CSSGraph
  ...
}
```

The CSSGraph has a **complete** CSS variable resolution system that already resolves every `var()` reference:
- `CSSGraph.variablesByName` — indexes all `--name: value` declarations (e.g., `--size-padding-x-md: 8px`)
- `VariableReferenceEntity.resolvedVariable` — every `var(--name)` reference is already resolved to its defining `VariableEntity` during `css/phases/references.ts`
- `VariableEntity.value` — holds the concrete declared value (e.g., `"8px"`)
- Scope-aware resolution with specificity, cascade priority, shadow analysis — all implemented
- `extractVarReferences(value)` in `css/parser/value.ts` — parses var() references from any value string
- Full query API in `css/queries/variable.ts`

The entire resolution pipeline exists. The `computedValue` field on `VariableEntity` is always `null` — value substitution into cascade declarations was never connected.

**Data flow today**:
```
cascade value: "var(--size-padding-x-md)"
  → parseLength() → hasDynamicExpression() → true → Unknown
  → readKnownPx() → null → no warning
```

**Data flow after fix**:
```
cascade value: "var(--size-padding-x-md)"
  → resolveVarReferences() → variablesByName.get("--size-padding-x-md") → VariableEntity.value = "8px"
  → substituted value: "8px"
  → parseLength("8px") → Known, px=8
  → readKnownPx() → 8 → 8 < 12 → warning with "8px"
```

**Fix**: Add a `var()` value substitution step between cascade building and signal normalization. The cascade builder already operates in a context with CSSGraph access. The substitution:

1. For each cascade declaration value containing `var(`, call `extractVarReferences(value)` (existing function in `css/parser/value.ts`)
2. For each extracted reference, look up `variablesByName.get(ref.name)` (existing index on CSSGraph)
3. Select the best matching `VariableEntity` using existing scope-aware resolution (specificity, cascade priority — already implemented in `css/phases/references.ts`)
4. Substitute the `var(--name)` substring with `VariableEntity.value`
5. Handle nested var() references recursively (var values can themselves contain var() — chain resolution already handles depth via `MAX_FALLBACK_DEPTH = 10` in references.ts)
6. Handle fallback values: if no variable resolves, use `ref.fallback` (already parsed and stored on `VariableReferenceEntity`)

**Implementation location**: A new function `resolveVarDeclarationValues` called from `buildCascadeMapForElement` (cascade-builder.ts) or as a post-step on the cascade map before it enters `normalizeSignalMapWithCounts`. The CSSGraph is accessible through the build context.

**Architecture**:
- The cascade map stores `LayoutCascadedDeclaration.value` as a raw string. The substitution produces a new string with var() references replaced by concrete values.
- For variables that resolve to other var() references, recursive substitution is bounded by the existing `MAX_FALLBACK_DEPTH` constant.
- Variables that cannot be resolved (no matching definition, no fallback) remain as-is — `hasDynamicExpression` correctly marks them Unknown.
- The guard provenance is preserved — if the cascade winner is conditional, the substituted value retains the conditional guard.

**Files to modify**:
- `packages/ganko/src/cross-file/layout/cascade-builder.ts` — add var() substitution step in `buildCascadeMapForElement` or as a post-processing pass
- `packages/ganko/src/cross-file/layout/build.ts` — pass CSSGraph variable index to cascade builder context (if not already available)

---

## Expansion: Other False-Positive Patterns

### E1: All `data-*` Attribute Selector Patterns (Same Root Cause)

Every component using the `data-X={props.X}` pattern hits Gaps 1+2+3. Common in design systems:

- `data-variant={local.variant ?? "secondary"}` → `[data-variant="danger"]` on buttons
- `data-size={local.size}` → `[data-size="sm"]` on inputs, selects, textareas
- `data-orientation={local.orientation}` → `[data-orientation="horizontal"]` on separators, tabs
- `data-state={...}` → `[data-state="open"]` on dialogs, popovers, accordions
- `data-align={...}` → `[data-align="center"]` on dropdown menus

Fixing Gaps 1+2+3 handles ALL of these simultaneously — the fix is pattern-agnostic.

### E2: Polymorphic `as={Component}` Patterns — IMPLEMENTED

`resolveHostForElement` in `element-record.ts` now detects `as={Component}` props on call-site elements, resolves the referenced component through the existing host resolver, and composes the `as` component's host descriptor (tagName, attributes, classes, bindings) with the outer component's host. The `as` component takes precedence for tagName and structural attributes while the outer component's attributes merge underneath.

### E3: Default Prop Values (Fallback When Prop Not Passed)

```tsx
<Button>Submit</Button>  // No size prop → defaults to "sm"
```

The Button template has `data-size={local.size ?? "sm"}`. When `size` is not passed, `local.size` is `undefined`, so `data-size` = `"sm"` at runtime.

Currently `getStaticStringFromJSXValue` returns `null` for `local.size ?? "sm"`. But `getStaticNumericValue` already handles `x ?? <number>` (returns the fallback). Adding the same pattern for strings:

```typescript
// In getStaticStringFromJSXValue:
if (ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
  const fallback = getStaticStringFromJSXValue(expression.right)
  if (fallback !== null) return fallback
}
```

This gives `data-size: "sm"` as the DEFAULT in the host descriptor's `staticAttributes`. When a call-site passes `size="md"`, the prop binding (Gap 2) overrides it to `"md"`. When no `size` is passed, the fallback `"sm"` remains. Both cases produce a concrete value instead of `null`.

**Important**: This works because the descriptor stores the fallback (per-component), and the prop binding resolves the actual value (per-call-site). The fallback is only used when the call-site doesn't override.

### E4: Spread-Based Attribute Forwarding

```tsx
// Component that spreads all props to host
function IconButton(props) {
  return <button {...props}>{props.children}</button>
}
```

`collectStaticAttributes` skips spread attributes entirely (`if (!ts.isJsxAttribute(attribute.node)) continue`). The host element's attributes map is empty. No CSS attribute selectors can match.

This is harder to fix because spreads are opaque — we can't know which attributes are forwarded without type analysis. However, for components that BOTH spread AND set explicit data attributes, the explicit ones ARE captured. The spread case is a lower-priority expansion.

### E5: Kobalte/Radix State Attributes

Component libraries like Kobalte inject `data-expanded`, `data-disabled`, `data-checked`, etc. at runtime. These attributes don't appear in the JSX template — they're set imperatively by the library's state management.

CSS like `[data-expanded] { height: auto; }` targets these runtime-only attributes. The layout graph can't know about them through static analysis.

**Mitigation**: For KNOWN component libraries, a configurable attribute allowlist could inject expected attributes. This is lower priority and more of a heuristic.

---

## Implementation Order

| Priority | Item | Impact | Effort |
|----------|------|--------|--------|
| **P0** | Gap 1: CSS scope propagation | Eliminates ALL `0px` false positives on components | Low — connecting existing functions in scope.ts |
| **P0** | Gap 2: Attribute prop bindings | Enables unconditional selector matching for component elements | Medium — new descriptor field + extraction + merge step |
| **P0** | Gap 3: CSS var() value substitution | Enables accurate px values from design tokens for ALL layout rules | Medium — connecting existing CSSGraph variable resolution to cascade builder |
| **P1** | E3: Default prop fallbacks in `getStaticStringFromJSXValue` | Handles `<Button>` without explicit size prop | Low — 5-line addition mirroring existing numeric pattern |
| **P1** | E2: Polymorphic `as={Component}` resolution | Fixes Dialog.CloseButton, DropdownMenu.Trigger etc. | Medium — extend `resolveTagNameFromPolymorphicProp` |
| **P3** | E4: Spread attribute analysis | Handles pure-spread components | High — requires type-level analysis |
| **P3** | E5: Library state attribute allowlists | Handles runtime-injected attributes | Medium — configurable, heuristic |

## Files to Modify

**Gap 1 (CSS scope)**:
- `packages/ganko/src/cross-file/layout/scope.ts` — extend `collectCSSScopeBySolidFile` loop to include co-located CSS from component imports via `resolveSolid` + `resolveColocatedCss`

**Gap 2 (attribute bindings)**:
- `packages/ganko/src/cross-file/layout/component-host.ts` — add `attributePropBindings` to descriptor, extraction logic alongside `collectStaticAttributes`
- `packages/ganko/src/cross-file/layout/element-record.ts` — use bindings in `mergeAttributes`
- `packages/ganko/src/cross-file/layout/graph.ts` — add bindings field to `LayoutComponentHostDescriptor` interface

**Gap 3 (CSS var() substitution)**:
- `packages/ganko/src/cross-file/layout/cascade-builder.ts` — add var() substitution in `buildCascadeMapForElement` using `extractVarReferences` + `CSSGraph.variablesByName`
- `packages/ganko/src/cross-file/layout/build.ts` — pass variable resolution index to cascade builder context

**E3 (default fallbacks)**:
- `packages/ganko/src/solid/util/static-value.ts` — add `??` handling to `getStaticStringFromJSXValue`

**E2 (polymorphic as)**:
- `packages/ganko/src/cross-file/layout/component-host.ts` — extend `resolveTagNameFromPolymorphicProp` to resolve component references via binding chain
