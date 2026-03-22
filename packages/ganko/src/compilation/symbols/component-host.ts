export interface ComponentHostSymbol {
  readonly symbolKind: "componentHost"
  readonly name: string
  readonly filePath: string | null
  readonly importSource: string
  readonly exportName: string
  readonly hostTag: string | null
  readonly hostClassTokens: readonly string[]
  readonly hostAttributes: ReadonlyMap<string, string | null>
  readonly resolvedFilePath: string
}
