# ganko

Language Server Protocol (LSP) server for Solid.js projects. `ganko` powers diagnostics and editor intelligence for TypeScript/Solid and CSS files, including cross-file analysis.

## Features

- Real-time diagnostics from `ganko` (Solid + CSS + cross-file rules)
- Definition, references, rename (prepare + execute), hover, completion, code actions
- Signature help, document highlight, linked editing, folding ranges, selection ranges
- Document symbols and workspace symbols
- Semantic tokens and inlay hints for reactive constructs
- Custom request: `solid/showReactiveGraph` (Mermaid + DOT graph payload)

Supported source extensions:

- Solid/TS/JS: `.tsx`, `.jsx`, `.ts`, `.js`, `.mts`, `.cts`, `.mjs`, `.cjs`
- Styles: `.css`, `.scss`, `.sass`, `.less`

## Installation

```bash
npm i -g @drskillissue/ganko-lsp
```

This installs the `ganko` binary, which serves as both the language server and CLI linter.

## Editor Setup

### VS Code

Install `ganko-vscode` from the VS Code marketplace. It bundles the LSP server — no separate install required.

### OpenCode

Within `opencode.json`:

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

> NOTE: You must restart opencode and LSP will **NOT** show until a file matching the above extension is read.

### Other Editors

Any editor with LSP support can use ganko. Launch `ganko --stdio` — the server communicates via JSON-RPC over stdio.

## CLI Usage

### Language Server

```bash
# Start server over stdio
npx ganko

# If installed globally
ganko

# Write server logs to a file (for debugging)
ganko --log-file /tmp/ganko.log

# CLI helpers
ganko --help
ganko --version
```

### Lint Command

Run the same analysis pipeline as the LSP server, but headless — no editor required.

```bash
# Lint entire project
ganko lint

# Lint specific files
ganko lint src/App.tsx src/Counter.tsx

# Glob patterns
ganko lint "src/**/*.tsx"

# JSON output (for CI)
ganko lint --format json

# Skip cross-file analysis (faster)
ganko lint --no-cross-file

# Fail on any warnings
ganko lint --max-warnings 0

# Custom ESLint config
ganko lint --eslint-config eslint.config.mjs

# Skip ESLint config entirely
ganko lint --no-eslint-config
```

| Option | Description |
|--------|-------------|
| `--format <text\|json>` | Output format (default: `text`) |
| `--no-cross-file` | Skip cross-file analysis |
| `--max-warnings <n>` | Exit with error if warning count exceeds `n` |
| `--eslint-config <path>` | Explicit ESLint config file path |
| `--no-eslint-config` | Ignore ESLint config |
| `--exclude <glob>` | Exclude files matching glob pattern (repeatable) |
| `--verbose`, `-v` | Enable debug-level log output |
| `--log-level <level>` | Set log level: `trace`, `debug`, `info`, `warning`, `error`, `critical`, `off` |
| `--log-file <path>` | Write logs to a file (in addition to stderr) |

Exit codes: `0` clean, `1` errors found (or warnings exceeded `--max-warnings`), `2` invalid arguments.

The CLI entrypoint uses `#!/usr/bin/env node` — only Node.js `>=22.0.0` is required on `PATH`.

## Client Settings (Initialization / Config Change)

Clients can send `ServerSettings` via `initializationOptions` and `workspace/didChangeConfiguration` under `settings.solid`.
`rules`, `useESLintConfig`, `eslintConfigPath`, and `accessibilityPolicy` directly affect rule evaluation.

```json
{
  "settings": {
    "solid": {
      "trace": "off",
      "logLevel": "info",
      "rules": { "signal-call": "error" },
      "useESLintConfig": true,
      "eslintConfigPath": "eslint.config.mjs",
      "accessibilityPolicy": "wcag-aa",
      "exclude": ["backend/**", "scripts/**"]
    }
  }
}
```

Rule override precedence:

1. VS Code/client `rules` payload
2. ESLint config overrides
3. Built-in rule defaults

## Development

```bash
# Build
bun run --cwd packages/lsp build

# Test
bun run --cwd packages/lsp test

# Type-check
bun run --cwd packages/lsp tsc
```

## Requirements

- Node.js `>=22.0.0`

## License

MIT
