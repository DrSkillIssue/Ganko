# Phase 2 — Dead Code & Consolidation (C1, C3, C6, C7)

**Goal:** Remove dead code, deduplicate types, consolidate overlapping tag sets and regex constants.

**Validation after each step:** `bun run tsc && bun run test && bun run lint`

---

## Step 2.1: Delete dead `buildContainingBlockFactsByElementKey` (C1)

**File:** `cascade-builder.ts:384-423`

This function is NEVER called. Containing block facts are built inline in `buildElementFactIndex` (`build.ts:399-414`) using a parent-key propagation approach. This function uses a different `while (current)` parent-chain-walking algorithm.

**Action:** Delete lines 384-423 entirely. Also remove the export from `index.ts` if present.

**Verify:** `rg "buildContainingBlockFactsByElementKey" packages/ganko/src/` should return only the definition (which is being deleted). If any call site exists, the delete would break `tsc`.

---

## Step 2.2: Deduplicate `TextualContentState` (C3)

**File:** `element-record.ts:44`
```typescript
export type TextualContentState = "yes" | "no" | "unknown" | "dynamic-text"
```

**File:** `signal-model.ts:95`
```typescript
export type LayoutTextualContentState = "yes" | "no" | "unknown" | "dynamic-text"
```

These are identical types.

**Action:**
1. Delete `TextualContentState` from `element-record.ts:44`
2. In `element-record.ts`, add import: `import type { LayoutTextualContentState } from "./signal-model"`
3. Replace all occurrences of `TextualContentState` in `element-record.ts` with `LayoutTextualContentState` (lines 35, 96-101, and any function signatures)

**NOTE:** After Phase 1 completes, both will already be numeric. This step is about eliminating the duplicate type definition regardless.

---

## Step 2.3: Consolidate tag sets (C6)

Three overlapping tag sets exist in three files:

**File:** `util.ts:7-9`
```typescript
export const CONTROL_ELEMENT_TAGS: ReadonlySet<string> = new Set([
  "input", "select", "textarea", "button",
])
```

**File:** `signal-normalization.ts:79`
```typescript
const REPLACED_TAGS = new Set(["input", "select", "textarea", "button", "img", "video", "canvas", "svg", "iframe"])
```

**File:** `content-composition.ts:18-19`
```typescript
const INTRINSIC_REPLACED_TAGS: ReadonlySet<string> = new Set([
  "img", "svg", "video", "canvas", "iframe", "object", "embed",
])
```

**Action:**
1. In `util.ts`, add after `CONTROL_ELEMENT_TAGS`:
```typescript
export const INTRINSIC_REPLACED_TAGS: ReadonlySet<string> = new Set([
  "img", "svg", "video", "canvas", "iframe", "object", "embed",
])
```

2. In `signal-normalization.ts:79`, replace:
```typescript
// Delete: const REPLACED_TAGS = new Set(["input", "select", "textarea", "button", "img", "video", "canvas", "svg", "iframe"])
```
Add import:
```typescript
import { CONTROL_ELEMENT_TAGS, INTRINSIC_REPLACED_TAGS } from "./util"
```
Replace `REPLACED_TAGS.has(tag)` in `isReplacedTag` with:
```typescript
export function isReplacedTag(tag: string | null): boolean {
  if (tag === null) return false
  const lower = tag.toLowerCase()
  return CONTROL_ELEMENT_TAGS.has(lower) || INTRINSIC_REPLACED_TAGS.has(lower)
}
```

3. In `content-composition.ts:18-19`, delete the local `INTRINSIC_REPLACED_TAGS` and import from `util.ts`:
```typescript
import { CONTROL_ELEMENT_TAGS, INTRINSIC_REPLACED_TAGS } from "./util"
```

---

## Step 2.4: Consolidate regex constants (C7)

**File:** `context-classification.ts:15`
```typescript
const WHITESPACE_RE = /\s+/
```

**File:** `context-classification.ts:32`
```typescript
const DISPLAY_TOKEN_SPLIT_RE = /\s+/
```

**File:** `guard-model.ts:29`
```typescript
const WHITESPACE_RE = /\s+/g
```

**Action:**
1. In `util.ts`, add:
```typescript
export const WHITESPACE_RE = /\s+/
```

2. In `context-classification.ts`:
   - Delete line 15 (`const WHITESPACE_RE = /\s+/`)
   - Delete line 32 (`const DISPLAY_TOKEN_SPLIT_RE = /\s+/`)
   - Import `WHITESPACE_RE` from `./util`
   - Replace `DISPLAY_TOKEN_SPLIT_RE` usage with `WHITESPACE_RE`

3. In `guard-model.ts`:
   - Delete line 29 (`const WHITESPACE_RE = /\s+/g`)
   - Import `WHITESPACE_RE` from `./util`
   - **CAUTION:** `guard-model.ts` uses `/\s+/g` (global flag). Check if the `g` flag is needed. If `split()` is the only consumer, the `g` flag is unnecessary for `String.prototype.split()`. Verify usage before changing.

---

## Estimated Impact

- C1: Dead code removal, reduced bundle size
- C3: Single source of truth for textual content state
- C6: Single source of truth for element tag classification, no desync risk
- C7: No duplicate regex allocations across modules
