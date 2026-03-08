# Ganko

Ganko was built to catch the horrible code that AI vibe-coding produces and steer it in the right direction automatically. Traditional linters walk a single file's AST, so every rule re-derives the same context from scratch. That makes sophisticated analysis impractical once you have 100+ rules.

Ganko builds a typed graph of your program first (reactivity, scopes, JSX, CSS cascade, cross-file layout) and lets every rule query it. The result is a standalone linter, LSP server, and VS Code extension covering Solid.js reactivity, runtime performance, CSS layout stability, and cross-file JSX-to-CSS analysis.

## What It Covers

**Solid Reactivity & JSX** (25 rules) — Signal call enforcement, effect misuse, store reactivity breaks, component lifecycle, resource access, reactive scope detection, JSX nesting validation, and Suspense boundary checks. Catches the mistakes that Solid's run-once model makes easy to introduce.

**Solid Idioms** (10 rules) — Import consistency, `<For>`/`<Index>`/`<Show>` preferences, batch optimization, style prop validation, and React-to-Solid migration checks.

**TypeScript/JavaScript Correctness** (14 rules) — Non-null assertion bans, type-casting restrictions, `any`/`unknown` guards, JSDoc enforcement, AI-generated comment detection, and import hygiene.

**Runtime Performance** (51 rules) — V8 deoptimization patterns (hidden class transitions, megamorphic access, delete operator), quadratic complexity (accumulator spreads, nested collection loops), memory leaks (unbounded collections, detached DOM references, leaked timers/observers/listeners), and hot-path allocation (closures in loops, intermediate array copies).

**CSS Analysis** (33 rules) — Accessibility policy enforcement (contrast ratios, touch targets, typography, reduced motion), animation validation (discrete transitions, empty keyframes, unknown animation names), cascade correctness (specificity conflicts, layer order inversions, redundant overrides), and structural checks (custom property cycles, container queries, z-index positioning).

**Cross-File JSX + CSS** (30 rules) — Correlates JSX elements with CSS selectors: layout shift detection (CLS-triggering transitions, conditional display collapse, unsized replaced elements, stateful box-model shifts), classList geometry toggles, fill-image parent sizing, undefined CSS class references, and unused custom properties across file boundaries.

## Installation

### LSP Server (for editors)

```bash
npm i -g @drskillissue/ganko-lsp
```

This installs the `ganko` binary, which serves as both the language server and CLI linter.

### Editor Setup

#### VS Code

Install `ganko-vscode` from the VS Code marketplace. It bundles the LSP server — no separate install required.

#### Neovim (0.11+)

Add to `~/.config/nvim/init.lua`:

```lua
vim.lsp.config("ganko", {
  cmd = { "ganko", "--stdio" },
  filetypes = { "typescript", "typescriptreact", "javascript", "javascriptreact", "css", "scss", "sass", "less" },
  root_markers = { "package.json", "tsconfig.json", ".git" },
})
vim.lsp.enable("ganko")
```

#### OpenCode

Add to `~/.config/opencode/opencode.json` (or `opencode.json` in project root):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "lsp": {
    "ganko": {
      "command": ["ganko", "--stdio"],
      "extensions": [".ts", ".tsx", ".js", ".jsx", ".css", ".scss", ".sass", ".less"]
    }
  }
}
```

#### Helix

Add to `~/.config/helix/languages.toml`:

```toml
[language-server.ganko]
command = "ganko"
args = ["--stdio"]

[[language]]
name = "typescript"
language-servers = ["typescript-language-server", "ganko"]

[[language]]
name = "tsx"
language-servers = ["typescript-language-server", "ganko"]

[[language]]
name = "javascript"
language-servers = ["typescript-language-server", "ganko"]

[[language]]
name = "jsx"
language-servers = ["typescript-language-server", "ganko"]

[[language]]
name = "css"
language-servers = ["vscode-css-language-server", "ganko"]

[[language]]
name = "scss"
language-servers = ["vscode-css-language-server", "ganko"]
```

#### Sublime Text

Install the [LSP](https://packagecontrol.io/packages/LSP) package, then add to `LSP.sublime-settings`:

```json
{
  "clients": {
    "ganko": {
      "enabled": true,
      "command": ["ganko", "--stdio"],
      "selector": "source.ts | source.tsx | source.js | source.jsx | source.css | source.scss | source.sass | source.less"
    }
  }
}
```

#### Emacs (eglot)

```elisp
(with-eval-after-load 'eglot
  (add-to-list 'eglot-server-programs
               '((typescript-ts-mode tsx-ts-mode js-ts-mode js-mode css-mode scss-mode)
                 . ("ganko" "--stdio"))))

(dolist (hook '(typescript-ts-mode-hook tsx-ts-mode-hook js-ts-mode-hook
               js-mode-hook css-mode-hook scss-mode-hook))
  (add-hook hook #'eglot-ensure))
```

#### Other Editors

Any editor with LSP support can use ganko. Launch `ganko --stdio` — the server communicates via JSON-RPC over stdio.

## Usage

### CLI Linter

```bash
# Lint entire project
ganko lint

# Lint specific files or globs
ganko lint src/App.tsx "src/**/*.tsx"

# JSON output for CI
ganko lint --format json

# Fail on any warnings
ganko lint --max-warnings 0

# Exclude paths
ganko lint --exclude "backend/**"
```

See the [ganko README](packages/ganko/README.md) for the full CLI reference.

### ESLint Integration

Ganko also ships as an ESLint plugin for individuals that want to run it through their existing ESLint config:

```javascript
// eslint.config.mjs
import solid from "@drskillissue/ganko/eslint-plugin";

export default [
  ...solid.configs.recommended,
];
```

### Requirements

- Node.js >= 22.0.0
- TypeScript >= 5.9.3

## Rules

Rule IDs use the `solid/<rule-id>` namespace.

The tables below are synced with the current generated manifest and include Solid, CSS, and cross-file rules.

<!-- BEGIN AUTO-GENERATED:solid-rule-descriptions -->
### Correctness Rules (14)

| Rule | Description | Recommended |
|------|-------------|:-----------:|
| `solid/avoid-conditional-spreads` | Disallow conditional spread operators that create empty objects. Patterns like `...(condition ? {...} : {})` are fragile and create unnecessary object creations. | error |
| `solid/avoid-non-null-assertions` | Disallow non-null assertion operator (`!`). Use optional chaining, nullish coalescing, or proper type narrowing instead. | error |
| `solid/avoid-object-assign` | Disallow Object.assign(). Prefer object spread syntax or structuredClone() for copying objects. | error |
| `solid/avoid-object-spread` | Disallow object spread operators that break Solid's fine-grained reactivity. | error |
| `solid/avoid-type-casting` | Disallow type casting methods that bypass TypeScript's type safety. Includes unnecessary casts, double assertions, casting to any, type predicates, and unsafe generic assertions. | error |
| `solid/avoid-unsafe-type-annotations` | Disallow `any` and `unknown` in value-level type annotation positions (parameters, returns, variables, properties) | error |
| `solid/event-handlers` | Enforce naming DOM element event handlers consistently and prevent Solid's analysis from misunderstanding whether a prop should be an event handler. | error |
| `solid/missing-jsdoc-comments` | Require JSDoc comments on functions with appropriate tags for parameters, return values, and throws. | error |
| `solid/no-ai-slop-comments` | Disallow comments containing specified forbidden words or phrases. Useful for enforcing comment style guidelines and detecting AI-generated boilerplate. | error |
| `solid/no-array-handlers` | Disallow array handlers in JSX event properties. | error |
| `solid/no-banner-comments` | Disallow banner-style comments with repeated separator characters. | error |
| `solid/no-destructure` | Disallow destructuring props in Solid components. Props must be accessed via property access (props.x) to preserve reactivity. | error |
| `solid/no-inline-imports` | Disallow inline type imports. Import types at the top of the file for clarity and maintainability. | error |
| `solid/string-concat-in-loop` | Disallow string concatenation with += inside loops. Use array.push() and .join() instead. | error |


### CSS A11y Rules (6)

| Rule | Description | Recommended |
|------|-------------|:-----------:|
| `solid/css-no-outline-none-without-focus-visible` | Disallow removing outline without explicit focus-visible replacement. | error |
| `solid/css-policy-contrast` | Enforce minimum contrast ratio between foreground and background colors per accessibility policy. | warn |
| `solid/css-policy-spacing` | Enforce minimum letter-spacing, word-spacing, and paragraph spacing per accessibility policy. | warn |
| `solid/css-policy-touch-target` | Enforce minimum interactive element sizes per accessibility policy. | warn |
| `solid/css-policy-typography` | Enforce minimum font sizes and line heights per accessibility policy. | warn |
| `solid/css-require-reduced-motion-override` | Require reduced-motion override for animated selectors. | warn |


### CSS Animation Rules (6)

| Rule | Description | Recommended |
|------|-------------|:-----------:|
| `solid/css-no-discrete-transition` | Disallow transitions on discrete CSS properties. | error |
| `solid/css-no-empty-keyframes` | Disallow empty @keyframes rules. | error |
| `solid/no-layout-property-animation` | Disallow animating layout-affecting properties. | warn |
| `solid/no-transition-all` | Disallow transition: all and transition-property: all. | warn |
| `solid/no-unknown-animation-name` | Disallow animation names that do not match declared keyframes. | error |
| `solid/no-unused-keyframes` | Disallow unused @keyframes declarations. | warn |


### CSS Cascade Rules (5)

| Rule | Description | Recommended |
|------|-------------|:-----------:|
| `solid/declaration-no-overridden-within-rule` | Disallow duplicate declarations of the same property within a single rule block. | warn |
| `solid/media-query-overlap-conflict` | Disallow conflicting declarations in partially overlapping media queries. | warn |
| `solid/no-descending-specificity-conflict` | Disallow lower-specificity selectors after higher-specificity selectors for the same property. | warn |
| `solid/no-layer-order-inversion` | Disallow source-order assumptions that are inverted by layer precedence. | warn |
| `solid/no-redundant-override-pairs` | Disallow declarations that are deterministically overridden in the same selector context. | warn |


### CSS JSX Rules (15)

| Rule | Description | Recommended |
|------|-------------|:-----------:|
| `solid/css-no-unreferenced-component-class` | Detect CSS classes that are never referenced by static JSX class attributes. | warn |
| `solid/jsx-classlist-boolean-values` | Require classList values to be boolean-like expressions. | error |
| `solid/jsx-classlist-no-accessor-reference` | Disallow passing accessor references directly as classList values. | error |
| `solid/jsx-classlist-no-constant-literals` | Disallow classList entries with constant true/false values. | warn |
| `solid/jsx-classlist-static-keys` | Require classList keys to be static and non-computed. | error |
| `solid/jsx-layout-classlist-geometry-toggle` | Flag classList-driven class toggles that map to layout-affecting CSS geometry changes. | warn |
| `solid/jsx-layout-fill-image-parent-must-be-sized` | Require stable parent size and positioning for fill-image component usage. | warn |
| `solid/jsx-layout-picture-source-ratio-consistency` | Require consistent intrinsic aspect ratios across <picture> sources and fallback image. | warn |
| `solid/jsx-layout-unstable-style-toggle` | Flag dynamic inline style values on layout-sensitive properties that can trigger CLS. | warn |
| `solid/jsx-no-duplicate-class-token-class-classlist` | Disallow duplicate class tokens between class and classList on the same JSX element. | warn |
| `solid/jsx-no-undefined-css-class` | Detect undefined CSS class names in JSX | error |
| `solid/jsx-style-kebab-case-keys` | Require kebab-case keys in JSX style object literals. | error |
| `solid/jsx-style-no-function-values` | Disallow function values in JSX style objects. | error |
| `solid/jsx-style-no-unused-custom-prop` | Detect inline style custom properties that are never consumed by CSS var() references. | warn |
| `solid/jsx-style-policy` | Enforce accessibility policy thresholds on inline JSX style objects. | warn |


### CSS Layout Rules (15)

| Rule | Description | Recommended |
|------|-------------|:-----------:|
| `solid/css-layout-animation-layout-property` | Disallow keyframe animations that mutate layout-affecting properties and can trigger CLS. | warn |
| `solid/css-layout-box-sizing-toggle-with-chrome` | Disallow conditional box-sizing mode toggles when box chrome contributes to geometry shifts. | warn |
| `solid/css-layout-conditional-display-collapse` | Disallow conditional display collapse in flow without reserved geometry. | warn |
| `solid/css-layout-conditional-offset-shift` | Disallow conditional non-zero block-axis offsets that can trigger layout shifts. | warn |
| `solid/css-layout-conditional-white-space-wrap-shift` | Disallow conditional white-space wrapping mode toggles that can trigger CLS. | warn |
| `solid/css-layout-content-visibility-no-intrinsic-size` | Require intrinsic size reservation when using content-visibility auto to avoid late layout shifts. | warn |
| `solid/css-layout-dynamic-slot-no-reserved-space` | Require reserved block space for dynamic content containers to avoid layout shifts. | warn |
| `solid/css-layout-font-swap-instability` | Require metric overrides for swapping webfonts to reduce layout shifts during font load. | warn |
| `solid/css-layout-overflow-anchor-instability` | Disallow overflow-anchor none on dynamic or scrollable containers prone to visible layout shifts. | warn |
| `solid/css-layout-overflow-mode-toggle-instability` | Disallow conditional overflow mode switches that can introduce scrollbar-induced layout shifts. | warn |
| `solid/css-layout-scrollbar-gutter-instability` | Require stable scrollbar gutters for scrollable containers to reduce layout shifts. | warn |
| `solid/css-layout-sibling-alignment-outlier` | Detect vertical alignment outliers between sibling elements in shared layout containers. | warn |
| `solid/css-layout-stateful-box-model-shift` | Disallow stateful selector changes that alter element geometry and trigger layout shifts. | warn |
| `solid/css-layout-transition-layout-property` | Disallow transitions that animate layout-affecting geometry properties. | warn |
| `solid/css-layout-unsized-replaced-element` | Require stable reserved geometry for replaced media elements to prevent layout shifts. | warn |


### CSS Property Rules (7)

| Rule | Description | Recommended |
|------|-------------|:-----------:|
| `solid/css-no-custom-property-cycle` | Disallow cycles in custom property references. | error |
| `solid/css-no-hardcoded-z-index` | Disallow hardcoded positive z-index literals. | warn |
| `solid/css-no-legacy-vh-100` | Disallow 100vh in viewport sizing declarations. | warn |
| `solid/css-z-index-requires-positioned-context` | Require positioned context when using z-index. | warn |
| `solid/no-important` | Disallow !important declarations. | warn |
| `solid/no-unresolved-custom-properties` | Disallow unresolved custom property references. | error |
| `solid/no-unused-custom-properties` | Disallow unused CSS custom properties. | warn |


### CSS Selector Rules (5)

| Rule | Description | Recommended |
|------|-------------|:-----------:|
| `solid/no-complex-selectors` | Disallow deep selectors that are expensive to match. | warn |
| `solid/no-duplicate-selectors` | Disallow duplicate selector blocks. | warn |
| `solid/no-id-selectors` | Disallow ID selectors. | warn |
| `solid/selector-max-attribute-and-universal` | Disallow selectors with attribute or universal selectors beyond configured limits. | off |
| `solid/selector-max-specificity` | Disallow selectors that exceed a specificity threshold. | warn |


### CSS Structure Rules (4)

| Rule | Description | Recommended |
|------|-------------|:-----------:|
| `solid/css-no-empty-rule` | Disallow empty CSS rules. | warn |
| `solid/css-no-unknown-container-name` | Disallow unknown named containers in @container queries. | error |
| `solid/css-no-unused-container-name` | Disallow unused named containers. | warn |
| `solid/layer-requirement-for-component-rules` | Require style rules to be inside @layer when the file defines layers. | warn |


### JSX Rules (10)

| Rule | Description | Recommended |
|------|-------------|:-----------:|
| `solid/components-return-once` | Disallow early returns in components. Solid components only run once, and so conditionals should be inside JSX. | error |
| `solid/jsx-no-duplicate-props` | Disallow passing the same prop twice in JSX. | error |
| `solid/jsx-no-script-url` | Disallow javascript: URLs. | error |
| `solid/jsx-no-undef` | Disallow references to undefined variables in JSX. Handles custom directives. | error |
| `solid/jsx-uses-vars` | Detect imported components and directives that are never used in JSX. | warn |
| `solid/no-innerhtml` | Disallow usage of the innerHTML attribute, which can lead to security vulnerabilities. | error |
| `solid/no-unknown-namespaces` | Enforce using only Solid-specific namespaced attribute names (i.e. `'on:'` in `<div on:click={...} />`). | error |
| `solid/show-truthy-conversion` | Detect <Show when={expr}> where expr is not explicitly boolean, which may have unexpected truthy/falsy behavior. | error |
| `solid/suspense-boundary-missing` | Detect missing fallback props on Suspense/ErrorBoundary, and lazy components without Suspense wrapper. | error |
| `solid/validate-jsx-nesting` | Validates that HTML elements are nested according to the HTML5 specification. | error |


### Performance Rules (51)

| Rule | Description | Recommended |
|------|-------------|:-----------:|
| `solid/avoid-arguments-object` | Disallow arguments object (use rest parameters instead). | warn |
| `solid/avoid-chained-array-methods` | Flags chained array methods creating 3+ intermediate arrays, or filter().map() pattern. | warn |
| `solid/avoid-defensive-copy-for-scalar-stat` | Disallow defensive array copies passed into scalar statistic calls. | warn |
| `solid/avoid-delete-operator` | Disallow delete operator on objects (causes V8 deoptimization). | warn |
| `solid/avoid-function-allocation-in-hot-loop` | Disallow creating closures inside loops. | warn |
| `solid/avoid-hidden-class-transition` | Suggest consistent object shapes to avoid V8 hidden class transitions. | warn |
| `solid/avoid-intermediate-map-copy` | Disallow temporary Map allocations that are copied key-for-key into another Map. | warn |
| `solid/avoid-megamorphic-property-access` | Avoid property access on `any` or wide union types to prevent V8 deoptimization. | warn |
| `solid/avoid-quadratic-pair-comparison` | Disallow nested for-loops over the same collection creating O(n²) pair comparison. | warn |
| `solid/avoid-quadratic-spread` | Disallow spreading accumulator in reduce callbacks (O(n²) complexity). | error |
| `solid/avoid-repeated-indexof-check` | Disallow 3+ .indexOf() calls on the same array variable in one function. | warn |
| `solid/avoid-slice-sort-pattern` | Disallow .slice().sort() and .slice().reverse() chains. Use .toSorted()/.toReversed(). | warn |
| `solid/avoid-sparse-arrays` | Disallow new Array(n) without fill (creates holey array). | warn |
| `solid/avoid-spread-sort-map-join-pipeline` | Disallow [...iterable].sort().map().join() pipelines on hot paths. | warn |
| `solid/bounded-worklist-traversal` | Detect queue/worklist traversals with unbounded growth and no guard. | warn |
| `solid/closure-captured-scope` | Detect closures returned from scopes containing large allocations that may be retained. | warn |
| `solid/closure-dom-circular` | Detect event handler property assignments that create closure-DOM circular references. | warn |
| `solid/create-root-dispose` | Detect createRoot with unused dispose parameter. | warn |
| `solid/detached-dom-reference` | Detect DOM query results stored in module-scoped variables that may hold detached nodes. | warn |
| `solid/effect-outside-root` | Detect reactive computations created outside a reactive root (no Owner). | error |
| `solid/finalization-registry-leak` | Detect FinalizationRegistry.register() where heldValue references the target. | error |
| `solid/no-char-array-materialization` | Disallow split(""), Array.from(str), or [...str] in parsing loops. | warn |
| `solid/no-double-pass-delimiter-count` | Disallow split-based delimiter counting followed by additional split passes. | warn |
| `solid/no-full-split-in-hot-parse` | Disallow full split() materialization inside hot string parsing loops. | warn |
| `solid/no-heavy-parser-constructor-in-loop` | Disallow constructing heavy parsing helpers inside loops. | warn |
| `solid/no-leaked-abort-controller` | Detect AbortController in effects without abort() in onCleanup. | warn |
| `solid/no-leaked-animation-frame` | Detect requestAnimationFrame in effects without cancelAnimationFrame in onCleanup. | warn |
| `solid/no-leaked-event-listener` | Detect addEventListener in effects without removeEventListener in onCleanup. | warn |
| `solid/no-leaked-observer` | Detect Observer APIs in effects without disconnect() in onCleanup. | warn |
| `solid/no-leaked-subscription` | Detect WebSocket/EventSource/BroadcastChannel in effects without close() in onCleanup. | warn |
| `solid/no-leaked-timer` | Detect setInterval/setTimeout in effects without onCleanup to clear them. | warn |
| `solid/no-loop-string-plus-equals` | Disallow repeated string += accumulation in parsing loops. | warn |
| `solid/no-multipass-split-pipeline` | Disallow multipass split/map/filter pipelines in parsing code. | warn |
| `solid/no-per-char-substring-scan` | Disallow per-character substring/charAt scanning patterns in loops. | warn |
| `solid/no-repeated-token-normalization` | Disallow repeated trim/lower/upper normalization chains on the same token in one function. | warn |
| `solid/no-rescan-indexof-loop` | Disallow repeated indexOf/includes scans from start in parsing loops. | warn |
| `solid/no-rest-slice-loop` | Disallow repeated self-slice reassignment loops in string parsing code. | warn |
| `solid/no-shift-splice-head-consume` | Disallow shift/splice(0,1) head-consume patterns in loops. | warn |
| `solid/no-write-only-index` | Detect index structures that are written but never queried by key. | warn |
| `solid/prefer-charcode-over-regex-test` | Prefer charCodeAt() range checks over regex .test() for single-character classification. | warn |
| `solid/prefer-index-scan-over-string-iterator` | Prefer index-based string scanning over for-of iteration in ASCII parser code. | warn |
| `solid/prefer-lazy-property-access` | Suggests moving property access after early returns when not used immediately. | warn |
| `solid/prefer-map-lookup-over-linear-scan` | Disallow repeated linear scans over fixed literal collections in hot paths. | warn |
| `solid/prefer-map-over-object-dictionary` | Suggest Map for dictionary-like objects with dynamic keys. | warn |
| `solid/prefer-precompiled-regex` | Prefer hoisting regex literals to module-level constants to avoid repeated compilation. | warn |
| `solid/prefer-set-has-over-equality-chain` | Disallow 4+ guard-style equality checks against string literals on the same variable. Use a Set. | warn |
| `solid/prefer-set-lookup-in-loop` | Disallow linear search methods (.includes/.indexOf) on arrays inside loops. | warn |
| `solid/recursive-timer` | Detect setTimeout that recursively calls its enclosing function. | warn |
| `solid/self-referencing-store` | Detect setStore() where the value argument references the store itself. | error |
| `solid/unbounded-collection` | Detect module-scoped Map/Set/Array that only grow without removal. | warn |
| `solid/unbounded-signal-accumulation` | Detect signal setters that accumulate data without truncation via spread+append pattern. | warn |


### Reactivity Rules (15)

| Rule | Description | Recommended |
|------|-------------|:-----------:|
| `solid/async-tracked` | Disallow async functions in tracked scopes (createEffect, createMemo, etc.) | error |
| `solid/children-helper-misuse` | Detect misuse of the children() helper that causes unnecessary re-computation or breaks reactivity | error |
| `solid/cleanup-scope` | Detect onCleanup called outside of a valid reactive scope | error |
| `solid/derived-signal` | Detect functions that capture reactive values but are called in untracked contexts | error |
| `solid/effect-as-memo` | Detect createEffect that only sets a derived signal value, which should be createMemo instead | error |
| `solid/effect-as-mount` | Detect createEffect/createRenderEffect with no reactive dependencies that should be onMount instead | error |
| `solid/inline-component` | Detect component functions defined inside other components, which causes remount on every parent update | error |
| `solid/no-top-level-signal-call` | Disallow calling signals at component top-level (captures stale snapshots) | error |
| `solid/ref-early-access` | Detect accessing refs before they are assigned (before mount) | error |
| `solid/resource-access-unchecked` | Detect accessing resource data without checking loading/error state. | error |
| `solid/resource-refetch-loop` | Detect refetch() calls inside createEffect which can cause infinite loops | error |
| `solid/signal-call` | Require signals to be called as functions when used in tracked contexts | error |
| `solid/signal-in-loop` | Detect problematic signal usage inside For/Index loop callbacks | error |
| `solid/store-reactive-break` | Detect patterns that break store reactivity: spreading stores, top-level property extraction, or destructuring | error |
| `solid/transition-pending-unchecked` | Detect useTransition usage without handling the isPending state | error |


### Solid Rules (10)

| Rule | Description | Recommended |
|------|-------------|:-----------:|
| `solid/batch-optimization` | Suggest using batch() when multiple signal setters are called in the same synchronous scope | warn |
| `solid/imports` | Enforce consistent imports from "solid-js", "solid-js/web", and "solid-js/store". | error |
| `solid/index-vs-for` | Suggest <For> for object arrays and <Index> for primitive arrays. | warn |
| `solid/no-react-deps` | Disallow usage of dependency arrays in `createEffect`, `createMemo`, and `createRenderEffect`. | error |
| `solid/no-react-specific-props` | Disallow usage of React-specific `className`/`htmlFor` props, which were deprecated in v1.4.0. | error |
| `solid/prefer-for` | Enforce using Solid's `<For />` component for mapping an array to JSX elements. | warn |
| `solid/prefer-memo-complex-styles` | Enforce extracting complex style computations to createMemo for better approach. Complex inline style objects are rebuilt on every render, which can impact approach. | warn |
| `solid/prefer-show` | Enforce using Solid's `<Show />` component for conditionally showing content. Solid's compiler covers this case, so it's a stylistic rule only. | warn |
| `solid/self-closing-comp` | Disallow extra closing tags for components without children. | warn |
| `solid/style-prop` | Require CSS properties in the `style` prop to be valid and kebab-cased (ex. 'font-size'), not camel-cased (ex. 'fontSize') like in React, and that property values with dimensions are strings, not numbers with implicit 'px' units. | warn |
<!-- END AUTO-GENERATED:solid-rule-descriptions -->

## Rule Configuration

Rule severity can be overridden in three places (highest precedence first):

1. **VS Code settings** — `solid.rules.<rule-id>` per-rule overrides (editor-only)
2. **ESLint flat config** — `eslint.config.{mjs,js,cjs}` rule entries (read by both CLI and LSP)
3. **Built-in defaults** — from the rules manifest

The CLI also accepts `--exclude` patterns and reads global `ignores` from ESLint config.

See the [ganko README](packages/ganko/README.md) and [ganko-vscode README](packages/vscode/README.md) for configuration details.

## Development Setup

### Building

```bash
# Install dependencies
bun install

# Build all packages
bun run build

# Run linter
bun run lint

# Run tests
bun run test
```

### Running Tests

```bash
# Run all tests
bun run test

# Run specific test file
bun run --cwd packages/ganko test -- signal-call.test.ts

# Run tests matching a pattern
bun run --cwd packages/ganko test -- --grep "signal call"
```

## License

MIT
