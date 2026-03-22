import type { SelectorEntity } from "../../css/entities/selector"
import type {
  TailwindParsedCandidate,
  TailwindResolvedDeclaration,
  TailwindCandidateDiagnostic,
} from "../providers/tailwind"

export interface CSSClassNameSource {
  readonly kind: "css"
  readonly selectors: readonly SelectorEntity[]
  readonly filePaths: readonly string[]
}

export interface TailwindClassNameSource {
  readonly kind: "tailwind"
  readonly candidate: TailwindParsedCandidate
  readonly resolvedCSS: string | null
  readonly declarations: readonly TailwindResolvedDeclaration[]
  readonly diagnostics: readonly TailwindCandidateDiagnostic[]
}

export type ClassNameSource = CSSClassNameSource | TailwindClassNameSource

export interface ClassNameSymbol {
  readonly symbolKind: "className"
  readonly name: string
  readonly filePath: string | null
  readonly source: ClassNameSource
}

export function createClassNameSymbol(
  name: string,
  selectors: readonly SelectorEntity[],
  filePaths: readonly string[],
): ClassNameSymbol {
  return {
    symbolKind: "className",
    name,
    filePath: filePaths.length > 0 ? filePaths[0]! : null,
    source: {
      kind: "css",
      selectors,
      filePaths,
    },
  }
}
