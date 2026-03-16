/**
 * Phase 1: File Parsing
 *
 * Parse CSS/SCSS files from input and create FileEntities.
 */
import postcss, { CssSyntaxError, type Root } from "postcss"
import safeParse from "postcss-safe-parser"
import postcssScss from "postcss-scss"
import type { CSSGraph } from "../impl"
import type { CSSInput, CSSOptions } from "../input"
import type { FileEntity, ImportInfo } from "../entities"
import { FILE_HAS_IMPORTS, FILE_HAS_VARIABLES, FILE_HAS_MIXINS } from "../entities"
import {
  CHAR_DOUBLE_QUOTE,
  CHAR_SINGLE_QUOTE,
  CHAR_HYPHEN,
  CHAR_DOLLAR,
  CHAR_UNDERSCORE,
  CHAR_DOT,
  countLines,
} from "@drskillissue/ganko-shared";

const URL_IMPORT_RE = /^url\s*\(\s*(['"]?)([^'")\s]+)\1\s*\)/;
const LAYER_RE = /layer\s*\(\s*([^)]+)\s*\)/;
const LAYER_GLOBAL_RE = /layer\s*\([^)]*\)/g;

export function runParsePhase(graph: CSSGraph, input: CSSInput): void {
  if (input.files.length === 0) return;

  const files = input.files
  for (const f of files) {
    const file = parseFile(graph, f.path, f.content)
    graph.addFile(file)
  }
}

/**
 * Parses a CSS/SCSS file and creates a FileEntity with its AST.
 * @param graph - The CSS graph
 * @param path - The file path
 * @param content - The file content
 * @returns The created FileEntity
 * @throws If errorReporting is set to "throw" and parsing fails
 */
function parseFile(graph: CSSGraph, path: string, content: string): FileEntity {
  const syntax = detectSyntax(path, graph.options);
  const isScss = syntax === "scss" || syntax === "sass";

  if (isScss) graph.hasScssFiles = true;

  let root: Root;
  try {
    if (isScss) {
      root = postcss().process(content, { syntax: postcssScss, from: path }).root;
    } else {
      root = postcss.parse(content, { from: path });
    }
  } catch (err) {
    const mode = graph.options.errorReporting ?? "collect";

    if (mode === "throw") throw err;

    if (mode === "silent") {
      graph.addFailedFile(path);
      root = postcss.root();
    } else if (
      graph.options.maxParseErrors !== undefined &&
      graph.parseErrors.length >= graph.options.maxParseErrors
    ) {
      graph.addFailedFile(path);
      root = postcss.root();
    } else {
      let recovered = false;

      if (!isScss) {
        try {
          const parsed = safeParse(content, { from: path });
          const resolvedRoot = parsed.type === "document" ? parsed.nodes[0] : parsed;
          if (!resolvedRoot) {
            graph.addFailedFile(path);
            root = postcss.root();
          } else {
            root = resolvedRoot;
            recovered = true;
          }
        } catch {
          graph.addFailedFile(path);
          root = postcss.root();
        }
      } else {
        graph.addFailedFile(path);
        root = postcss.root();
      }

      if (err instanceof CssSyntaxError) {
        graph.addParseError({
          message: err.reason ?? err.message,
          line: err.line ?? 1,
          column: err.column ?? 1,
          endLine: err.endLine ?? null,
          endColumn: err.endColumn ?? null,
          file: path,
          severity: recovered ? "warn" : "error",
          source: err.source ?? null,
          isRecoverable: recovered,
        });
      } else if (err instanceof Error) {
        graph.addParseError({
          message: err.message,
          line: 1,
          column: 1,
          endLine: null,
          endColumn: null,
          file: path,
          severity: "error",
          source: null,
          isRecoverable: false,
        });
      }
    }
  }

  const lineStartOffsets = computeLineStartOffsets(content)
  const lineCount = lineStartOffsets.length > 0 ? lineStartOffsets.length : countLines(content)
  const { imports, hasVariablesHint, hasMixinsHint } = extractRootInfo(root);

  return {
    id: graph.nextFileId(),
    path,
    content,
    syntax,
    node: root,
    lineCount,
    lineStartOffsets,
    _flags: (imports.length > 0 ? FILE_HAS_IMPORTS : 0) |
            (hasVariablesHint ? FILE_HAS_VARIABLES : 0) |
            (hasMixinsHint ? FILE_HAS_MIXINS : 0),
    imports,
    importedBy: [],
    rules: [],
    atRules: [],
    variables: [],
  };
}

function computeLineStartOffsets(content: string): number[] {
  const starts = [0]
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) !== 10) continue
    starts.push(i + 1)
  }
  return starts
}

/**
 * Detects the CSS syntax type from file extension or options.
 * @param path - The file path
 * @param options - The CSS graph options
 * @returns The detected syntax type
 */
function detectSyntax(path: string, options: CSSOptions): "css" | "scss" | "sass" | "less" {
  if (options.scss !== undefined) return options.scss ? "scss" : "css";
  const dotIdx = path.lastIndexOf(".");
  if (dotIdx === -1 || dotIdx === path.length - 1) return "css";
  const ext = path.slice(dotIdx + 1).toLowerCase();
  switch (ext) {
    case "scss": return "scss";
    case "sass": return "sass";
    case "less": return "less";
    default: return "css";
  }
}

interface RootInfo {
  imports: ImportInfo[];
  hasVariablesHint: boolean;
  hasMixinsHint: boolean;
}

/**
 * Extracts import directives and hints about variables/mixins from the root.
 * @param root - The PostCSS root
 * @returns Information about imports and presence of variables/mixins
 */
function extractRootInfo(root: Root): RootInfo {
  const imports: ImportInfo[] = [];
  let hasVariablesHint = false;
  let hasMixinsHint = false;

  const nodes = root.nodes;
  if (!nodes || nodes.length === 0) return { imports, hasVariablesHint, hasMixinsHint };

  for (const node of nodes) {
    if (node.type === "atrule") {
      const nameLower = node.name.length <= 7 ? node.name.toLowerCase() : node.name;
      if (nameLower === "import" || nameLower === "use" || nameLower === "forward") {
        const importInfo = parseImportDirective(node.params, node);
        if (importInfo) imports.push(importInfo);
      } else if (nameLower === "mixin") {
        hasMixinsHint = true;
      }
    } else if (node.type === "decl") {
      const firstChar = node.prop.charCodeAt(0);
      if ((firstChar === CHAR_HYPHEN && node.prop.charCodeAt(1) === CHAR_HYPHEN) || firstChar === CHAR_DOLLAR) {
        hasVariablesHint = true;
      }
    }
  }

  return { imports, hasVariablesHint, hasMixinsHint };
}

/**
 * Parses an @import, @use, or @forward directive into ImportInfo.
 * @param params - The directive parameters
 * @param node - The at-rule node
 * @returns The parsed import info or null if invalid
 */
function parseImportDirective(params: string, node: postcss.AtRule): ImportInfo | null {
  const trimmed = params.trim();
  if (trimmed.length === 0) return null;

  let importPath: string | null = null;
  let mediaQuery: string | null = null;
  let layer: string | null = null;

  const firstChar = trimmed.charCodeAt(0);

  if (firstChar === CHAR_DOUBLE_QUOTE || firstChar === CHAR_SINGLE_QUOTE) {
    let end = 1;
    while (end < trimmed.length && trimmed.charCodeAt(end) !== firstChar) end++;
    if (end > 1 && end < trimmed.length) {
      importPath = trimmed.substring(1, end);
      const remainder = trimmed.substring(end + 1).trim();
      if (remainder) ({ layer, mediaQuery } = parseLayerAndMedia(remainder));
    }
  } else {
    const urlMatch = trimmed.match(URL_IMPORT_RE);
    if (urlMatch) {
      importPath = urlMatch[2] ?? null;
      const remainder = trimmed.slice(urlMatch[0].length).trim();
      if (remainder) ({ layer, mediaQuery } = parseLayerAndMedia(remainder));
    }
  }

  if (!importPath) return null;

  return {
    path: importPath,
    node,
    isPartial: detectPartial(importPath),
    resolvedFile: null,
    mediaQuery,
    layer,
  };
}

/**
 * Detects if an import path refers to an SCSS partial (underscore prefix or no extension).
 * @param path - The import path
 * @returns True if the path is a partial
 */
function detectPartial(path: string): boolean {
  let hasDot = false;
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c === CHAR_UNDERSCORE) return true;
    if (c === CHAR_DOT) hasDot = true;
  }
  return !hasDot;
}

/**
 * Parses layer() and media query from import directive remainder.
 * @param remainder - The remainder string after the import path
 * @returns Object with layer name and media query
 */
function parseLayerAndMedia(remainder: string): { layer: string | null; mediaQuery: string | null } {
  const layerMatch = remainder.match(LAYER_RE);
  const layerCapture = layerMatch ? layerMatch[1] : null;
  const layer = layerCapture ? layerCapture.trim() : null;
  const mediaQuery = remainder.replace(LAYER_GLOBAL_RE, "").trim() || null;
  return { layer, mediaQuery };
}
