import ts from "typescript";
import type { VisitorContext } from "../context";
import type { ImportEntity, ImportSpecifierEntity } from "../../../entities/import";
import type { InlineImportEntity } from "../../../entities/inline-import";

export function handleImport(ctx: VisitorContext, node: ts.ImportDeclaration): void {
  const graph = ctx.graph;
  const file = ctx.file;

  // Build specifiers
  const specifiers: ImportSpecifierEntity[] = [];
  const importClause = node.importClause;
  if (importClause) {
    // Default import
    if (importClause.name) {
      specifiers.push({
        id: graph.nextMiscId(),
        node: importClause,
        localName: importClause.name.text,
        importedName: null,
        kind: "default",
        isTypeOnly: false,
      });
    }
    const bindings = importClause.namedBindings;
    if (bindings) {
      if (ts.isNamespaceImport(bindings)) {
        specifiers.push({
          id: graph.nextMiscId(),
          node: bindings,
          localName: bindings.name.text,
          importedName: null,
          kind: "namespace",
          isTypeOnly: false,
        });
      } else if (ts.isNamedImports(bindings)) {
        for (let i = 0, len = bindings.elements.length; i < len; i++) {
          const spec = bindings.elements[i];
          if (!spec) continue;
          specifiers.push({
            id: graph.nextMiscId(),
            node: spec,
            localName: spec.name.text,
            importedName: spec.propertyName ? spec.propertyName.text : spec.name.text,
            kind: "named",
            isTypeOnly: spec.isTypeOnly,
          });
        }
      }
    }
  }

  const moduleSpecifier = node.moduleSpecifier;
  const source = ts.isStringLiteral(moduleSpecifier) ? moduleSpecifier.text : "";

  const imp: ImportEntity = {
    id: graph.nextImportId(),
    node,
    file,
    source,
    specifiers,
    isTypeOnly: importClause?.isTypeOnly ?? false,
  };

  graph.addImport(imp);
}

export function handleInlineImport(ctx: VisitorContext, node: ts.ImportTypeNode): void {
  const arg = node.argument;
  if (!ts.isLiteralTypeNode(arg) || !ts.isStringLiteral(arg.literal)) return;

  const source = arg.literal.text;

  let qualifier = "";
  const qual = node.qualifier;
  if (qual) {
    qualifier = getQualifierText(ctx, qual);
  }

  const entity: InlineImportEntity = {
    id: ctx.graph.nextMiscId(),
    node,
    file: ctx.file,
    source,
    qualifier,
  };
  ctx.graph.addInlineImport(entity);
}

export function getQualifierText(ctx: VisitorContext, node: ts.QualifiedName | ts.Identifier): string {
  if (ts.isIdentifier(node)) return node.text;
  const left = node.left;
  if (ts.isIdentifier(left)) return left.text + "." + node.right.text;
  return getQualifierText(ctx, left) + "." + node.right.text;
}
