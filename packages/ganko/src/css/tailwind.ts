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
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { existsSync } from "node:fs"

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
 * Module shape expected from `@tailwindcss/node`.
 *
 * Defined as a named interface so the type guard narrows cleanly
 * without type assertions.
 */
interface TailwindNodeModule {
  __unstable__loadDesignSystem(css: string, opts: { base: string }): Promise<DesignSystem>
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
 * Resolve the absolute path to `@tailwindcss/node` from a project directory.
 *
 * Resolution strategy:
 * 1. Walk up from `startDir` looking for `node_modules` directories
 * 2. For each `node_modules`, try direct resolution of `@tailwindcss/node`
 * 3. If direct resolution fails, try resolving through carrier packages
 *    (`@tailwindcss/vite`, `@tailwindcss/postcss`, `@tailwindcss/cli`)
 *    whose transitive deps include `@tailwindcss/node`
 *
 * @param startDir - Directory to start searching from (typically CSS entry dir)
 * @returns Resolved absolute path to `@tailwindcss/node`, or null
 */
function resolveTailwindNodePath(startDir: string): string | null {
  let dir = startDir
  for (;;) {
    const nmDir = join(dir, "node_modules")
    if (existsSync(nmDir)) {
      /* Try direct resolution first. */
      const dummyFile = join(nmDir, "__resolve_anchor__")
      const req = createRequire(dummyFile)
      try {
        return req.resolve("@tailwindcss/node")
      } catch {
        /* Not directly available — try carrier packages. */
      }

      for (let i = 0; i < CARRIER_PACKAGES.length; i++) {
        try {
          const pkg = CARRIER_PACKAGES[i]
          if (!pkg) continue
          const carrierPath = req.resolve(pkg)
          const carrierReq = createRequire(carrierPath)
          return carrierReq.resolve("@tailwindcss/node")
        } catch {
          /* Carrier not installed here, try next. */
        }
      }
    }

    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
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
export async function resolveTailwindValidator(
  files: readonly { path: string; content: string }[],
): Promise<TailwindValidator | null> {
  const entry = detectTailwindEntry(files)
  if (!entry) return null

  try {
    const base = dirname(entry.path)
    const resolved = resolveTailwindNodePath(base)
    if (resolved === null) return null

    const mod: TailwindNodeModule = await import(resolved)
    if (typeof mod.__unstable__loadDesignSystem !== "function") return null

    const design = await mod.__unstable__loadDesignSystem(
      entry.content,
      { base },
    )

    return createLiveValidator(design)
  } catch {
    return null
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
export function resolveTailwindValidatorSync(
  files: readonly { path: string; content: string }[],
): TailwindValidator | null {
  const entry = detectTailwindEntry(files)
  if (!entry) return null

  const base = dirname(entry.path)
  const modulePath = resolveTailwindNodePath(base)
  if (modulePath === null) return null

  /* The subprocess loads the design system using the pre-resolved absolute
     path, avoiding module resolution issues with transitive dependencies. */
  const script = [
    `const { __unstable__loadDesignSystem } = await import(${JSON.stringify(modulePath)});`,
    `const d = await __unstable__loadDesignSystem(`,
    `  ${JSON.stringify(entry.content)},`,
    `  { base: ${JSON.stringify(base)} }`,
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
    const result = Bun.spawnSync(["bun", "-e", script], { cwd: base })
    if (result.exitCode !== 0) return null

    const text = result.stdout.toString()
    if (text.length === 0) return null

    const data = JSON.parse(text) as {
      u: string[]
      v: { name: string; values: string[]; hasDash: boolean; isArbitrary: boolean }[]
    }

    const utilities = new Set(data.u)
    const variants = expandVariants(data.v)
    return createStaticValidator(utilities, variants)
  } catch {
    return null
  }
}
