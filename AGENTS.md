# AGENTS.md - Development Guidelines

TypeScript monorepo for the **ganko** toolchain: a graph-first static analysis SDK for Solid.js and CSS, with an LSP server and VS Code extension.

## Build & Development Commands

```bash
# From root — full project
bun run ci              # Build + tsc + lint + test (only run for final validation)
bun run build           # Build all packages (sequential: shared → ganko → lsp → vscode)
bun run test            # Run all tests (ganko only — 1476 tests)
bun run lint            # Lint (enforces --max-warnings=0)
bun run tsc             # Type-check all 4 packages
bun run package         # Build vscode extension (.vsix)
```

## Code Style (Enforced by ESLint)
- **Never compromise type safety**: No `any`, no non-null assertion operator (`!`), no type assertions (`as Type` (excluding `as const`)), and no functions that accept *unknown* parameters.

### Naming Conventions
- **Files:** kebab-case (`signal-call.ts`)
- **Functions/variables:** camelCase
- **Types/interfaces:** PascalCase
- **Rule IDs:** kebab-case matching filename

## Rule Development

**CRITICAL**: NEVER walk AST. Each plugin contains a Graph with typed entities and query methods. Use Graph API methods for rule development.

### Rule Development AST Usage - TSESLint, NOT ESLint

**CRITICAL**: This project uses **TSESLint AST** (from `@typescript-eslint`), NOT vanilla ESLint AST.
- **DO NOT** manually traverse AST in rules — use Graph API methods/queries.

### Auto-Generated Files

- `packages/ganko/src/generated/rules-manifest.ts` is auto-generated — fix the generator (`scripts/generate-rules-manifest.ts`) instead of editing directly.
- Run `bun run --cwd packages/ganko generate` to regenerate.
- CI checks manifest freshness via `bun run --cwd packages/ganko generate:check`.