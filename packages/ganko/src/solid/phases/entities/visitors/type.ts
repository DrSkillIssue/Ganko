import type { TSESTree as T } from "@typescript-eslint/utils";
import type { VisitorContext } from "../context";
import { handleInlineImport } from "../handlers/import";
import { handleUnsafeTypeAnnotation } from "../handlers/assertion";
export function visitTypeNode(ctx: VisitorContext, node: T.TypeNode): void {
  switch (node.type) {
    case "TSImportType":
      handleInlineImport(ctx, node);
      if (node.typeArguments) {
        for (let i = 0, len = node.typeArguments.params.length; i < len; i++) {
          const tp = node.typeArguments.params[i];
          if (!tp) continue;
          visitTypeNode(ctx, tp);
        }
      }
      break;
    case "TSArrayType":
      visitTypeNode(ctx, node.elementType);
      break;
    case "TSTupleType":
      for (let i = 0, len = node.elementTypes.length; i < len; i++) {
        const el = node.elementTypes[i];
        if (!el) continue;
        if (el.type === "TSNamedTupleMember") {
          visitTypeNode(ctx, el.elementType);
        } else {
          visitTypeNode(ctx, el);
        }
      }
      break;
    case "TSUnionType":
    case "TSIntersectionType":
      for (let i = 0, len = node.types.length; i < len; i++) {
        const t = node.types[i];
        if (!t) continue;
        visitTypeNode(ctx, t);
      }
      break;
    case "TSTypeReference":
      if (node.typeArguments) {
        for (let i = 0, len = node.typeArguments.params.length; i < len; i++) {
          const tp = node.typeArguments.params[i];
          if (!tp) continue;
          visitTypeNode(ctx, tp);
        }
      }
      break;
    case "TSFunctionType":
    case "TSConstructorType":
      if (node.returnType) visitTypeNode(ctx, node.returnType.typeAnnotation);
      for (let i = 0, len = node.params.length; i < len; i++) {
        const param = node.params[i];
        if (!param) continue;
        if ("typeAnnotation" in param && param.typeAnnotation) {
          visitTypeNode(ctx, param.typeAnnotation.typeAnnotation);
        }
      }
      break;
    case "TSTypeLiteral":
      for (let i = 0, len = node.members.length; i < len; i++) {
        const m = node.members[i];
        if (!m) continue;
        visitTypeMember(ctx, m);
      }
      break;
    case "TSConditionalType":
      visitTypeNode(ctx, node.checkType);
      visitTypeNode(ctx, node.extendsType);
      visitTypeNode(ctx, node.trueType);
      visitTypeNode(ctx, node.falseType);
      break;
    case "TSMappedType":
      if (node.typeAnnotation) visitTypeNode(ctx, node.typeAnnotation);
      break;
    case "TSIndexedAccessType":
      visitTypeNode(ctx, node.objectType);
      visitTypeNode(ctx, node.indexType);
      break;
    case "TSTypeOperator":
      if (node.typeAnnotation) visitTypeNode(ctx, node.typeAnnotation);
      break;
    case "TSOptionalType":
    case "TSRestType":
      visitTypeNode(ctx, node.typeAnnotation);
      break;
    case "TSInferType":
      break;
    case "TSTypePredicate":
      if (node.typeAnnotation) visitTypeNode(ctx, node.typeAnnotation.typeAnnotation);
      break;
    case "TSTypeQuery":
      break;
    case "TSTemplateLiteralType":
      for (let i = 0, len = node.types.length; i < len; i++) {
        const tt = node.types[i];
        if (!tt) continue;
        visitTypeNode(ctx, tt);
      }
      break;
    // Unsafe type keywords — collect for rule analysis
    case "TSAnyKeyword":
    case "TSUnknownKeyword":
      handleUnsafeTypeAnnotation(ctx, node);
      break;
    // Leaf type nodes
    case "TSBigIntKeyword":
    case "TSBooleanKeyword":
    case "TSIntrinsicKeyword":
    case "TSNeverKeyword":
    case "TSNullKeyword":
    case "TSNumberKeyword":
    case "TSObjectKeyword":
    case "TSStringKeyword":
    case "TSSymbolKeyword":
    case "TSUndefinedKeyword":
    case "TSVoidKeyword":
    case "TSThisType":
    case "TSLiteralType":
      break;
  }
}

export function visitTypeMember(ctx: VisitorContext, member: T.TypeElement): void {
  switch (member.type) {
    case "TSPropertySignature":
      if (member.typeAnnotation) visitTypeNode(ctx, member.typeAnnotation.typeAnnotation);
      break;
    case "TSMethodSignature":
      if (member.returnType) visitTypeNode(ctx, member.returnType.typeAnnotation);
      break;
    case "TSIndexSignature":
      if (member.typeAnnotation) visitTypeNode(ctx, member.typeAnnotation.typeAnnotation);
      break;
    case "TSCallSignatureDeclaration":
    case "TSConstructSignatureDeclaration":
      if (member.returnType) visitTypeNode(ctx, member.returnType.typeAnnotation);
      break;
  }
}

export function visitInterfaceBody(ctx: VisitorContext, body: T.TSInterfaceBody): void {
  for (let i = 0, len = body.body.length; i < len; i++) {
    const member = body.body[i];
    if (!member) continue;
    visitTypeMember(ctx, member);
  }
}

export function visitParameterTypeAnnotation(ctx: VisitorContext, param: T.Parameter): void {
  switch (param.type) {
    case "Identifier":
      if (param.typeAnnotation) {
        visitTypeNode(ctx, param.typeAnnotation.typeAnnotation);
      }
      break;
    case "AssignmentPattern":
      if (param.left.type === "Identifier" && param.left.typeAnnotation) {
        visitTypeNode(ctx, param.left.typeAnnotation.typeAnnotation);
      }
      break;
    case "RestElement":
      if (param.argument.type === "Identifier" && param.argument.typeAnnotation) {
        visitTypeNode(ctx, param.argument.typeAnnotation.typeAnnotation);
      }
      break;
    case "ArrayPattern":
    case "ObjectPattern":
      if (param.typeAnnotation) {
        visitTypeNode(ctx, param.typeAnnotation.typeAnnotation);
      }
      break;
    case "TSParameterProperty":
      if (param.parameter.type === "Identifier" && param.parameter.typeAnnotation) {
        visitTypeNode(ctx, param.parameter.typeAnnotation.typeAnnotation);
      }
      break;
  }
}
