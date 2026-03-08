/**
 * Bitmask flag constants for CSS entity boolean fields.
 *
 * Each entity type has its own flag namespace starting at bit 0.
 * Flags are per-entity-type — bit 0 means different things for different entities.
 */

// --- SelectorComplexity flags (bits 0-5) ---
export const SEL_HAS_UNIVERSAL = 1 << 0;
export const SEL_HAS_ID = 1 << 1;
export const SEL_HAS_ATTRIBUTE = 1 << 2;
export const SEL_HAS_PSEUDO_CLASS = 1 << 3;
export const SEL_HAS_PSEUDO_ELEMENT = 1 << 4;
export const SEL_HAS_NESTING = 1 << 5;

// --- VariableEntity flags (bits 0-3) ---
export const VAR_IS_GLOBAL = 1 << 0;
export const VAR_IS_USED = 1 << 1;
export const VAR_HAS_FALLBACK = 1 << 2;
export const VAR_IS_SCSS = 1 << 3;

// --- FileEntity flags (bits 0-2) ---
export const FILE_HAS_IMPORTS = 1 << 0;
export const FILE_HAS_VARIABLES = 1 << 1;
export const FILE_HAS_MIXINS = 1 << 2;

// --- DeclarationEntity flags (bit 0) ---
export const DECL_IS_IMPORTANT = 1 << 0;

// --- VariableReferenceEntity flags (bit 0) ---
export const REF_IS_RESOLVED = 1 << 0;

// --- MixinEntity flags (bits 0-2) ---
export const MIXIN_HAS_REST_PARAM = 1 << 0;
export const MIXIN_HAS_CONTENT_BLOCK = 1 << 1;
export const MIXIN_IS_USED = 1 << 2;

// --- MixinIncludeEntity flags (bits 0-1) ---
export const INCLUDE_HAS_CONTENT_BLOCK = 1 << 0;
export const INCLUDE_IS_RESOLVED = 1 << 1;

// --- FunctionCallEntity flags (bits 0-1) ---
export const FCALL_IS_BUILTIN = 1 << 0;
export const FCALL_IS_RESOLVED = 1 << 1;

// --- SCSSFunctionEntity flags (bit 0) ---
export const SCSSFN_IS_USED = 1 << 0;

// --- PlaceholderEntity flags (bit 0) ---
export const PLACEHOLDER_IS_USED = 1 << 0;

// --- ExtendEntity flags (bits 0-1) ---
export const EXTEND_IS_OPTIONAL = 1 << 0;
export const EXTEND_IS_RESOLVED = 1 << 1;

export function hasFlag(flags: number, flag: number): boolean {
  return (flags & flag) !== 0;
}

export function setFlag(flags: number, flag: number): number {
  return flags | flag;
}

export function clearFlag(flags: number, flag: number): number {
  return flags & ~flag;
}
