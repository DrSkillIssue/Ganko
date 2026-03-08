
import type { TSESTree as T } from "@typescript-eslint/utils";
import type { SolidGraph } from "../impl";
import type { SolidInput } from "../input";
import type { ExportEntity } from "../entities/export";
import type { ReactiveKind } from "../entities/variable";
import { ExportKind } from "../entities/export";
import { isComponentName } from "../util/function";

export function runExportsPhase(graph: SolidGraph, input: SolidInput): void {
    const ast = input.sourceCode.ast;
    const body = ast.body;
    if (body.length === 0) return;

    for (let i = 0, len = body.length; i < len; i++) {
      const stmt = body[i];
      if (!stmt) continue;

      if (stmt.type === "ExportNamedDeclaration") {
        extractNamedExports(stmt, graph);
      }

      if (stmt.type === "ExportDefaultDeclaration") {
        extractDefaultExport(stmt, graph);
      }
    }
}

/**
 * Extracts named exports from an export declaration.
 * @param stmt - The export named declaration
 * @param graph - The solid graph to populate
 */
function extractNamedExports(stmt: T.ExportNamedDeclaration, graph: SolidGraph): void {
  const declaration = stmt.declaration;

  if (declaration) {
    if (declaration.type === "FunctionDeclaration" && declaration.id) {
      const name = declaration.id.name;
      const fns = graph.functionsByName.get(name);
      const fn = fns?.[0];

      graph.addExport(createExport({
        id: graph.nextExportId(),
        name,
        kind: isComponentName(name) ? ExportKind.COMPONENT : ExportKind.FUNCTION,
        entityId: fn?.id ?? -1,
        node: stmt,
      }));
    }

    if (declaration.type === "ClassDeclaration" && declaration.id) {
      const name = declaration.id.name;
      const classes = graph.classesByName.get(name);
      const cls = classes?.[0];

      graph.addExport(createExport({
        id: graph.nextExportId(),
        name,
        kind: ExportKind.CLASS,
        entityId: cls?.id ?? -1,
        node: stmt,
      }));
    }

    if (declaration.type === "VariableDeclaration") {
      const decls = declaration.declarations;
      for (let i = 0, len = decls.length; i < len; i++) {
        const decl = decls[i];
        if (!decl) continue;
        if (decl.id.type === "Identifier") {
          const name = decl.id.name;
          const fns = graph.functionsByName.get(name);
          const vars = graph.variablesByName.get(name);
          const fn = fns?.[0];
          const variable = vars?.[0];

          let kind: ExportKind;
          let entityId: number;
          const reactiveKind = variable?.reactiveKind ?? null;

          if (fn) {
            entityId = fn.id;
            kind = isComponentName(name) ? ExportKind.COMPONENT : ExportKind.FUNCTION;
          } else if (variable) {
            entityId = variable.id;
            kind = ExportKind.VARIABLE;
            if (reactiveKind === "signal") kind = ExportKind.SIGNAL;
            else if (reactiveKind === "store") kind = ExportKind.STORE;
            else if (reactiveKind === "memo") kind = ExportKind.MEMO;
            else if (reactiveKind === "resource") kind = ExportKind.RESOURCE;
          } else {
            entityId = -1;
            kind = ExportKind.VARIABLE;
          }

          graph.addExport(createExport({
            id: graph.nextExportId(),
            name,
            kind,
            entityId,
            node: stmt,
            reactiveKind,
          }));
        }
      }
    }
  }

  const specifiers = stmt.specifiers;
  const isStmtTypeOnly = stmt.exportKind === "type";

  for (let i = 0, len = specifiers.length; i < len; i++) {
    const spec = specifiers[i];
    if (!spec) continue;
    const localName = spec.local.type === "Identifier" ? spec.local.name : spec.local.value;
    const exportedName = spec.exported.type === "Identifier" ? spec.exported.name : spec.exported.value;
    const isTypeOnly = isStmtTypeOnly || spec.exportKind === "type";

    const fns = graph.functionsByName.get(localName);
    const vars = graph.variablesByName.get(localName);
    const fn = fns?.[0];
    const variable = vars?.[0];

    let kind: ExportKind;
    let entityId: number;
    const reactiveKind = variable?.reactiveKind ?? null;

    if (isTypeOnly) {
      kind = ExportKind.TYPE;
      entityId = -1;
    } else if (fn) {
      kind = isComponentName(localName) ? ExportKind.COMPONENT : ExportKind.FUNCTION;
      entityId = fn.id;
    } else if (variable) {
      kind = ExportKind.VARIABLE;
      if (reactiveKind === "signal") kind = ExportKind.SIGNAL;
      else if (reactiveKind === "store") kind = ExportKind.STORE;
      else if (reactiveKind === "memo") kind = ExportKind.MEMO;
      else if (reactiveKind === "resource") kind = ExportKind.RESOURCE;
      entityId = variable.id;
    } else {
      kind = ExportKind.VARIABLE;
      entityId = -1;
    }

    graph.addExport(createExport({
      id: graph.nextExportId(),
      name: exportedName,
      kind,
      entityId,
      node: stmt,
      reactiveKind,
      source: stmt.source?.value ?? null,
      importedName: localName !== exportedName ? localName : null,
      isTypeOnly,
    }));
  }
}

/**
 * Extracts default export from an export default declaration.
 * @param stmt - The export default declaration
 * @param graph - The solid graph to populate
 */
function extractDefaultExport(stmt: T.ExportDefaultDeclaration, graph: SolidGraph): void {
  const declaration = stmt.declaration;

  let entityId = -1;
  let kind = ExportKind.VARIABLE;
  let reactiveKind = null;

  if (declaration.type === "FunctionDeclaration") {
    const name = declaration.id?.name;
    if (name) {
      const fns = graph.functionsByName.get(name);
      entityId = fns?.[0]?.id ?? -1;
      kind = isComponentName(name) ? ExportKind.COMPONENT : ExportKind.FUNCTION;
    } else {
      kind = ExportKind.FUNCTION;
    }
  }

  if (declaration.type === "Identifier") {
    const name = declaration.name;
    const fns = graph.functionsByName.get(name);
    const vars = graph.variablesByName.get(name);

    if (fns?.[0]) {
      entityId = fns[0].id;
      kind = isComponentName(name) ? ExportKind.COMPONENT : ExportKind.FUNCTION;
    } else if (vars?.[0]) {
      const variable = vars[0];
      entityId = variable.id;
      reactiveKind = variable.reactiveKind;
      kind = ExportKind.VARIABLE;
      if (reactiveKind === "signal") kind = ExportKind.SIGNAL;
      else if (reactiveKind === "store") kind = ExportKind.STORE;
      else if (reactiveKind === "memo") kind = ExportKind.MEMO;
      else if (reactiveKind === "resource") kind = ExportKind.RESOURCE;
    }
  }

  graph.addExport(createExport({
    id: graph.nextExportId(),
    name: "default",
    kind,
    entityId,
    node: stmt,
    isDefault: true,
    reactiveKind,
  }));
}

interface CreateExportArgs {
  id: number;
  name: string;
  kind: ExportKind;
  entityId: number;
  node: T.Node;
  isDefault?: boolean;
  isTypeOnly?: boolean;
  reactiveKind?: ReactiveKind | null;
  source?: string | null;
  importedName?: string | null;
}

/**
 * Creates an ExportEntity from the provided arguments.
 * @param args - The export creation arguments
 * @returns The created ExportEntity
 */
function createExport(args: CreateExportArgs): ExportEntity {
  return {
    id: args.id,
    name: args.name,
    kind: args.kind,
    entityId: args.entityId,
    isTypeOnly: args.isTypeOnly ?? false,
    isDefault: args.isDefault ?? false,
    reactiveKind: args.reactiveKind ?? null,
    signature: buildSignature(args.kind, args.entityId),
    node: args.node,
    loc: args.node.loc ?? null,
    source: args.source ?? null,
    importedName: args.importedName ?? null,
  };
}

/**
 * Builds a signature string for an export.
 * @param kind - The export kind
 * @param entityId - The entity ID
 * @returns The signature string
 */
function buildSignature(kind: ExportKind, entityId: number): string {
  const prefix = ExportKind[kind].toLowerCase();
  return `${prefix}:${entityId}`;
}
