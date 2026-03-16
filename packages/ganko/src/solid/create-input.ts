import type ts from "typescript"
import type { Logger } from "@drskillissue/ganko-shared"
import type { SolidInput } from "./input"

export function createSolidInput(
  filePath: string,
  program: ts.Program,
  logger?: Logger,
): SolidInput {
  const sourceFile = program.getSourceFile(filePath)
  if (!sourceFile) {
    throw new Error(`File not found in program: ${filePath}`)
  }
  const input: { -readonly [K in keyof SolidInput]: SolidInput[K] } = {
    file: filePath,
    sourceFile,
    checker: program.getTypeChecker(),
  }
  if (logger !== undefined) input.logger = logger
  return input
}
