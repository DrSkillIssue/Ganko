import type { CSSSyntaxTree } from "../core/css-syntax-tree"
import type { SymbolTable } from "./symbol-table"
import type { TailwindValidator } from "../../css/tailwind"
import { buildSymbolTable } from "./symbol-table"

export interface DeclarationTable {
  readonly generation: number
  withTree(tree: CSSSyntaxTree): DeclarationTable
  withoutTree(filePath: string): DeclarationTable
  withTailwindValidator(validator: TailwindValidator | null): DeclarationTable
  materialize(): SymbolTable
}

class DeclarationTableImpl implements DeclarationTable {
  readonly generation: number
  private readonly _olderTrees: ReadonlyMap<string, CSSSyntaxTree>
  private readonly _latestTree: CSSSyntaxTree | null
  private _cachedTable: SymbolTable | null
  private readonly _tailwindValidator: TailwindValidator | null

  constructor(
    olderTrees: ReadonlyMap<string, CSSSyntaxTree>,
    latestTree: CSSSyntaxTree | null,
    cachedTable: SymbolTable | null,
    generation: number,
    tailwindValidator: TailwindValidator | null,
  ) {
    this._olderTrees = olderTrees
    this._latestTree = latestTree
    this._cachedTable = cachedTable
    this.generation = generation
    this._tailwindValidator = tailwindValidator
  }

  withTree(tree: CSSSyntaxTree): DeclarationTable {
    const olderTrees = new Map(this._olderTrees)
    const prev = this._latestTree
    if (prev !== null) {
      olderTrees.set(prev.filePath, prev)
    }

    if (olderTrees.has(tree.filePath)) {
      olderTrees.delete(tree.filePath)
    }

    return new DeclarationTableImpl(
      olderTrees,
      tree,
      null,
      this.generation + 1,
      this._tailwindValidator,
    )
  }

  withoutTree(filePath: string): DeclarationTable {
    if (this._latestTree !== null && this._latestTree.filePath === filePath) {
      return new DeclarationTableImpl(
        this._olderTrees,
        null,
        null,
        this.generation + 1,
        this._tailwindValidator,
      )
    }

    if (!this._olderTrees.has(filePath)) {
      return this
    }

    const olderTrees = new Map(this._olderTrees)
    olderTrees.delete(filePath)
    return new DeclarationTableImpl(
      olderTrees,
      this._latestTree,
      null,
      this.generation + 1,
      this._tailwindValidator,
    )
  }

  withTailwindValidator(validator: TailwindValidator | null): DeclarationTable {
    return new DeclarationTableImpl(
      this._olderTrees,
      this._latestTree,
      null,
      this.generation + 1,
      validator,
    )
  }

  materialize(): SymbolTable {
    if (this._cachedTable !== null) {
      return this._cachedTable
    }

    const allTrees: CSSSyntaxTree[] = []
    for (const tree of this._olderTrees.values()) {
      allTrees.push(tree)
    }
    if (this._latestTree !== null) {
      allTrees.push(this._latestTree)
    }

    const table = buildSymbolTable(allTrees, this._tailwindValidator)
    this._cachedTable = table
    return table
  }
}

const EMPTY_OLDER: ReadonlyMap<string, CSSSyntaxTree> = new Map()

export function createDeclarationTable(): DeclarationTable {
  return new DeclarationTableImpl(EMPTY_OLDER, null, null, 0, null)
}
