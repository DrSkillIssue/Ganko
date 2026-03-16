import type ts from "typescript"
import type { Logger } from "@drskillissue/ganko-shared"

export interface SolidInput {
  readonly file: string
  readonly sourceFile: ts.SourceFile
  readonly checker: ts.TypeChecker
  readonly logger?: Logger
}
