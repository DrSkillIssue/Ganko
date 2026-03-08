import type { TSESTree as T } from "@typescript-eslint/utils";
import type { VisitorContext } from "../context";
import { visitExpression, visitFunctionBody } from "./expression";
import { visitTypeNode, visitInterfaceBody } from "./type";
import { handleImport } from "../handlers/import";
import { handleFunction } from "../handlers/function";
import { handleClass, handleProperty } from "../handlers/class";
import { handleReturnStatement, handleThrowStatement } from "../handlers/misc";
import { handleRestDestructure } from "../handlers/spread";
export function visitProgram(ctx: VisitorContext, node: T.Program): void {
  if (node.body.length === 0) return;

  for (let i = 0, len = node.body.length; i < len; i++) {
    const stmt = node.body[i];
    if (!stmt) continue;
    visitProgramStatement(ctx, stmt);
  }
}

export function visitProgramStatement(ctx: VisitorContext, node: T.ProgramStatement): void {
  switch (node.type) {
    case "ImportDeclaration":
      handleImport(ctx, node);
      break;
    case "ExportNamedDeclaration":
      if (node.declaration) visitDeclaration(ctx, node.declaration);
      break;
    case "ExportDefaultDeclaration":
      visitExportDefaultDeclaration(ctx, node);
      break;
    case "FunctionDeclaration":
      handleFunction(ctx, node);
      visitFunctionBody(ctx, node.body);
      ctx.functionStack.pop();
      break;
    case "ClassDeclaration":
      handleClass(ctx, node);
      visitClassBody(ctx, node.body);
      ctx.classStack.pop();
      break;
    case "VariableDeclaration":
      visitVariableDeclaration(ctx, node);
      break;
    case "ExpressionStatement":
      visitExpression(ctx, node.expression);
      break;
    case "BlockStatement":
      visitBlockStatement(ctx, node);
      break;
    case "IfStatement":
      visitIfStatement(ctx, node);
      break;
    case "ForStatement":
      visitForStatement(ctx, node);
      break;
    case "ForInStatement":
    case "ForOfStatement":
      visitForInOfStatement(ctx, node);
      break;
    case "WhileStatement":
    case "DoWhileStatement":
      visitExpression(ctx, node.test);
      visitStatement(ctx, node.body);
      break;
    case "SwitchStatement":
      visitSwitchStatement(ctx, node);
      break;
    case "TryStatement":
      visitTryStatement(ctx, node);
      break;
    case "ReturnStatement":
      handleReturnStatement(ctx, node);
      if (node.argument) visitExpression(ctx, node.argument);
      break;
    case "ThrowStatement":
      handleThrowStatement(ctx, );
      visitExpression(ctx, node.argument);
      break;
    case "LabeledStatement":
      visitStatement(ctx, node.body);
      break;
    case "WithStatement":
      visitExpression(ctx, node.object);
      visitStatement(ctx, node.body);
      break;
    // Empty statements, debugger, break, continue - no children to visit
    case "EmptyStatement":
    case "DebuggerStatement":
    case "BreakStatement":
    case "ContinueStatement":
      break;
    // TypeScript declarations - visit for inline imports in type annotations
    case "TSTypeAliasDeclaration":
      visitTypeNode(ctx, node.typeAnnotation);
      break;
    case "TSInterfaceDeclaration":
      visitInterfaceBody(ctx, node.body);
      break;
    case "TSEnumDeclaration":
    case "TSModuleDeclaration":
    case "TSDeclareFunction":
    case "TSImportEqualsDeclaration":
    case "TSExportAssignment":
    case "TSNamespaceExportDeclaration":
      break;
  }
}

export function visitStatement(ctx: VisitorContext, node: T.Statement): void {
  switch (node.type) {
    case "BlockStatement":
      visitBlockStatement(ctx, node);
      break;
    case "ExpressionStatement":
      visitExpression(ctx, node.expression);
      break;
    case "IfStatement":
      visitIfStatement(ctx, node);
      break;
    case "ForStatement":
      visitForStatement(ctx, node);
      break;
    case "ForInStatement":
    case "ForOfStatement":
      visitForInOfStatement(ctx, node);
      break;
    case "WhileStatement":
    case "DoWhileStatement":
      ctx.loopDepth++;
      visitExpression(ctx, node.test);
      visitStatement(ctx, node.body);
      ctx.loopDepth--;
      break;
    case "SwitchStatement":
      visitSwitchStatement(ctx, node);
      break;
    case "TryStatement":
      visitTryStatement(ctx, node);
      break;
    case "ReturnStatement":
      handleReturnStatement(ctx, node);
      if (node.argument) visitExpression(ctx, node.argument);
      break;
    case "ThrowStatement":
      handleThrowStatement(ctx, );
      visitExpression(ctx, node.argument);
      break;
    case "VariableDeclaration":
      visitVariableDeclaration(ctx, node);
      break;
    case "FunctionDeclaration":
      handleFunction(ctx, node);
      visitFunctionBody(ctx, node.body);
      ctx.functionStack.pop();
      break;
    case "ClassDeclaration":
      handleClass(ctx, node);
      visitClassBody(ctx, node.body);
      ctx.classStack.pop();
      break;
    case "LabeledStatement":
      visitStatement(ctx, node.body);
      break;
    case "WithStatement":
      visitExpression(ctx, node.object);
      visitStatement(ctx, node.body);
      break;
    case "EmptyStatement":
    case "DebuggerStatement":
    case "BreakStatement":
    case "ContinueStatement":
      break;
    // TS declarations - visit for inline imports in type annotations
    case "TSTypeAliasDeclaration":
      visitTypeNode(ctx, node.typeAnnotation);
      break;
    case "TSInterfaceDeclaration":
      visitInterfaceBody(ctx, node.body);
      break;
    case "TSEnumDeclaration":
    case "TSModuleDeclaration":
    case "TSDeclareFunction":
    case "TSImportEqualsDeclaration":
    case "TSExportAssignment":
    case "TSNamespaceExportDeclaration":
      break;
    // These don't appear as statements
    case "ImportDeclaration":
    case "ExportNamedDeclaration":
    case "ExportDefaultDeclaration":
    case "ExportAllDeclaration":
      break;
  }
}

export function visitBlockStatement(ctx: VisitorContext, node: T.BlockStatement): void {
  if (node.body.length === 0) return;
  for (let i = 0, len = node.body.length; i < len; i++) {
    const stmt = node.body[i];
    if (!stmt) continue;
    visitStatement(ctx, stmt);
  }
}

export function visitIfStatement(ctx: VisitorContext, node: T.IfStatement): void {
  visitExpression(ctx, node.test);
  ctx.conditionalDepth++;
  visitStatement(ctx, node.consequent);
  if (node.alternate) visitStatement(ctx, node.alternate);
  ctx.conditionalDepth--;
}

export function visitForStatement(ctx: VisitorContext, node: T.ForStatement): void {
  if (node.init) {
    if (node.init.type === "VariableDeclaration") {
      visitVariableDeclaration(ctx, node.init);
    } else {
      visitExpression(ctx, node.init);
    }
  }
  if (node.test) visitExpression(ctx, node.test);
  if (node.update) visitExpression(ctx, node.update);
  ctx.loopDepth++;
  visitStatement(ctx, node.body);
  ctx.loopDepth--;
}

export function visitForInOfStatement(ctx: VisitorContext, node: T.ForInStatement | T.ForOfStatement): void {
  if (node.left.type === "VariableDeclaration") {
    visitVariableDeclaration(ctx, node.left);
  }
  visitExpression(ctx, node.right);
  ctx.loopDepth++;
  visitStatement(ctx, node.body);
  ctx.loopDepth--;
}

export function visitSwitchStatement(ctx: VisitorContext, node: T.SwitchStatement): void {
  visitExpression(ctx, node.discriminant);
  ctx.conditionalDepth++;
  for (let i = 0, len = node.cases.length; i < len; i++) {
    const c = node.cases[i];
    if (!c) continue;
    if (c.test) visitExpression(ctx, c.test);
    for (let j = 0, clen = c.consequent.length; j < clen; j++) {
      const consequent = c.consequent[j];
      if (!consequent) continue;
      visitStatement(ctx, consequent);
    }
  }
  ctx.conditionalDepth--;
}

export function visitTryStatement(ctx: VisitorContext, node: T.TryStatement): void {
  visitBlockStatement(ctx, node.block);
  if (node.handler) visitBlockStatement(ctx, node.handler.body);
  if (node.finalizer) visitBlockStatement(ctx, node.finalizer);
}

export function visitVariableDeclaration(ctx: VisitorContext, node: T.VariableDeclaration): void {
  if (node.declarations.length === 0) return;

  for (let i = 0, len = node.declarations.length; i < len; i++) {
    const decl = node.declarations[i];
    if (!decl) continue;
    if (decl.id.typeAnnotation) {
      visitTypeNode(ctx, decl.id.typeAnnotation.typeAnnotation);
    }
    // Check for rest destructuring: const { a, ...rest } = obj
    if (decl.id.type === "ObjectPattern") {
      visitObjectPattern(ctx, decl.id, decl.init);
    }
    if (decl.init) visitExpression(ctx, decl.init);
  }
}

export function visitObjectPattern(ctx: VisitorContext, pattern: T.ObjectPattern, init: T.Expression | null): void {
  const properties = pattern.properties;
  for (let i = 0, len = properties.length; i < len; i++) {
    const prop = properties[i];
    if (!prop) continue;
    if (prop.type === "RestElement") {
      handleRestDestructure(ctx, prop, pattern, init);
    }
  }
}

export function visitDeclaration(ctx: VisitorContext, node: NonNullable<T.ExportNamedDeclaration["declaration"]>): void {
  switch (node.type) {
    case "FunctionDeclaration":
      handleFunction(ctx, node);
      visitFunctionBody(ctx, node.body);
      ctx.functionStack.pop();
      break;
    case "ClassDeclaration":
      handleClass(ctx, node);
      visitClassBody(ctx, node.body);
      ctx.classStack.pop();
      break;
    case "VariableDeclaration":
      visitVariableDeclaration(ctx, node);
      break;
    case "TSTypeAliasDeclaration":
    case "TSInterfaceDeclaration":
    case "TSEnumDeclaration":
    case "TSModuleDeclaration":
    case "TSDeclareFunction":
      break;
  }
}

export function visitExportDefaultDeclaration(ctx: VisitorContext, node: T.ExportDefaultDeclaration): void {
  const decl = node.declaration;
  if (decl.type === "FunctionDeclaration") {
    handleFunction(ctx, decl);
    visitFunctionBody(ctx, decl.body);
    ctx.functionStack.pop();
    return;
  }
  if (decl.type === "ClassDeclaration") {
    handleClass(ctx, decl);
    visitClassBody(ctx, decl.body);
    ctx.classStack.pop()
    return;
  }
  // Skip TypeScript-only declarations
  if (
    decl.type === "TSDeclareFunction" ||
    decl.type === "TSInterfaceDeclaration" ||
    decl.type === "TSEnumDeclaration" ||
    decl.type === "TSModuleDeclaration" ||
    decl.type === "TSTypeAliasDeclaration"
  ) {
    return;
  }
  // Handle VariableDeclaration (e.g., export default const x = ...)
  if (decl.type === "VariableDeclaration") {
    visitVariableDeclaration(ctx, decl);
    return;
  }
  // Now TypeScript knows decl is Expression
  visitExpression(ctx, decl);
}

export function visitClassBody(ctx: VisitorContext, node: T.ClassBody): void {
  if (node.body.length === 0 || ctx.classStack.length === 0) return;
  const currentClass = ctx.classStack[ctx.classStack.length - 1];
  if (!currentClass) return;

  for (let i = 0, len = node.body.length; i < len; i++) {
    const member = node.body[i];
    if (!member) continue;
    switch (member.type) {
      case "MethodDefinition":
        if (member.value && member.value.type !== "TSEmptyBodyFunctionExpression") {
          handleFunction(ctx, member.value);
          const fn = ctx.functionStack[ctx.functionStack.length - 1];
          if (!fn) break;
          if (member.kind === "constructor") {
            currentClass.constructor = fn;
          } else {
            currentClass.methods.push(fn);
          }
          if (member.value.body) {
            visitFunctionBody(ctx, member.value.body);
          }
          ctx.functionStack.pop();
        }
        break;
      case "PropertyDefinition":
        handleProperty(ctx, member, currentClass);
        if (member.typeAnnotation) visitTypeNode(ctx, member.typeAnnotation.typeAnnotation);
        if (member.value) visitExpression(ctx, member.value);
        break;
      case "StaticBlock":
        for (let j = 0, slen = member.body.length; j < slen; j++) {
          const stmt = member.body[j];
          if (!stmt) continue;
          visitStatement(ctx, stmt);
        }
        break;
      case "AccessorProperty":
        if (member.value) visitExpression(ctx, member.value);
        break;
      case "TSAbstractMethodDefinition":
      case "TSAbstractPropertyDefinition":
      case "TSAbstractAccessorProperty":
      case "TSIndexSignature":
        break;
    }
  }
}
