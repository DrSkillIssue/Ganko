/**
 * Shared ESLint Adapter Utilities
 *
 * Common infrastructure for bridging ganko's rule engine into
 * ESLint's plugin format. Used by each plugin's eslint-plugin.ts.
 */
import { ESLintUtils, type TSESLint } from "@typescript-eslint/utils"
import type { Diagnostic, Fix, FixOperation, Suggestion } from "./diagnostic"
import type { BaseRule, Emit } from "./graph"
import type { SolidInput } from "./solid/input"

export type RuleModule = TSESLint.RuleModule<string>
export type RuleContext = TSESLint.RuleContext<string, readonly unknown[]>

/**
 * Build a SolidInput from an ESLint rule context.
 *
 * Extracts the TypeScript program from parser services, then obtains
 * the source file and type checker for the current file.
 */
export function buildSolidInputFromContext(context: RuleContext): SolidInput {
  const parserServices = ESLintUtils.getParserServices(context)
  const program = parserServices.program
  if (!program) {
    throw new Error(
      "ganko requires typed linting. Ensure your ESLint config uses " +
      "typescript-eslint typed linting with `projectService: true`.",
    )
  }
  const sourceFile = program.getSourceFile(context.filename)
  if (!sourceFile) {
    throw new Error(`File not found in TypeScript program: ${context.filename}`)
  }
  return {
    file: context.filename,
    sourceFile,
    checker: program.getTypeChecker(),
  }
}

/**
 * Passthrough message ID used by all rules.
 *
 * ganko resolves message templates at emit time, so the ESLint
 * adapter uses a single passthrough template that receives the
 * pre-resolved message via data.
 */
export const MSG_ID = "_msg" as const
export const MSG_TEMPLATE = { [MSG_ID]: "{{msg}}" }

/**
 * Convert a ganko FixOperation to an ESLint RuleFix.
 */
function applyFix(fixer: TSESLint.RuleFixer, op: FixOperation): TSESLint.RuleFix {
  return fixer.replaceTextRange([op.range[0], op.range[1]], op.text)
}

/**
 * Convert a ganko Fix to an ESLint fix function.
 */
export function toESLintFix(fix: Fix): (fixer: TSESLint.RuleFixer) => TSESLint.RuleFix | TSESLint.RuleFix[] {
  return (fixer) => {
    const first = fix[0]
    if (fix.length === 1 && first) return applyFix(fixer, first)
    const fixes: TSESLint.RuleFix[] = []
    for (let i = 0; i < fix.length; i++) {
      const op = fix[i]
      if (!op) continue
      fixes.push(applyFix(fixer, op))
    }
    return fixes
  }
}

/**
 * Convert ganko suggestions to ESLint suggestion descriptors.
 */
export function toESLintSuggestions(
  suggestions: readonly Suggestion[],
): TSESLint.SuggestionReportDescriptor<string>[] {
  const result: TSESLint.SuggestionReportDescriptor<string>[] = []
  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i]
    if (!s) continue
    result.push({
      messageId: MSG_ID,
      data: { msg: s.message },
      fix: toESLintFix(s.fix),
    })
  }
  return result
}

/**
 * Create an ESLint RuleModule from a ganko rule.
 *
 * Works for any rule+graph pair where the graph is obtained from a
 * context-keyed getter (SolidRule+SolidGraph, CSSRule+CSSGraph).
 */
export function createRuleModule<G>(
  rule: BaseRule<G>,
  getGraph: (context: RuleContext) => G,
): RuleModule {
  const meta: TSESLint.RuleMetaData<string> = {
    type: "problem",
    docs: {
      description: rule.meta.description,
    },
    messages: MSG_TEMPLATE,
    schema: [],
  }
  if (rule.meta.fixable) meta.fixable = "code" as const
  return {
    meta,
    defaultOptions: [],
    create(context) {
      return {
        Program() {
          const graph = getGraph(context)
          const diagnostics: Diagnostic[] = []
          const emit: Emit = (d) => diagnostics.push(d)

          rule.check(graph, emit)

          for (let i = 0; i < diagnostics.length; i++) {
            const diag = diagnostics[i]
            if (!diag) continue
            reportDiagnostic(context, diag)
          }
        },
      }
    },
  }
}

/**
 * Create a cached ESLint plugin adapter from rules and a graph builder.
 *
 * Handles the SourceCode-keyed WeakMap cache and the rules-to-modules
 * loop that is identical across Solid and CSS eslint-plugin files.
 */
export function createCachedPluginAdapter<G>(
  rules: readonly BaseRule<G>[],
  buildGraph: (context: RuleContext) => G,
): { eslintRules: Record<string, RuleModule> } {
  const cache = new WeakMap<TSESLint.SourceCode, G>()

  function getGraph(context: RuleContext): G {
    const sourceCode = context.sourceCode
    const cached = cache.get(sourceCode)
    if (cached) return cached
    const graph = buildGraph(context)
    cache.set(sourceCode, graph)
    return graph
  }

  const eslintRules: Record<string, RuleModule> = {}
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i]
    if (!r) continue
    eslintRules[r.id] = createRuleModule(r, getGraph)
  }

  return { eslintRules }
}

/**
 * Create an ESLint plugin adapter for rules that run in batch (all rules share
 * one analysis pass). The runAll function receives the context built from a
 * single ESLint RuleContext and an emit callback, runs analysis once, and
 * emits diagnostics keyed by rule ID.
 *
 * Used by cross-file rules where graph construction is expensive and shared.
 */
export function createBatchPluginAdapter<G>(
  rules: readonly BaseRule<G>[],
  buildContext: (context: RuleContext) => G,
  runAll: (graph: G, emit: Emit) => void,
): { eslintRules: Record<string, RuleModule> } {
  const cache = new WeakMap<TSESLint.SourceCode, ReadonlyMap<string, readonly Diagnostic[]>>()

  function getResults(context: RuleContext): ReadonlyMap<string, readonly Diagnostic[]> {
    const sourceCode = context.sourceCode
    const cached = cache.get(sourceCode)
    if (cached) return cached

    const graph = buildContext(context)
    const byRule = new Map<string, Diagnostic[]>()
    const emit: Emit = (d) => {
      const list = byRule.get(d.rule)
      if (list) { list.push(d) }
      else { byRule.set(d.rule, [d]) }
    }
    runAll(graph, emit)
    cache.set(sourceCode, byRule)
    return byRule
  }

  function createBatchRuleModule(
    rule: BaseRule<G>,
    getResults: (context: RuleContext) => ReadonlyMap<string, readonly Diagnostic[]>,
  ): RuleModule {
    const meta: TSESLint.RuleMetaData<string> = {
      type: "problem",
      docs: { description: rule.meta.description },
      messages: MSG_TEMPLATE,
      schema: [],
    }
    if (rule.meta.fixable) meta.fixable = "code" as const
    return {
      meta,
      defaultOptions: [],
      create(context) {
        return {
          Program() {
            const results = getResults(context)
            const diagnostics = results.get(rule.id) ?? []
            for (let j = 0; j < diagnostics.length; j++) {
              const diag = diagnostics[j]
              if (!diag) continue
              reportDiagnostic(context, diag)
            }
          },
        }
      },
    }
  }

  const eslintRules: Record<string, RuleModule> = {}
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    if (!rule) continue
    eslintRules[rule.id] = createBatchRuleModule(rule, getResults)
  }
  return { eslintRules }
}

/**
 * Report a ganko Diagnostic through ESLint's context.report().
 */
export function reportDiagnostic(context: RuleContext, d: Diagnostic): void {
  const data = { msg: d.message }

  if (d.fix) {
    if (d.suggest && d.suggest.length > 0) {
      context.report({
        messageId: MSG_ID,
        data,
        loc: d.loc,
        fix: toESLintFix(d.fix),
        suggest: toESLintSuggestions(d.suggest),
      })
    } else {
      context.report({
        messageId: MSG_ID,
        data,
        loc: d.loc,
        fix: toESLintFix(d.fix),
      })
    }
  } else if (d.suggest && d.suggest.length > 0) {
    context.report({
      messageId: MSG_ID,
      data,
      loc: d.loc,
      suggest: toESLintSuggestions(d.suggest),
    })
  } else {
    context.report({
      messageId: MSG_ID,
      data,
      loc: d.loc,
    })
  }
}
