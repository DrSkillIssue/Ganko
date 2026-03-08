# AGENTS.md - Development Guidelines

TypeScript monorepo for the **ganko** toolchain: a graph-first static analysis SDK for Solid.js and CSS, with an LSP server and VS Code extension.

## Project Structure

```
packages/
  shared/    @drskillissue/ganko-shared   Shared protocol types, constants, and utilities
  ganko/     @drskillissue/ganko           Analysis SDK — graphs, rules, ESLint adapter
  lsp/       @drskillissue/ganko-lsp      Language server and CLI linter
  vscode/    ganko-vscode    VS Code extension (private, not published)
```

## Build & Development Commands

```bash
# From root — full project
bun run build           # Build all packages (sequential: shared → ganko → lsp → vscode)
bun run test            # Run all tests (ganko only — 1476 tests)
bun run lint            # Lint (enforces --max-warnings=0)
bun run tsc             # Type-check all 4 packages
bun run ci              # build + test + lint + tsc + manifest check
bun run package         # Build vscode extension (.vsix)
```

## Code Style (Enforced by ESLint)
- **Never compromise type safety**: No `any`, no non-null assertion operator (`!`), no type assertions (`as Type`), and no functions that accept *unknown* parameters.
- **NEVER use `@ts-ignore` or `@ts-expect-error`**

### Naming Conventions
- **Files:** kebab-case (`signal-call.ts`)
- **Functions/variables:** camelCase
- **Types/interfaces:** PascalCase
- **Rule IDs:** kebab-case matching filename

### Comments
- Use `/** */` for JSDoc blocks
- Explain "why", not "what"
- **No banner comments** like `// ================` (linter enforces)
- **No AI slop comments** - Do **NOT** add redundant commentary.

## Environment

- **Node.js:** >= 22.0.0
- **Package Manager:** bun@1.3.10
- **TypeScript:** ^5.9.3
- **ESLint:** ^10.0.3

## TypeScript Strictness

The root `tsconfig.json` enables:
- `noUnusedLocals`, `noUnusedParameters`
- `noImplicitReturns`
- `exactOptionalPropertyTypes`
- `noPropertyAccessFromIndexSignature`
- `isolatedModules`, `forceConsistentCasingInFileNames`

## Rule Development

**CRITICAL**: NEVER walk AST. Each plugin contains a Graph with typed entities and query methods. Use Graph API methods for rule development.

### AST Usage - TSESLint, NOT ESLint

**CRITICAL**: This project uses **TSESLint AST** (from `@typescript-eslint`), NOT vanilla ESLint AST.
- Access TypeScript APIs via `parserServices.program`
- **DO NOT** manually traverse AST in rules — use Graph API methods
- **DO NOT** assume ESLint AST node structures — check TypeScript definitions

### Auto-Generated Files

- `packages/ganko/src/generated/rules-manifest.ts` is auto-generated — fix the generator (`scripts/generate-rules-manifest.ts`) instead of editing directly.
- Run `bun run --cwd packages/ganko generate` to regenerate.
- CI checks manifest freshness via `bun run --cwd packages/ganko generate:check`.

## Zero-Tolerance Linting

The project enforces `--max-warnings=0`. Run before committing:

```bash
bun run lint && bun run tsc && bun run test
```
