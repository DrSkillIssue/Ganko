import type { SolidSyntaxTree } from "./solid-syntax-tree";
import type { CSSSyntaxTree } from "./css-syntax-tree";

export interface TailwindConfigInput {
  readonly kind: "tailwind-config";
  readonly filePath: string;
  readonly version: string;
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

  readonly symbolTable: never;
  readonly dependencyGraph: never;

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
  getSemanticModel(solidFilePath: string): never;

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

  return {
    id,
    solidTrees,
    cssTrees,
    tailwindConfig,
    packageManifest,
    tsConfig,

    get symbolTable(): never {
      throw new Error("Not implemented: Phase 2 required");
    },

    get dependencyGraph(): never {
      throw new Error("Not implemented: Phase 3 required");
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

    getSemanticModel(): never {
      throw new Error("Not implemented: Phase 5 required");
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
  };
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
    const t = solidTrees[i]!;
    solidMap.set(t.filePath, t);
  }

  const cssMap = new Map<string, CSSSyntaxTree>();
  for (let i = 0; i < cssTrees.length; i++) {
    const t = cssTrees[i]!;
    cssMap.set(t.filePath, t);
  }

  return makeCompilation(solidMap, cssMap, null, null, null);
}
