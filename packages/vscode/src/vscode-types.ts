import type { RuleSeveritySettingValue } from "@drskillissue/ganko-shared";

/** A single VS Code contributes.configuration property entry (JSON Schema subset). */
export interface VSCodeConfigProperty {
  readonly type: string
  readonly default?: string | boolean | number | readonly string[] | Record<string, string>
  readonly description?: string
  readonly markdownDescription?: string
  readonly enum?: readonly string[]
  readonly enumDescriptions?: readonly string[]
  readonly items?: { readonly type: string }
  readonly additionalProperties?: { readonly type: string }
}

/** A rule-specific VS Code contributes.configuration property with a fixed string-enum shape. */
export interface RuleConfigProperty {
  readonly type: "string"
  readonly enum: readonly RuleSeveritySettingValue[]
  readonly default: "default"
  readonly markdownDescription: string
  readonly enumDescriptions: readonly [string, string, string, string]
}

/** Shape of contributes.configuration in a VS Code extension package.json. */
export interface VSCodeConfiguration {
  readonly title: string
  properties: Record<string, VSCodeConfigProperty>
}

/** Typed projection of the fields read/written in the extension's package.json. */
export interface ExtensionPackageJson {
  readonly contributes: {
    readonly configuration: VSCodeConfiguration
  }
}
