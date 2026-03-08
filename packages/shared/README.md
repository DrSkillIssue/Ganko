# @drskillissue/ganko-shared

Shared protocol types, constants, and utilities for the ganko toolchain. This package defines the contracts between `ganko-vscode` (client), `@drskillissue/ganko-lsp` (server), and `ganko` (engine).

## Modules

### Configuration (`config`)

Server settings, rule severity types, and Zod-validated schemas for the LSP initialization and configuration-change boundaries.

| Export | Kind | Description |
|--------|------|-------------|
| `ServerSettingsSchema` | Zod schema | Validates `ServerSettings` with defaults for all fields |
| `ServerSettings` | type | Settings payload sent from VS Code to the LSP server |
| `ConfigurationChangePayload` | type | Shape of `workspace/didChangeConfiguration` notifications |
| `RuleSeverityOverride` | type | `"error" \| "warn" \| "off"` |
| `RuleOverrides` | type | `Record<string, RuleSeverityOverride>` |
| `RuleSeveritySettingValue` | type | `RuleSeverityOverride \| "default"` |
| `ESLintConfigResult` | type | Loaded ESLint flat config (overrides + global ignores) |
| `AccessibilityPolicy` | type | Named a11y policy template |
| `TraceLevel` | type | LSP protocol trace level |
| `ACCESSIBILITY_POLICIES` | const | `["wcag-aa", "wcag-aaa", "mobile-first", "dense-ui", "large-text"]` |
| `SEVERITY_LOOKUP` | const | String → `RuleSeverityOverride` lookup |
| `NUMERIC_SEVERITY` | const | ESLint numeric severity → `RuleSeverityOverride` |
| `ESLINT_CONFIG_FILENAMES` | const | Candidate ESLint flat config filenames in resolution order |

### Extensions (`extensions`)

File classification constants and helpers.

| Export | Kind | Description |
|--------|------|-------------|
| `SOLID_EXTENSIONS` | const | `.tsx`, `.jsx`, `.ts`, `.js`, `.mts`, `.cts`, `.mjs`, `.cjs` |
| `CSS_EXTENSIONS` | const | `.css`, `.scss`, `.sass`, `.less` |
| `ALL_EXTENSIONS` | const | `SOLID_EXTENSIONS` + `CSS_EXTENSIONS` |
| `FileKind` | type | `"solid" \| "css" \| "unknown"` |
| `matchesExtension(path, extensions)` | fn | Check if a path ends with any extension in the list |
| `classifyFile(path)` | fn | Classify a path by extension (`.d.ts` → `"unknown"`) |
| `extensionsToGlobs(extensions)` | fn | `[".ts"] → ["**/*.ts"]` |
| `extensionsToWatcherGlob(extensions)` | fn | `[".ts", ".css"] → "**/*.{ts,css}"` |

### Logging (`log`)

Structured logger with runtime-adjustable level thresholds.

| Export | Kind | Description |
|--------|------|-------------|
| `Logger` | interface | Read-only logging interface with `enabled` guard |
| `LeveledLogger` | interface | `Logger` + mutable `setLevel()` |
| `LogWriter` | interface | Environment-specific output adapter |
| `LogLevel` | type | `"trace" \| "debug" \| "info" \| "warning" \| "error" \| "critical" \| "off"` |
| `noopLogger` | const | Silent logger (tests, disabled contexts) |
| `createLogger(writer, level?)` | fn | Create a `LeveledLogger` backed by a `LogWriter` |
| `parseLogLevel(raw, fallback)` | fn | Validate a string into `LogLevel` |

### Path (`path`)

URI/path conversion with canonical caching.

| Export | Kind | Description |
|--------|------|-------------|
| `canonicalPath(path)` | fn | Symlink-resolved, absolute path with bounded cache (10k entries) |
| `uriToPath(uri)` | fn | `file://` URI → canonical file system path |
| `pathToUri(path)` | fn | File system path → `file://` URI |

### Cross-File (`cross-file`)

| Export | Kind | Description |
|--------|------|-------------|
| `CROSS_FILE_DEPENDENTS` | const | `Record<FileKind, Set<FileKind>>` — when a file of kind K changes, which open file kinds need re-diagnosis |

### Memory (`memory`)

Runtime-agnostic memory monitoring. Uses `bun:jsc` on Bun for object counts, falls back to `process.memoryUsage()` on Node.

| Export | Kind | Description |
|--------|------|-------------|
| `MemorySnapshot` | interface | Point-in-time memory measurement |
| `MemorySnapshotFormatted` | interface | MB-formatted snapshot for display |
| `takeMemorySnapshot()` | fn | Capture current memory state |
| `formatSnapshot(snapshot)` | fn | Raw snapshot → formatted snapshot |
| `snapshotToLogLine(snapshot)` | fn | Raw snapshot → single log line |
| `HighWaterMarkTracker` | class | Tracks named metrics, reports growth above threshold |
| `triggerGC()` | fn | Full GC if available (Bun or `--expose-gc`) |

### Utilities (`util`)

General-purpose string, CSS, HTML, and parsing utilities. This module re-exports from specialized submodules:

- **chars** — Character code constants (`CHAR_SPACE`, `CHAR_DOT`, etc.) and classification functions (`isDigit`, `isHexDigit`, `isWhitespace`, `isIdentChar`, etc.)
- **string** — Fast string splitting (`splitByComma`, `splitSelectorList`, `splitMediaQueries`), trimming (`trimFast`, `getTrimBounds`), classification (`isBlank`, `isCSSFile`, `isKebabCase`), and bracket-aware search (`findMatchingParen`, `findClosingParenRobust`, `indexOfAtDepthZero`)
- **string-intern** — `StringInterner` for deduplicating repeated strings in hot paths
- **html** — `HTML_VOID_ELEMENTS`, `HEADING_ELEMENTS`, `isVoidElement`, `isDomElement`
- **patterns** — Compiled regex patterns for CSS selectors, media queries, animation values, function calls, and glob matching (`matchesGlobPattern`, `matchesAnyGlobPattern`)
- **animation** — CSS animation value classification (`isAnimationKeyword`, `isTimingFunction`, `extractKeyframeNames`)
- **inline-style-parser** — Inline style string parser (`parseInlineStyle`)
- **is-html** — HTML content detection heuristic
- **known-css-properties** — Set of valid CSS property names (`knownCSSProperties`)
- **style-to-object** — Inline style string → object converter (`styleToObject`)
- **hash** — Content hashing (`computeContentHash`, `simpleHash`)

## Requirements

- Node.js `>=22.0.0`

## Architecture

```text
src/
  index.ts           Public API barrel (explicit exports only)
  config.ts          ServerSettings, severity types, Zod schemas
  extensions.ts      File extension constants and classification
  log.ts             Logger interface and factory
  path.ts            URI/path conversion with canonical cache
  cross-file.ts      Cross-file dependency model
  memory.ts          Memory snapshot and high-water-mark tracking

  util/
    index.ts         Utility barrel
    chars.ts         Character code constants and classification
    string.ts        String splitting, trimming, classification
    string-intern.ts String interning
    html.ts          HTML element constants
    patterns.ts      Compiled regex patterns
    animation.ts     CSS animation value helpers
    inline-style-parser.ts  Inline style parser
    is-html.ts       HTML content detection
    known-css-properties.ts CSS property set
    style-to-object.ts      Style string → object
    hash.ts          Content hashing
```

## Development

From monorepo root:

```bash
bun run --cwd packages/shared build
bun run --cwd packages/shared tsc
```

From `packages/shared` directly:

```bash
bun run build
bun run tsc
```

## License

MIT
