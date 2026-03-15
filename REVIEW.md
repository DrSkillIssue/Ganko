# Phase 2: Migrate Graph Pipeline from ESTree to TypeScript's Native AST

**Estimated Impact**: Eliminates the entire ESTree conversion layer — 6.4-13.1s for a 230-file project. Parent pointers are free. Type resolution is direct (no ESTree↔TSNode mapping). Per-file parse cost drops to zero for files in the program.

**Effort**: `XL` (every entity type, phase, query, rule, and utility in the ganko SDK)

**Depends on**: Phase 1 (direct `ts.Program` — provides `ts.SourceFile` instances and `ts.TypeChecker`)

---

## Problem

Ganko's graph pipeline is built on `@typescript-eslint`'s ESTree AST. Every file goes through:

1. `parseForESLint(content, { programs: [program] })` — converts TypeScript's internal AST to ESTree (~15-30ms/file)
2. `simpleTraverse(ast, ..., true)` — walks the entire ESTree to set parent pointers (~1-2ms/file)
3. `analyze(ast, options)` — builds the ESLint scope manager (~2-5ms/file)
4. `new SourceCode(...)` — wraps AST + scope manager
5. `TypeResolver.initialize(parserServices)` — stores the `esTreeNodeToTSNodeMap` so that every subsequent type query requires a map lookup to translate ESTree nodes back to TypeScript nodes

This pipeline exists because ganko originated as an ESLint plugin. It is now a standalone SDK with its own graph, phases, rules, CLI, daemon, and LSP server. The ESTree layer is pure overhead:

- **TypeScript already parsed the files** during `ts.createProgram`. The `ts.SourceFile` instances exist with full ASTs, parent pointers set, and binding complete. `parseForESLint` re-parses the same content to produce a *different* AST representation.
- **Parent pointers are free** on `ts.Node` when `setParentNodes: true` (always the case for program-provided source files). The `simpleTraverse` walk exists solely because the ESTree converter discards them.
- **Type resolution round-trips** through a map. `typeResolver.getType(esTreeNode)` looks up `esTreeNodeToTSNodeMap.get(esTreeNode)` to find the corresponding `ts.Node`, then calls `checker.getTypeAtLocation(tsNode)`. Operating on `ts.Node` directly eliminates the map lookup.
- **The scope manager duplicates work** that TypeScript's binder already performed. TypeScript resolves symbols, tracks declarations and references, and builds scope chains during binding. The `@typescript-eslint/scope-manager` re-derives this from the ESTree AST.

For 230 files: steps 1-4 cost **6.4-13.1s** of the 44s total. This time is eliminated entirely — not reduced, eliminated — because `program.getSourceFile(path)` returns the already-parsed `ts.SourceFile` in O(1).

---

## 1. `SolidInput` — New Interface

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

Removed:
- `sourceCode: TSESLint.SourceCode` — replaced by `sourceFile: ts.SourceFile`
- `parserServices: Partial<ParserServices> | null` — eliminated; the node IS the TypeScript node, no mapping needed
- `checker: ts.TypeChecker | null` — the `| null` is gone; every execution path provides a `ts.TypeChecker` because every path has a `ts.Program` (mandated by Phase 1)

Construction at every call site:

```typescript
const sourceFile = program.getSourceFile(canonicalPath(filePath));
const checker = program.getTypeChecker();
const input: SolidInput = { file: filePath, sourceFile, checker };
```

No parse call. No conversion. `program.getSourceFile()` is an O(1) hash map lookup returning an already-parsed, already-bound `ts.SourceFile` with parent pointers set.

---

## 2. `SolidGraph` — Core Changes

```typescript
export class SolidGraph {
  readonly kind = "solid" as const;
  readonly file: string;
  readonly logger: Logger;

  readonly sourceFile: ts.SourceFile;
  readonly checker: ts.TypeChecker;
  readonly typeResolver: TypeResolver;
  readonly fileEntity: FileEntity;

  // Entity arrays — node types change from TSESTree.* to ts.*
  readonly functions: FunctionEntity[] = [];
  readonly calls: CallEntity[] = [];
  readonly jsxElements: JSXElementEntity[] = [];
  // ... all other entity arrays ...

  // Index maps — key types change
  readonly callsByNode = new Map<ts.CallExpression | ts.NewExpression, CallEntity>();
  readonly jsxByNode = new Map<ts.JsxElement | ts.JsxFragment | ts.JsxSelfClosingElement, JSXElementEntity>();
  readonly functionsByNode = new Map<ts.Node, FunctionEntity>();
  // ... all other index maps ...

  constructor(input: SolidInput) {
    this.file = input.file;
    this.logger = input.logger ?? noopLogger;
    this.sourceFile = input.sourceFile;
    this.checker = input.checker;
    this.typeResolver = createTypeResolver(input.checker, this.logger);
    // ...
  }
}
```

Key change: `typeResolver` takes `ts.TypeChecker` directly at construction. No conditional initialization. No `parserServices`. No `esTreeNodeToTSNodeMap`.

---

## 3. Entity Type Definitions — Node Type Migration

Every entity interface changes its `node` field from ESTree types to TypeScript types. The mapping:

| Entity | Current `node` type | New `node` type |
|--------|-------------------|----------------|
| `CallEntity` | `T.CallExpression \| T.NewExpression` | `ts.CallExpression \| ts.NewExpression` |
| `FunctionEntity` | `T.FunctionDeclaration \| T.FunctionExpression \| T.ArrowFunctionExpression` | `ts.FunctionDeclaration \| ts.FunctionExpression \| ts.ArrowFunction` |
| `JSXElementEntity` | `T.JSXElement \| T.JSXFragment` | `ts.JsxElement \| ts.JsxSelfClosingElement \| ts.JsxFragment` |
| `JSXAttributeEntity` | `T.JSXAttribute \| T.JSXSpreadAttribute` | `ts.JsxAttribute \| ts.JsxSpreadAttribute` |
| `ImportEntity` | `T.ImportDeclaration` | `ts.ImportDeclaration` |
| `ExportEntity` | `T.ExportNamedDeclaration \| T.ExportDefaultDeclaration` | `ts.ExportDeclaration \| ts.ExportAssignment` |
| `VariableEntity` | `declarations: T.Node[]`, `reads: ReadEntity[]` | `declarations: ts.Node[]`, `reads: ReadEntity[]` |
| `ReadEntity` | `node: T.Identifier` | `node: ts.Identifier` |
| `ScopeEntity` | `node: T.Node` | `node: ts.Node` |
| `TypeAssertionEntity` | `node: T.TSAsExpression \| T.TSSatisfiesExpression` | `node: ts.AsExpression \| ts.SatisfiesExpression` |
| `NonNullAssertionEntity` | `node: T.TSNonNullExpression` | `node: ts.NonNullExpression` |

JSX structural difference: ESTree represents `<Foo />` as a `JSXElement` with empty children. TypeScript has a distinct `ts.JsxSelfClosingElement` type. `JSXElementEntity.node` must accept both `ts.JsxElement` (has opening+closing) and `ts.JsxSelfClosingElement`. This is reflected in the union type above.

---

## 4. Node Type Discriminants — `ts.SyntaxKind` Replaces String Checks

Every `node.type === "..."` check becomes a `ts.is*` type guard or `node.kind === ts.SyntaxKind.*` check.

**Systematic migration patterns**:

```typescript
// BEFORE                                    // AFTER
node.type === "CallExpression"              → ts.isCallExpression(node)
node.type === "Identifier"                  → ts.isIdentifier(node)
node.type === "ArrowFunctionExpression"     → ts.isArrowFunction(node)
node.type === "FunctionDeclaration"         → ts.isFunctionDeclaration(node)
node.type === "FunctionExpression"          → ts.isFunctionExpression(node)
node.type === "VariableDeclarator"          → ts.isVariableDeclaration(node)
node.type === "VariableDeclaration"         → ts.isVariableStatement(node)
node.type === "MemberExpression"            → ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
node.type === "ObjectExpression"            → ts.isObjectLiteralExpression(node)
node.type === "ArrayExpression"             → ts.isArrayLiteralExpression(node)
node.type === "TemplateLiteral"             → ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)
node.type === "JSXElement"                  → ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)
node.type === "JSXFragment"                 → ts.isJsxFragment(node)
node.type === "JSXExpressionContainer"      → ts.isJsxExpression(node)
node.type === "JSXAttribute"                → ts.isJsxAttribute(node)
node.type === "JSXText"                     → ts.isJsxText(node)
node.type === "ImportDeclaration"           → ts.isImportDeclaration(node)
node.type === "Literal"                     → ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ...
node.type === "TSAsExpression"              → ts.isAsExpression(node)
node.type === "TSSatisfiesExpression"       → ts.isSatisfiesExpression(node)
node.type === "TSNonNullExpression"         → ts.isNonNullExpression(node)
node.type === "UnaryExpression"             → ts.isPrefixUnaryExpression(node)
node.type === "AssignmentExpression"        → ts.isBinaryExpression(node) && ts.isAssignmentOperator(node.operatorToken.kind)
node.type === "LogicalExpression"           → ts.isBinaryExpression(node) && isLogicalOperator(node.operatorToken.kind)
node.type === "ConditionalExpression"       → ts.isConditionalExpression(node)
node.type === "ReturnStatement"             → ts.isReturnStatement(node)
node.type === "SpreadElement"               → ts.isSpreadElement(node)
```

**Property access migration**:

```typescript
// BEFORE                                    // AFTER
call.callee                                 → call.expression
call.arguments                              → call.arguments  (same)
member.object                               → (node as ts.PropertyAccessExpression).expression
member.property                             → (node as ts.PropertyAccessExpression).name
member.computed                             → ts.isElementAccessExpression(node)
func.params                                 → func.parameters
func.body                                   → func.body  (same)
arrow.params                                → arrow.parameters
decl.init                                   → decl.initializer
decl.id                                     → decl.name
varDecl.declarations                        → (node as ts.VariableStatement).declarationList.declarations
importDecl.source.value                     → (importDecl.moduleSpecifier as ts.StringLiteral).text
jsxElement.openingElement.name              → jsxElement.openingElement.tagName
jsxAttr.name.name                           → (jsxAttr.name as ts.Identifier).text
jsxExprContainer.expression                 → jsxExpr.expression
literal.value (string)                      → (node as ts.StringLiteral).text
identifier.name                             → identifier.text
```

**Compound pattern**: ESTree's `MemberExpression` with `computed: boolean` splits into two TypeScript types. Code that currently checks `node.type === "MemberExpression" && !node.computed` becomes `ts.isPropertyAccessExpression(node)`. Code that checks `node.type === "MemberExpression" && node.computed` becomes `ts.isElementAccessExpression(node)`. Code that handles both becomes `ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)`.

**Performance note**: `ts.isCallExpression(node)` is `node.kind === ts.SyntaxKind.CallExpression` — an integer comparison. ESTree's `node.type === "CallExpression"` is a string comparison. Every discriminant check is faster after migration.

---

## 5. `node.parent` — Free on TypeScript's AST

TypeScript sets parent pointers on all nodes during parsing when `setParentNodes: true` is passed to `ts.createSourceFile`, and during binding when the type checker is invoked. Since Phase 1 ensures all `ts.SourceFile` instances come from `ts.Program`, parent pointers are guaranteed.

The 78 `node.parent` call sites require zero changes to the `.parent` access itself. They require changes only to the type checks performed on the parent:

```typescript
// BEFORE
const parent = node.parent;
if (parent?.type === "CallExpression" && parent.callee === node) { ... }

// AFTER
const parent = node.parent;
if (ts.isCallExpression(parent) && parent.expression === node) { ... }
```

The `runPreparePhase` validation reduces to:

```typescript
export function runPreparePhase(_graph: SolidGraph, input: SolidInput): void {
  const sf = input.sourceFile;
  const firstStmt = sf.statements[0];
  if (sf.statements.length > 0 && firstStmt && firstStmt.parent !== sf) {
    throw new Error("SourceFile missing parent links — file was not obtained from ts.Program");
  }
}
```

This is a structural invariant check, not a functional requirement. With Phase 1 providing all source files from `ts.Program`, parent pointers are architecturally guaranteed. The check exists as a fail-fast assertion against misuse.

---

## 6. Scope Resolution — TypeScript's Symbol System Replaces `@typescript-eslint/scope-manager`

### What the scope manager provides

The current `runScopesPhase` iterates `sourceCode.scopeManager.scopes` to build `ScopeEntity` and `VariableEntity` instances. Each `VariableEntity` has:
- `name` — from `eslintVar.name`
- `declarations` — from `eslintVar.defs[i].name`
- `reads: ReadEntity[]` — from `eslintVar.references.filter(r => r.isRead())`
- `assignments: AssignmentEntity[]` — from `eslintVar.references.filter(r => r.isWrite())`

Each `ReadEntity` has:
- `node: ts.Identifier` — the reference site
- `scope: ScopeEntity` — the scope containing the reference
- `isProperAccess` — whether the identifier is the callee of a call expression
- `isInLoop`, `isInConditional` — positional flags

### What TypeScript provides

`ts.TypeChecker` provides:
- `checker.getSymbolAtLocation(node)` → `ts.Symbol` — resolves any identifier to its declared symbol in O(1)
- `ts.Symbol.declarations` — all declaration nodes for the symbol
- `ts.Symbol.valueDeclaration` — the primary value declaration
- `ts.Symbol.flags` — `SymbolFlags.Variable`, `SymbolFlags.Function`, `SymbolFlags.FunctionScopedVariable`, etc.
- `checker.getTypeAtLocation(node)` — the type of any node

TypeScript does NOT provide a pre-computed "all references to this symbol" list. This must be built by walking the AST and resolving each identifier.

### New `runScopesPhase` implementation

The new scopes phase performs a single-pass AST walk that builds both scope entities and variable entities:

```typescript
export function runScopesPhase(graph: SolidGraph, input: SolidInput): void {
  const checker = input.checker;
  const sourceFile = input.sourceFile;
  
  // Symbol → VariableEntity map, populated during walk
  const symbolToVariable = new Map<ts.Symbol, VariableEntity>();
  
  // Scope stack, maintained during walk
  const scopeStack: ScopeEntity[] = [];
  
  function currentScope(): ScopeEntity {
    return scopeStack[scopeStack.length - 1]!;
  }
  
  function visit(node: ts.Node): void {
    // Check if this node creates a new scope
    const scopeEntity = tryCreateScope(node, graph, currentScope());
    if (scopeEntity !== null) {
      graph.addScope(scopeEntity, /* no ESLint scope */);
      scopeStack.push(scopeEntity);
    }
    
    // Collect variable declarations
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const symbol = checker.getSymbolAtLocation(node.name);
      if (symbol && !symbolToVariable.has(symbol)) {
        const variable = createVariableFromSymbol(
          graph, symbol, currentScope(), checker,
        );
        graph.addVariable(variable);
        symbolToVariable.set(symbol, variable);
      }
    }
    
    // Collect parameter declarations
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      const symbol = checker.getSymbolAtLocation(node.name);
      if (symbol && !symbolToVariable.has(symbol)) {
        const variable = createVariableFromSymbol(
          graph, symbol, currentScope(), checker,
        );
        graph.addVariable(variable);
        symbolToVariable.set(symbol, variable);
      }
    }
    
    // Collect identifier references (reads and writes)
    if (ts.isIdentifier(node) && !isDeclarationName(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol) {
        const variable = symbolToVariable.get(symbol);
        if (variable) {
          recordReference(node, variable, currentScope(), graph);
        }
      }
    }
    
    ts.forEachChild(node, visit);
    
    if (scopeEntity !== null) {
      scopeStack.pop();
    }
  }
  
  // Initialize with the module scope
  const moduleScope = createScope({
    id: graph.nextScopeId(),
    node: sourceFile,
    file: graph.fileEntity,
    kind: "program",
    parent: null,
    trackingContext: null,
    resolvedContext: UNKNOWN_CONTEXT,
  });
  graph.addScope(moduleScope);
  scopeStack.push(moduleScope);
  
  ts.forEachChild(sourceFile, visit);
}
```

Scope-creating node detection:

```typescript
function tryCreateScope(
  node: ts.Node,
  graph: SolidGraph,
  parent: ScopeEntity,
): ScopeEntity | null {
  let kind: "function" | "block" | null = null;
  
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    kind = "function";
  } else if (
    ts.isBlock(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isCaseBlock(node)
  ) {
    kind = "block";
  }
  
  if (kind === null) return null;
  
  return createScope({
    id: graph.nextScopeId(),
    node,
    file: graph.fileEntity,
    kind,
    parent,
    trackingContext: null,
    resolvedContext: parent._resolvedContext,
  });
}
```

Reference classification (read vs write):

```typescript
function recordReference(
  identifier: ts.Identifier,
  variable: VariableEntity,
  scope: ScopeEntity,
  graph: SolidGraph,
): void {
  const parent = identifier.parent;
  const isWrite = isWriteReference(identifier, parent);
  const isRead = isReadReference(identifier, parent, isWrite);
  const inLoop = isInLoop(identifier);
  const inConditional = isInConditional(identifier);
  
  if (isRead) {
    variable.reads.push({
      id: graph.nextMiscId(),
      node: identifier,
      scope,
      isProperAccess: ts.isCallExpression(parent) && parent.expression === identifier,
      isInLoop: inLoop,
      isInConditional: inConditional,
    });
  }
  
  if (isWrite) {
    variable.assignments.push({
      id: graph.nextMiscId(),
      node: identifier,
      value: getAssignmentValue(identifier, parent),
      operator: getAssignmentOperator(parent),
      isInLoop: inLoop,
      isInConditional: inConditional,
    });
  }
}

function isWriteReference(identifier: ts.Identifier, parent: ts.Node): boolean {
  // Simple assignment: x = ...
  if (ts.isBinaryExpression(parent) && ts.isAssignmentOperator(parent.operatorToken.kind) && parent.left === identifier) {
    return true;
  }
  // Variable declaration initializer: const x = ...
  if (ts.isVariableDeclaration(parent) && parent.name === identifier && parent.initializer !== undefined) {
    return true;
  }
  // Prefix/postfix increment/decrement: ++x, x++
  if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) {
    const op = parent.operator;
    if (op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken) {
      return true;
    }
  }
  return false;
}

function isReadReference(identifier: ts.Identifier, parent: ts.Node, isWrite: boolean): boolean {
  // Simple assignment LHS without compound operator is write-only
  if (ts.isBinaryExpression(parent) && parent.left === identifier) {
    return parent.operatorToken.kind !== ts.SyntaxKind.EqualsToken; // compound assignment (+=, -=, etc.) is read+write
  }
  // Everything else that resolved to a symbol is a read
  return !isWrite || ts.isBinaryExpression(parent); // compound assignments are both
}
```

**Identifier classification** — distinguishing declaration names from references:

```typescript
function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return true;
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return true;
  if (ts.isParameter(parent) && parent.name === node) return true;
  if (ts.isClassDeclaration(parent) && parent.name === node) return true;
  if (ts.isImportSpecifier(parent) && parent.name === node) return true;
  if (ts.isImportClause(parent) && parent.name === node) return true;
  if (ts.isPropertyDeclaration(parent) && parent.name === node) return true;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isEnumDeclaration(parent) && parent.name === node) return true;
  if (ts.isEnumMember(parent) && parent.name === node) return true;
  if (ts.isTypeAliasDeclaration(parent) && parent.name === node) return true;
  if (ts.isInterfaceDeclaration(parent) && parent.name === node) return true;
  return false;
}
```

**What `eslintScopeMap` becomes**: The current `SolidGraph.eslintScopeMap` maps ESLint `Scope` objects to `ScopeEntity`. After migration, this map is eliminated. Scopes are tracked via the scope stack during the single-pass walk and associated with nodes directly. The `scopeForCache` (a `WeakMap<ts.Node, ScopeEntity>`) provides O(1) scope lookup for any node.

---

## 7. Text, Token, and Comment Access — `ts.SourceFile` Replaces `SourceCode`

### Text extraction (22 call sites)

```typescript
// BEFORE
sourceCode.getText(node)
sourceCode.getText()  // full file text

// AFTER
node.getText(sourceFile)              // text of a specific node (excludes leading trivia)
sourceFile.text                       // full file text
sourceFile.text.slice(node.getStart(sourceFile), node.end)  // equivalent to getText(node)
```

`node.getText(sourceFile)` calls `sourceFile.text.substring(node.getStart(sourceFile), node.end)` internally. `getStart(sourceFile)` returns the position after leading trivia (whitespace, comments). This matches ESTree's `getText` behavior.

The `SolidGraph` provides `this.sourceFile` for all call sites that currently use `this.sourceCode.getText(...)`.

### Token access (2 call sites)

`no-react-deps.ts:90` uses `sourceCode.getTokenBefore(arg)` to find a comma before a call argument for fix generation. `no-react-specific-props.ts:65` uses `sourceCode.getTokenBefore(node)` to find a token before a JSX attribute.

Both call sites need token-level information for fix range computation. Replace with positional analysis of the source text:

```typescript
function findPrecedingToken(
  position: number,
  sourceFile: ts.SourceFile,
): { kind: ts.SyntaxKind; pos: number; end: number } | null {
  const text = sourceFile.text;
  let pos = position - 1;
  // Skip whitespace backward
  while (pos >= 0 && (text.charCodeAt(pos) === 32 || text.charCodeAt(pos) === 10 || text.charCodeAt(pos) === 13 || text.charCodeAt(pos) === 9)) {
    pos--;
  }
  if (pos < 0) return null;
  const ch = text.charCodeAt(pos);
  // Comma
  if (ch === 44) return { kind: ts.SyntaxKind.CommaToken, pos, end: pos + 1 };
  // Semicolon
  if (ch === 59) return { kind: ts.SyntaxKind.SemicolonToken, pos, end: pos + 1 };
  // Open paren
  if (ch === 40) return { kind: ts.SyntaxKind.OpenParenToken, pos, end: pos + 1 };
  // For multi-character tokens, use the scanner
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, sourceFile.languageVariant, text, undefined, pos);
  const kind = scanner.scan();
  return { kind, pos: scanner.getTokenStart(), end: scanner.getTokenEnd() };
}
```

For the `no-react-deps` rule specifically: the rule removes a dependency array argument from a Solid API call. To determine if a comma precedes the argument, check whether the argument is the first in the argument list by inspecting its index in `parent.arguments`. If it's not the first argument, the fix range extends backward to include the preceding comma. This is a structural check on the call expression's argument array, not a generic token scan:

```typescript
function getArgumentRemovalRange(arg: ts.Node, call: ts.CallExpression, sourceFile: ts.SourceFile): { start: number; end: number } {
  const args = call.arguments;
  const idx = args.indexOf(arg as ts.Expression);
  if (idx === 0) {
    // First argument — remove forward to next comma or closing paren
    const nextArg = args[1];
    return { start: arg.getStart(sourceFile), end: nextArg ? nextArg.getStart(sourceFile) : arg.end };
  }
  // Not first — remove backward from previous argument's end
  const prevArg = args[idx - 1]!;
  return { start: prevArg.end, end: arg.end };
}
```

### Comment access (3 call sites: suppression, `no-banner-comments`, `no-ai-slop-comments`)

The suppression module (`suppression.ts`) and two rules iterate all comments in the file. Replace `sourceCode.getAllComments()` with scanner-based extraction:

```typescript
interface CommentEntry {
  readonly pos: number
  readonly end: number
  readonly value: string
  readonly line: number
  readonly endLine: number
  readonly kind: ts.SyntaxKind.SingleLineCommentTrivia | ts.SyntaxKind.MultiLineCommentTrivia
}

export function extractAllComments(sourceFile: ts.SourceFile): readonly CommentEntry[] {
  const comments: CommentEntry[] = [];
  const text = sourceFile.text;
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ false,
    sourceFile.languageVariant,
    text,
  );

  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      const pos = scanner.getTokenStart();
      const end = scanner.getTokenEnd();
      const raw = text.slice(pos, end);
      const value = token === ts.SyntaxKind.SingleLineCommentTrivia
        ? raw.slice(2)       // strip //
        : raw.slice(2, -2);  // strip /* */
      comments.push({
        pos,
        end,
        value,
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

This uses TypeScript's own lexer (`ts.Scanner`), which correctly handles all edge cases: comments inside template literals (not comments), regex patterns containing `//` (not comments), string literals containing `/*` (not comments). The scanner processes the file in a single linear pass with zero backtracking.

The suppression module changes:

```typescript
export function createSuppressionEmit(sourceFile: ts.SourceFile, target: Emit): Emit {
  const suppressions = parseSuppression(sourceFile);
  if (suppressions === EMPTY) return target;
  return (d) => {
    if (!isSuppressed(suppressions, d)) target(d);
  };
}

function parseSuppression(sourceFile: ts.SourceFile): Suppressions {
  const comments = extractAllComments(sourceFile);
  if (comments.length === 0) return EMPTY;
  // ... rest identical, iterating comments instead of sourceCode.getAllComments()
}
```

The `no-banner-comments` and `no-ai-slop-comments` rules receive comments via the graph. Add a `comments` property to `SolidGraph` populated during construction:

```typescript
export class SolidGraph {
  readonly comments: readonly CommentEntry[];
  
  constructor(input: SolidInput) {
    // ...
    this.comments = extractAllComments(input.sourceFile);
  }
}
```

Rules access `graph.comments` instead of `getSourceCode(graph).getAllComments()`.

---

## 8. TypeResolver — Direct Type Access, No Mapping

Current `TypeResolver` stores `esTreeNodeToTSNodeMap` and translates ESTree nodes to TypeScript nodes before every type query:

```typescript
// CURRENT
getType(esTreeNode): TypeInfo {
  const tsNode = this.esTreeNodeToTSNodeMap.get(esTreeNode);
  if (!tsNode) return UNKNOWN_TYPE;
  const type = this.checker.getTypeAtLocation(tsNode);
  // ...
}
```

After migration, the input IS a `ts.Node`. The map lookup is eliminated:

```typescript
export function createTypeResolver(checker: ts.TypeChecker, logger: Logger): TypeResolver {
  return {
    hasTypeInfo(): boolean {
      return true; // Always true — every path has a checker
    },

    getType(node: ts.Node): TypeInfo {
      const type = checker.getTypeAtLocation(node);
      return classifyType(type, checker);
    },

    isCallableType(node: ts.Node): boolean {
      const type = checker.getTypeAtLocation(node);
      return type.getCallSignatures().length > 0;
    },

    isAccessorType(node: ts.Node): boolean {
      const type = checker.getTypeAtLocation(node);
      return isAccessorTypeInternal(type, checker);
    },

    getReactiveKindWithType(declaration: ts.Node): ReactiveKind | null {
      const type = checker.getTypeAtLocation(declaration);
      return classifyReactiveType(type, checker);
    },

    isUnnecessaryCast(expression: ts.Node, assertedType: ts.Node): boolean {
      const exprType = checker.getTypeAtLocation(expression);
      const targetType = checker.getTypeAtLocation(assertedType);
      return checker.isTypeAssignableTo(exprType, targetType);
    },
    
    // ... other methods, all taking ts.Node directly
  };
}
```

The `hasTypeInfo()` method returns `true` unconditionally. There is no typeless execution path. Every rule that gates on `hasTypeInfo()` will now always execute its type-aware branch. Rules like `show-truthy-conversion`, `avoid-object-spread`, `avoid-object-assign`, and the wiring phase's assertion analysis — previously conditional — now always run.

---

## 9. Phase 1 Synergy — Zero Parse Cost

With Phase 1 providing direct `ts.Program`, and Phase 2 consuming `ts.SourceFile` directly, the per-file cost of entering the graph pipeline drops to zero:

```typescript
// CLI/daemon lint loop — after Phase 1 + Phase 2
const program = batchService.program;
const checker = program.getTypeChecker();

for (const filePath of solidFiles) {
  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) continue;
  
  const input: SolidInput = { file: filePath, sourceFile, checker };
  const graph = buildSolidGraph(input);
  runSolidRules(graph, sourceFile, emit);
}
```

`program.getSourceFile(filePath)` is an O(1) lookup into the program's internal `Map<string, ts.SourceFile>`. The `SourceFile` was already parsed and bound during `ts.createProgram`. There is no per-file parse step. The entire 6.4-13.1s ESTree conversion pipeline is gone.

For workers (Phase 3): each worker builds its own `ts.Program` from the same tsconfig. Each worker's program parses and binds all files, producing `ts.SourceFile` instances with parent pointers. Workers operate on `ts.Node` directly. No ESTree conversion in workers. No degraded typeless mode. Workers have full type checking because they have a full `ts.Program`.

---

## 10. `parseContent` and `parseContentWithProgram` — Removed

Both functions are deleted from `packages/ganko/src/solid/parse.ts`. The entire `parse.ts` module is removed. Its functionality is replaced by:

```typescript
function createSolidInput(
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

This is not a function that "parses." It retrieves an already-parsed `ts.SourceFile` from the program. The naming reflects this: `createSolidInput`, not `parseContent`.

The `parseFile` function (which reads from disk and parses) is also removed. All file reading happens during `ts.createProgram`, which reads all project files via its `CompilerHost`.

For the ESLint integration (`eslint-plugin.ts`): ESLint's `@typescript-eslint/parser` provides `parserServices.program`. The ESLint rule adapter extracts the `ts.SourceFile` from this program:

```typescript
// eslint-plugin.ts
create(context) {
  const parserServices = context.sourceCode.parserServices;
  const program = parserServices.program;
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(context.filename);
  
  const input: SolidInput = { file: context.filename, sourceFile, checker };
  const graph = buildSolidGraph(input);
  // ...
}
```

---

## 11. `@typescript-eslint/parser` Dependency

**For the ganko SDK (`packages/ganko`)**: The `@typescript-eslint/parser`, `@typescript-eslint/typescript-estree`, `@typescript-eslint/scope-manager`, and `@typescript-eslint/utils` imports are all removed. The SDK depends only on `typescript` for AST types. The `@typescript-eslint/utils` import of `TSESTree`, `TSESLint`, and `ParserServices` (present in `input.ts`, `impl.ts`, `parse.ts`, every rule file, every phase file, every query file, every utility file) is replaced with imports from `typescript`.

**For the LSP package (`packages/lsp`)**: `@typescript-eslint/parser` is retained as a dev dependency ONLY for the ESLint config loading path (`eslint-config.ts`), which evaluates the user's ESLint config to extract rule overrides. If the ESLint config loading path can be implemented without `@typescript-eslint/parser` (it loads the config via `jiti`, not via the parser), then the dependency is dropped entirely.

**For `tsup.config.ts`**: Remove `@typescript-eslint/parser`, `@typescript-eslint/project-service`, `@typescript-eslint/utils`, `@typescript-eslint/typescript-estree`, `@typescript-eslint/scope-manager`, `@typescript-eslint/types`, and `@typescript-eslint/visitor-keys` from `BUNDLED_DEPS`. This reduces the bundle size by an estimated 2-4MB, improving worker startup time (Phase 3) and CLI cold start.

**For tests**: All 1476 tests use the ESTree-based API. Every test that constructs `SolidInput`, calls `parseContent`, or checks ESTree node types must be migrated. Tests that verify rule behavior construct inputs via `createSolidInput(filePath, program)` using a test program built from fixture files.

---

## 12. Combined Single-Pass AST Walk

The current phase pipeline walks the AST multiple times:
1. `simpleTraverse` — full walk for parent pointers
2. `runScopesPhase` — iterates ESLint scopes (which themselves were built by walking the AST)
3. `runEntitiesPhase` — full walk via `visitProgram` to extract functions, calls, JSX, etc.

After migration, phases 1 and 2 are eliminated or merged. The entities phase walk becomes the single AST walk that also builds scopes and resolves variables:

```typescript
export function runCombinedScopeAndEntitiesPhase(graph: SolidGraph, input: SolidInput): void {
  const checker = input.checker;
  const sourceFile = input.sourceFile;
  const symbolToVariable = new Map<ts.Symbol, VariableEntity>();
  const scopeStack: ScopeEntity[] = [graph.firstScope!];

  function visit(node: ts.Node): void {
    // Scope tracking
    const newScope = tryCreateScope(node, graph, scopeStack[scopeStack.length - 1]!);
    if (newScope !== null) {
      graph.addScope(newScope);
      scopeStack.push(newScope);
    }

    // Variable declarations + references (scope phase work)
    if (ts.isIdentifier(node)) {
      processIdentifier(node, checker, graph, symbolToVariable, scopeStack[scopeStack.length - 1]!);
    }

    // Entity extraction (entities phase work)
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      extractCallEntity(node, graph);
    }
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      extractFunctionEntity(node, graph);
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      extractJSXEntity(node, graph);
    }
    if (ts.isImportDeclaration(node)) {
      extractImportEntity(node, graph);
    }
    // ... all other entity extraction ...

    // Position index
    graph.addToPositionIndex(node);

    ts.forEachChild(node, visit);

    if (newScope !== null) {
      scopeStack.pop();
    }
  }

  ts.forEachChild(sourceFile, visit);
}
```

One walk. Scopes, variables, references, and all entities extracted in a single pass. No `simpleTraverse`. No scope manager. No separate entities phase walk.

---

## Performance Impact

| Eliminated Component | Per-File Cost | × 230 Files |
|---------------------|--------------|-------------|
| `parseForESLint` (ESTree conversion) | 15-30ms | 3.5-6.9s |
| `simpleTraverse` (parent pointers) | 1-2ms | 0.23-0.46s |
| `analyze()` (scope manager) | 2-5ms | 0.46-1.15s |
| `SourceCode` construction | 0.5-1ms | 0.12-0.23s |
| ESTree→TSNode map lookups in TypeResolver | ~0.5ms | 0.12s |
| Second AST walk in entities phase | 2-3ms | 0.46-0.69s |
| **Total eliminated** | **21-41ms** | **4.9-9.5s** |

Retained cost per file (after migration):
- `program.getSourceFile(path)` — O(1) lookup: ~0.001ms
- `buildSolidGraph` (combined scope+entities walk): ~3-8ms (one walk instead of two, no ESTree overhead)
- `runSolidRules`: ~2-5ms

New per-file cost: **5-13ms × 230 = 1.15-3.0s** for the entire graph+rules pipeline.

---

## Verification

1. **Type safety**: `bun run tsc` — all 4 packages type-check with zero errors. Every `ts.Node` access is type-narrowed via `ts.is*` guards. No `as` casts on AST nodes.
2. **Test suite**: `bun run test` — all 1476 tests pass after migration. Tests are rewritten to construct inputs via `createSolidInput(path, program)` using programs built from fixture tsconfigs.
3. **Lint output equivalence**: `ganko lint` on the 230-file target project produces identical diagnostics before and after migration. Diff the output to confirm zero diagnostic regressions.
4. **Performance measurement**: Profile the 230-file project before and after. Verify the ESTree conversion cost is eliminated (it should not appear in the flamechart). Verify per-file graph building time is 5-13ms.
5. **LSP feature verification**: hover, definition, completion, semantic tokens, and all other handlers still function (they use `ts.LanguageService` from Phase 1, independent of graph building).
6. **Bundle size**: Verify `@typescript-eslint/*` packages are no longer in the `dist/` bundle. Measure size reduction.

---

## Files Touched

**`packages/ganko/src/solid/`** (core SDK):
- `input.ts` — `SolidInput` interface rewrite
- `impl.ts` — `SolidGraph` class: all entity types, index maps, `sourceFile` replaces `sourceCode`
- `parse.ts` — **deleted**
- `plugin.ts` — `SolidPlugin.analyze` takes `program` parameter
- `phases/prepare.ts` — `ts.SourceFile` parent validation
- `phases/scopes.ts` — complete rewrite using `ts.TypeChecker` symbol resolution
- `phases/entities.ts` — merged into combined single-pass walk, all node types migrated
- `phases/entities/handlers/*.ts` — every handler: node type migrations
- `phases/exports.ts` — `ts.ExportDeclaration` / `ts.ExportAssignment`
- `phases/reactivity.ts` — node type migrations
- `phases/dependencies.ts` — node type migrations
- `phases/wiring.ts` — direct type checker access, unconditional execution
- `queries/*.ts` — all query functions: node type migrations, parent chain walks
- `rules/**/*.ts` — all rule files: node type discriminants, property access patterns
- `util/*.ts` — all utilities: node type migrations
- `typescript/index.ts` — `TypeResolver` rewrite: direct `ts.TypeChecker`, no ESTree→TSNode map
- `entities/*.ts` — all entity type definitions: `ts.Node` subtypes

**`packages/ganko/src/`** (SDK root):
- `graph.ts` — `Plugin` interface: `analyze` receives `AnalysisContext`
- `suppression.ts` — scanner-based comment extraction from `ts.SourceFile`
- `cache.ts` — `GraphCache`: `SolidGraph` type changes propagate
- `index.ts` — public API: remove `parseContent`, `parseContentWithProgram` exports

**`packages/lsp/src/`** (LSP/CLI):
- `core/analyze.ts` — `buildSolidGraphForPath` uses `createSolidInput`
- `cli/lint.ts` — CLI pipeline: `program.getSourceFile()` replaces parse calls
- `cli/daemon.ts` — daemon pipeline: same
- `server/connection.ts` — `createHandlerContext`: `getAST` returns `ts.SourceFile.statements`, comment/token access via `ts.SourceFile`
- `tsup.config.ts` — remove `@typescript-eslint/*` from `BUNDLED_DEPS`

**`packages/lsp/package.json`**: Remove `@typescript-eslint/parser`, `@typescript-eslint/project-service`, `@typescript-eslint/utils` from `devDependencies`. Retain `typescript`.