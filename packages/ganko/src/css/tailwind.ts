/**
 * Tailwind CSS v4 Integration
 *
 * Provides a TailwindValidator interface that checks whether a class name
 * is a valid Tailwind utility. Two implementations exist:
 *
 * - LiveValidator: Wraps a Tailwind DesignSystem, uses candidatesToCss()
 *   for exact validation. Used in async contexts (LSP, CLI).
 * - StaticValidator: Wraps pre-computed sets of base utilities and variant
 *   names, strips variant prefixes recursively. Used in sync contexts (ESLint).
 *
 * Detection scans CSS file content for `@import "tailwindcss` or `@theme`
 * directives to determine if Tailwind v4 is in use.
 */
import { dirname, join, sep } from "node:path"
import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { Level } from "@drskillissue/ganko-shared"
import type { Logger } from "@drskillissue/ganko-shared"

/**
 * Validates whether a CSS class name is a known Tailwind utility.
 *
 * Implementations are provided by callers depending on their execution
 * context (async vs sync). The CSSGraph stores this as an optional field
 * and the undefined-css-class rule falls back to it when `classNameIndex`
 * misses.
 */
export interface TailwindValidator {
  has(className: string): boolean

  /**
   * Resolves a Tailwind utility class to its generated CSS string.
   *
   * Returns the full CSS rule text (e.g. `.flex { display: flex; }`) or null
   * if the class is not a valid Tailwind utility or resolution is not supported
   * (e.g. in the sync/static validator path).
   */
  resolve(className: string): string | null
}

/**
 * Subset of Tailwind v4's DesignSystem API used for validation.
 *
 * Defined locally to avoid a hard dependency on `@tailwindcss/node`.
 * Structural typing ensures compatibility without type assertions.
 */
interface DesignSystem {
  candidatesToCss(classes: string[]): (string | null)[]
  getClassList(): [string, { modifiers: string[] }][]
  getVariants(): { name: string; values: string[]; hasDash: boolean; isArbitrary: boolean }[]
}


/**
 * Packages that depend on `@tailwindcss/node` and can be used as carriers
 * for transitive resolution when the package is not directly installable.
 *
 * Bun stores transitive dependencies in `.bun/` directories which are not
 * importable via bare specifiers. Resolving from a carrier package's
 * installed location allows `createRequire` to find `@tailwindcss/node`
 * through the carrier's own `node_modules`.
 */
const CARRIER_PACKAGES = ["@tailwindcss/vite", "@tailwindcss/postcss", "@tailwindcss/cli"]

/**
 * Walk up from a directory to find the nearest directory containing package.json.
 * Used as fallback when no explicit project root is provided (ESLint plugin path).
 */
function findNearestPackageRoot(startDir: string): string {
  let dir = startDir
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir
    const parent = dirname(dir)
    if (parent === dir) return startDir
    dir = parent
  }
}

/** The entry point path within @tailwindcss/node */
const TAILWIND_NODE_ENTRY = join("@tailwindcss", "node", "dist", "index.js")

/**
 * Check a single search root for @tailwindcss/node.
 *
 * Tries direct installation first, then transitive installation
 * through each carrier package's own node_modules.
 *
 * @param searchRoot - Directory containing a node_modules folder
 * @returns Absolute path to @tailwindcss/node entry, or null
 */
function probeForTailwindNode(searchRoot: string): string | null {
  const nmDir = join(searchRoot, "node_modules")

  const direct = join(nmDir, TAILWIND_NODE_ENTRY)
  if (existsSync(direct)) return direct

  for (let i = 0; i < CARRIER_PACKAGES.length; i++) {
    const carrier = CARRIER_PACKAGES[i]
    if (!carrier) continue
    const transitive = join(nmDir, carrier.replace("/", sep), "node_modules", TAILWIND_NODE_ENTRY)
    if (existsSync(transitive)) return transitive
  }

  return null
}

/**
 * Resolve the absolute path to `@tailwindcss/node` from known workspace roots.
 *
 * Uses direct filesystem existence checks — no `createRequire`, which is
 * broken in Bun-compiled binaries. Searches the project root first, then
 * each workspace package root. Does NOT walk up past the project root.
 *
 * @param rootPath - Project root directory (contains the top-level node_modules)
 * @param workspacePackagePaths - Workspace package directories to search
 * @returns Resolved absolute path to @tailwindcss/node entry, or null
 */
function resolveTailwindNodePath(
  rootPath: string,
  workspacePackagePaths: readonly string[],
): string | null {
  const fromRoot = probeForTailwindNode(rootPath)
  if (fromRoot !== null) return fromRoot

  for (let i = 0; i < workspacePackagePaths.length; i++) {
    const wsPath = workspacePackagePaths[i]
    if (!wsPath) continue
    const fromWs = probeForTailwindNode(wsPath)
    if (fromWs !== null) return fromWs
  }

  return null
}

/**
 * Creates a TailwindValidator backed by a live DesignSystem.
 *
 * Uses `candidatesToCss()` for exact validation — handles arbitrary values,
 * compound variants, and modifier syntax. Results are cached per class name.
 */
export function createLiveValidator(design: DesignSystem): TailwindValidator {
  const cache = new Map<string, string | null>()

  function resolveFromDesign(className: string): string | null {
    const cached = cache.get(className)
    if (cached !== undefined) return cached
    const result = design.candidatesToCss([className])
    const css = result[0] ?? null
    cache.set(className, css)
    return css
  }

  return {
    has(className) {
      return resolveFromDesign(className) !== null
    },
    resolve(className) {
      return resolveFromDesign(className)
    },
  }
}

/**
 * Creates a TailwindValidator from pre-computed utility and variant sets.
 *
 * Variant-prefixed classes (e.g. `md:flex`, `hover:bg-red-500`) are
 * validated by stripping known variant prefixes and checking the base
 * utility. Handles compound variants (`sm:hover:flex`) via recursion.
 */
export function createStaticValidator(
  utilities: ReadonlySet<string>,
  variants: ReadonlySet<string>,
): TailwindValidator {
  const cache = new Map<string, boolean>()

  function check(className: string): boolean {
    const cached = cache.get(className)
    if (cached !== undefined) return cached

    if (utilities.has(className)) {
      cache.set(className, true)
      return true
    }

    const colon = className.indexOf(":")
    if (colon === -1) {
      cache.set(className, false)
      return false
    }

    const prefix = className.substring(0, colon)
    const rest = className.substring(colon + 1)

    if (!variants.has(prefix)) {
      cache.set(className, false)
      return false
    }

    const valid = check(rest)
    cache.set(className, valid)
    return valid
  }

  return {
    has: check,
    resolve() {
      /* Static validators cannot resolve CSS — they only have pre-computed
         utility/variant name sets without access to the DesignSystem. CSS
         resolution is only available in async (CLI/LSP) contexts. */
      return null
    },
  }
}

/** Regex matching Tailwind v4 import directives. */
const TAILWIND_IMPORT = /@import\s+["']tailwindcss/

/** Regex matching Tailwind v4 @theme blocks. */
const TAILWIND_THEME = /@theme\s*\{/

/**
 * Detects the Tailwind CSS v4 entry file from a list of CSS files.
 *
 * Prioritizes files with `@import "tailwindcss` directives — these are
 * the actual entry points that load the full design system. Falls back
 * to files containing `@theme` blocks only if no import-based entry is
 * found, since `@theme`-only files are typically partials (e.g. colors)
 * that cannot initialize the design system on their own.
 *
 * @param files - CSS files with their content
 * @returns The entry file, or null if no Tailwind markers are found
 */
export function detectTailwindEntry(
  files: readonly { path: string; content: string }[],
): { path: string; content: string } | null {
  let themeOnlyFallback: { path: string; content: string } | null = null

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (!file) continue
    if (TAILWIND_IMPORT.test(file.content)) return file
    if (themeOnlyFallback === null && TAILWIND_THEME.test(file.content)) {
      themeOnlyFallback = file
    }
  }

  return themeOnlyFallback
}

/**
 * Resolves a TailwindValidator from CSS files by detecting Tailwind v4
 * and loading the design system via `@tailwindcss/node`.
 *
 * Handles projects where `@tailwindcss/node` is a transitive dependency
 * (e.g. installed via `@tailwindcss/vite`) by resolving through carrier
 * packages when direct import fails.
 *
 * Returns null if:
 * - No Tailwind entry file is detected
 * - `@tailwindcss/node` is not installed (directly or transitively)
 * - The design system fails to load
 */
/**
 * Preparation result for Tailwind resolution.
 *
 * Contains the data needed by the WorkspaceEvaluator subprocess to load the
 * design system. The caller passes these fields to evaluateWorkspace().
 */
export interface TailwindEvalParams {
  readonly modulePath: string
  readonly entryCss: string
  readonly entryBase: string
}

/**
 * Prepare Tailwind evaluation parameters from CSS files.
 *
 * Detects the Tailwind entry file and resolves the @tailwindcss/node module
 * path. Returns null if no entry is detected or the module is not installed.
 * Does NOT spawn a subprocess — the caller does that via WorkspaceEvaluator.
 *
 * @param files - CSS files with content
 * @param rootPath - Project root for module resolution
 * @param workspacePackagePaths - Workspace package paths for module resolution
 * @param logger - Logger
 * @returns Evaluation parameters, or null
 */
export function prepareTailwindEval(
  files: readonly { path: string; content: string }[],
  rootPath: string,
  workspacePackagePaths: readonly string[],
  logger?: Logger,
): TailwindEvalParams | null {
  const entry = detectTailwindEntry(files)
  if (!entry) {
    logger?.info("tailwind: no entry file detected (no @import \"tailwindcss\" or @theme block found in CSS files)")
    return null
  }

  logger?.info(`tailwind: entry file detected: ${entry.path}`)

  const modulePath = resolveTailwindNodePath(rootPath, workspacePackagePaths)
  if (modulePath === null) {
    logger?.warning(`tailwind: @tailwindcss/node not resolvable in project root or workspace packages`)
    return null
  }

  logger?.info(`tailwind: @tailwindcss/node resolved to ${modulePath}`)
  return { modulePath, entryCss: entry.content, entryBase: dirname(entry.path) }
}

/**
 * A TailwindValidator with a preloadable batch cache for arbitrary value classes.
 *
 * The static validator handles known utility/variant combinations.
 * Arbitrary values (min-h-[60vh], max-w-[360px], [&_[data-slot]]:hidden, etc.)
 * are not in the static set. The caller collects all class names that will be
 * checked, sends them to candidatesToCss in one batch via the WorkspaceEvaluator,
 * and preloads the results before rule execution.
 */
export interface BatchableTailwindValidator extends TailwindValidator {
  preloadBatch(classNames: readonly string[], results: readonly boolean[]): void
}

/**
 * Build a TailwindValidator from evaluation results with batch preloading.
 *
 * @param utilities - Utility class names from the design system
 * @param variants - Variant definitions from the design system
 * @param logger - Logger
 * @returns BatchableTailwindValidator
 */
export function buildTailwindValidatorFromEval(
  utilities: readonly string[],
  variants: readonly { name: string; values: string[]; hasDash: boolean; isArbitrary: boolean }[],
  logger?: Logger,
): BatchableTailwindValidator {
  const utilitySet = new Set(utilities)
  const variantSet = expandVariants(variants as { name: string; values: string[]; hasDash: boolean; isArbitrary: boolean }[])
  logger?.info(`tailwind: design system loaded (${utilitySet.size} utilities, ${variantSet.size} variants)`)

  const staticValidator = createStaticValidator(utilitySet, variantSet)
  const batchCache = new Map<string, boolean>()

  return {
    has(className: string): boolean {
      if (staticValidator.has(className)) return true
      const cached = batchCache.get(className)
      if (cached !== undefined) return cached
      return false
    },
    resolve(): string | null {
      return null
    },
    preloadBatch(classNames: readonly string[], results: readonly boolean[]): void {
      for (let i = 0; i < classNames.length; i++) {
        const name = classNames[i]
        const valid = results[i]
        if (name !== undefined && valid !== undefined) {
          batchCache.set(name, valid)
        }
      }
      if (logger?.isLevelEnabled(Level.Debug)) {
        let validCount = 0
        for (let i = 0; i < results.length; i++) {
          if (results[i]) validCount++
        }
        logger.debug(`tailwind: preloaded ${classNames.length} candidates (${validCount} valid)`)
      }
    },
  }
}

/**
 * Builds variant name sets from a DesignSystem's getVariants() output.
 *
 * For variants with values (e.g. `aria-checked`, `data-active`), expands
 * them into concrete prefixes: `aria-checked`, `data-active`, etc.
 */
function expandVariants(
  raw: { name: string; values: string[]; hasDash: boolean; isArbitrary: boolean }[],
): Set<string> {
  const variants = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i]
    if (!v) continue
    variants.add(v.name)
    const values = v.values
    for (let j = 0; j < values.length; j++) {
      const val = values[j]
      if (val === undefined) continue
      variants.add(v.hasDash ? v.name + "-" + val : v.name + val)
    }
  }
  return variants
}

/**
 * Resolves a TailwindValidator synchronously by spawning a subprocess.
 *
 * Resolves the absolute path to `@tailwindcss/node` in the parent process
 * (including transitive resolution through carrier packages), then passes
 * that path to the subprocess so it can import from the exact location.
 *
 * Returns null if:
 * - No Tailwind entry file is detected
 * - The subprocess fails
 * - `@tailwindcss/node` is not available (directly or transitively)
 */
/**
 * Resolve a TailwindValidator synchronously.
 *
 * Prepares the evaluation parameters and delegates to a caller-provided
 * sync evaluator function. The evaluator is responsible for spawning the
 * subprocess — this function handles detection, path resolution, and
 * validator construction.
 *
 * @param files - CSS files with content
 * @param syncEvaluator - Function that evaluates tailwind params and returns utilities/variants
 * @param rootPath - Project root (optional, walks up to package.json if not provided)
 * @param workspacePackagePaths - Workspace package paths (optional)
 * @returns TailwindValidator, or null
 */
/**
 * Default sync evaluator — spawns a Bun subprocess to load the design system.
 *
 * Used by ESLint plugin and runner paths that don't have access to the
 * WorkspaceEvaluator from the LSP package.
 *
 * @param params - Tailwind evaluation parameters
 * @returns Utilities and variants, or null
 */
function defaultSyncEvaluator(
  params: TailwindEvalParams,
): { utilities: string[]; variants: { name: string; values: string[]; hasDash: boolean; isArbitrary: boolean }[] } | null {
  const script = [
    `const { __unstable__loadDesignSystem } = await import(${JSON.stringify(params.modulePath)});`,
    `const d = await __unstable__loadDesignSystem(`,
    `  ${JSON.stringify(params.entryCss)},`,
    `  { base: ${JSON.stringify(params.entryBase)} }`,
    `);`,
    `const u = d.getClassList().map(e => e[0]);`,
    `const v = d.getVariants().map(v => ({`,
    `  name: v.name,`,
    `  values: v.values ?? [],`,
    `  hasDash: v.hasDash ?? false,`,
    `  isArbitrary: v.isArbitrary ?? false,`,
    `}));`,
    `process.stdout.write(JSON.stringify({ u, v }));`,
  ].join("\n")

  try {
    const result = spawnSync("bun", ["-e", script], { cwd: params.entryBase, encoding: "utf-8", timeout: 30000 })
    if (result.status !== 0) return null
    const text = typeof result.stdout === "string" ? result.stdout : String(result.stdout ?? "")
    if (text.length === 0) return null
    const data = JSON.parse(text)
    return { utilities: data.u, variants: data.v }
  } catch {
    return null
  }
}

/**
 * Resolve a TailwindValidator synchronously.
 *
 * Uses the default Bun subprocess evaluator unless a custom one is provided.
 *
 * @param files - CSS files with content
 * @param rootPath - Project root (optional, walks up to package.json if not provided)
 * @param workspacePackagePaths - Workspace package paths (optional)
 * @returns TailwindValidator, or null
 */
export function resolveTailwindValidatorSync(
  files: readonly { path: string; content: string }[],
  rootPath?: string,
  workspacePackagePaths?: readonly string[],
): TailwindValidator | null {
  const effectiveRoot = rootPath ?? findNearestPackageRoot(dirname(files[0]?.path ?? "."))
  const params = prepareTailwindEval(files, effectiveRoot, workspacePackagePaths ?? [])
  if (params === null) return null

  const result = defaultSyncEvaluator(params)
  if (result === null) return null

  return buildTailwindValidatorFromEval(result.utilities, result.variants)
}
