import type { TSESTree as T } from "@typescript-eslint/utils";
import type { VisitorContext } from "../context";
import type { ImportEntity, ImportSpecifierEntity } from "../../../entities/import";
import type { InlineImportEntity } from "../../../entities/inline-import";
import { getImportedName, getImportSpecifierKind } from "../helpers";

export function handleImport(ctx: VisitorContext, node: T.ImportDeclaration): void {
  const graph = ctx.graph;
  const file = ctx.file;

  // Build specifiers
  const specifiers: ImportSpecifierEntity[] = [];
  for (let i = 0, len = node.specifiers.length; i < len; i++) {
    const spec = node.specifiers[i];
    if (!spec) continue;
    specifiers.push({
      id: graph.nextMiscId(),
      node: spec,
      localName: spec.local.name,
      importedName: getImportedName(spec),
      kind: getImportSpecifierKind(spec),
      isTypeOnly: spec.type === "ImportSpecifier" && spec.importKind === "type",
    });
  }

  const imp: ImportEntity = {
    id: graph.nextImportId(),
    node,
    file,
    source: node.source.value,
    specifiers,
    isTypeOnly: node.importKind === "type",
  };

  graph.addImport(imp);
}

export function handleInlineImport(ctx: VisitorContext, node: T.TSImportType): void {
  const src = node.source;
  if (src.type !== "Literal") return;

  const source = src.value;
  if (typeof source !== "string") return;

  let qualifier = "";
  const qual = node.qualifier;
  if (qual && qual.type !== "ThisExpression") {
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

export function getQualifierText(ctx: VisitorContext, node: T.TSQualifiedName | T.Identifier): string {
  if (node.type === "Identifier") return node.name;
  const left = node.left;
  if (left.type === "ThisExpression") return "this." + node.right.name;
  return getQualifierText(ctx, left) + "." + node.right.name;
}
