# ganko

Language Server Protocol (LSP) server for Solid.js projects. `ganko` powers diagnostics and editor intelligence for Solid and CSS files, including cross-file analysis.

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

## CLI Usage

### Language Server

```bash
# Start server over stdio
npx ganko

# If installed globally
ganko

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

Exit codes: `0` clean, `1` errors found (or warnings exceeded `--max-warnings`), `2` invalid arguments.

Note: the bundled CLI entrypoint uses `#!/usr/bin/env bun`, so `bun` must be available on `PATH` when invoking `ganko` directly.

## Editor Integration

### VS Code

Use the `ganko-vscode` extension, which bundles and configures this server.

### Neovim

```lua
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

configs.solid_lsp = {
  default_config = {
    cmd = { 'ganko' },
    filetypes = { 'typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'css', 'scss', 'sass', 'less' },
    root_dir = lspconfig.util.root_pattern('package.json', 'tsconfig.json', 'eslint.config.mjs', 'eslint.config.js', 'eslint.config.cjs'),
  },
}

lspconfig.solid_lsp.setup{}
```

### Other Editors

Use stdio transport and launch `ganko` (or `npx ganko`) as your language server command.

## Programmatic API

### Server

```typescript
import { createServer, startServer, main, buildServerCapabilities } from "ganko";

const server = createServer();
startServer(server);

// CLI-style startup
main();

const capabilities = buildServerCapabilities();
```

### Project (without LSP transport)

```typescript
import { createProject } from "ganko";
import { SolidPlugin, CSSPlugin } from "ganko";

const project = createProject({
  rootPath: "/path/to/workspace",
  plugins: [SolidPlugin, CSSPlugin],
});

const diagnostics = project.run(["src/App.tsx"]);
const languageService = project.getLanguageService("src/App.tsx");

project.updateFile("src/App.tsx", "<updated content>");
project.setRuleOverrides({ "signal-call": "error" });
project.dispose();
```

### TypeScript Project Service

```typescript
import {
  createTypeScriptProjectService,
  type TypeScriptProjectService,
} from "ganko";

const service: TypeScriptProjectService = createTypeScriptProjectService({
  tsconfigRootDir: "/path/to/workspace",
});

service.getProgramForFile("src/App.tsx");
service.getLanguageServiceForFile("src/App.tsx");
service.getScriptVersionForFile("src/App.tsx");
service.updateFile("src/App.tsx", "<updated content>");
service.closeFile("src/App.tsx");
service.dispose();
```

### Exported Handler Functions

`ganko` exports these handler functions:

- `handleDefinition`
- `handleReferences`
- `handlePrepareRename`
- `handleRename`
- `handleHover`
- `handleCompletion`
- `handleCodeAction`
- `handleSignatureHelp`
- `handleDocumentHighlight`
- `handleLinkedEditingRanges`
- `handleFoldingRanges`
- `handleSelectionRange`

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

## Custom Request

`ganko` implements a custom request for reactive graph visualization:

- Method: `solid/showReactiveGraph`
- Params:

```json
{
  "textDocument": {
    "uri": "file:///absolute/path/to/file.tsx"
  }
}
```

- Result: `{ mermaid, dot, nodes, edges }` or `null`

## Architecture

```
src/
  index.ts                  Public API exports
  core/
    project.ts              Project runner wrapper
    project-service.ts      TypeScript project service wrapper
    file-index.ts           Workspace file indexing by kind
    eslint-config.ts        ESLint rule override loading + merging
    analyze.ts              Shared diagnostic pipeline (single-file + cross-file)
    logger.ts               LSP and CLI logger backends for @ganko/shared Logger interface
  cli/
    lint.ts                 Headless lint command
    format.ts               Output formatters (text + JSON)
  server/
    index.ts                Server barrel exports
    connection.ts           LSP wiring, routing, diagnostics pipeline
    capabilities.ts         Advertised LSP capabilities
    gc-timer.ts             Periodic garbage collection scheduler
    memory-watcher.ts       Heap usage monitor with configurable threshold
    handlers/               Feature handlers + lifecycle/document handlers
bin/
  ganko.js              CLI entrypoint (LSP server + lint subcommand)
test/
  cli/                      Lint command unit + integration tests
  core/                     ESLint config, project service unit tests
  integration/              LSP integration tests
  helpers/                  Test utilities and server pool
  fixtures/                 Test project fixtures
```

## Development

```bash
# Build
bun run --cwd packages/ganko build

# Test (watch mode available via test:watch)
bun run --cwd packages/ganko test

# Type-check
bun run --cwd packages/ganko tsc
```

## Requirements

- Node.js `>=22.0.0`
- Bun (for running the packaged CLI entrypoint)

## License

MIT
