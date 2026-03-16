import ts from "typescript";
import type { VisitorContext } from "../context";
import { visitExpression, visitFunctionBody } from "./expression";
import { visitTypeNode, visitInterfaceBody } from "./type";
import { handleImport } from "../handlers/import";
import { handleFunction } from "../handlers/function";
import { handleClass, handleProperty } from "../handlers/class";
import { handleReturnStatement, handleThrowStatement } from "../handlers/misc";
import { handleRestDestructure } from "../handlers/spread";
export function visitProgram(ctx: VisitorContext, node: ts.SourceFile): void {
  if (node.statements.length === 0) return;

  for (let i = 0, len = node.statements.length; i < len; i++) {
    const stmt = node.statements[i];
    if (!stmt) continue;
    visitProgramStatement(ctx, stmt);
  }
}

export function visitProgramStatement(ctx: VisitorContext, node: ts.Statement): void {
  if (ts.isImportDeclaration(node)) {
    handleImport(ctx, node);
    return;
  }

  if (ts.isExportDeclaration(node)) {
    // ExportNamedDeclaration without declaration — skip
    return;
  }

  if (ts.isExportAssignment(node)) {
    // export default expression
    if (node.expression) {
      visitExpression(ctx, node.expression);
    }
    return;
  }

  if (ts.isFunctionDeclaration(node)) {
    // Check if it's an export
    handleFunction(ctx, node);
    if (node.body) visitFunctionBody(ctx, node.body);
    ctx.functionStack.pop();
    return;
  }

  if (ts.isClassDeclaration(node)) {
    handleClass(ctx, node);
    visitClassBody(ctx, node);
    ctx.classStack.pop();
    return;
  }

  if (ts.isVariableStatement(node)) {
    visitVariableDeclaration(ctx, node.declarationList);
    return;
  }

  if (ts.isExpressionStatement(node)) {
    visitExpression(ctx, node.expression);
    return;
  }

  if (ts.isBlock(node)) {
    visitBlockStatement(ctx, node);
    return;
  }

  if (ts.isIfStatement(node)) {
    visitIfStatement(ctx, node);
    return;
  }

  if (ts.isForStatement(node)) {
    visitForStatement(ctx, node);
    return;
  }

  if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
    visitForInOfStatement(ctx, node);
    return;
  }

  if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
    visitExpression(ctx, node.expression);
    visitStatement(ctx, node.statement);
    return;
  }

  if (ts.isSwitchStatement(node)) {
    visitSwitchStatement(ctx, node);
    return;
  }

  if (ts.isTryStatement(node)) {
    visitTryStatement(ctx, node);
    return;
  }

  if (ts.isReturnStatement(node)) {
    handleReturnStatement(ctx, node);
    if (node.expression) visitExpression(ctx, node.expression);
    return;
  }

  if (ts.isThrowStatement(node)) {
    handleThrowStatement(ctx);
    if (node.expression) visitExpression(ctx, node.expression);
    return;
  }

  if (ts.isLabeledStatement(node)) {
    visitStatement(ctx, node.statement);
    return;
  }

  if (ts.isWithStatement(node)) {
    visitExpression(ctx, node.expression);
    visitStatement(ctx, node.statement);
    return;
  }

  // TypeScript declarations - visit for inline imports in type annotations
  if (ts.isTypeAliasDeclaration(node)) {
    visitTypeNode(ctx, node.type);
    return;
  }

  if (ts.isInterfaceDeclaration(node)) {
    visitInterfaceBody(ctx, node);
    return;
  }

  // Empty statements, debugger, break, continue, enum, module, declare function - no children
}

export function visitStatement(ctx: VisitorContext, node: ts.Statement): void {
  if (ts.isBlock(node)) {
    visitBlockStatement(ctx, node);
    return;
  }

  if (ts.isExpressionStatement(node)) {
    visitExpression(ctx, node.expression);
    return;
  }

  if (ts.isIfStatement(node)) {
    visitIfStatement(ctx, node);
    return;
  }

  if (ts.isForStatement(node)) {
    visitForStatement(ctx, node);
    return;
  }

  if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
    visitForInOfStatement(ctx, node);
    return;
  }

  if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
    ctx.loopDepth++;
    visitExpression(ctx, node.expression);
    visitStatement(ctx, node.statement);
    ctx.loopDepth--;
    return;
  }

  if (ts.isSwitchStatement(node)) {
    visitSwitchStatement(ctx, node);
    return;
  }

  if (ts.isTryStatement(node)) {
    visitTryStatement(ctx, node);
    return;
  }

  if (ts.isReturnStatement(node)) {
    handleReturnStatement(ctx, node);
    if (node.expression) visitExpression(ctx, node.expression);
    return;
  }

  if (ts.isThrowStatement(node)) {
    handleThrowStatement(ctx);
    if (node.expression) visitExpression(ctx, node.expression);
    return;
  }

  if (ts.isVariableStatement(node)) {
    visitVariableDeclaration(ctx, node.declarationList);
    return;
  }

  if (ts.isFunctionDeclaration(node)) {
    handleFunction(ctx, node);
    if (node.body) visitFunctionBody(ctx, node.body);
    ctx.functionStack.pop();
    return;
  }

  if (ts.isClassDeclaration(node)) {
    handleClass(ctx, node);
    visitClassBody(ctx, node);
    ctx.classStack.pop();
    return;
  }

  if (ts.isLabeledStatement(node)) {
    visitStatement(ctx, node.statement);
    return;
  }

  if (ts.isWithStatement(node)) {
    visitExpression(ctx, node.expression);
    visitStatement(ctx, node.statement);
    return;
  }

  // TS declarations - visit for inline imports in type annotations
  if (ts.isTypeAliasDeclaration(node)) {
    visitTypeNode(ctx, node.type);
    return;
  }

  if (ts.isInterfaceDeclaration(node)) {
    visitInterfaceBody(ctx, node);
    return;
  }

  // Empty, debugger, break, continue, import, export - no children
}

export function visitBlockStatement(ctx: VisitorContext, node: ts.Block): void {
  if (node.statements.length === 0) return;
  for (let i = 0, len = node.statements.length; i < len; i++) {
    const stmt = node.statements[i];
    if (!stmt) continue;
    visitStatement(ctx, stmt);
  }
}

export function visitIfStatement(ctx: VisitorContext, node: ts.IfStatement): void {
  visitExpression(ctx, node.expression);
  ctx.conditionalDepth++;
  visitStatement(ctx, node.thenStatement);
  if (node.elseStatement) visitStatement(ctx, node.elseStatement);
  ctx.conditionalDepth--;
}

export function visitForStatement(ctx: VisitorContext, node: ts.ForStatement): void {
  if (node.initializer) {
    if (ts.isVariableDeclarationList(node.initializer)) {
      visitVariableDeclaration(ctx, node.initializer);
    } else {
      visitExpression(ctx, node.initializer);
    }
  }
  if (node.condition) visitExpression(ctx, node.condition);
  if (node.incrementor) visitExpression(ctx, node.incrementor);
  ctx.loopDepth++;
  visitStatement(ctx, node.statement);
  ctx.loopDepth--;
}

export function visitForInOfStatement(ctx: VisitorContext, node: ts.ForInStatement | ts.ForOfStatement): void {
  if (ts.isVariableDeclarationList(node.initializer)) {
    visitVariableDeclaration(ctx, node.initializer);
  }
  visitExpression(ctx, node.expression);
  ctx.loopDepth++;
  visitStatement(ctx, node.statement);
  ctx.loopDepth--;
}

export function visitSwitchStatement(ctx: VisitorContext, node: ts.SwitchStatement): void {
  visitExpression(ctx, node.expression);
  ctx.conditionalDepth++;
  for (let i = 0, len = node.caseBlock.clauses.length; i < len; i++) {
    const c = node.caseBlock.clauses[i];
    if (!c) continue;
    if (ts.isCaseClause(c) && c.expression) visitExpression(ctx, c.expression);
    for (let j = 0, clen = c.statements.length; j < clen; j++) {
      const consequent = c.statements[j];
      if (!consequent) continue;
      visitStatement(ctx, consequent);
    }
  }
  ctx.conditionalDepth--;
}

export function visitTryStatement(ctx: VisitorContext, node: ts.TryStatement): void {
  visitBlockStatement(ctx, node.tryBlock);
  if (node.catchClause) visitBlockStatement(ctx, node.catchClause.block);
  if (node.finallyBlock) visitBlockStatement(ctx, node.finallyBlock);
}

export function visitVariableDeclaration(ctx: VisitorContext, node: ts.VariableDeclarationList): void {
  if (node.declarations.length === 0) return;

  for (let i = 0, len = node.declarations.length; i < len; i++) {
    const decl = node.declarations[i];
    if (!decl) continue;
    if (decl.type) {
      visitTypeNode(ctx, decl.type);
    }
    // Check for rest destructuring: const { a, ...rest } = obj
    if (ts.isObjectBindingPattern(decl.name)) {
      visitObjectPattern(ctx, decl.name, decl.initializer ?? null);
    }
    if (decl.initializer) visitExpression(ctx, decl.initializer);
  }
}

export function visitObjectPattern(ctx: VisitorContext, pattern: ts.ObjectBindingPattern, init: ts.Expression | null): void {
  const elements = pattern.elements;
  for (let i = 0, len = elements.length; i < len; i++) {
    const el = elements[i];
    if (!el) continue;
    if (el.dotDotDotToken) {
      handleRestDestructure(ctx, el, pattern, init);
    }
  }
}

export function visitDeclaration(ctx: VisitorContext, node: ts.Declaration): void {
  if (ts.isFunctionDeclaration(node)) {
    handleFunction(ctx, node);
    if (node.body) visitFunctionBody(ctx, node.body);
    ctx.functionStack.pop();
    return;
  }

  if (ts.isClassDeclaration(node)) {
    handleClass(ctx, node);
    visitClassBody(ctx, node);
    ctx.classStack.pop();
    return;
  }

  if (ts.isVariableStatement(node)) {
    visitVariableDeclaration(ctx, node.declarationList);
    return;
  }

  // TypeAlias, Interface, Enum, Module, DeclareFunction - skip
}

export function visitExportDefaultDeclaration(ctx: VisitorContext, node: ts.ExportAssignment): void {
  const decl = node.expression;
  if (ts.isFunctionExpression(decl)) {
    handleFunction(ctx, decl);
    visitFunctionBody(ctx, decl.body);
    ctx.functionStack.pop();
    return;
  }
  if (ts.isClassExpression(decl)) {
    handleClass(ctx, decl);
    visitClassBody(ctx, decl);
    ctx.classStack.pop();
    return;
  }
  visitExpression(ctx, decl);
}

export function visitClassBody(ctx: VisitorContext, node: ts.ClassDeclaration | ts.ClassExpression): void {
  const members = node.members;
  if (members.length === 0 || ctx.classStack.length === 0) return;
  const currentClass = ctx.classStack[ctx.classStack.length - 1];
  if (!currentClass) return;

  for (let i = 0, len = members.length; i < len; i++) {
    const member = members[i];
    if (!member) continue;

    if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) {
      if (member.body) {
        // For methods, wrap in FunctionExpression-like handling
        handleFunction(ctx, member as any);
        const fn = ctx.functionStack[ctx.functionStack.length - 1];
        if (!fn) continue;
        if (ts.isConstructorDeclaration(member)) {
          currentClass.constructor = fn;
        } else {
          currentClass.methods.push(fn);
        }
        visitFunctionBody(ctx, member.body);
        ctx.functionStack.pop();
      }
    } else if (ts.isPropertyDeclaration(member)) {
      handleProperty(ctx, member, currentClass);
      if (member.type) visitTypeNode(ctx, member.type);
      if (member.initializer) visitExpression(ctx, member.initializer);
    } else if (ts.isClassStaticBlockDeclaration(member)) {
      visitBlockStatement(ctx, member.body);
    } else if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
      if (member.body) {
        visitFunctionBody(ctx, member.body);
      }
    }
    // TSAbstractMethodDefinition, TSAbstractPropertyDefinition, TSIndexSignature - skip
  }
}
