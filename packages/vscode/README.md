# ganko-vscode

VS Code extension for Solid.js language support, powered by `ganko` and `ganko`.

## Features

### Diagnostics and Analysis

- Solid-specific diagnostics for reactivity, correctness, and performance
- CSS and JSX policy diagnostics (including accessibility-oriented checks)
- Rule severity overrides directly from VS Code settings
- Optional ESLint config ingestion from `eslint.config.{mjs,js,cjs}`

### Navigation and Code Intelligence

- Go to definition, find references, and rename symbol
- Hover information, completions, and signature help
- Document symbols and workspace symbol search
- Document highlights, folding ranges, and selection ranges
- Linked editing for JSX tag pairs
- Code actions for fixable diagnostics

### Reactive Tooling

- Reactive graph visualization command (`Solid: Show Reactive Graph`)
- Mermaid-rendered graph panel for dependency exploration

### Editor Integration

- Semantic token support for Solid reactive constructs
- Inlay hints for reactive dependencies
- Status bar health indicator and output channel integration

### File Support

- TypeScript / JavaScript: `.ts`, `.tsx`, `.js`, `.jsx`
- Stylesheets: `.css`, `.scss`, `.sass`, `.less`

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `solid.enable` | boolean | `true` | Enable the Solid language server |
| `solid.exclude` | string[] | `[]` | Glob patterns to exclude from analysis (e.g. `["backend/**", "scripts/**"]`). Matched relative to workspace root. |
| `solid.logLevel` | string | `"info"` | Log level for the language server (`trace`, `debug`, `info`, `warning`, `error`, `critical`, `off`) |
| `solid.trace.server` | string | `"off"` | LSP trace level (`off`, `messages`, `verbose`) |
| `solid.accessibilityPolicy` | string | `"wcag-aa"` | Policy template for CSS/JSX style linting (`wcag-aa`, `wcag-aaa`, `mobile-first`, `dense-ui`, `large-text`) |
| `solid.eslintConfig.enable` | boolean | `true` | Read rule overrides from ESLint config |
| `solid.eslintConfig.path` | string | - | Custom ESLint config path (relative to workspace root). Uses auto-discovery if not set. |
| `solid.lsp.env` | object | `{}` | Environment variables passed to the LSP process |

### Rule Overrides

Rule overrides are configured per rule key as `solid.rules.<rule-id>`.

- Allowed values: `error`, `warn`, `off`, `default`
- `default` uses the built-in rule severity

Example:

```json
{
  "solid.rules.signal-call": "error",
  "solid.rules.effect-as-memo": "warn",
  "solid.rules.prefer-for": "off",
  "solid.rules.css-policy-contrast": "warn"
}
```

Severity precedence (highest to lowest):

1. VS Code `solid.rules.<rule-id>` overrides
2. ESLint config overrides (when `solid.eslintConfig.enable` is `true`)
3. Built-in rule defaults

## Commands

| Command | Description |
|---------|-------------|
| **Solid: Restart Language Server** | Restarts the language server |
| **Solid: Show Reactive Graph** | Opens a reactive dependency graph panel |
| **Solid: Show Output Channel** | Opens extension logs |
| **Solid: Show Memory Usage** | Shows language server heap usage |

## Semantic Tokens

Token types contributed by the extension:

- `solidSignal`
- `solidStore`
- `solidMemo`
- `solidDerived`
- `solidProps`
- `solidResource`
- `solidAccessor`
- `solidEffect`

Token modifiers:

- `reactive`
- `tracked`
- `declaration`

## Status Bar

The extension shows language server state in the status bar:

- `$(loading~spin) Solid LSP` - starting
- `$(check) Solid LSP` - running
- `$(circle-slash) Solid LSP` - stopped
- `$(error) Solid LSP` - error

Click the status bar item to open the output channel.

## Architecture

```
src/
  extension.ts          Entry point and lifecycle orchestration
  client.ts             LanguageClient setup, restart throttling, state handling
  config.ts             VS Code config -> LSP settings mapping
  commands.ts           Command registration
  reactive-graph.ts     Reactive graph webview integration
  status-bar.ts         Status bar state mapping
  server-path.ts        Bundled server discovery
  log.ts                OutputChannel-backed logger
  protocol.ts           Custom request/response types
  vscode-types.ts       VS Code contribution type definitions
  webview/
    reactive-graph.html Webview template
```

## Development

### Build

```bash
# From monorepo root
bun install
bun run --cwd packages/ganko-vscode build
```

### Local Testing

1. Build the extension:

   ```bash
   bun run --cwd packages/ganko-vscode build
   ```

2. Open this repository in VS Code.
3. Press `F5` to launch an Extension Development Host.
4. Open a Solid project in the new window.

### Package

```bash
bun run --cwd packages/ganko-vscode package
```

This produces a `.vsix` file in `packages/ganko-vscode/`.

## Workspace Trust

This extension requires a trusted workspace. It does not activate in untrusted workspaces.

## Requirements

- VS Code `>=1.105.0`
- Node.js `>=22.0.0`
