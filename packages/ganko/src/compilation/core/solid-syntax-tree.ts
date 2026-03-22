import type ts from "typescript";
import type { CommentEntry } from "../../diagnostic";
import type { ScopeEntity } from "../../solid/entities/scope";
import type { VariableEntity } from "../../solid/entities/variable";
import type { FunctionEntity } from "../../solid/entities/function";
import type { CallEntity, ArgumentEntity } from "../../solid/entities/call";
import type { JSXElementEntity, JSXAttributeEntity } from "../../solid/entities/jsx";
import type { ImportEntity } from "../../solid/entities/import";
import type { ExportEntity } from "../../solid/entities/export";
import type { ClassEntity } from "../../solid/entities/class";
import type { PropertyEntity } from "../../solid/entities/property";
import type { PropertyAssignmentEntity } from "../../solid/entities/property-assignment";
import type { ConditionalSpreadEntity, ObjectSpreadEntity } from "../../solid/entities/spread";
import type { NonNullAssertionEntity } from "../../solid/entities/non-null-assertion";
import type { TypeAssertionEntity, TypePredicateEntity, UnsafeGenericAssertionEntity, UnsafeTypeAnnotationEntity } from "../../solid/entities/type-assertion";
import type { InlineImportEntity } from "../../solid/entities/inline-import";
import type { ComputationEntity, DependencyEdge, OwnershipEdge } from "../../solid/entities/computation";
import type { FileEntity } from "../../solid/entities/file";
import type { TypeResolver } from "../../solid/typescript/index";
import type { JSXAttributeKind } from "../../solid/util/jsx";

interface JSXAttributeWithElement {
  readonly attr: JSXAttributeEntity;
  readonly element: JSXElementEntity;
}

interface JSXStaticClassIndex {
  readonly hasDynamicClass: boolean;
  readonly tokens: readonly string[];
}

interface JSXStaticObjectKeyIndex {
  readonly hasDynamic: boolean;
  readonly keys: readonly string[];
}

interface JSXObjectPropertyWithElement {
  readonly property: ts.ObjectLiteralElementLike;
  readonly attr: JSXAttributeEntity;
  readonly element: JSXElementEntity;
}

export interface SolidSyntaxTree {
  readonly kind: "solid";
  readonly filePath: string;
  readonly version: string;
  readonly sourceFile: ts.SourceFile;
  readonly comments: readonly CommentEntry[];

  readonly scopes: readonly ScopeEntity[];
  readonly variables: readonly VariableEntity[];
  readonly functions: readonly FunctionEntity[];
  readonly calls: readonly CallEntity[];
  readonly jsxElements: readonly JSXElementEntity[];
  readonly imports: readonly ImportEntity[];
  readonly exports: readonly ExportEntity[];
  readonly classes: readonly ClassEntity[];
  readonly properties: readonly PropertyEntity[];
  readonly propertyAssignments: readonly PropertyAssignmentEntity[];
  readonly conditionalSpreads: readonly ConditionalSpreadEntity[];
  readonly objectSpreads: readonly ObjectSpreadEntity[];
  readonly nonNullAssertions: readonly NonNullAssertionEntity[];
  readonly typeAssertions: readonly TypeAssertionEntity[];
  readonly typePredicates: readonly TypePredicateEntity[];
  readonly unsafeGenericAssertions: readonly UnsafeGenericAssertionEntity[];
  readonly unsafeTypeAnnotations: readonly UnsafeTypeAnnotationEntity[];
  readonly inlineImports: readonly InlineImportEntity[];
  readonly computations: readonly ComputationEntity[];
  readonly dependencyEdges: readonly DependencyEdge[];
  readonly ownershipEdges: readonly OwnershipEdge[];

  readonly variablesByName: ReadonlyMap<string, readonly VariableEntity[]>;
  readonly functionsByNode: ReadonlyMap<ts.Node, FunctionEntity>;
  readonly functionsByDeclarationNode: ReadonlyMap<ts.Node, FunctionEntity>;
  readonly functionsByName: ReadonlyMap<string, readonly FunctionEntity[]>;
  readonly callsByNode: ReadonlyMap<ts.CallExpression | ts.NewExpression, CallEntity>;
  readonly callsByPrimitive: ReadonlyMap<string, readonly CallEntity[]>;
  readonly callsByMethodName: ReadonlyMap<string, readonly CallEntity[]>;
  readonly callsByArgNode: ReadonlyMap<ts.Node, ArgumentEntity>;
  readonly jsxByNode: ReadonlyMap<ts.Node, JSXElementEntity>;
  readonly jsxByTag: ReadonlyMap<string, readonly JSXElementEntity[]>;
  readonly jsxAttributesByElementId: ReadonlyMap<number, ReadonlyMap<string, JSXAttributeEntity>>;
  readonly jsxAttrsByKind: ReadonlyMap<JSXAttributeKind, readonly JSXAttributeWithElement[]>;
  readonly jsxClassAttributes: readonly JSXAttributeWithElement[];
  readonly jsxClassListAttributes: readonly JSXAttributeWithElement[];
  readonly jsxStyleAttributes: readonly JSXAttributeWithElement[];
  readonly fillImageElements: readonly JSXElementEntity[];
  readonly staticClassTokensByElementId: ReadonlyMap<number, JSXStaticClassIndex>;
  readonly staticClassListKeysByElementId: ReadonlyMap<number, JSXStaticObjectKeyIndex>;
  readonly staticStyleKeysByElementId: ReadonlyMap<number, JSXStaticObjectKeyIndex>;
  readonly classListProperties: readonly JSXObjectPropertyWithElement[];
  readonly styleProperties: readonly JSXObjectPropertyWithElement[];
  readonly inlineStyleClassNames: ReadonlySet<string>;
  readonly importsBySource: ReadonlyMap<string, readonly ImportEntity[]>;
  readonly exportsByName: ReadonlyMap<string, ExportEntity>;
  readonly exportsByEntityId: ReadonlyMap<number, ExportEntity>;
  readonly classesByNode: ReadonlyMap<ts.ClassDeclaration | ts.ClassExpression, ClassEntity>;
  readonly classesByName: ReadonlyMap<string, readonly ClassEntity[]>;
  readonly unaryExpressionsByOperator: ReadonlyMap<ts.SyntaxKind, readonly ts.PrefixUnaryExpression[]>;
  readonly spreadElements: readonly (ts.SpreadElement | ts.SpreadAssignment)[];
  readonly newExpressionsByCallee: ReadonlyMap<string, readonly ts.NewExpression[]>;
  readonly deleteExpressions: readonly ts.DeleteExpression[];
  readonly identifiersByName: ReadonlyMap<string, readonly ts.Identifier[]>;

  readonly firstScope: ScopeEntity | null;
  readonly componentScopes: ReadonlyMap<ScopeEntity, { readonly scope: ScopeEntity; readonly name: string }>;
  readonly componentFunctions: readonly FunctionEntity[];
  readonly functionsWithReactiveCaptures: readonly FunctionEntity[];
  readonly reactiveVariables: readonly VariableEntity[];
  readonly propsVariables: readonly VariableEntity[];
  readonly storeVariables: readonly VariableEntity[];
  readonly resourceVariables: readonly VariableEntity[];
  readonly variablesWithPropertyAssignment: readonly VariableEntity[];
  readonly computationByCallId: ReadonlyMap<number, ComputationEntity>;

  readonly typeResolver: TypeResolver;
  readonly fileEntity: FileEntity;
  readonly lineStartOffsets: readonly number[];

  // Mutable caches used by query functions for memoization
  readonly jsxContextCache: WeakMap<ts.Node, import("../../solid/entities/jsx").JSXContext | null>;
  readonly scopeForCache: WeakMap<ts.Node, ScopeEntity>;
  readonly onDepsCache: WeakMap<ts.Node, boolean>;
  readonly passthroughCache: WeakMap<ts.Node, boolean>;

  findExpressionAtOffset(offset: number): ts.Node | null;
}
