# Contributing

## Prerequisites

- [Bun](https://bun.sh/) >= 1.3.10
- Node.js >= 22.0.0

## Setup

```bash
git clone https://github.com/DrSkillIssue/Ganko.git
cd ganko
bun install
bun run build
```

## Development Workflow

```bash
bun run build       # Build all packages (shared → ganko → lsp → vscode)
bun run test        # Run tests (1476 tests in ganko)
bun run lint        # ESLint with --max-warnings=0
bun run tsc         # Type-check all 4 packages
```

Run all checks before submitting a PR:

```bash
bun run ci
```

## Project Structure

```
packages/
  shared/    @drskillissue/ganko-shared   Shared protocol types, constants, utilities
  ganko/     @drskillissue/ganko           Analysis SDK — graphs, rules, ESLint adapter
  lsp/       @drskillissue/ganko-lsp      Language server and CLI linter
  vscode/    ganko-vscode    VS Code extension (private)
```

## Code Standards

- No `any`, no non-null assertions (`!`), no type assertions (`as Type`)
- No `@ts-ignore` or `@ts-expect-error`
- Zero ESLint warnings (`--max-warnings=0`)
- Files: kebab-case. Functions/variables: camelCase. Types: PascalCase.
- Comments explain "why", not "what". No banner comments. No redundant commentary.

## Rule Development

Rules consume typed Graphs, not raw AST. Never walk the AST directly — use Graph API query methods. See `AGENTS.md` for details.

## Auto-Generated Files

`packages/ganko/src/generated/rules-manifest.ts` is auto-generated. Edit `scripts/generate-rules-manifest.ts` instead, then run:

```bash
bun run --cwd packages/ganko generate
```

## Changesets

This project uses [Changesets](https://github.com/changesets/changesets) for versioning.

When your PR includes user-facing changes, add a changeset:

```bash
bunx changeset
```

Select the affected packages, choose the bump type (`patch`, `minor`, `major`), and write a summary.
