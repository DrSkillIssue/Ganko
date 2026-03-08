/**
 * String Interning for Solid.js
 *
 * Provides pre-interned strings for common Solid.js identifiers.
 */

import { StringInterner } from "@drskillissue/ganko-shared";

/**
 * Pre-interned strings for known Solid.js identifiers.
 *
 * These strings are commonly used during graph building and
 * can be compared by reference for quick equality checks.
 */
export const INTERNED = {
  // Module sources
  SOLID_JS: "solid-js",
  SOLID_STORE: "solid-js/store",
  SOLID_WEB: "solid-js/web",

  // Reactive primitives
  CREATE_SIGNAL: "createSignal",
  CREATE_EFFECT: "createEffect",
  CREATE_MEMO: "createMemo",
  CREATE_RESOURCE: "createResource",
  CREATE_STORE: "createStore",
  CREATE_COMPUTED: "createComputed",
  CREATE_RENDER_EFFECT: "createRenderEffect",
  CREATE_DEFERRED: "createDeferred",
  CREATE_SELECTOR: "createSelector",
  CREATE_ROOT: "createRoot",
  CREATE_CONTEXT: "createContext",
  CREATE_UNIQUE_ID: "createUniqueId",

  // Lifecycle hooks
  ON_MOUNT: "onMount",
  ON_CLEANUP: "onCleanup",
  ON_ERROR: "onError",

  // Utility functions
  BATCH: "batch",
  UNTRACK: "untrack",
  ON: "on",
  OBSERVABLE: "observable",
  FROM: "from",
  PRODUCE: "produce",
  RECONCILE: "reconcile",

  // Components
  FOR: "For",
  INDEX: "Index",
  SHOW: "Show",
  SWITCH: "Switch",
  MATCH: "Match",
  SUSPENSE: "Suspense",
  SUSPEND: "suspend",
  LAZY: "lazy",
  PORTAL: "Portal",
  DYNAMIC: "Dynamic",
  ERROR_BOUNDARY: "ErrorBoundary",

  // Common prop names
  CHILDREN: "children",
  FALLBACK: "fallback",
  EACH: "each",
  WHEN: "when",
  KEYED: "keyed",
  REF: "ref",
  STYLE: "style",
  CLASS: "class",
  CLASS_LIST: "classList",
  USE: "use:",
  PROP: "prop:",
  ATTR: "attr:",
  ON_PREFIX: "on:",
  ONCAPTURE: "oncapture:",

  // Accessor-related
  USE_CONTEXT: "useContext",
  USE_TRANSITION: "useTransition",
  START_TRANSITION: "startTransition",
  CHILDREN_FN: "children",
  MERGE_PROPS: "mergeProps",
  SPLIT_PROPS: "splitProps",
} as const;

/**
 * Global string interner instance for shared use.
 *
 * Pre-populated with known Solid.js strings.
 */
export const globalInterner = new StringInterner();

// Pre-intern all known strings
for (const value of Object.values(INTERNED)) {
  globalInterner.intern(value);
}
