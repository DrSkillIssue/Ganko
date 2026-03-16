
import ts from "typescript";
import type { SolidGraph } from "../impl";
import type { SolidInput } from "../input";
import type { ExportEntity } from "../entities/export";
import type { ReactiveKind } from "../entities/variable";
import { ExportKind } from "../entities/export";
import { isComponentName } from "../util/function";

export function runExportsPhase(graph: SolidGraph, input: SolidInput): void {
    const sourceFile = input.sourceFile;
    const statements = sourceFile.statements;
    if (statements.length === 0) return;

    for (let i = 0, len = statements.length; i < len; i++) {
      const stmt = statements[i];
      if (!stmt) continue;

      // Named exports: export function foo() {}, export const x = 1, export { x, y }
      if (ts.isExportDeclaration(stmt)) {
        extractNamedExportDeclaration(stmt, graph);
      }

      // export function foo() {} / export class Foo {} / export const x = 1
      if (hasExportModifier(stmt)) {
        extractModifierExport(stmt, graph);
      }

      // Default exports: export default function() {}, export default expr
      if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
        extractDefaultExport(stmt, graph);
      }
    }
}

/**
 * Checks if a statement has the `export` keyword modifier.
 * In TypeScript AST, `export function foo()` and `export const x`
 * are represented as declarations with export modifiers, NOT as ExportDeclaration nodes.
 */
function hasExportModifier(node: ts.Statement): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (!modifiers) return false;
  for (let i = 0; i < modifiers.length; i++) {
    const mod = modifiers[i];
    if (mod && mod.kind === ts.SyntaxKind.ExportKeyword) return true;
  }
  return false;
}

/**
 * Checks if a statement has the `default` keyword modifier.
 */
function hasDefaultModifier(node: ts.Statement): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (!modifiers) return false;
  for (let i = 0; i < modifiers.length; i++) {
    const mod = modifiers[i];
    if (mod && mod.kind === ts.SyntaxKind.DefaultKeyword) return true;
  }
  return false;
}

/**
 * Extracts exports from statements with export modifiers.
 * Handles: export function foo(), export const x = 1, export class Foo {}
 */
function extractModifierExport(stmt: ts.Statement, graph: SolidGraph): void {
  const isDefault = hasDefaultModifier(stmt);

  if (ts.isFunctionDeclaration(stmt) && stmt.name) {
    const name = stmt.name.text;
    const fns = graph.functionsByName.get(name);
    const fn = fns?.[0];

    if (isDefault) {
      graph.addExport(createExport({
        id: graph.nextExportId(),
        name: "default",
        kind: isComponentName(name) ? ExportKind.COMPONENT : ExportKind.FUNCTION,
        entityId: fn?.id ?? -1,
        node: stmt,
        isDefault: true,
      }));
    } else {
      graph.addExport(createExport({
        id: graph.nextExportId(),
        name,
        kind: isComponentName(name) ? ExportKind.COMPONENT : ExportKind.FUNCTION,
        entityId: fn?.id ?? -1,
        node: stmt,
      }));
    }
  }

  if (ts.isClassDeclaration(stmt) && stmt.name) {
    const name = stmt.name.text;
    const classes = graph.classesByName.get(name);
    const cls = classes?.[0];

    graph.addExport(createExport({
      id: graph.nextExportId(),
      name: isDefault ? "default" : name,
      kind: ExportKind.CLASS,
      entityId: cls?.id ?? -1,
      node: stmt,
      isDefault,
    }));
  }

  if (ts.isVariableStatement(stmt)) {
    const decls = stmt.declarationList.declarations;
    for (let i = 0, len = decls.length; i < len; i++) {
      const decl = decls[i];
      if (!decl) continue;
      if (ts.isIdentifier(decl.name)) {
        const name = decl.name.text;
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

/**
 * Extracts named exports from an ExportDeclaration node.
 * Handles: export { x, y }, export { x as y }, export { x } from "./mod"
 */
function extractNamedExportDeclaration(stmt: ts.ExportDeclaration, graph: SolidGraph): void {
  const isStmtTypeOnly = stmt.isTypeOnly;

  // export { x, y } or export { x } from "./mod"
  if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
    const specifiers = stmt.exportClause.elements;
    for (let i = 0, len = specifiers.length; i < len; i++) {
      const spec = specifiers[i];
      if (!spec) continue;
      const localName = (spec.propertyName ?? spec.name).text;
      const exportedName = spec.name.text;
      const isTypeOnly = isStmtTypeOnly || spec.isTypeOnly;

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

      const sourceModule = stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
        ? stmt.moduleSpecifier.text
        : null;

      graph.addExport(createExport({
        id: graph.nextExportId(),
        name: exportedName,
        kind,
        entityId,
        node: stmt,
        reactiveKind,
        source: sourceModule,
        importedName: localName !== exportedName ? localName : null,
        isTypeOnly,
      }));
    }
  }
}

/**
 * Extracts default export from an ExportAssignment node.
 * Handles: export default expr, export default function() {}
 */
function extractDefaultExport(stmt: ts.ExportAssignment, graph: SolidGraph): void {
  const expression = stmt.expression;

  let entityId = -1;
  let kind = ExportKind.VARIABLE;
  let reactiveKind: ReactiveKind | null = null;

  if (ts.isIdentifier(expression)) {
    const name = expression.text;
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

  if (ts.isFunctionExpression(expression) || ts.isArrowFunction(expression)) {
    kind = ExportKind.FUNCTION;
    if (ts.isFunctionExpression(expression) && expression.name) {
      const name = expression.name.text;
      const fns = graph.functionsByName.get(name);
      entityId = fns?.[0]?.id ?? -1;
      if (isComponentName(name)) kind = ExportKind.COMPONENT;
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
  node: ts.Node;
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
    loc: null,
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
