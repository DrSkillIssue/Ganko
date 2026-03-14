# Phase 2 — Dead Code & Consolidation (C1, C3, C6, C7)

**Goal:** Remove dead code, deduplicate types, consolidate overlapping tag sets and regex constants.


---

## Step 2.1: Delete dead `buildContainingBlockFactsByElementKey` (C1)

**File:** `cascade-builder.ts:384-423`

This function is NEVER called. Containing block facts are built inline in `buildElementFactIndex` (`build.ts:399-414`) using a parent-key propagation approach. This function uses a different `while (current)` parent-chain-walking algorithm.

**Action:** Delete lines 384-423 entirely. Also remove the export from `index.ts` if present.

**Verify:** `rg "buildContainingBlockFactsByElementKey" packages/ganko/src/` should return only the definition (which is being deleted). If any call site exists, the delete would break `tsc`.

---

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
Replace `REPLACED_TAGS.has(tag)` usage in `isReplacedTag`. The current `REPLACED_TAGS` does NOT include `"object"` or `"embed"` but `INTRINSIC_REPLACED_TAGS` does — preserve the original set membership by constructing the replacement explicitly:
```typescript
const REPLACED_ELEMENT_TAGS: ReadonlySet<string> = new Set([
  ...CONTROL_ELEMENT_TAGS, "img", "video", "canvas", "svg", "iframe",
])

export function isReplacedTag(tag: string | null): boolean {
  if (tag === null) return false
  return REPLACED_ELEMENT_TAGS.has(tag.toLowerCase())
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
   - `guard-model.ts:100` uses `.replace(WHITESPACE_RE, " ")` which REQUIRES the `g` flag to replace all whitespace runs. `String.prototype.replace()` with a non-global regex only replaces the first match.
   - Keep a local `const WHITESPACE_RE_GLOBAL = /\s+/g` in `guard-model.ts` for the `.replace()` call. Import `WHITESPACE_RE` from `./util` only for `.split()` consumers in `context-classification.ts`.

---

## Estimated Impact

- C1: Dead code removal, reduced bundle size
- C3: Single source of truth for textual content state
- C6: Single source of truth for element tag classification, no desync risk
- C7: No duplicate regex allocations across modules
