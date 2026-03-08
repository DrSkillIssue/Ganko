import type { TSESTree as T } from "@typescript-eslint/utils";
import type { ClassEntity } from "../../entities/class";
import type { FunctionNode } from "../../entities/function";

export interface ExpressionHandlers {
  handleCall: (node: T.CallExpression | T.NewExpression) => void;
  handleFunction: (node: FunctionNode) => void;
  handleClass: (node: T.ClassDeclaration | T.ClassExpression) => void;
  handleJSXElement: (node: T.JSXElement) => void;
  handleJSXFragment: (node: T.JSXFragment) => void;
  handleObjectSpread: (spread: T.SpreadElement, parent: T.ObjectExpression) => void;
  handleConditionalSpread: (spread: T.SpreadElement, parent: T.ObjectExpression) => void;
  handleMemberExpression: (node: T.MemberExpression) => void;
  handleAssignmentExpression: (node: T.AssignmentExpression) => void;
  handleTypeAssertion: (node: T.TSAsExpression | T.TSTypeAssertion) => void;
  handleNonNullAssertion: (node: T.TSNonNullExpression) => void;
  handleNewExpression: (node: T.NewExpression) => void;  
  visitExpression: (node: T.Expression) => void;
  visitTypeNode: (node: T.TypeNode) => void;
  visitJSXAttributeValues: (attrs: (T.JSXAttribute | T.JSXSpreadAttribute)[]) => void;
  visitJSXChildren: (children: T.JSXChild[]) => void;
  visitFunctionBody: (body: T.BlockStatement | T.Expression) => void;
  visitClassBody: (body: T.ClassBody) => void;
  visitCallArgument: (node: T.CallExpressionArgument) => void;
  visitChainElement: (node: T.ChainElement) => void;
}

export interface StatementHandlers {
  handleImport: (node: T.ImportDeclaration) => void;
  handleFunction: (node: T.FunctionDeclaration | T.FunctionExpression | T.ArrowFunctionExpression) => void;
  handleClass: (node: T.ClassDeclaration | T.ClassExpression) => void;
  handleProperty: (node: T.PropertyDefinition, cls: ClassEntity) => void;
  handleReturnStatement: (node: T.ReturnStatement) => void;
  handleThrowStatement: () => void;
  handleRestDestructure: (rest: T.RestElement, pattern: T.ObjectPattern, init: T.Expression | null) => void;  
  visitExpression: (node: T.Expression) => void;
  visitStatement: (node: T.Statement) => void;
  visitTypeNode: (node: T.TypeNode) => void;
  visitInterfaceBody: (body: T.TSInterfaceBody) => void;
  visitFunctionBody: (body: T.BlockStatement | T.Expression) => void;
  visitClassBody: (body: T.ClassBody) => void;
  visitVariableDeclaration: (node: T.VariableDeclaration) => void;
  visitObjectPattern: (pattern: T.ObjectPattern, init: T.Expression | null) => void;
  visitDeclaration: (node: NonNullable<T.ExportNamedDeclaration["declaration"]>) => void;
}