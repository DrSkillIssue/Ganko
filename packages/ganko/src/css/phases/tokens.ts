/**
 * Phase 4: Theme Token Inference
 *
 * Analyzes CSS custom property naming patterns to infer design system tokens.
 * Groups related variables into semantic tokens and detects missing variants.
 */

import type { CSSGraph } from "../impl";
import type { CSSInput } from "../input";
import type {
  ThemeTokenEntity,
  VariableEntity,
  TokenCategory,
  ThemeTokenVariant,
  FileEntity,
} from "../entities";
import {
  inferTokenCategory,
  extractTokenName,
  extractTokenVariant,
} from "../parser/variable-name";
import { hasFlag, VAR_IS_SCSS } from "../entities";
import { isDigit } from "@drskillissue/ganko-shared";

const DIGITS_G = /\d+/g
const TRAILING_VARIANT = /-[a-z]+$/i

/**
 * Standard numeric scale variants used in design systems.
 */
const NUMERIC_SCALE_VARIANTS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
const NUMERIC_SCALE_SET = new Set(NUMERIC_SCALE_VARIANTS);

/**
 * Standard size variants used in design systems.
 */
const SIZE_SCALE_VARIANTS = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"];
const SIZE_SCALE_SET = new Set(SIZE_SCALE_VARIANTS);

/**
 * Standard state variants used in design systems.
 */
const STATE_VARIANTS = ["default", "hover", "focus", "active", "disabled"];
const STATE_SET = new Set(STATE_VARIANTS);

/**
 * Variant type discriminator for token analysis.
 * Using const enum for zero-cost abstraction (inlined at compile time).
 */
const enum VariantType {
  None = 0,
  Numeric = 1,
  Size = 2,
  State = 3,
}

/**
 * Result of extracting variants from variables.
 * Bundles the variants array with lookup data used by findMissingVariants.
 */
interface ExtractVariantsResult {
  variants: ThemeTokenVariant[];
  namesLower: Set<string>;
  variantType: VariantType;
  matchCount: number;
}

/**
 * Naming patterns for token detection.
 */
const NAMING_PATTERNS = [
  { regex: /^--([a-z]+)-([a-z]+(?:-[a-z]+)*)-(\d+|[a-z]+)$/i, template: "--{category}-{name}-{variant}" },
  { regex: /^--([a-z]+)-(\d+|[a-z]+)$/i, template: "--{category}-{variant}" },
  { regex: /^--([a-z]+)-(\d+|[a-z]+)$/i, template: "--{name}-{variant}" },
] as const;

export function runTokensPhase(graph: CSSGraph, input: CSSInput): void {
    if (input.options?.inferTokens === false) return;
    if (graph.variables.length === 0) return;

    const tokenGroups = new Map<string, Map<TokenCategory, VariableEntity[]>>();

    for (const variable of graph.variables) {
      if (hasFlag(variable._flags, VAR_IS_SCSS)) continue;

      const category = inferTokenCategory(variable.name);
      if (!category) continue;

      const tokenName = extractTokenName(variable.name);
      if (!tokenName) continue;

      let categoryMap = tokenGroups.get(tokenName);
      if (!categoryMap) {
        categoryMap = new Map();
        tokenGroups.set(tokenName, categoryMap);
      }

      let variables = categoryMap.get(category);
      if (!variables) {
        variables = [];
        categoryMap.set(category, variables);
      }

      variables.push(variable);
    }

    for (const [tokenName, categoryMap] of tokenGroups) {
      for (const [category, variables] of categoryMap) {
        const firstVar = variables[0];
        if (!firstVar) continue;
        const file = firstVar.file;
        const token = createThemeTokenEntity(graph, tokenName, category, file, variables);
        graph.addToken(token);

        for (const variable of variables) {
          variable.themeToken = token;
        }
      }
    }
}

/**
 * Creates a theme token entity from grouped variables.
 * @param graph - The CSS graph implementation
 * @param name - Token name
 * @param category - Token category
 * @param file - Source file
 * @param variables - Variables belonging to this token
 * @returns The created theme token entity
 */
function createThemeTokenEntity(
  graph: CSSGraph,
  name: string,
  category: TokenCategory,
  file: FileEntity,
  variables: VariableEntity[],
): ThemeTokenEntity {
  const { variants, namesLower, variantType, matchCount } = extractVariants(variables);
  const namingPattern = detectNamingPattern(variables);
  const missingVariants = findMissingVariants(namesLower, variantType, matchCount);
  const isComplete = missingVariants.length === 0;

  return {
    id: graph.nextTokenId(),
    name,
    category,
    file,
    variables,
    variants,
    isComplete,
    missingVariants,
    namingPattern,
  };
}

/**
 * Checks if a string is a numeric variant (2-3 digit number).
 * @param s - String to check
 * @returns True if string is 2-3 digits
 */
function isNumericVariant(s: string): boolean {
  const len = s.length;
  if (len < 2 || len > 3) return false;
  for (let i = 0; i < len; i++) {
    if (!isDigit(s.charCodeAt(i))) return false;
  }
  return true;
}

/**
 * Extracts variants from a list of variables.
 * @param variables - The variables to extract variants from
 * @returns Object containing variants array and lookup metadata
 */
function extractVariants(variables: VariableEntity[]): ExtractVariantsResult {
  if (variables.length === 0) {
    return {
      variants: [],
      namesLower: new Set(),
      variantType: VariantType.None,
      matchCount: 0,
    };
  }

  const variants: ThemeTokenVariant[] = [];
  const namesLower = new Set<string>();
  let variantType = VariantType.None;
  let matchCount = 0;

  for (const variable of variables) {
    const variantName = extractTokenVariant(variable.name);
    const name = variantName ?? "default";
    const lower = name.toLowerCase();

    variants.push({
      name,
      variable: variable,
      value: variable.value,
    });

    namesLower.add(lower);

    if (variantType === VariantType.None) {
      if (isNumericVariant(name)) {
        variantType = VariantType.Numeric;
        matchCount = NUMERIC_SCALE_SET.has(name) ? 1 : 0;
      } else if (SIZE_SCALE_SET.has(lower)) {
        variantType = VariantType.Size;
        matchCount = 1;
      } else if (STATE_SET.has(lower)) {
        variantType = VariantType.State;
        matchCount = 1;
      }
    } else {
      switch (variantType) {
        case VariantType.Numeric:
          if (NUMERIC_SCALE_SET.has(name)) matchCount++;
          break;
        case VariantType.Size:
          if (SIZE_SCALE_SET.has(lower)) matchCount++;
          break;
        case VariantType.State:
          if (STATE_SET.has(lower)) matchCount++;
          break;
      }
    }
  }

  return { variants, namesLower, variantType, matchCount };
}

/**
 * Finds missing variants based on detected variant type.
 * @param namesLower - Set of lowercased variant names
 * @param variantType - Detected variant type
 * @param matchCount - Matches against expected scale
 * @returns Array of missing variant names
 */
function findMissingVariants(
  namesLower: Set<string>,
  variantType: VariantType,
  matchCount: number,
): string[] {
  if (variantType === VariantType.None) return [];
  if (matchCount < 3) return [];

  let expectedVariants: string[];
  switch (variantType) {
    case VariantType.Numeric:
      expectedVariants = NUMERIC_SCALE_VARIANTS;
      break;
    case VariantType.Size:
      expectedVariants = SIZE_SCALE_VARIANTS;
      break;
    case VariantType.State:
      expectedVariants = STATE_VARIANTS;
      break;
    default:
      return [];
  }

  const missing: string[] = [];
  for (const expected of expectedVariants) {
    if (!namesLower.has(expected)) {
      missing.push(expected);
    }
  }

  return missing;
}

/**
 * Detects the naming pattern used by a set of variables.
 * @param variables - The variables to analyze
 * @returns A naming pattern template string
 */
function detectNamingPattern(variables: VariableEntity[]): string {
  if (variables.length === 0) return "";

  const first = variables[0];
  if (!first) return "";
  const reference = first.name;

  for (const { regex, template } of NAMING_PATTERNS) {
    if (regex.test(reference)) {
      return template;
    }
  }

  return reference.replace(DIGITS_G, "{n}").replace(TRAILING_VARIANT, "-{variant}");
}
