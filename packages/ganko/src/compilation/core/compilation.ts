import type { SolidSyntaxTree } from "./solid-syntax-tree";
import type { CSSSyntaxTree } from "./css-syntax-tree";
import type { SymbolTable } from "../symbols/symbol-table";
import { buildSymbolTable } from "../symbols/symbol-table";
import type { DependencyGraph } from "../incremental/dependency-graph";
import { buildDependencyGraph } from "../incremental/dependency-graph";
import { createFileSemanticModel, type FileSemanticModel } from "../binding/semantic-model";
import type { TailwindValidator } from "../../css/tailwind";

export interface TailwindConfigInput {
  readonly kind: "tailwind-config";
  readonly filePath: string;
  readonly version: string;
  readonly validator: TailwindValidator | null;
}

export interface PackageManifestInput {
  readonly kind: "package-manifest";
  readonly filePath: string;
  readonly version: string;
}

export interface TSConfigInput {
  readonly kind: "tsconfig";
  readonly filePath: string;
  readonly version: string;
}

export interface StyleCompilation {
  readonly id: number;

  readonly solidTrees: ReadonlyMap<string, SolidSyntaxTree>;
  readonly cssTrees: ReadonlyMap<string, CSSSyntaxTree>;

  readonly tailwindConfig: TailwindConfigInput | null;
  readonly packageManifest: PackageManifestInput | null;
  readonly tsConfig: TSConfigInput | null;

  readonly symbolTable: SymbolTable;
  readonly dependencyGraph: DependencyGraph;

  withSolidTree(tree: SolidSyntaxTree): StyleCompilation;
  withCSSTrees(trees: readonly CSSSyntaxTree[]): StyleCompilation;
  withCSSTree(tree: CSSSyntaxTree): StyleCompilation;
  withoutFile(filePath: string): StyleCompilation;
  withTailwindConfig(config: TailwindConfigInput | null): StyleCompilation;
  withPackageManifest(manifest: PackageManifestInput | null): StyleCompilation;
  withTSConfig(config: TSConfigInput | null): StyleCompilation;
  withFile(filePath: string, tree: SolidSyntaxTree | CSSSyntaxTree): StyleCompilation;

  getSolidTree(filePath: string): SolidSyntaxTree | null;
  getCSSTree(filePath: string): CSSSyntaxTree | null;
  getSemanticModel(solidFilePath: string): FileSemanticModel;

  getSolidFilePaths(): readonly string[];
  getCSSFilePaths(): readonly string[];
}

let nextId = 1;

const EMPTY_SOLID: ReadonlyMap<string, SolidSyntaxTree> = new Map();
const EMPTY_CSS: ReadonlyMap<string, CSSSyntaxTree> = new Map();

function makeCompilation(
  solidTrees: ReadonlyMap<string, SolidSyntaxTree>,
  cssTrees: ReadonlyMap<string, CSSSyntaxTree>,
  tailwindConfig: TailwindConfigInput | null,
  packageManifest: PackageManifestInput | null,
  tsConfig: TSConfigInput | null,
): StyleCompilation {
  const id = nextId++;
  let cachedSymbolTable: SymbolTable | null = null
  let cachedDependencyGraph: DependencyGraph | null = null
  const cachedSemanticModels = new Map<string, FileSemanticModel>()

  const self: StyleCompilation = {
    id,
    solidTrees,
    cssTrees,
    tailwindConfig,
    packageManifest,
    tsConfig,

    get symbolTable(): SymbolTable {
      if (cachedSymbolTable === null) {
        const allCssTrees: CSSSyntaxTree[] = []
        for (const tree of cssTrees.values()) allCssTrees.push(tree)
        cachedSymbolTable = buildSymbolTable(allCssTrees, tailwindConfig?.validator ?? null)
      }
      return cachedSymbolTable
    },

    get dependencyGraph(): DependencyGraph {
      if (cachedDependencyGraph === null) {
        cachedDependencyGraph = buildDependencyGraph(solidTrees, cssTrees)
      }
      return cachedDependencyGraph
    },

    withSolidTree(tree: SolidSyntaxTree): StyleCompilation {
      const next = new Map(solidTrees);
      next.set(tree.filePath, tree);
      return makeCompilation(next, cssTrees, tailwindConfig, packageManifest, tsConfig);
    },

    withCSSTree(tree: CSSSyntaxTree): StyleCompilation {
      const next = new Map(cssTrees);
      next.set(tree.filePath, tree);
      return makeCompilation(solidTrees, next, tailwindConfig, packageManifest, tsConfig);
    },

    withCSSTrees(trees: readonly CSSSyntaxTree[]): StyleCompilation {
      const next = new Map(cssTrees);
      for (let i = 0; i < trees.length; i++) {
        const t = trees[i]!;
        next.set(t.filePath, t);
      }
      return makeCompilation(solidTrees, next, tailwindConfig, packageManifest, tsConfig);
    },

    withoutFile(filePath: string): StyleCompilation {
      const hasSolid = solidTrees.has(filePath);
      const hasCSS = cssTrees.has(filePath);
      if (!hasSolid && !hasCSS) return this;

      let nextSolid = solidTrees;
      let nextCSS = cssTrees;
      if (hasSolid) {
        nextSolid = new Map(solidTrees);
        (nextSolid as Map<string, SolidSyntaxTree>).delete(filePath);
      }
      if (hasCSS) {
        nextCSS = new Map(cssTrees);
        (nextCSS as Map<string, CSSSyntaxTree>).delete(filePath);
      }
      return makeCompilation(nextSolid, nextCSS, tailwindConfig, packageManifest, tsConfig);
    },

    withTailwindConfig(config: TailwindConfigInput | null): StyleCompilation {
      return makeCompilation(solidTrees, cssTrees, config, packageManifest, tsConfig);
    },

    withPackageManifest(manifest: PackageManifestInput | null): StyleCompilation {
      return makeCompilation(solidTrees, cssTrees, tailwindConfig, manifest, tsConfig);
    },

    withTSConfig(config: TSConfigInput | null): StyleCompilation {
      return makeCompilation(solidTrees, cssTrees, tailwindConfig, packageManifest, config);
    },

    withFile(_filePath: string, tree: SolidSyntaxTree | CSSSyntaxTree): StyleCompilation {
      if (tree.kind === "solid") {
        return this.withSolidTree(tree);
      }
      return this.withCSSTree(tree);
    },

    getSolidTree(filePath: string): SolidSyntaxTree | null {
      return solidTrees.get(filePath) ?? null;
    },

    getCSSTree(filePath: string): CSSSyntaxTree | null {
      return cssTrees.get(filePath) ?? null;
    },

    getSemanticModel(solidFilePath: string): FileSemanticModel {
      const cached = cachedSemanticModels.get(solidFilePath)
      if (cached !== undefined) return cached
      const solidTree = solidTrees.get(solidFilePath)
      if (!solidTree) throw new Error(`No solid tree for ${solidFilePath}`)
      const model = createFileSemanticModel(solidTree, self.symbolTable, self.dependencyGraph, self)
      cachedSemanticModels.set(solidFilePath, model)
      return model
    },

    getSolidFilePaths(): readonly string[] {
      const keys = solidTrees.keys();
      const out: string[] = [];
      for (const k of keys) out.push(k);
      return out;
    },

    getCSSFilePaths(): readonly string[] {
      const keys = cssTrees.keys();
      const out: string[] = [];
      for (const k of keys) out.push(k);
      return out;
    },
  }

  return self
}

export function createStyleCompilation(): StyleCompilation {
  return makeCompilation(EMPTY_SOLID, EMPTY_CSS, null, null, null);
}

export function createCompilationFromLegacy(
  solidTrees: readonly SolidSyntaxTree[],
  cssTrees: readonly CSSSyntaxTree[],
): StyleCompilation {
  const solidMap = new Map<string, SolidSyntaxTree>();
  for (let i = 0; i < solidTrees.length; i++) {
    const t = solidTrees[i];
    if (t) solidMap.set(t.filePath, t);
  }

  const cssMap = new Map<string, CSSSyntaxTree>();
  for (let i = 0; i < cssTrees.length; i++) {
    const t = cssTrees[i];
    if (t) cssMap.set(t.filePath, t);
  }

  return makeCompilation(solidMap, cssMap, null, null, null);
}
