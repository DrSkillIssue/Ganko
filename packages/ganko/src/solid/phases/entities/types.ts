import type ts from "typescript";
import type { ClassEntity } from "../../entities/class";

export interface ExpressionHandlers {
  handleCall: (node: ts.CallExpression | ts.NewExpression) => void;
  handleFunction: (node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction) => void;
  handleClass: (node: ts.ClassDeclaration | ts.ClassExpression) => void;
  handleJSXElement: (node: ts.JsxElement) => void;
  handleJSXFragment: (node: ts.JsxFragment) => void;
  handleObjectSpread: (spread: ts.SpreadAssignment, parent: ts.ObjectLiteralExpression) => void;
  handleConditionalSpread: (spread: ts.SpreadAssignment, parent: ts.ObjectLiteralExpression) => void;
  handleMemberExpression: (node: ts.PropertyAccessExpression) => void;
  handleAssignmentExpression: (node: ts.BinaryExpression) => void;
  handleTypeAssertion: (node: ts.AsExpression | ts.TypeAssertion) => void;
  handleNonNullAssertion: (node: ts.NonNullExpression) => void;
  handleNewExpression: (node: ts.NewExpression) => void;
  visitExpression: (node: ts.Expression) => void;
  visitTypeNode: (node: ts.TypeNode) => void;
  visitJSXAttributeValues: (attrs: ts.NodeArray<ts.JsxAttributeLike>) => void;
  visitJSXChildren: (children: ts.NodeArray<ts.JsxChild>) => void;
  visitFunctionBody: (body: ts.Block | ts.Expression) => void;
  visitClassBody: (node: ts.ClassDeclaration | ts.ClassExpression) => void;
  visitCallArgument: (node: ts.Expression) => void;
  visitChainElement: (node: ts.Expression) => void;
}

export interface StatementHandlers {
  handleImport: (node: ts.ImportDeclaration) => void;
  handleFunction: (node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction) => void;
  handleClass: (node: ts.ClassDeclaration | ts.ClassExpression) => void;
  handleProperty: (node: ts.PropertyDeclaration, cls: ClassEntity) => void;
  handleReturnStatement: (node: ts.ReturnStatement) => void;
  handleThrowStatement: () => void;
  handleRestDestructure: (rest: ts.BindingElement, pattern: ts.ObjectBindingPattern, init: ts.Expression | null) => void;
  visitExpression: (node: ts.Expression) => void;
  visitStatement: (node: ts.Statement) => void;
  visitTypeNode: (node: ts.TypeNode) => void;
  visitInterfaceBody: (decl: ts.InterfaceDeclaration) => void;
  visitFunctionBody: (body: ts.Block | ts.Expression) => void;
  visitClassBody: (node: ts.ClassDeclaration | ts.ClassExpression) => void;
  visitVariableDeclaration: (node: ts.VariableDeclarationList) => void;
  visitObjectPattern: (pattern: ts.ObjectBindingPattern, init: ts.Expression | null) => void;
  visitDeclaration: (node: ts.Declaration) => void;
}
