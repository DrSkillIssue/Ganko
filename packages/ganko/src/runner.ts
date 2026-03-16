/**
 * Runner - Plugin-agnostic runner for ganko
 *
 * The runner takes a configuration with plugins and runs them against files.
 * It never stores typed graphs - plugins handle their own graph building
 * and rule execution internally via the analyze() method.
 *
 * Rule overrides allow callers (LSP, CLI) to disable rules or remap their
 * severity without modifying rule definitions. The runner intercepts the
 * Emit callback to enforce overrides before diagnostics reach the caller.
 */
import type ts from "typescript"
import type { Diagnostic } from "./diagnostic"
import type { Plugin, Emit } from "./graph"
import type { RuleOverrides } from "@drskillissue/ganko-shared"

/** Runner configuration */
export interface RunnerConfig {
  readonly plugins: readonly Plugin<string>[]
  readonly rules?: RuleOverrides
  readonly program?: ts.Program
}

/** Runner interface */
export interface Runner {
  run(files: readonly string[]): readonly Diagnostic[]
  /** Replace rule overrides. Takes effect on the next run() call. */
  setRuleOverrides(overrides: RuleOverrides): void
  /** Replace the TypeScript program. Takes effect on the next run() call. */
  setProgram(program: ts.Program): void
}

/**
 * Build an Emit wrapper that enforces rule overrides.
 *
 * @param target - The underlying emit that collects diagnostics
 * @param overrides - Current rule override map
 * @returns Wrapped emit that suppresses/remaps per overrides
 */
export function createOverrideEmit(target: Emit, overrides: RuleOverrides): Emit {
  return (d) => {
    const override = overrides[d.rule]
    if (override === undefined) { target(d); return }
    if (override === "off") return
    if (override !== d.severity) {
      target({ ...d, severity: override })
      return
    }
    target(d)
  }
}

/**
 * Create a runner from configuration.
 */
export function createRunner(config: RunnerConfig): Runner {
  let overrides: RuleOverrides = config.rules ?? {}
  let program: ts.Program | undefined = config.program

  return {
    run(files) {
      const diagnostics: Diagnostic[] = []
      const raw: Emit = (d) => diagnostics.push(d)
      const hasOverrides = Object.keys(overrides).length > 0
      const emit = hasOverrides ? createOverrideEmit(raw, overrides) : raw
      const context = program ? { program } : undefined
      for (const plugin of config.plugins) {
        plugin.analyze(files, emit, context)
      }
      return diagnostics
    },

    setRuleOverrides(next) {
      overrides = next
    },

    setProgram(next) {
      program = next
    },
  }
}
