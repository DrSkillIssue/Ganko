/**
 * Test Server Implementation
 *
 * Uses HandlerContext to delegate to real LSP handlers.
 * No ts.LanguageService — TS-based features (definition, references,
 * hover, rename) return null. Diagnostics use ganko's
 * analyzeInput directly for in-memory files. Code actions use
 * getContent for offset-to-position conversion.
 */

import type {
  Definition,
  Location,
  Hover,
  CompletionItem,
  WorkspaceEdit,
  CodeAction,
  Diagnostic as LSPDiagnostic,
  Range,
} from "vscode-languageserver";
import { CodeActionTriggerKind, CompletionItemKind } from "vscode-languageserver";

import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import ts from "typescript";
import { createSolidInput, analyzeInput, type Diagnostic } from "@drskillissue/ganko";
import { noopLogger } from "@drskillissue/ganko-shared";
import type { HandlerContext } from "../../src/server/handlers/handler-context";

import { handleDefinition } from "../../src/server/handlers/definition";
import { handleReferences } from "../../src/server/handlers/references";
import { handleHover } from "../../src/server/handlers/hover";
import { handlePrepareRename, handleRename } from "../../src/server/handlers/rename";
import { handleCodeAction } from "../../src/server/handlers/code-action";
import { convertDiagnostics } from "../../src/server/handlers/diagnostics";
import { positionToOffset } from "./position";

/** Prepare rename result type. */
export interface PrepareRenameResult {
  range: Range
  placeholder: string
}

/** Cached parse result for a file */
interface CachedFile {
  readonly content: string
  readonly sourceFile: ts.SourceFile | null
  readonly diagnostics: readonly Diagnostic[]
}

const CONTROL_FLOW = ["Show", "For", "Switch", "Match", "Index", "ErrorBoundary", "Suspense", "Portal"];

const HTML_ELEMENTS = [
  "div", "span", "p", "a", "button", "input", "form", "h1", "h2", "h3",
  "h4", "h5", "h6", "ul", "ol", "li", "table", "tr", "td", "th",
  "img", "nav", "header", "footer", "main", "section", "article",
  "aside", "label", "select", "option", "textarea",
];

const HTML_ATTRS = [
  "class", "classList", "id", "style", "ref", "onClick", "onInput",
  "onChange", "onSubmit", "onKeyDown", "onKeyUp", "onMouseDown",
  "onMouseUp", "onMouseMove", "onFocus", "onBlur",
];

const TAG_CONTEXT = /<([A-Za-z]*)$/;
const ATTR_CONTEXT = /<[A-Za-z][\w.]*(?:\s+[\w:]+(?:=(?:"[^"]*"|'[^']*'|\{[^}]*\}))?)*\s+([a-zA-Z]*)$/;
const EXPR_CONTEXT = /\{([a-zA-Z]*)$/;

/**
 * Test server instance for integration testing.
 *
 * Provides a HandlerContext backed by in-memory files. TS LanguageService
 * features return null; diagnostics use ganko's analyzeInput.
 */
export class TestServer {
  private readonly files = new Map<string, CachedFile>();
  private readonly ctx: HandlerContext;

  constructor() {
    this.ctx = {
      log: noopLogger,
      getLanguageService: () => null,
      getSourceFile: () => null,
      getTSFileInfo: () => null,
      getAST: (path) => this.files.get(path)?.sourceFile ?? null,
      getDiagnostics: (path) => this.files.get(path)?.diagnostics ?? [],
      getContent: (path) => this.files.get(path)?.content ?? null,
      getSolidGraph: () => null,
    };
  }

  /** Add a file to the project. */
  addFile(filePath: string, content: string): void {
    this.files.set(this.normalizePath(filePath), buildCachedFile(filePath, content));
  }

  /** Update an existing file. */
  updateFile(filePath: string, content: string): void {
    this.files.set(this.normalizePath(filePath), buildCachedFile(filePath, content));
  }

  /** Remove a file from the project. */
  removeFile(filePath: string): void {
    this.files.delete(this.normalizePath(filePath));
  }

  /** Get file content. */
  getFileContent(filePath: string): string | null {
    return this.files.get(this.normalizePath(filePath))?.content ?? null;
  }

  /** Go to definition. */
  definition(uri: string, line: number, character: number): Definition | null {
    return handleDefinition(
      { textDocument: { uri: this.pathToUri(uri) }, position: { line, character } },
      this.ctx,
    );
  }

  /** Find all references. */
  references(uri: string, line: number, character: number, includeDeclaration = true): Location[] | null {
    return handleReferences(
      { textDocument: { uri: this.pathToUri(uri) }, position: { line, character }, context: { includeDeclaration } },
      this.ctx,
    );
  }

  /** Get hover information. */
  hover(uri: string, line: number, character: number): Hover | null {
    return handleHover(
      { textDocument: { uri: this.pathToUri(uri) }, position: { line, character } },
      this.ctx,
    );
  }

  /** Get completions at position. */
  completion(uri: string, line: number, character: number, _trigger?: string): CompletionItem[] | null {
    const normalized = this.normalizePath(uri);
    const cached = this.files.get(normalized);
    if (!cached) return null;

    const offset = positionToOffset(cached.content, { line, character });
    const before = cached.content.slice(0, offset);

    const tagItems = matchTagContext(before);
    if (tagItems) return tagItems;

    const attrItems = matchAttrContext(before);
    if (attrItems) return attrItems;

    const exprItems = matchExprContext(before, cached.content);
    if (exprItems) return exprItems;

    return null;
  }

  /** Prepare rename at position. */
  prepareRename(uri: string, line: number, character: number): PrepareRenameResult | null {
    return handlePrepareRename(
      { textDocument: { uri: this.pathToUri(uri) }, position: { line, character } },
      this.ctx,
    );
  }

  /** Perform rename. */
  rename(uri: string, line: number, character: number, newName: string): WorkspaceEdit | null {
    return handleRename(
      { textDocument: { uri: this.pathToUri(uri) }, position: { line, character }, newName },
      this.ctx,
    );
  }

  /** Get code actions for a range. */
  codeActions(uri: string, r: Range, diagnostics: LSPDiagnostic[] = []): CodeAction[] | null {
    return handleCodeAction(
      {
        textDocument: { uri: this.pathToUri(uri) },
        range: r,
        context: { diagnostics, only: undefined, triggerKind: CodeActionTriggerKind.Invoked },
      },
      this.ctx,
    );
  }

  /** Get diagnostics for a file. */
  getDiagnostics(filePath: string): LSPDiagnostic[] {
    const cached = this.files.get(this.normalizePath(filePath));
    if (!cached) return [];
    return convertDiagnostics(cached.diagnostics);
  }

  /** Get raw internal diagnostics. */
  getRawDiagnostics(filePath: string): readonly Diagnostic[] {
    return this.files.get(this.normalizePath(filePath))?.diagnostics ?? [];
  }

  /** Clear all files and reset state. */
  clear(): void {
    this.files.clear();
  }

  /** Get all file paths in the project. */
  getAllFiles(): readonly string[] {
    return [...this.files.keys()];
  }

  /** Check if a file exists. */
  hasFile(filePath: string): boolean {
    return this.files.has(this.normalizePath(filePath));
  }

  private normalizePath(filePath: string): string {
    if (filePath.startsWith("file:")) return fileURLToPath(filePath);
    if (!filePath.startsWith("/")) return "/test/" + filePath;
    return filePath;
  }

  private pathToUri(filePath: string): string {
    return pathToFileURL(this.normalizePath(filePath)).href;
  }

  private uriToPath(uri: string): string {
    if (uri.startsWith("file:")) return fileURLToPath(uri);
    return uri;
  }
}

/** Shared CompilerHost — lib files are immutable, no need to recreate per call. */
const defaultHost = ts.createCompilerHost({});

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
};

/**
 * Cache parsed lib SourceFile objects at module scope. Lib .d.ts files are
 * immutable so parsing them once and reusing across all ts.createProgram
 * invocations is safe and eliminates the dominant cost per call.
 */
const libSourceFileCache = new Map<string, ts.SourceFile | undefined>();

/**
 * Build a ts.Program from virtual file content, run ganko analysis,
 * and return the cached result.
 */
function buildCachedFile(path: string, content: string): CachedFile {
  try {
    const resolvedPath = resolve(path);
    const fileMap = new Map<string, string>([[resolvedPath, content]]);

    const host: ts.CompilerHost = {
      ...defaultHost,
      getSourceFile(fileName, languageVersion) {
        const virtual = fileMap.get(fileName);
        if (virtual !== undefined) {
          return ts.createSourceFile(fileName, virtual, languageVersion, true);
        }
        const cached = libSourceFileCache.get(fileName);
        if (cached !== undefined) return cached;
        const sf = defaultHost.getSourceFile(fileName, languageVersion);
        libSourceFileCache.set(fileName, sf);
        return sf;
      },
      fileExists(fileName) {
        return fileMap.has(fileName) || defaultHost.fileExists(fileName);
      },
      readFile(fileName) {
        return fileMap.get(fileName) ?? defaultHost.readFile(fileName);
      },
    };

    const program = ts.createProgram({
      rootNames: [resolvedPath],
      options: compilerOptions,
      host,
    });

    const input = createSolidInput(resolvedPath, program);
    const diagnostics: Diagnostic[] = [];
    analyzeInput(input, (d) => diagnostics.push(d));
    return { content, sourceFile: input.sourceFile, diagnostics };
  } catch {
    return { content, sourceFile: null, diagnostics: [] };
  }
}

/** JSX tag completion: after `<` or `<prefix` */
function matchTagContext(before: string): CompletionItem[] | null {
  const match = before.match(TAG_CONTEXT);
  if (!match) return null;

  const prefix = match[1].toLowerCase();
  const items: CompletionItem[] = [];

  for (const name of CONTROL_FLOW) {
    if (!prefix || name.toLowerCase().startsWith(prefix)) {
      items.push({ label: name, kind: CompletionItemKind.Class, detail: "Solid.js control flow" });
    }
  }
  for (const name of HTML_ELEMENTS) {
    if (!prefix || name.startsWith(prefix)) {
      items.push({ label: name, kind: CompletionItemKind.Property, detail: "HTML element" });
    }
  }
  return items.length > 0 ? items : null;
}

/** Attribute completion: after `<tag ...space prefix` */
function matchAttrContext(before: string): CompletionItem[] | null {
  const match = before.match(ATTR_CONTEXT);
  if (!match) return null;

  const prefix = match[1].toLowerCase();
  const items: CompletionItem[] = [];

  for (const name of HTML_ATTRS) {
    if (!prefix || name.toLowerCase().startsWith(prefix)) {
      items.push({ label: name, kind: CompletionItemKind.Property, detail: "Attribute" });
    }
  }
  return items.length > 0 ? items : null;
}

/** Expression completion inside JSX `{prefix` — extract variable names from content */
function matchExprContext(before: string, content: string): CompletionItem[] | null {
  const match = before.match(EXPR_CONTEXT);
  if (!match) return null;

  const prefix = match[1].toLowerCase();
  const items: CompletionItem[] = [];
  const seen = new Set<string>();

  const varPattern = /(?:const|let|var)\s+(?:\[([a-zA-Z_$][\w$]*)|([a-zA-Z_$][\w$]*))\b/g;
  let varMatch = varPattern.exec(content);
  while (varMatch !== null) {
    const name = varMatch[1] ?? varMatch[2];
    if (name && !seen.has(name) && (!prefix || name.toLowerCase().startsWith(prefix))) {
      seen.add(name);
      items.push({ label: name, kind: CompletionItemKind.Variable, detail: "Variable" });
    }
    varMatch = varPattern.exec(content);
  }

  return items.length > 0 ? items : null;
}

/** Create a new test server with initial files. */
export function createTestServer(files: Record<string, string> = {}): TestServer {
  const server = new TestServer();
  for (const [filePath, content] of Object.entries(files)) {
    server.addFile(filePath, content);
  }
  return server;
}
