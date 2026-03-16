import ts from "typescript";
import type { VisitorContext } from "../context";
import { handleInlineImport } from "../handlers/import";
import { handleUnsafeTypeAnnotation } from "../handlers/assertion";
export function visitTypeNode(ctx: VisitorContext, node: ts.TypeNode): void {
  if (ts.isImportTypeNode(node)) {
    handleInlineImport(ctx, node);
    if (node.typeArguments) {
      for (let i = 0, len = node.typeArguments.length; i < len; i++) {
        const tp = node.typeArguments[i];
        if (!tp) continue;
        visitTypeNode(ctx, tp);
      }
    }
    return;
  }

  if (ts.isArrayTypeNode(node)) {
    visitTypeNode(ctx, node.elementType);
    return;
  }

  if (ts.isTupleTypeNode(node)) {
    for (let i = 0, len = node.elements.length; i < len; i++) {
      const el = node.elements[i];
      if (!el) continue;
      if (ts.isNamedTupleMember(el)) {
        visitTypeNode(ctx, el.type);
      } else {
        visitTypeNode(ctx, el);
      }
    }
    return;
  }

  if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
    for (let i = 0, len = node.types.length; i < len; i++) {
      const t = node.types[i];
      if (!t) continue;
      visitTypeNode(ctx, t);
    }
    return;
  }

  if (ts.isTypeReferenceNode(node)) {
    if (node.typeArguments) {
      for (let i = 0, len = node.typeArguments.length; i < len; i++) {
        const tp = node.typeArguments[i];
        if (!tp) continue;
        visitTypeNode(ctx, tp);
      }
    }
    return;
  }

  if (ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node)) {
    if (node.type) visitTypeNode(ctx, node.type);
    for (let i = 0, len = node.parameters.length; i < len; i++) {
      const param = node.parameters[i];
      if (!param) continue;
      if (param.type) {
        visitTypeNode(ctx, param.type);
      }
    }
    return;
  }

  if (ts.isTypeLiteralNode(node)) {
    for (let i = 0, len = node.members.length; i < len; i++) {
      const m = node.members[i];
      if (!m) continue;
      visitTypeMember(ctx, m);
    }
    return;
  }

  if (ts.isConditionalTypeNode(node)) {
    visitTypeNode(ctx, node.checkType);
    visitTypeNode(ctx, node.extendsType);
    visitTypeNode(ctx, node.trueType);
    visitTypeNode(ctx, node.falseType);
    return;
  }

  if (ts.isMappedTypeNode(node)) {
    if (node.type) visitTypeNode(ctx, node.type);
    return;
  }

  if (ts.isIndexedAccessTypeNode(node)) {
    visitTypeNode(ctx, node.objectType);
    visitTypeNode(ctx, node.indexType);
    return;
  }

  if (ts.isTypeOperatorNode(node)) {
    visitTypeNode(ctx, node.type);
    return;
  }

  if (ts.isOptionalTypeNode(node) || ts.isRestTypeNode(node)) {
    visitTypeNode(ctx, node.type);
    return;
  }

  if (ts.isInferTypeNode(node)) {
    return;
  }

  if (ts.isTypePredicateNode(node)) {
    if (node.type) visitTypeNode(ctx, node.type);
    return;
  }

  if (ts.isTypeQueryNode(node)) {
    return;
  }

  if (ts.isTemplateLiteralTypeNode(node)) {
    for (let i = 0, len = node.templateSpans.length; i < len; i++) {
      const span = node.templateSpans[i];
      if (!span) continue;
      visitTypeNode(ctx, span.type);
    }
    return;
  }

  // Unsafe type keywords — collect for rule analysis
  if (node.kind === ts.SyntaxKind.AnyKeyword || node.kind === ts.SyntaxKind.UnknownKeyword) {
    handleUnsafeTypeAnnotation(ctx, node as ts.KeywordTypeNode);
    return;
  }

  // Leaf type nodes — no further traversal
}

export function visitTypeMember(ctx: VisitorContext, member: ts.TypeElement): void {
  if (ts.isPropertySignature(member)) {
    if (member.type) visitTypeNode(ctx, member.type);
    return;
  }

  if (ts.isMethodSignature(member)) {
    if (member.type) visitTypeNode(ctx, member.type);
    return;
  }

  if (ts.isIndexSignatureDeclaration(member)) {
    if (member.type) visitTypeNode(ctx, member.type);
    return;
  }

  if (ts.isCallSignatureDeclaration(member) || ts.isConstructSignatureDeclaration(member)) {
    if (member.type) visitTypeNode(ctx, member.type);
    return;
  }
}

export function visitInterfaceBody(ctx: VisitorContext, decl: ts.InterfaceDeclaration): void {
  for (let i = 0, len = decl.members.length; i < len; i++) {
    const member = decl.members[i];
    if (!member) continue;
    visitTypeMember(ctx, member);
  }
}

export function visitParameterTypeAnnotation(ctx: VisitorContext, param: ts.ParameterDeclaration): void {
  if (param.type) {
    visitTypeNode(ctx, param.type);
  }
}
