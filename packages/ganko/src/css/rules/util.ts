import { createDiagnosticFromLoc, effectiveSeverity } from "../../diagnostic"
import type { Emit } from "../../graph"
import type { CSSRule } from "../rule"

export function emitCSSDiagnostic(
  emit: Emit,
  file: string,
  line: number,
  column: number,
  rule: CSSRule,
  messageId: string,
  message: string,
): void {
  const safeLine = line > 0 ? line : 1
  const safeColumn = column > 0 ? column : 1

  emit(
    createDiagnosticFromLoc(
      file,
      {
        start: { line: safeLine, column: safeColumn },
        end: { line: safeLine, column: safeColumn + 1 },
      },
      rule.id,
      messageId,
      message,
      effectiveSeverity(rule.severity),
    ),
  )
}
