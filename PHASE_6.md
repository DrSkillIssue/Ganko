# Phase 6: Bundle Size + Cold Start Cleanup

**Effort**: S (half day)
**Depends on**: Phase 1 (ESTree deps removed from code)
**Independent value**: 2-4MB smaller bundle. ~200ms faster worker/CLI cold start.

---

## Dependency removal analysis

### `packages/ganko/package.json` (SDK)

Current dependencies:

```json
{
  "@typescript-eslint/parser": "^8.57.0",
  "@typescript-eslint/typescript-estree": "^8.57.0",
  "@typescript-eslint/utils": "^8.57.0",
  "postcss": "^8.5.8",
  "postcss-safe-parser": "^7.0.1",
  "postcss-scss": "^4.0.9",
  "postcss-value-parser": "^4.2.0",
  "zod": "^4.3.6"
}
```

After Phase 1:

| Package | Action | Reason |
|---------|--------|--------|
| `@typescript-eslint/parser` | **Remove** | `parseForESLint` is deleted. No code calls the parser. |
| `@typescript-eslint/typescript-estree` | **Remove** | `simpleTraverse` import in `parse.ts` is deleted with the file. |
| `@typescript-eslint/utils` | **Keep (ESLint adapter only)** | `eslint-adapter.ts` imports `TSESLint` for `RuleModule`, `RuleContext` types. `eslint-plugin.ts` imports `TSESLint`. These types are needed for the ESLint integration surface — users run ganko rules through ESLint. |
| `postcss` | Keep | CSS analysis |
| `postcss-safe-parser` | Keep | CSS analysis |
| `postcss-scss` | Keep | CSS analysis |
| `postcss-value-parser` | Keep | CSS analysis |
| `zod` | Keep | Schema validation |

**Important**: `@typescript-eslint/utils` must remain as a dependency, NOT a devDependency. The ESLint adapter is part of the published SDK (`exports["./eslint-plugin"]`). ESLint users who `import ganko from "@drskillissue/ganko/eslint-plugin"` need the `TSESLint` types at runtime for ESLint rule registration.

However, the ESLint adapter only uses `TSESLint` types (type-level imports). At runtime, `@typescript-eslint/utils` is needed only because ESLint's internal rule runner type-checks rule definitions against `TSESLint.RuleModule`. The actual runtime import is `import type { TSESLint }` — type-only, erased at compile time.

**BUT**: `tsup` bundles the SDK. If `@typescript-eslint/utils` is not in `dependencies`, it won't be installed when a user installs `@drskillissue/ganko`. Since all ganko imports of `@typescript-eslint/utils` are `import type`, they're erased — the bundle doesn't contain any `@typescript-eslint/utils` code. So it can safely be moved to `devDependencies` IF the bundle is self-contained.

Verify: after `bun run build`, check if `dist/eslint-plugin.js` contains any `require("@typescript-eslint/utils")` calls. If not, move to `devDependencies`.

Post-Phase 1 `package.json`:

```json
{
  "dependencies": {
    "postcss": "^8.5.8",
    "postcss-safe-parser": "^7.0.1",
    "postcss-scss": "^4.0.9",
    "postcss-value-parser": "^4.2.0",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@drskillissue/ganko-shared": "workspace:^",
    "@typescript-eslint/rule-tester": "^8.57.0",
    "@typescript-eslint/utils": "^8.57.0"
  },
  "peerDependencies": {
    "typescript": "^5.9.3"
  }
}
```

### `packages/lsp/package.json` (LSP/CLI)

Current devDependencies:

```json
{
  "@typescript-eslint/parser": "^8.57.0",
  "@typescript-eslint/project-service": "^8.57.0",
  "@typescript-eslint/utils": "^8.57.0",
  "ignore": "^7.0.5",
  "typescript": "^5.9.3",
  "vscode-languageserver": "^9.0.1",
  "vscode-languageserver-textdocument": "^1.0.12",
  "zod": "^4.3.6"
}
```

After Phase 1:

| Package | Action | Reason |
|---------|--------|--------|
| `@typescript-eslint/parser` | **Remove** | `eslint-config.ts` uses custom Zod parsing of the flat config export via direct `import()` of the config file. It does NOT use ESLint's `calculateConfigArray` and does NOT import from `@typescript-eslint/parser` at runtime. |
| `@typescript-eslint/project-service` | **Remove** | `project-service.ts` is deleted. |
| `@typescript-eslint/utils` | **Remove** | Only used for `TSESTree` type imports in `connection.ts` (`import type { TSESTree as T }`). After migration, no imports remain. |
| `ignore` | Keep | Glob ignore pattern matching |
| `typescript` | Keep | Direct `ts.Program` usage |
| `vscode-languageserver` | Keep | LSP protocol |
| `vscode-languageserver-textdocument` | Keep | Document manager |
| `zod` | Keep | Schema validation |

**Confirmed**: `eslint-config.ts` does NOT reference `@typescript-eslint/parser` at runtime. It uses direct `import()` of the config file and Zod schema validation — no ESLint API involvement.

Post-Phase 1 `package.json`:

```json
{
  "devDependencies": {
    "@drskillissue/ganko-shared": "workspace:^",
    "ignore": "^7.0.5",
    "typescript": "^5.9.3",
    "vscode-languageserver": "^9.0.1",
    "vscode-languageserver-textdocument": "^1.0.12",
    "zod": "^4.3.6"
  }
}
```


---

## `packages/lsp/tsup.config.ts` changes

Current `BUNDLED_DEPS`:

```typescript
const BUNDLED_DEPS = [
  "@drskillissue/ganko",
  "@drskillissue/ganko-shared",
  "vscode-languageserver",
  "vscode-languageserver-textdocument",
  "@typescript-eslint/parser",
  "@typescript-eslint/project-service",
  "@typescript-eslint/utils",
  "@typescript-eslint/typescript-estree",
  "@typescript-eslint/scope-manager",
  "@typescript-eslint/types",
  "@typescript-eslint/visitor-keys",
  "typescript",
  "eslint",
  "zod",
  "ignore",
] as const;
```

Post-Phase 1:

```typescript
const BUNDLED_DEPS = [
  "@drskillissue/ganko",
  "@drskillissue/ganko-shared",
  "vscode-languageserver",
  "vscode-languageserver-textdocument",
  "typescript",
  "zod",
  "ignore",
] as const;
```

Removed:
- `@typescript-eslint/parser` — no longer imported
- `@typescript-eslint/project-service` — no longer imported
- `@typescript-eslint/utils` — no longer imported
- `@typescript-eslint/typescript-estree` — no longer imported
- `@typescript-eslint/scope-manager` — `@typescript-eslint/scope-manager` is NOT listed in `packages/ganko/package.json` — it's a transitive dependency of `@typescript-eslint/parser`. Only the `packages/lsp/tsup.config.ts` BUNDLED_DEPS entry needs removal (already listed above).
- `@typescript-eslint/types` — no longer imported
- `@typescript-eslint/visitor-keys` — no longer imported
- `eslint` — `eslint-config.ts` does NOT import from `eslint` at runtime. Remove from BUNDLED_DEPS.

**Confirmed**: `eslint-config.ts` does NOT import from `eslint`. It uses direct `import()` of the user's config file and Zod schema validation. The `eslint` package is not needed in BUNDLED_DEPS.

---

## Bundle size impact

Current LSP bundle size (approximate):
- `@typescript-eslint/*` packages: ~2-3MB bundled (parser, estree, scope-manager, visitor-keys, types)
- `eslint` core: ~1MB bundled (if included)

After removal: 2-4MB reduction in `dist/entry.js` and `dist/index.js`.

Cold start improvement: less JavaScript to parse on `require()`. Node.js V8 parse time is ~1MB/100ms. 2-4MB reduction → ~200-400ms faster cold start for CLI and worker threads.

---

## ganko SDK `tsup.config.ts`

Check if the ganko SDK's tsup config also bundles `@typescript-eslint/*`:

```typescript
// packages/ganko/tsup.config.ts — verify
```

If the SDK marks `@typescript-eslint/*` as external (peer/dev dependency), no changes needed. If it bundles them via `noExternal`, the bundle shrinks by the same 2-3MB.

---

## `packages/ganko/src/solid/rules/jsx/no-innerhtml.ts` — `ASTUtils` runtime import

Line 23: `import { ASTUtils } from "@typescript-eslint/utils";`

This is a RUNTIME import (not `import type`). `ASTUtils` is used for `ASTUtils.isIdentifier()` or similar. After Phase 1, this import is replaced by `ts.isIdentifier()` — but verify it's actually migrated. If this file isn't fully migrated in Phase 1, the runtime import breaks when `@typescript-eslint/utils` is removed.

This is Phase 1's responsibility, not Phase 6's. Phase 6 verifies that Phase 1 completed all migrations before removing dependencies.

---

## Verification

1. **Bundle size**: `du -sh dist/` before and after. Expect 2-4MB reduction.
2. **No runtime `@typescript-eslint/*` imports**: `rg "@typescript-eslint" dist/ --type js` → zero matches.
3. **`bun run ci` passes**: build + test + lint + tsc + manifest check.
4. **ESLint integration**: `eslint --rule ganko/signal-call src/App.tsx` still works (the ESLint adapter uses `@typescript-eslint/utils` types at compile time only).
5. **Cold start**: `time node dist/entry.js --version` — measure. Should be ~200ms faster than pre-Phase 6.
