# Phase 1: Direct `ts.Program` + SDK AST Migration

**Effort**: XL (14-20 days)

---

## New utility: `packages/ganko/src/ast-utils.ts`

```typescript
import type ts from "typescript";
import type { SourceLocation } from "./diagnostic";

export function nodeToSourceLocation(node: ts.Node, sourceFile: ts.SourceFile): SourceLocation {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.end);
  return {
    start: { line: start.line + 1, column: start.character },
    end: { line: end.line + 1, column: end.character },
  };
}

export function nodeRange(node: ts.Node, sf: ts.SourceFile): [number, number] {
  return [node.getStart(sf), node.end];
}
```

`node.getStart(sourceFile)` excludes leading trivia. `node.pos` includes it. ESTree's `range[0]` matches `getStart()`, not `pos`. Every `node.range[0]` becomes `node.getStart(sf)`. Every `node.range[1]` becomes `node.end`. 48 call sites across rules, `impl.ts:560`, `phases/entities/handlers/spread.ts:274`, `phases/entities/handlers/misc.ts:45`.

---

## `packages/ganko/src/diagnostic.ts`

Remove `import type { TSESTree as T } from "@typescript-eslint/utils"`.

Add `import type ts from "typescript"`.

Add `import { nodeToSourceLocation } from "./ast-utils"`.

### `CommentToken` (line 54-58)

Replace with:

```typescript
export interface CommentEntry {
  readonly pos: number
  readonly end: number
  readonly value: string
  readonly line: number
  readonly endLine: number
  readonly kind: ts.SyntaxKind.SingleLineCommentTrivia | ts.SyntaxKind.MultiLineCommentTrivia
}
```

### `createDiagnosticFromComment` (line 118-129)

Change parameter from `comment: CommentToken` to `comment: CommentEntry`. Compute loc from `comment.line`/`comment.endLine`:

```typescript
export function createDiagnosticFromComment(
  file: string,
  comment: CommentEntry,
  rule: string,
  messageId: string,
  message: string,
  severity: DiagnosticSeverity,
  fix?: Fix,
  suggest?: readonly Suggestion[],
): Diagnostic {
  const loc: SourceLocation = {
    start: { line: comment.line, column: 0 },
    end: { line: comment.endLine, column: 0 },
  };
  return createDiagnosticFromLoc(file, loc, rule, messageId, message, severity, fix, suggest);
}
```

### `createDiagnostic` (line 134-145)

Change `node: T.Node | T.Comment` to `node: ts.Node`. Add `sourceFile: ts.SourceFile` parameter. Replace `node.loc` with `nodeToSourceLocation(node, sourceFile)`:

```typescript
export function createDiagnostic(
  file: string,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  rule: string,
  messageId: string,
  message: string,
  severity: DiagnosticSeverity,
  fix?: Fix,
  suggest?: readonly Suggestion[],
): Diagnostic {
  return createDiagnosticFromLoc(file, nodeToSourceLocation(node, sourceFile), rule, messageId, message, severity, fix, suggest);
}
```

This cascades to ~90 rule call sites. Every `createDiagnostic(file, node, rule, ...)` becomes `createDiagnostic(file, node, graph.sourceFile, rule, ...)`.

---

## `packages/ganko/src/solid/input.ts`

Replace entire file:

```typescript
import type ts from "typescript";
import type { Logger } from "@drskillissue/ganko-shared";

export interface SolidInput {
  readonly file: string
  readonly sourceFile: ts.SourceFile
  readonly checker: ts.TypeChecker
  readonly logger?: Logger
}
```

Removed: `sourceCode`, `parserServices`, `checker: ts.TypeChecker | null`. The `| null` is gone.

---

## `packages/ganko/src/solid/entities/file.ts`

Remove `import type { TSESLint } from "@typescript-eslint/utils"`.

Add `import type ts from "typescript"`.

Change line 25: `sourceCode: TSESLint.SourceCode | null` → `sourceFile: ts.SourceFile | null`.

---

## `packages/ganko/src/solid/entities/function.ts`

Remove `import type { TSESTree as T }` import.

Add `import type ts from "typescript"`.

Line 27: `body: T.BlockStatement | T.Expression` → `body: ts.Block | ts.Expression | undefined`. `undefined` for overload signatures.

Line 60: `ParameterEntity.node: T.Parameter` → `node: ts.ParameterDeclaration`.

Line 10 (or wherever `FunctionNode` type is defined, may be in `util/function.ts`): `T.FunctionDeclaration | T.FunctionExpression | T.ArrowFunctionExpression` → `ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction`.

All `T.*` types in this file → corresponding `ts.*` types per REVIEW.md §3.

---

## `packages/ganko/src/solid/entities/call.ts`

Remove ESTree import. Add `import type ts from "typescript"`.

Line 17: `CalleeExpression = T.Expression | T.Super` → delete this alias. `ts.CallExpression.expression` is `ts.Expression` which already includes `super`. `CallEntity.callee` becomes `ts.Expression`.

All `T.CallExpression | T.NewExpression` → `ts.CallExpression | ts.NewExpression`.

---

## `packages/ganko/src/solid/entities/variable.ts`

Remove ESTree import. Add `import type ts from "typescript"`.

Line 46: `AssignmentOperator = T.AssignmentExpression["operator"]` → `type AssignmentOperator = ts.SyntaxKind`. Every site checking `operator === "="` becomes `operator === ts.SyntaxKind.EqualsToken`.

Line 53: `AssignmentEntity.node: T.Node` → `ts.Node`.

Line 55: `AssignmentEntity.value: T.Expression` → `ts.Expression`.

All `ReadEntity.node: T.Identifier` → `ts.Identifier`.

---

## `packages/ganko/src/solid/entities/scope.ts`

Remove ESTree import. Add `import type ts from "typescript"`.

Line 21: `ScopeEntity.node: T.Node | null` → `ts.Node | null`. Preserve `| null` for synthetic scopes.

Line 68: `CreateScopeArgs.node: T.Node | null` → `ts.Node | null`.

---

## `packages/ganko/src/solid/entities/jsx.ts`

Remove ESTree import. Add `import type ts from "typescript"`.

Line 17: `JSXElementEntity.node: T.JSXElement | T.JSXFragment` → `ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment`. Three-way union. Every `node.type === "JSXElement"` check must now check both `ts.isJsxElement(node)` and `ts.isJsxSelfClosingElement(node)`.

Line 65: `JSXAttributeEntity.node: T.JSXAttribute | T.JSXSpreadAttribute` → `ts.JsxAttribute | ts.JsxSpreadAttribute`.

Line 70: `valueNode: T.Node | null` → `ts.Node | null`.

Line 80: `JSXChildEntity.node: T.Node` → `ts.Node`.

Line 93: `JSXContext.containerNode: T.JSXExpressionContainer | null` → `ts.JsxExpression | null`.

Line 36-37: `SpreadProp.keyNode: T.Node` → `ts.Node`. `SpreadProp.valueNode: T.Node | null` → `ts.Node | null`.

Line 53: `SpreadInfo.callExpressionNode: T.CallExpression | null` → `ts.CallExpression | null`.

Line 55: `SpreadInfo.memberExpressionNode: T.MemberExpression | null` → `ts.PropertyAccessExpression | ts.ElementAccessExpression | null`.

Line 98: `CreateJSXElementArgs.node` → same 3-way union.

---

## `packages/ganko/src/solid/entities/export.ts`

Remove ESTree import. Add `import type ts from "typescript"`.

Line 64: `node: T.Node` → `ts.Node`.

Line 67: `loc: T.SourceLocation | null` → `SourceLocation | null`. Import `SourceLocation` from `../../diagnostic`. Construction in `phases/exports.ts:244` changes from `loc: args.node.loc ?? null` to computing via `nodeToSourceLocation(args.node, input.sourceFile)`.

---

## `packages/ganko/src/solid/entities/property-assignment.ts`

Remove ESTree import. Add `import type ts from "typescript"`.

Line 23: `node: T.AssignmentExpression` → `ts.BinaryExpression`.

Line 25: `target: T.MemberExpression` → `ts.PropertyAccessExpression | ts.ElementAccessExpression`.

Line 27: `object: T.Expression` → `ts.Expression`.

Line 29: `property: T.Expression | T.PrivateIdentifier` → `ts.Expression | ts.PrivateIdentifier`.

Line 31: `computed: boolean` → derived from `ts.isElementAccessExpression(target)`.

Line 33: `value: T.Expression` → `ts.Expression`.

Line 35: `operator: T.AssignmentExpression["operator"]` → `ts.SyntaxKind`.

---

## `packages/ganko/src/solid/entities/return-statement.ts`

Remove ESTree import. Add `import type ts from "typescript"`.

Line 14: `node: T.ReturnStatement` → `ts.ReturnStatement`.

---

## `packages/ganko/src/solid/entities/inline-import.ts`

Remove ESTree import. Add `import type ts from "typescript"`.

Line 21: `node: T.TSImportType` → `ts.ImportTypeNode`.

---

## `packages/ganko/src/solid/entities/import.ts`

Remove ESTree import. Add `import type ts from "typescript"`.

All `T.ImportDeclaration` → `ts.ImportDeclaration`. All `T.Node` → `ts.Node`.

---

## `packages/ganko/src/solid/entities/class.ts`

Remove ESTree import. Add `import type ts from "typescript"`.

All `T.ClassDeclaration | T.ClassExpression` → `ts.ClassDeclaration | ts.ClassExpression`. All `T.Node` → `ts.Node`.

---

## `packages/ganko/src/solid/entities/type-assertion.ts`

Remove ESTree import. Add `import type ts from "typescript"`.

`T.TSAsExpression | T.TSSatisfiesExpression` → `ts.AsExpression | ts.SatisfiesExpression`.

---

## `packages/ganko/src/solid/entities/non-null-assertion.ts`

Remove ESTree import. Add `import type ts from "typescript"`.

`T.TSNonNullExpression` → `ts.NonNullExpression`.

---

## `packages/ganko/src/solid/entities/spread.ts`

Remove ESTree import. Add `import type ts from "typescript"`.

All `T.Node` → `ts.Node`. All `T.SpreadElement` → `ts.SpreadElement`.

---

## `packages/ganko/src/solid/entities/computation.ts`

No direct ESTree type fields. Migrates transitively. Verify compilation after other entities migrate.

---

## `packages/ganko/src/solid/impl.ts`

Remove ESTree/TSESLint imports. Add `import type ts from "typescript"`.

### Constructor / fields

Line 171 area: `this.sourceCode = input.sourceCode` → `this.sourceFile = input.sourceFile`.

Line 178-189: `FileEntity` construction: `sourceCode: input.sourceCode` → `sourceFile: input.sourceFile`.

Line 193: position index array from `input.sourceCode.text` → `input.sourceFile.text`.

Add `readonly comments: readonly CommentEntry[]` property. In constructor: `this.comments = extractAllComments(input.sourceFile)`.

### Index maps (lines 102-134)

- `functionsByNode: Map<T.Node, ...>` → `Map<ts.Node, ...>`
- `functionsByDeclarationNode: Map<T.Node, ...>` → `Map<ts.Node, ...>`
- `callsByNode: Map<T.CallExpression | T.NewExpression, ...>` → `Map<ts.CallExpression | ts.NewExpression, ...>`
- `callsByArgNode: Map<T.Node, ...>` → `Map<ts.Node, ...>`
- `jsxByNode: Map<T.JSXElement | T.JSXFragment, ...>` → `Map<ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment, ...>`
- `classesByNode: Map<T.ClassDeclaration | T.ClassExpression, ...>` → `Map<ts.ClassDeclaration | ts.ClassExpression, ...>`
- `unaryExpressionsByOperator: Map<string, T.UnaryExpression[]>` → `Map<ts.SyntaxKind, ts.PrefixUnaryExpression[]>`
- `spreadElements: T.SpreadElement[]` → `ts.SpreadElement[]`
- `newExpressionsByCallee: Map<string, T.NewExpression[]>` → `Map<string, ts.NewExpression[]>`
- `identifiersByName: Map<string, T.Identifier[]>` → `Map<string, ts.Identifier[]>`

### WeakMap caches (lines 158-161)

All `WeakMap<T.Node, ...>` → `WeakMap<ts.Node, ...>`.

### `addScope` (line 224)

Drop second `eslintScope` parameter. New signature: `addScope(scope: ScopeEntity)`. Delete `eslintScopeMap`. Update call site in `phases/scopes.ts`.

### `positionIndex` (line 559, 586)

`addToPositionIndex` uses `node.range` → use `node.getStart(this.sourceFile)` and `node.end` via `nodeRange()`.

`PositionIndex.nodeAtOffset: Array<T.Node | null>` → `Array<ts.Node | null>`.

### All add* methods (lines 531-556)

`addUnaryExpression`, `addSpreadElement`, `addNewExpressionByCallee`, `addIdentifierReference` — all parameter types from `T.*` → `ts.*`.

---

## `packages/ganko/src/solid/typescript/index.ts`

Rewrite from class to factory function. Remove `ParserServices`, `esTreeNodeToTSNodeMap`, `initialize()` method.

```typescript
export function createTypeResolver(checker: ts.TypeChecker, logger: Logger): TypeResolver {
  // All methods take ts.Node directly
  // hasTypeInfo() returns true unconditionally
  // No map lookups — checker.getTypeAtLocation(node) directly
}
```

All 38 `this.services`/`this.typeChecker` references → direct `checker` usage. All `T.Node` parameters → `ts.Node`. `typeCache: WeakMap<T.Node, ...>` → `WeakMap<ts.Node, ...>`.

---

## `packages/ganko/src/suppression.ts`

Remove `import type { TSESLint } from "@typescript-eslint/utils"`.

Add `import type ts from "typescript"`.

### New function: `extractAllComments`

```typescript
export function extractAllComments(sourceFile: ts.SourceFile): readonly CommentEntry[] {
  const comments: CommentEntry[] = [];
  const text = sourceFile.text;
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest, false, sourceFile.languageVariant, text,
  );
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) {
      const pos = scanner.getTokenStart();
      const end = scanner.getTokenEnd();
      const raw = text.slice(pos, end);
      const value = token === ts.SyntaxKind.SingleLineCommentTrivia ? raw.slice(2) : raw.slice(2, -2);
      comments.push({
        pos, end, value,
        line: sourceFile.getLineAndCharacterOfPosition(pos).line + 1,
        endLine: sourceFile.getLineAndCharacterOfPosition(end).line + 1,
        kind: token,
      });
    }
    token = scanner.scan();
  }
  return comments;
}
```

### `parseSuppression` (line 70)

`parseSuppression(sourceCode: TSESLint.SourceCode)` → `parseSuppression(sourceFile: ts.SourceFile)`.

`sourceCode.getAllComments()` → `extractAllComments(sourceFile)`.

`comment.loc.end.line` → `comment.endLine`. `comment.loc.start.line` → `comment.line`.

### `createSuppressionEmit` (line 153)

`createSuppressionEmit(sourceCode: TSESLint.SourceCode, target: Emit)` → `createSuppressionEmit(sourceFile: ts.SourceFile, target: Emit)`.

---

## `packages/ganko/src/solid/plugin.ts`

### `analyzeInput` (line 30-33)

`createSuppressionEmit(input.sourceCode, emit)` → `createSuppressionEmit(input.sourceFile, emit)`.

### `runSolidRules` (line 42)

`(graph: SolidGraph, sourceCode: TSESLint.SourceCode, emit: Emit)` → `(graph: SolidGraph, sourceFile: ts.SourceFile, emit: Emit)`.

`createSuppressionEmit(sourceCode, emit)` → `createSuppressionEmit(sourceFile, emit)`.

### `SolidPlugin.analyze` (line 70-77)

`parseFile(file)` is deleted. The `Plugin.analyze` signature gains an optional context parameter:

```typescript
Plugin.analyze(files: readonly string[], emit: Emit, context?: { program: ts.Program })
```

`Runner` passes `context` through to each plugin. `CSSPlugin.analyze` ignores the `context` parameter — it has no TypeScript dependency. `CrossFilePlugin.analyze` uses `context.program` to replace its internal `parseFile` calls (see CrossFilePlugin migration section below). `SolidPlugin.analyze` uses `context.program` to call `createSolidInput(file, context.program)` for each file, then `buildSolidGraph(input)` and `runSolidRules(graph, input.sourceFile, emit)`.

### `analyzeInput` signature change cascade

After migration, `analyzeInput` takes `SolidInput` with `sourceFile` (not `sourceCode`). The `createSuppressionEmit(input.sourceCode, emit)` call becomes `createSuppressionEmit(input.sourceFile, emit)`. In `runSingleFileDiagnostics` (analyze.ts:128), the call becomes:

```typescript
analyzeInput(createSolidInput(key, program), emit)
```

This requires `program` to be non-null. When `program` is `null` and the file kind is `'solid'`, throw an error — the program should always be available post-migration. Do NOT fall back to creating a single-file program; this would produce degraded type information and mask configuration errors.

---

## `packages/ganko/src/solid/parse.ts`

**Delete this file.**

Replace with `packages/ganko/src/solid/create-input.ts`:

```typescript
import type ts from "typescript";
import type { Logger } from "@drskillissue/ganko-shared";
import type { SolidInput } from "./input";

export function createSolidInput(
  filePath: string,
  program: ts.Program,
  logger?: Logger,
): SolidInput {
  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) {
    throw new Error(`File not found in program: ${filePath}`);
  }
  return {
    file: filePath,
    sourceFile,
    checker: program.getTypeChecker(),
    logger,
  };
}
```

---

## `packages/ganko/src/graph.ts`

Line 72: `analyze(files: readonly string[], emit: Emit)` → `analyze(files: readonly string[], emit: Emit, context?: { program: ts.Program })`. The `context` parameter is optional to preserve backward compatibility with `CSSPlugin`. `Runner.run()` passes `{ program }` when available.

---

## `packages/ganko/src/runner.ts`

`Runner.run()` passes `{ program }` as the third argument to each `plugin.analyze(files, emit, { program })`. The `Runner` obtains the program from its `Project` instance via `project.getProgram()`. If no program is available (CSS-only run), `context` is omitted.

---

## `packages/ganko/src/solid/queries/get.ts`

Line 36-38: `getSourceCode(graph)` → rename to `getSourceFile(graph): ts.SourceFile` returning `graph.sourceFile`.

Line 40-42: `getAST(graph)` returning `graph.sourceCode.ast` → delete or merge into `getSourceFile`. Callers accessing `.body` → `.statements`.

Line 272-292: `getNodeAtPosition` — `node.type` → `ts.SyntaxKind[node.kind]` or change `NodeAtPositionInfo.type: string` → `kind: ts.SyntaxKind`. `node.loc` → compute via `nodeToSourceLocation(node, sourceFile)`. `node.name` for identifiers → `ts.isIdentifier(node) ? node.text : null`.

---

## `packages/ganko/src/solid/phases/scopes.ts`

Complete rewrite. The current implementation wraps ESLint's `ScopeManager` — after migration, scope analysis is built directly from TypeScript's AST and symbol API.

### Architecture

Single-pass `ts.forEachChild` walk maintaining a scope stack. Each scope boundary creates a `ScopeEntity`. Variable declarations create `VariableEntity` instances. Identifier references are classified as reads or writes via `ts.Symbol` from `checker.getSymbolAtLocation`.

### Scope boundary detection

Create a new `ScopeEntity` when entering:

- **Module scope**: `ts.SourceFile` — the top-level scope.
- **Function scope**: `ts.FunctionDeclaration`, `ts.FunctionExpression`, `ts.ArrowFunction`, `ts.MethodDeclaration`, `ts.Constructor`, `ts.GetAccessor`, `ts.SetAccessor`.
- **Block scope**: `ts.Block` (when parent is NOT a function body — function bodies share the function scope), `ts.ForStatement`, `ts.ForInStatement`, `ts.ForOfStatement`, `ts.CaseBlock`, `ts.CatchClause`.
- **Class scope**: `ts.ClassDeclaration`, `ts.ClassExpression`.

### Variable declaration extraction

Extract `VariableEntity` from all declaration forms:

- **`var`/`let`/`const`**: `ts.VariableDeclaration` — check `parent.parent` for `ts.VariableStatement` flags. `var` declarations are hoisted to the nearest function scope. `let`/`const` are block-scoped.
- **Function declarations**: `ts.FunctionDeclaration` — hoisted to the nearest function scope.
- **Class declarations**: `ts.ClassDeclaration` — block-scoped.
- **Import declarations**: `ts.ImportSpecifier`, `ts.ImportClause` (default import), `ts.NamespaceImport` — module-scoped.
- **Parameters**: `ts.ParameterDeclaration` — function-scoped. Traverse binding patterns recursively.
- **Catch clause variables**: `ts.CatchClause.variableDeclaration` — scoped to the catch block.

### Destructuring pattern traversal

For `ts.ObjectBindingPattern` and `ts.ArrayBindingPattern`, recursively traverse `ts.BindingElement` to extract all bound names. Each `BindingElement.name` that is a `ts.Identifier` creates a `VariableEntity`. Nested patterns (destructuring within destructuring) are handled by recursion.

### Read/write reference classification

For each `ts.Identifier` encountered during the walk:

1. Call `checker.getSymbolAtLocation(identifier)` to get the `ts.Symbol`.
2. If the symbol matches a known `VariableEntity`, classify the reference:
   - **Write**: The identifier is the LHS of an assignment (`ts.BinaryExpression` with assignment operator), the operand of `++`/`--` (`ts.PostfixUnaryExpression`/`ts.PrefixUnaryExpression`), or a `ts.ShorthandPropertyAssignment` in destructuring assignment target.
   - **Read**: All other usages — RHS of assignments, function call arguments, property access base, template literal expressions, etc.
3. Create `ReadEntity` or `WriteEntity` (via `AssignmentEntity`) accordingly.

### Hoisting rules

- `var` declarations and `function` declarations are hoisted to the nearest function (or module) scope boundary. During the walk, when a `var` or `FunctionDeclaration` is encountered inside a block scope, the variable is registered in the enclosing function scope, not the block scope.
- `let`, `const`, `class` declarations are NOT hoisted — they are registered in the current block scope.

### `eslintScopeMap` deletion and `addScope` signature

Delete the `eslintScopeMap: WeakMap` from `impl.ts`. The `addScope` call becomes single-parameter: `addScope(scope: ScopeEntity)`. All call sites in the scopes phase that previously passed `(scope, eslintScope)` now pass `(scope)` only.

---

## `packages/ganko/src/solid/phases/entities.ts`

Merged with scopes phase into `runCombinedScopeAndEntitiesPhase` per REVIEW.md §12. Scope stack is maintained during the walk so entity handlers can call `currentScope()` instead of `getScopeFor()` which had a circular dependency during the walk.

---

## `packages/ganko/src/solid/phases/exports.ts`

Line 11-12: `input.sourceCode.ast` → `input.sourceFile`. `ast.body` → `sourceFile.statements`.

Line 19: `stmt.type === "ExportNamedDeclaration"` → `ts.isExportDeclaration(stmt)`.

Line 23: `stmt.type === "ExportDefaultDeclaration"` → check for `ts.ExportAssignment` AND declarations with `ts.ModifierFlags.Export | ts.ModifierFlags.Default`. This is a structural rewrite — ESTree wraps defaults in `ExportDefaultDeclaration`; TS uses `ExportAssignment` for `export default expr` and modifier flags for `export default function`.

Line 244: `loc: args.node.loc ?? null` → `loc: nodeToSourceLocation(args.node, input.sourceFile)`.

---

## `packages/ganko/src/solid/phases/index.ts`

Merge scopes + entities into single combined phase. Phase count: 9 → 8. Prepare phase remains as a single assertion check.

---

## `packages/ganko/src/solid/phases/prepare.ts`, `context.ts`, `wiring.ts`, `reactivity.ts`, `reachability.ts`, `dependencies.ts`

All: remove ESTree imports, add `import type ts from "typescript"`. All `node.type === "..."` → `ts.is*()`. All property accesses per REVIEW.md §4.

`wiring.ts`: direct `checker` access. Unconditional type-aware execution.

---

## `packages/ganko/src/solid/phases/entities/handlers/*.ts` (~12 files)

All handlers: `call.callee` → `call.expression`. `func.params` → `func.parameters`. `decl.init` → `decl.initializer`. `decl.id` → `decl.name`. `member.object` → `.expression`. `member.property` → `.name`. All per REVIEW.md §4.

---

## `packages/ganko/src/solid/phases/entities/visitors/*.ts` (~4 files)

`visitProgram` becomes `ts.forEachChild`-based. All `node.type ===` → `ts.is*()`.

---

## `packages/ganko/src/solid/util/expression.ts` (1039 lines)

Every function uses `node.type === "..."` string checks. All become `ts.is*()`. All `node.parent.type` checks change. All property accesses migrate per REVIEW.md §4. This is the largest single migration file.

---

## `packages/ganko/src/solid/util/function.ts` (309 lines)

`FunctionNode` type alias: `T.FunctionDeclaration | T.FunctionExpression | T.ArrowFunctionExpression` → `ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction`.

`isFunctionNode`: `ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)`.

`containsJSX`: `node.type === "JSXElement"` → `ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)`.

All remaining ESTree type checks in this file migrate.

---

## `packages/ganko/src/solid/util/*.ts` (remaining ~8 files)

All: remove ESTree imports, add `import type ts from "typescript"`. All node type discriminants, property access per REVIEW.md §4.

---

## `packages/ganko/src/solid/rules/**/*.ts` (~90 files)

All rules: `import type { TSESTree as T }` → `import type ts from "typescript"`.

All `node.type === "..."` → `ts.is*()`.

`sourceCode.getText(node)` → `node.getText(graph.sourceFile)`.

`sourceCode.getAllComments()` → `graph.comments`.

`sourceCode.getTokenBefore(node)` → structural analysis per REVIEW.md §7 (`findPrecedingToken` or `getArgumentRemovalRange`).

`createDiagnostic(file, node, rule, ...)` → `createDiagnostic(file, node, graph.sourceFile, rule, ...)` at ~90 call sites.

`node.range[0]` → `node.getStart(graph.sourceFile)`. `node.range[1]` → `node.end`. 48 call sites.

### `no-innerhtml.ts` runtime `ASTUtils` import

`no-innerhtml.ts:23` has a RUNTIME import `import { ASTUtils } from "@typescript-eslint/utils"`. Replace `ASTUtils.isIdentifier()` with `ts.isIdentifier()`. This is NOT a type-only import — it will cause a runtime crash if not migrated before Phase 6 removes the `@typescript-eslint/utils` dependency. The general rule migration pattern (changing `import type { TSESTree as T }` to `import type ts`) does not catch this because it is a value import, not a type import.

### `missing-jsdoc-comments` — `getSourceCode().getNodeByRangeIndex()`

`missing-jsdoc-comments` at line 259 uses `sourceCode.getNodeByRangeIndex()`. This method does not exist on `ts.SourceFile`. Replace with `ts.getTokenAtPosition(graph.sourceFile, pos)` to find the token at a given character offset. This is a rule-specific migration not covered by the general patterns.

---

## `packages/ganko/src/solid/rules/util.ts`

Remove ESTree import. Add `import type ts from "typescript"`. All node type migrations.

---

## `packages/ganko/src/cross-file/` (5 files — MISSED BY ORIGINAL PLAN)

These files import `TSESTree as T` and will fail `tsc` after `@typescript-eslint/utils` is removed:

- `cross-file/layout/element-record.ts`
- `cross-file/layout/component-host.ts`
- `cross-file/rules/jsx-no-duplicate-class-token-class-classlist.ts`
- `cross-file/rules/jsx-layout-unstable-style-toggle.ts`
- `cross-file/rules/jsx-layout-classlist-geometry-toggle.ts`

All: remove ESTree imports, add `import type ts from "typescript"`. All node type migrations per REVIEW.md §4.

### `CrossFilePlugin.analyze` migration (`cross-file/plugin.ts`)

`CrossFilePlugin.analyze` internally calls `buildSolidGraph(parseFile(file))` to build per-file graphs for cross-file analysis. The `parseFile` call must be replaced:

```typescript
// Before:
const graph = buildSolidGraph(parseFile(file));

// After:
if (!context?.program) {
  throw new Error("CrossFilePlugin requires a TypeScript program");
}
const input = createSolidInput(file, context.program);
const graph = buildSolidGraph(input);
```

This means `CrossFilePlugin.analyze` MUST accept and use the `context?: { program: ts.Program }` parameter from `Plugin.analyze`. Unlike `CSSPlugin` which truly ignores context, `CrossFilePlugin` depends on it for `parseFile` replacement. The `context.program` provides the `ts.SourceFile` and `ts.TypeChecker` that `createSolidInput` needs.

---

## `packages/ganko/src/eslint-adapter.ts`

Line 18-26: `buildSolidInputFromContext` must extract `ts.Program` from `context.sourceCode.parserServices.program`, then `program.getSourceFile(context.filename)` and `program.getTypeChecker()`.

If `parserServices.program` is `undefined` (user not using typed linting), throw with clear error message requiring typed linting. This is a breaking change — document it.

Line 133: `WeakMap<TSESLint.SourceCode, G>` stays as-is — ESLint still provides `SourceCode` as cache key.

---

## `packages/ganko/src/solid/eslint-plugin.ts`

Line 15: `buildSolidInputFromContext(context)` returns new `SolidInput` shape with `sourceFile` + `checker`.

---

## `packages/ganko/src/eslint-plugin.ts` (top-level aggregator)

Verify compilation after solid plugin migration. No direct changes expected unless imported types break.

---

## `packages/ganko/src/css/eslint-plugin.ts`

Verify it does not import from `@typescript-eslint/utils`. `context.sourceCode.getText()` is ESLint's API — stays as-is.

---

## `packages/ganko/src/index.ts`

Line 26: remove `parseFile`, `parseContent`, `parseContentWithProgram` exports.

Add `export { createSolidInput } from "./solid"`.

### `createSolidInput` export chain verification

The full export chain must be wired:

1. **`solid/create-input.ts`**: Defines and exports `createSolidInput`.
2. **`solid/index.ts`**: Add `export { createSolidInput } from "./create-input"` to the barrel file.
3. **`index.ts`**: `export { createSolidInput } from "./solid"` (added above).
4. **`@drskillissue/ganko`**: Resolved via `package.json` `"exports"` field pointing at `index.ts`.

Without step 2, the `solid/index.ts` barrel file does not re-export the new function, and `import { createSolidInput } from "@drskillissue/ganko"` in `packages/lsp` will fail at compile time.

---

## `packages/ganko/src/cache.ts`

`SolidGraph` type changes propagate. No structural change to `GraphCache` itself.

---

## `packages/lsp/src/core/project-service.ts`

**Delete this file.**

---

## `packages/lsp/src/core/batch-program.ts` (NEW)

```typescript
import ts from "typescript";

export interface BatchTypeScriptService {
  readonly program: ts.Program
  readonly checker: ts.TypeChecker
  dispose(): void
}

export function createBatchProgram(rootPath: string): BatchTypeScriptService {
  const tsconfigPath = ts.findConfigFile(rootPath, ts.sys.fileExists, "tsconfig.json");
  if (!tsconfigPath) throw new Error(`No tsconfig.json found in ${rootPath}`);
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, rootPath);
  const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
  return {
    program,
    checker: program.getTypeChecker(),
    dispose() { /* no-op for batch */ },
  };
}
```

---

## `packages/lsp/src/core/incremental-program.ts` (NEW)

`ts.createWatchCompilerHost` + `ts.createWatchProgram`. Custom `CompilerHost` with in-memory overlay for unsaved buffers.

```typescript
export interface IncrementalTypeScriptService {
  getProgram(): ts.Program
  getLanguageService(): ts.LanguageService
  updateFile(path: string, content: string): void
  dispose(): void
}
```

Implementation: in-memory content map. `readFile`/`fileExists`/`getModifiedTime` overrides serve in-memory content for open files. File change triggers rebuild via registered `watchFile` callbacks (`host.onSourceFileChanged` does not exist on `ts.WatchCompilerHost`).

---

## `packages/lsp/src/core/project.ts`

Rewire from `TypeScriptProjectService` → `BatchTypeScriptService | IncrementalTypeScriptService`.

Drop: `warmProgram`, `getScriptVersion`, `openFiles`, `closeFile`.

Gain: `getProgram(): ts.Program`, `getSourceFile(path: string): ts.SourceFile | undefined`.

---

## `packages/lsp/src/core/analyze.ts`

Remove imports of `parseContent`, `parseContentWithProgram`, `parseFile`.

`parseWithOptionalProgram` → `createSolidInput`.

`buildSolidGraphForPath`: `program.getSourceFile(path)` directly.

---

## `packages/lsp/src/core/analyze.ts` — `runSingleFileDiagnostics` migration

`runSingleFileDiagnostics` (analyze.ts:107-141) has THREE code paths that all depend on deleted parsing functions. All must be rewritten:

### Path (a): `project.run([key])` for disk-based files (line 119)

`Runner.run()` calls `SolidPlugin.analyze()` which calls `parseFile()` (deleted). After migration, `Runner.run()` passes `{ program }` to `SolidPlugin.analyze()`, which uses `createSolidInput(file, context.program)`. No changes needed in `runSingleFileDiagnostics` itself for this path — the fix is in the `Runner`/`Plugin` layer.

### Path (b): `analyzeInput(parseWithOptionalProgram(...))` for in-memory solid files (line 128)

Replace:

```typescript
// Before:
analyzeInput(parseWithOptionalProgram(key, content, program, log), emit)

// After:
if (!program) {
  throw new Error(`TypeScript program unavailable for ${key} — program must be available post-migration`);
}
analyzeInput(createSolidInput(key, program, log), emit)
```

`createSolidInput` requires a non-null `program`. When `program` is `null` (should not happen post-migration), throw an error rather than silently degrading.

### Path (c): `project.run([key])` fallback (line 138)

Same as path (a) — migrated through the `Runner`/`Plugin` layer.

### Import changes

Remove: `parseContent`, `parseContentWithProgram`, `parseFile`, `parseWithOptionalProgram`.

Add: `import { createSolidInput } from "@drskillissue/ganko"`.

---

## `packages/lsp/src/core/analyze.ts` — `buildSolidGraphForPath` migration

`buildSolidGraphForPath` (analyze.ts:84-93) calls `parseFile(path, logger)` as a fallback when no sourceFile is available. Replace the entire function body:

```typescript
export function buildSolidGraphForPath(
  path: string,
  project: Project,
  logger: Logger,
): SolidGraph {
  const program = project.getProgram();
  if (!program) {
    throw new Error(`TypeScript program unavailable — cannot build graph for ${path}`);
  }
  const input = createSolidInput(path, program, logger);
  return buildSolidGraph(input);
}
```

The `program` is obtained from the project. The fallback case (no program) throws an error — post-migration, the program is always available. The `parseFile` import is removed.

---

## `packages/lsp/src/cli/lint.ts`

Instantiate `BatchTypeScriptService`. Per-file loop: `program.getSourceFile(path)` → `createSolidInput` → `buildSolidGraph` → `runSolidRules`. No `warmProgram`, no `openClientFile`.

`runSolidRules` second argument: `sourceCode` → `sourceFile`.

---

## `packages/lsp/src/cli/daemon.ts`

This is a significant rewrite — NOT "same as lint.ts". The daemon has extensive lifecycle management that must be dismantled.

### Remove `warmProgram` calls (lines 228, 643)

`project.warmProgram(sentinel, readFileSync(sentinel, "utf-8"))` is deleted. The program is already built when `createBatchProgram` or `createIncrementalProgram` is called. The `prewarmDaemon` function at line 639-643 no longer needs to warm the program — it creates the TypeScript service directly.

### Remove `openFiles`/`closeFile` lifecycle (lines 263, 452, 265, 456)

`project.openFiles(keys)` and `project.closeFile(key)` are no longer needed without `ProjectService`. The daemon's file tracking at lines 448-462 (closing stale files that are no longer in the lint set) is eliminated entirely. The `openFiles` set maintained by the daemon is deleted.

### Remove `getScriptVersion` (lines 367-368)

`project.getScriptVersion(key)` is replaced by `contentHash(content)` from `@drskillissue/ganko-shared`. The daemon's cache invalidation compares content hashes instead of script versions.

### Rewrite `prewarmDaemon`

```typescript
function prewarmDaemon(rootPath: string): Project {
  const service = createBatchProgram(rootPath);
  return createProject(service);
}
```

No `warmProgram` call. No sentinel file. The TypeScript service is created directly.

### Remove file open/close tracking (lines 448-462)

The block that tracks which files are "open" in the ProjectService and closes stale ones is deleted. Without ProjectService, there is no concept of open/closed files — the program includes all files from `tsconfig.json`.

### Bug fix: re-parse on cache hit (lines 383-401)

The current code re-parses via `parseWithOptionalProgram` even on cache hits. After migration, cache hits skip parsing entirely — the graph is reused and `runSolidRules` is called with the current `sourceFile` from `program.getSourceFile(key)`.

---

## `packages/lsp/src/server/handlers/handler-context.ts`

Line 35: `getAST(path): T.Program | null` → `getAST(path): ts.SourceFile | null`.

---

## `packages/lsp/src/server/connection.ts`

Lines 93-96: `CachedAST` interface eliminated. `ts.SourceFile` cached by the program.

Lines 139-156: `getAST` implementation — `parseContent(path, sf.text, ...)` replaced by `return project.getSourceFile(path)`.

Lines 488, 515: AST cache invalidation removed.

`runSolidRules` calls: second argument from `sourceCode` → `sourceFile`.

### `astCache` elimination — explicit wiring removal

Remove all `astCache` references from `createServer` and its dependents:

1. **`createServer` (connection.ts:441)**: Delete `const astCache = new Map<string, CachedAST>()`.
2. **`createHandlerContext` (connection.ts:110)**: Remove the `astCache: Map<string, CachedAST>` parameter and all internal references.
3. **`evictFileCache` (connection.ts:488)**: Remove `astCache.delete(key)`.
4. **`rediagnoseAll` (connection.ts:515)**: Remove `astCache.clear()`.
5. **`CachedAST` interface (connection.ts:93-96)**: Delete entirely — `ts.SourceFile` is cached by the program.

The `getAST` implementation in `createHandlerContext` becomes `return project.getSourceFile(path)` — no intermediate cache needed.

---

## LSP Handlers using ESTree AST

`folding-ranges.ts`: `T.Program` statement iteration → `ts.SourceFile.statements`.

`selection-range.ts`: ESTree node structure → `ts.Node` with `ts.forEachChild`.

`linked-editing.ts`: JSX tag matching → `ts.JsxElement.openingElement.tagName` + `closingElement.tagName`.

`document-symbol.ts`: ESTree traversal → `ts.SourceFile` traversal.

`semantic-tokens.ts`: ESTree node types → `ts.SyntaxKind`.

`inlay-hint.ts`: ESTree node types → `ts.Node` types.

---

## `packages/lsp/tsup.config.ts`

Remove from `BUNDLED_DEPS`: `@typescript-eslint/parser`, `@typescript-eslint/project-service`, `@typescript-eslint/utils`, `@typescript-eslint/typescript-estree`, `@typescript-eslint/scope-manager`, `@typescript-eslint/types`, `@typescript-eslint/visitor-keys`.

---

## Test infrastructure: `packages/ganko/test/solid/test-utils.ts`

`parseCode` calls `parseContent` (deleted). Replace with `createTestProgram`-based helper.

### `createTestProgram` implementation

```typescript
import ts from "typescript";

const LIB_DIR = ts.getDefaultLibFilePath({});

export function createTestProgram(files: Record<string, string>): ts.Program {
  const fileMap = new Map(Object.entries(files));
  const defaultHost = ts.createCompilerHost({});

  const host: ts.CompilerHost = {
    ...defaultHost,
    getSourceFile(fileName, languageVersion) {
      const content = fileMap.get(fileName);
      if (content !== undefined) {
        return ts.createSourceFile(fileName, content, languageVersion, true);
      }
      return defaultHost.getSourceFile(fileName, languageVersion);
    },
    fileExists(fileName) {
      return fileMap.has(fileName) || defaultHost.fileExists(fileName);
    },
    readFile(fileName) {
      return fileMap.get(fileName) ?? defaultHost.readFile(fileName);
    },
  };

  return ts.createProgram({
    rootNames: [...fileMap.keys()],
    options: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.Preserve,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
    host,
  });
}
```

`skipLibCheck: true` skips semantic diagnostics on `.d.ts` files but does NOT skip loading/parsing them — the performance benefit is in type-checking time, not program creation time. Program creation cost is dominated by parsing `lib.d.ts` and resolving `node_modules` types.

### Module resolution for `solid-js`

Tests that exercise type-aware rules (e.g., wiring phase, reactivity checks) require `solid-js` declarations to be resolvable. Add resolution configuration to `createTestProgram`:

```typescript
options: {
  // ... existing options ...
  baseUrl: resolve(__dirname, "../../../.."), // workspace root
  paths: {
    "solid-js": ["node_modules/solid-js"],
    "solid-js/*": ["node_modules/solid-js/*"],
  },
  typeRoots: [resolve(__dirname, "../../../../node_modules/@types")],
}
```

Alternatively, if the test runner CWD is the workspace root, `ModuleResolutionKind.Bundler` resolves `solid-js` from `node_modules` automatically. Verify by running the full test suite from a clean checkout.

### Test performance mitigation

Share a single `CompilerHost` (with `defaultHost` cached) across tests within a file to avoid re-parsing `lib.d.ts` on every `createTestProgram` call:

```typescript
let sharedHost: ts.CompilerHost | undefined;

function getSharedHost(options: ts.CompilerOptions): ts.CompilerHost {
  if (!sharedHost) {
    sharedHost = ts.createCompilerHost(options);
  }
  return sharedHost;
}
```

Each `createTestProgram` call layers virtual file overrides on top of the shared host. This ensures `lib.d.ts` is parsed once per test file, not once per test case.

`ts.createProgram` for a single virtual file with a shared host costs ~10-50ms. Without host sharing, each call pays ~50-100ms for `lib.d.ts` parsing. Verify test suite doesn't become >5x slower. If it does, consider a test-level program cache keyed by source content hash.

### `test-utils.ts` migration

`parseCode(code, filePath)` → calls `createTestProgram({ [filePath]: code })`, returns `createSolidInput(filePath, program)`.

`buildGraph(code, filePath)` → calls `parseCode`, then `buildSolidGraph(input)`.

`checkRule` and `checkAll` cascade through `buildGraph`.

---

## Verification

1. `bun run tsc` — zero errors across all 4 packages
2. `bun run test` — all 1476 tests pass
3. `bun run lint` — zero warnings
4. Diagnostic snapshot: `ganko lint` on `/home/skill/p/bor-web/web` before AND after. Diff output. Zero regressions.
5. `parseForESLint` absent from flamechart. Per-file graph build ≤13ms.
