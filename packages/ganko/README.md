# Ganko

`Ganko` is a graph-first linting SDK for Solid.js and CSS.

It provides:

- Typed program graphs for Solid and CSS
- A plugin-agnostic runner (`SolidPlugin`, `CSSPlugin`, `CrossFilePlugin`)
- Cross-file analysis (Solid <-> CSS) with layout inference
- ESLint plugin adapters
- A generated rule metadata manifest for tooling (`ganko/rules-manifest`)

## Package Entry Points

| Entry | Purpose |
|-------|---------|
| `ganko` | Full SDK (runner, plugins, graph builders, diagnostics, cache, policy, helpers) |
| `ganko/eslint-plugin` | Flat-config ESLint plugin with `configs.recommended` |
| `ganko/rules-manifest` | Lightweight metadata-only rule manifest (`RULES`, `RULES_BY_CATEGORY`, `RULE_CATEGORIES`, `getRule`) |

## Requirements

- Node.js `>=22.0.0`
- TypeScript `^5.9.3` (peer dependency)
- Bun for local development workflows in this monorepo

## Quick Start

```ts
import { createRunner, SolidPlugin, CSSPlugin } from "@drskillissue/ganko";

const runner = createRunner({
  plugins: [SolidPlugin, CSSPlugin],
  rules: {
    "signal-call": "error",
    "jsx-uses-vars": "off",
    "no-transition-all": "warn",
  },
});

const diagnostics = runner.run([
  "src/App.tsx",
  "src/styles/app.css",
]);
```

`rules` is a map of `rule-id -> "error" | "warn" | "off"`.

## Core Concepts

- **Plugin**: owns file filtering, graph construction, and rule execution (`SolidPlugin`, `CSSPlugin`).
- **Graph**: typed model of a source domain (`SolidGraph`, `CSSGraph`).
- **Rule**: consumes a typed graph and emits diagnostics via callback.
- **Runner**: executes plugins across a file list and merges diagnostics.
- **Emit wrapper**: can rewrite/suppress diagnostics (rule overrides, suppressions).

## Runner API

```ts
import { createRunner } from "@drskillissue/ganko";
import type { Runner, RunnerConfig } from "@drskillissue/ganko";

const config: RunnerConfig = {
  plugins: [],
  rules: {},
};

const runner: Runner = createRunner(config);
runner.setRuleOverrides({ "signal-call": "warn" });
const diagnostics = runner.run(["src/App.tsx"]);
```

Diagnostic severities are `"error" | "warn"`, matching ESLint convention.

## Parsing And In-Memory Analysis

Use these APIs when content is already in memory (ESLint, LSP, tests).

### Solid Input

```ts
import {
  parseContent,
  parseContentWithProgram,
  analyzeInput,
  buildSolidGraph,
} from "@drskillissue/ganko";

const input = parseContent("src/App.tsx", "export const App = () => <div />");

const diagnostics = [];
analyzeInput(input, (d) => diagnostics.push(d));

const graph = buildSolidGraph(input);
```

`parseContentWithProgram(path, content, program)` is available for type-aware parsing when you already have a `ts.Program`.

### CSS Graph

```ts
import { buildCSSGraph } from "@drskillissue/ganko";
import type { CSSInput } from "@drskillissue/ganko";

const cssInput: CSSInput = {
  files: [{ path: "src/styles/app.css", content: ".btn { color: red; }" }],
};

const cssGraph = buildCSSGraph(cssInput);
```

### Cross-File Analysis

```ts
import {
  parseContent,
  buildSolidGraph,
  buildCSSGraph,
  buildLayoutGraph,
  runCrossFileRules,
} from "@drskillissue/ganko";

const solidInput = parseContent("src/App.tsx", "export const App = () => <div class=\"btn\" />;");
const cssInput = { files: [{ path: "src/app.css", content: ".btn { color: red; }" }] };

const solids = [buildSolidGraph(solidInput)];
const css = buildCSSGraph(cssInput);
const layout = buildLayoutGraph(solids, css);
runCrossFileRules({ solids, css, layout }, (d) => {
  // handle diagnostic
});
```

## Suppression Directives

Inline suppression comments are supported in Solid source files:

- `ganko-disable-next-line`
- `ganko-disable-line`
- `ganko-disable` (file-wide)

Rules may be listed after the directive; if omitted, all rules are suppressed for that scope.

```ts
// ganko-disable-next-line signal-call
const view = <div>{count}</div>;
```

## Plugins

### `SolidPlugin`

- Extensions: `.tsx`, `.jsx`, `.ts`, `.js`, `.mts`, `.cts`, `.mjs`, `.cjs`
- Parses with `@typescript-eslint/parser`
- Builds `SolidGraph`
- Runs Solid rules (reactivity, JSX, correctness, performance, Solid style/import conventions)

### `CSSPlugin`

- Extensions: `.css`, `.scss`, `.sass`, `.less`
- Builds `CSSGraph` from one or many files
- Runs CSS rules across a11y, animation, cascade, property, selector, and structure categories

### Cross-File Analysis

- Uses `buildLayoutGraph` and `runCrossFileRules` for cross-domain analysis
- Builds `LayoutGraph` on top of Solid + CSS graphs
- Runs cross-file rules (class name usage, `classList` consistency, JSX inline style policy, layout outlier detection)

## Graph APIs

### `SolidGraph`

`SolidGraph` stores typed entities and indexes for:

- scopes, variables, functions, calls
- JSX elements/attributes and static class/classList/style indexes
- imports/exports
- reactive computations, dependency edges, ownership edges

### `CSSGraph`

`CSSGraph` stores:

- files, rules, selectors, declarations
- CSS custom properties and references
- at-rules (media, keyframes, layers, containers)
- selector and property indexes
- parse errors and unresolved references
- optional Tailwind validator integration

### `GraphCache`

`GraphCache` is exported for LSP-style incremental workflows:

```ts
import { GraphCache } from "@drskillissue/ganko";

const cache = new GraphCache();

// per-file/version Solid graph (lazy build on cache miss)
const solidGraph = cache.getSolidGraph(path, version, () => buildSolidGraph(input));

// pre-populate cache with an already-built graph (CLI uses this)
cache.setSolidGraph(path, version, graph);

// check if a graph is cached without building
cache.hasSolidGraph(path, version); // boolean

// workspace CSS graph
const cssGraph = cache.getCSSGraph(() => buildCSSGraph(cssInput));

// derived layout graph
const layoutGraph = cache.getLayoutGraph(() => buildLayoutGraph([solidGraph], cssGraph));

// read-only access to cached graphs (returns null if not cached)
cache.getCachedCSSGraph();
cache.getCachedLayoutGraph();

// all cached SolidGraphs (for cross-file analysis)
cache.getAllSolidGraphs(); // readonly SolidGraph[]

// cross-file diagnostics cache (avoids re-running cross-file rules during typing)
cache.getCachedCrossFileDiagnostics(path);
cache.setCachedCrossFileDiagnostics(path, diagnostics);
cache.getCachedCrossFileResults();    // null when stale
cache.setCachedCrossFileResults(allDiagnostics);

// invalidation
cache.invalidate(path);   // evict by file kind (solid or css)
cache.invalidateAll();     // full eviction

// introspection
cache.solidCount;  // number of cached SolidGraphs
```

## Tailwind And Policy Configuration

### Tailwind class validation

`resolveTailwindValidator` is exported for resolving Tailwind CSS class validators. Cross-file undefined-class checks use Tailwind validation when available.

### Accessibility policy

`setActivePolicy(name)` sets the active accessibility policy template. Supported names:

- `wcag-aa`
- `wcag-aaa`
- `mobile-first`
- `dense-ui`
- `large-text`

Policy-aware rules include CSS and JSX style threshold checks (contrast, spacing, touch target, typography).

## ESLint Integration

Use the dedicated subpath export:

```js
// eslint.config.mjs
import solid from "@drskillissue/ganko/eslint-plugin";

export default [
  ...solid.configs.recommended,
  {
    rules: {
      "solid/signal-call": "error",
      "solid/no-transition-all": "off",
    },
  },
];
```

Notes:

- Rule names are `solid/<rule-id>`.
- `configs.recommended` scopes Solid, CSS, and cross-file rules to matching file globs.

## Rule Manifest (Metadata-Only)

For docs/UI/config tools, import metadata without loading full analysis code:

```ts
import { RULES, RULES_BY_CATEGORY, getRule } from "@drskillissue/ganko/rules-manifest";

const allRules = RULES;
const reactivityRules = RULES_BY_CATEGORY["reactivity"];
const signalCall = getRule("signal-call");
```

Manifest generation command:

```bash
bun run --cwd packages/ganko generate
```

## Rule Catalog (Current Manifest)

<!-- BEGIN AUTO-GENERATED:rule-catalog -->
Totals:

- 164 rules total
- 101 Solid rules, 33 CSS rules, 30 cross-file rules
- 23 fixable rules

Category breakdown:

| Category | Count |
|----------|:-----:|
| `correctness` | 14 |
| `css-a11y` | 6 |
| `css-animation` | 6 |
| `css-cascade` | 5 |
| `css-jsx` | 15 |
| `css-layout` | 15 |
| `css-property` | 7 |
| `css-selector` | 5 |
| `css-structure` | 4 |
| `jsx` | 10 |
| `performance` | 51 |
| `reactivity` | 16 |
| `solid` | 10 |

For full, up-to-date rule IDs and descriptions, read the generated manifest via API:

```ts
import { RULES, RULES_BY_CATEGORY } from "@drskillissue/ganko/rules-manifest"

const allRules = RULES
const cssLayoutRules = RULES_BY_CATEGORY["css-layout"]

for (const rule of cssLayoutRules) {
  console.log(`${rule.id} [${rule.plugin}/${rule.severity}] - ${rule.description}`)
}
```
<!-- END AUTO-GENERATED:rule-catalog -->

## Architecture

```text
src/
  index.ts                   Public SDK exports
  graph.ts                   Graph/plugin contracts and rule metadata shape
  diagnostic.ts              Diagnostic and fix models
  runner.ts                  Plugin runner + rule override emit wrapper
  suppression.ts             Inline suppression parser and emit filter
  cache.ts                   Versioned graph cache for incremental workflows
  eslint-adapter.ts          Shared diagnostic -> ESLint adapter utilities
  eslint-plugin.ts           Aggregated ESLint plugin entry
  rules-manifest.ts          Metadata-only manifest re-export
  generated/
    rules-manifest.ts        Auto-generated manifest

  solid/
    index.ts                 Solid barrel exports
    plugin.ts                SolidPlugin, analyzeInput, buildSolidGraph
    parse.ts                 parseFile/parseContent/parseContentWithProgram
    impl.ts                  SolidGraph implementation
    input.ts                 SolidInput
    rule.ts                  Solid rule contract
    phases/                  Graph build phases
    entities/                Solid entity models
    queries/                 Solid query helpers
    rules/                   Solid rule implementations
    typescript/              Type resolver integration
    util/                    Solid helpers
    eslint-plugin.ts         Solid-rule ESLint adapter

  css/
    index.ts                 CSS barrel exports
    plugin.ts                CSSPlugin, analyzeCSSInput, buildCSSGraph
    impl.ts                  CSSGraph implementation
    input.ts                 CSSInput/CSSOptions
    rule.ts                  CSS rule contract
    intern.ts                String interning for CSS identifiers
    layout-taxonomy.ts       Layout-affecting property classification
    library-analysis.ts      Dependency custom property scanning
    parser/                  CSS value/parser helpers
    phases/                  CSS graph build phases
    entities/                CSS entity models
    queries/                 CSS query helpers
    rules/                   CSS rule implementations
    tailwind.ts              Tailwind validator integration
    policy.ts                Accessibility policy templates and active policy
    analysis/                Additional CSS analysis modules
    eslint-plugin.ts         CSS-rule ESLint adapter

  cross-file/
    index.ts                 Cross-file barrel exports
    plugin.ts                CrossFilePlugin, analyzeCrossFileInput, runCrossFileRules
    rule.ts                  Cross-rule contract
    queries.ts               Cross-file utility queries
    rules/                   Cross-file rule implementations
    layout/                  Layout graph + scoring/detection pipeline
    eslint-plugin.ts         Cross-file ESLint adapter

  util/
    query-ops.ts             Shared query operation helpers

scripts/
  generate-rules-manifest.ts
  generate-rule-readmes.ts
```

## Development

From monorepo root:

```bash
bun run --cwd packages/ganko generate
bun run --cwd packages/ganko build
bun run --cwd packages/ganko test
bun run --cwd packages/ganko lint
bun run --cwd packages/ganko tsc
```

From `packages/ganko` directly:

```bash
bun run generate
bun run build
bun run test
bun run test:watch
bun run lint
bun run tsc
```

## License

MIT
