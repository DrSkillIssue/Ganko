/**
 * AUTO-GENERATED — DO NOT EDIT
 *
 * Rule metadata manifest for all ganko rules.
 * Regenerate: bun run scripts/generate-rules-manifest.ts
 */

import type { RuleSeverityOverride } from "@drskillissue/ganko-shared"

/** Rule category for grouping in configuration UIs and documentation. */
export type RuleCategory =
  | "correctness"
  | "css-a11y"
  | "css-animation"
  | "css-cascade"
  | "css-jsx"
  | "css-layout"
  | "css-property"
  | "css-selector"
  | "css-structure"
  | "jsx"
  | "performance"
  | "reactivity"
  | "solid"

/** Plugin that owns the rule. */
export type RulePlugin =
  | "cross-file"
  | "css"
  | "solid"

/** Static metadata for a single lint rule. */
export interface RuleEntry {
  readonly id: string
  readonly severity: RuleSeverityOverride
  readonly description: string
  readonly fixable: boolean
  readonly category: RuleCategory
  readonly plugin: RulePlugin
  readonly messages: Record<string, string>
}

/** Union of all rule IDs. */
export type RuleId =
  | "avoid-conditional-spreads"
  | "avoid-non-null-assertions"
  | "avoid-object-assign"
  | "avoid-object-spread"
  | "avoid-type-casting"
  | "avoid-unsafe-type-annotations"
  | "event-handlers"
  | "missing-jsdoc-comments"
  | "no-ai-slop-comments"
  | "no-array-handlers"
  | "no-banner-comments"
  | "no-destructure"
  | "no-inline-imports"
  | "string-concat-in-loop"
  | "css-no-outline-none-without-focus-visible"
  | "css-policy-contrast"
  | "css-policy-spacing"
  | "css-policy-touch-target"
  | "css-policy-typography"
  | "css-require-reduced-motion-override"
  | "css-no-discrete-transition"
  | "css-no-empty-keyframes"
  | "no-layout-property-animation"
  | "no-transition-all"
  | "no-unknown-animation-name"
  | "no-unused-keyframes"
  | "declaration-no-overridden-within-rule"
  | "media-query-overlap-conflict"
  | "no-descending-specificity-conflict"
  | "no-layer-order-inversion"
  | "no-redundant-override-pairs"
  | "css-no-unreferenced-component-class"
  | "jsx-classlist-boolean-values"
  | "jsx-classlist-no-accessor-reference"
  | "jsx-classlist-no-constant-literals"
  | "jsx-classlist-static-keys"
  | "jsx-layout-classlist-geometry-toggle"
  | "jsx-layout-fill-image-parent-must-be-sized"
  | "jsx-layout-picture-source-ratio-consistency"
  | "jsx-layout-unstable-style-toggle"
  | "jsx-no-duplicate-class-token-class-classlist"
  | "jsx-no-undefined-css-class"
  | "jsx-style-kebab-case-keys"
  | "jsx-style-no-function-values"
  | "jsx-style-no-unused-custom-prop"
  | "jsx-style-policy"
  | "css-layout-animation-layout-property"
  | "css-layout-box-sizing-toggle-with-chrome"
  | "css-layout-conditional-display-collapse"
  | "css-layout-conditional-offset-shift"
  | "css-layout-conditional-white-space-wrap-shift"
  | "css-layout-content-visibility-no-intrinsic-size"
  | "css-layout-dynamic-slot-no-reserved-space"
  | "css-layout-font-swap-instability"
  | "css-layout-overflow-anchor-instability"
  | "css-layout-overflow-mode-toggle-instability"
  | "css-layout-scrollbar-gutter-instability"
  | "css-layout-sibling-alignment-outlier"
  | "css-layout-stateful-box-model-shift"
  | "css-layout-transition-layout-property"
  | "css-layout-unsized-replaced-element"
  | "css-no-custom-property-cycle"
  | "css-no-hardcoded-z-index"
  | "css-no-legacy-vh-100"
  | "css-z-index-requires-positioned-context"
  | "no-important"
  | "no-unresolved-custom-properties"
  | "no-unused-custom-properties"
  | "no-complex-selectors"
  | "no-duplicate-selectors"
  | "no-id-selectors"
  | "selector-max-attribute-and-universal"
  | "selector-max-specificity"
  | "css-no-empty-rule"
  | "css-no-unknown-container-name"
  | "css-no-unused-container-name"
  | "layer-requirement-for-component-rules"
  | "components-return-once"
  | "jsx-no-duplicate-props"
  | "jsx-no-script-url"
  | "jsx-no-undef"
  | "jsx-uses-vars"
  | "no-innerhtml"
  | "no-unknown-namespaces"
  | "show-truthy-conversion"
  | "suspense-boundary-missing"
  | "validate-jsx-nesting"
  | "avoid-arguments-object"
  | "avoid-chained-array-methods"
  | "avoid-defensive-copy-for-scalar-stat"
  | "avoid-delete-operator"
  | "avoid-function-allocation-in-hot-loop"
  | "avoid-hidden-class-transition"
  | "avoid-intermediate-map-copy"
  | "avoid-megamorphic-property-access"
  | "avoid-quadratic-pair-comparison"
  | "avoid-quadratic-spread"
  | "avoid-repeated-indexof-check"
  | "avoid-slice-sort-pattern"
  | "avoid-sparse-arrays"
  | "avoid-spread-sort-map-join-pipeline"
  | "bounded-worklist-traversal"
  | "closure-captured-scope"
  | "closure-dom-circular"
  | "create-root-dispose"
  | "detached-dom-reference"
  | "effect-outside-root"
  | "finalization-registry-leak"
  | "no-char-array-materialization"
  | "no-double-pass-delimiter-count"
  | "no-full-split-in-hot-parse"
  | "no-heavy-parser-constructor-in-loop"
  | "no-leaked-abort-controller"
  | "no-leaked-animation-frame"
  | "no-leaked-event-listener"
  | "no-leaked-observer"
  | "no-leaked-subscription"
  | "no-leaked-timer"
  | "no-loop-string-plus-equals"
  | "no-multipass-split-pipeline"
  | "no-per-char-substring-scan"
  | "no-repeated-token-normalization"
  | "no-rescan-indexof-loop"
  | "no-rest-slice-loop"
  | "no-shift-splice-head-consume"
  | "no-write-only-index"
  | "prefer-charcode-over-regex-test"
  | "prefer-index-scan-over-string-iterator"
  | "prefer-lazy-property-access"
  | "prefer-map-lookup-over-linear-scan"
  | "prefer-map-over-object-dictionary"
  | "prefer-precompiled-regex"
  | "prefer-set-has-over-equality-chain"
  | "prefer-set-lookup-in-loop"
  | "recursive-timer"
  | "self-referencing-store"
  | "unbounded-collection"
  | "unbounded-signal-accumulation"
  | "async-tracked"
  | "children-helper-misuse"
  | "cleanup-scope"
  | "derived-signal"
  | "effect-as-memo"
  | "effect-as-mount"
  | "inline-component"
  | "no-top-level-signal-call"
  | "ref-early-access"
  | "resource-access-unchecked"
  | "resource-implicit-suspense"
  | "resource-refetch-loop"
  | "signal-call"
  | "signal-in-loop"
  | "store-reactive-break"
  | "transition-pending-unchecked"
  | "batch-optimization"
  | "imports"
  | "index-vs-for"
  | "no-react-deps"
  | "no-react-specific-props"
  | "prefer-for"
  | "prefer-memo-complex-styles"
  | "prefer-show"
  | "self-closing-comp"
  | "style-prop"

/** All rule metadata entries, sorted by category then id. */
export const RULES: readonly RuleEntry[] = [
  {
    "id": "avoid-conditional-spreads",
    "severity": "error",
    "description": "Disallow conditional spread operators that create empty objects. Patterns like `...(condition ? {...} : {})` are fragile and create unnecessary object creations.",
    "fixable": false,
    "category": "correctness",
    "plugin": "solid",
    "messages": {
      "avoidConditionalSpread": "Avoid conditional spread with empty object fallback. Instead of `...(cond ? {...} : {})`, build the object first with conditional property assignment, then spread once.",
      "avoidLogicalAndSpread": "Avoid logical AND spread pattern. Instead of `...(cond && {...})`, use explicit conditional property assignment for clarity."
    }
  },
  {
    "id": "avoid-non-null-assertions",
    "severity": "error",
    "description": "Disallow non-null assertion operator (`!`). Use optional chaining, nullish coalescing, or proper type narrowing instead.",
    "fixable": true,
    "category": "correctness",
    "plugin": "solid",
    "messages": {
      "avoidNonNull": "Avoid non-null assertion on \"{{name}}\". Non-null assertions bypass type safety. Use optional chaining (`?.`), nullish coalescing (`??`), or proper type narrowing instead."
    }
  },
  {
    "id": "avoid-object-assign",
    "severity": "error",
    "description": "Disallow Object.assign(). Prefer object spread syntax or structuredClone() for copying objects.",
    "fixable": true,
    "category": "correctness",
    "plugin": "solid",
    "messages": {
      "avoidMerge": "Avoid Object.assign() for merging. Use object spread syntax { ...obj } instead.",
      "avoidMutation": "Avoid Object.assign() for mutation. Consider immutable patterns like { ...existing, ...props }."
    }
  },
  {
    "id": "avoid-object-spread",
    "severity": "error",
    "description": "Disallow object spread operators that break Solid's fine-grained reactivity.",
    "fixable": true,
    "category": "correctness",
    "plugin": "solid",
    "messages": {
      "avoidObjectCopy": "Avoid object spread for copying. Use direct property access.",
      "avoidObjectMerge": "Avoid object spread for merging. Use mergeProps() from 'solid-js'.",
      "avoidObjectUpdate": "Avoid object spread for updates. Use produce() or direct assignment.",
      "avoidJsxSpread": "Avoid JSX prop spreading. Use splitProps() to separate props.",
      "avoidRestDestructure": "Avoid rest destructuring. Use splitProps() from 'solid-js'.",
      "avoidPropsSpread": "Spreading props breaks reactivity. Use splitProps() to separate known props.",
      "avoidStoreSpread": "Spreading store creates a static snapshot. Access properties directly.",
      "avoidSignalSpread": "Spreading signal result captures current value. Wrap in createMemo().",
      "avoidClassListSpread": "Spreading in classList breaks reactivity. Wrap in createMemo().",
      "avoidStyleSpread": "Spreading in style breaks reactivity. Wrap in createMemo().",
      "unnecessarySplitProps": "Unnecessary splitProps with empty array. Remove it and use {{source}} directly."
    }
  },
  {
    "id": "avoid-type-casting",
    "severity": "error",
    "description": "Disallow type casting methods that bypass TypeScript's type safety. Includes unnecessary casts, double assertions, casting to any, type predicates, and unsafe generic assertions.",
    "fixable": true,
    "category": "correctness",
    "plugin": "solid",
    "messages": {
      "unnecessaryCast": "Unnecessary type assertion: \"{{name}}\" is already of type \"{{exprType}}\", which is assignable to \"{{type}}\". Remove the cast - it adds noise and suggests you don't understand the types.",
      "doubleAssertion": "Double assertion detected: \"{{name}}\" is cast through unknown/any to \"{{type}}\". This bypasses type safety. You are creating sloppy architecture.",
      "castToAny": "Casting \"{{name}}\" to `any` disables all type checking. Use `unknown` with proper type guards, or fix the underlying type issue.",
      "castToUnknown": "Casting to `unknown` requires runtime type checks before use. You are creating sloppy architecture.",
      "simpleAssertion": "Type assertion on \"{{name}}\" to \"{{type}}\" bypasses type checking. Why are you doing this? Do you EVEN need this? This is sloppy architecture.",
      "assertionInLoop": "Type assertion on \"{{name}}\" inside a loop. Repeated casts to \"{{type}}\" without validation can mask type errors. Consider validating the type once before the loop.",
      "importAssertion": "Type assertion on dynamic import to \"{{type}}\". Import types should be validated at runtime or use proper module type declarations.",
      "typePredicate": "Type predicate function asserts \"{{param}}\" is \"{{type}}\". Why are you doing this? Do you EVEN need this? This is sloppy architecture.",
      "unsafeGeneric": "Casting to generic type parameter \"{{typeParam}}\" without runtime validation. The function returns an unverified type. This is sloppy architecture."
    }
  },
  {
    "id": "avoid-unsafe-type-annotations",
    "severity": "error",
    "description": "Disallow `any` and `unknown` in value-level type annotation positions (parameters, returns, variables, properties)",
    "fixable": false,
    "category": "correctness",
    "plugin": "solid",
    "messages": {
      "anyParameter": "Parameter '{{name}}' is typed `any`{{inFunction}}. This disables type checking for all callers. Use a specific type, a generic, or `unknown` with proper type narrowing.",
      "anyReturn": "Function '{{name}}' returns `any`. This disables type checking for all callers. Use a specific return type.",
      "anyVariable": "Variable '{{name}}' is typed `any`. This disables all type checking on this variable. Use a specific type or `unknown` with type narrowing.",
      "anyProperty": "Property '{{name}}' is typed `any`. This disables type checking for all accesses. Use a specific type.",
      "unknownParameter": "Parameter '{{name}}' is typed `unknown`{{inFunction}}. Callers can pass anything and the function body requires type narrowing on every use. Use a specific type or a generic constraint.",
      "unknownReturn": "Function '{{name}}' returns `unknown`. Callers must narrow the return value before use. Use a specific return type or a generic.",
      "unknownVariable": "Variable '{{name}}' is typed `unknown`. Every use requires type narrowing. Use a specific type or parse the value at the boundary.",
      "unknownProperty": "Property '{{name}}' is typed `unknown`. Every access requires type narrowing. Use a specific type."
    }
  },
  {
    "id": "event-handlers",
    "severity": "error",
    "description": "Enforce naming DOM element event handlers consistently and prevent Solid's analysis from misunderstanding whether a prop should be an event handler.",
    "fixable": true,
    "category": "correctness",
    "plugin": "solid",
    "messages": {
      "detectedAttr": "The \"{{name}}\" prop looks like an event handler but has a static value ({{staticValue}}), so Solid will treat it as an attribute instead of attaching an event listener. Use attr:{{name}} to make this explicit, or provide a function value.",
      "naming": "The \"{{name}}\" prop is ambiguous. Solid cannot determine if this is an event handler or an attribute. Use {{handlerName}} for an event handler, or {{attrName}} for an attribute.",
      "capitalization": "The \"{{name}}\" prop should be {{fixedName}} for Solid to recognize it as an event handler. Event handlers use camelCase with an uppercase letter after \"on\".",
      "nonstandard": "The \"{{name}}\" prop uses a nonstandard event name. Use {{fixedName}} instead, which is the standard DOM event name that Solid recognizes.",
      "makeHandler": "Change {{name}} to {{handlerName}} (event handler).",
      "makeAttr": "Change {{name}} to {{attrName}} (attribute).",
      "spreadHandler": "The \"{{name}}\" prop is being spread into JSX, which prevents Solid from attaching it as an event listener. Add it directly as a JSX attribute instead: {{name}}={...}."
    }
  },
  {
    "id": "missing-jsdoc-comments",
    "severity": "error",
    "description": "Require JSDoc comments on functions with appropriate tags for parameters, return values, and throws.",
    "fixable": false,
    "category": "correctness",
    "plugin": "solid",
    "messages": {
      "missingJsdoc": "Function '{{name}}' is missing a JSDoc comment.",
      "missingParam": "JSDoc for '{{name}}' is missing @param tag for '{{param}}'.",
      "missingReturn": "JSDoc for '{{name}}' is missing @returns tag.",
      "missingThrows": "JSDoc for '{{name}}' is missing @throws tag.",
      "missingExample": "JSDoc for '{{name}}' is missing @example tag.",
      "missingClassJsdoc": "Class '{{name}}' is missing a JSDoc comment.",
      "missingPropertyJsdoc": "Property '{{name}}' is missing a JSDoc comment."
    }
  },
  {
    "id": "no-ai-slop-comments",
    "severity": "error",
    "description": "Disallow comments containing specified forbidden words or phrases. Useful for enforcing comment style guidelines and detecting AI-generated boilerplate.",
    "fixable": true,
    "category": "correctness",
    "plugin": "solid",
    "messages": {
      "forbiddenWord": "Comment contains forbidden word '{{word}}'."
    }
  },
  {
    "id": "no-array-handlers",
    "severity": "error",
    "description": "Disallow array handlers in JSX event properties.",
    "fixable": false,
    "category": "correctness",
    "plugin": "solid",
    "messages": {
      "noArrayHandlers": "Passing an array to \"{{handlerName}}\" is type-unsafe. The array syntax `[handler, data]` passes data as the first argument, making the event object the second argument. Use a closure instead: `{{handlerName}}={() => handler(data)}`."
    }
  },
  {
    "id": "no-banner-comments",
    "severity": "error",
    "description": "Disallow banner-style comments with repeated separator characters.",
    "fixable": true,
    "category": "correctness",
    "plugin": "solid",
    "messages": {
      "banner": "Avoid banner-style comments with repeated separator characters. Use simple comments instead."
    }
  },
  {
    "id": "no-destructure",
    "severity": "error",
    "description": "Disallow destructuring props in Solid components. Props must be accessed via property access (props.x) to preserve reactivity.",
    "fixable": false,
    "category": "correctness",
    "plugin": "solid",
    "messages": {
      "noDestructure": "Destructuring component props breaks Solid's reactivity. Props are reactive getters, so `{ a }` captures the value at component creation time and won't update. Use `props.a` to access props reactively.",
      "noDestructureWithDefaults": "Destructuring component props breaks Solid's reactivity. For default values, use `mergeProps({ a: defaultValue }, props)` instead of `{ a = defaultValue }`.",
      "noDestructureWithRest": "Destructuring component props breaks Solid's reactivity. For rest patterns, use `splitProps(props, ['a', 'b'])` instead of `{ a, b, ...rest }`.",
      "noDestructureWithBoth": "Destructuring component props breaks Solid's reactivity. For default values with rest, use `splitProps(mergeProps({ a: defaultValue }, props), ['a'])` to combine both patterns."
    }
  },
  {
    "id": "no-inline-imports",
    "severity": "error",
    "description": "Disallow inline type imports. Import types at the top of the file for clarity and maintainability.",
    "fixable": false,
    "category": "correctness",
    "plugin": "solid",
    "messages": {
      "inlineImport": "Avoid inline imports. Import `{{specifier}}` at the top of the file instead."
    }
  },
  {
    "id": "string-concat-in-loop",
    "severity": "error",
    "description": "Disallow string concatenation with += inside loops. Use array.push() and .join() instead.",
    "fixable": false,
    "category": "correctness",
    "plugin": "solid",
    "messages": {
      "stringConcatInLoop": "Avoid string concatenation with += inside loops. Use an array with .push() and .join() instead."
    }
  },
  {
    "id": "css-no-outline-none-without-focus-visible",
    "severity": "error",
    "description": "Disallow removing outline without explicit focus-visible replacement.",
    "fixable": false,
    "category": "css-a11y",
    "plugin": "css",
    "messages": {
      "missingFocusVisible": "Focus outline removed without matching `:focus-visible` replacement."
    }
  },
  {
    "id": "css-policy-contrast",
    "severity": "warn",
    "description": "Enforce minimum contrast ratio between foreground and background colors per accessibility policy.",
    "fixable": false,
    "category": "css-a11y",
    "plugin": "css",
    "messages": {
      "insufficientContrast": "Contrast ratio `{{ratio}}:1` between `{{fg}}` and `{{bg}}` is below the minimum `{{min}}:1` for `{{textSize}}` text in policy `{{policy}}`."
    }
  },
  {
    "id": "css-policy-spacing",
    "severity": "warn",
    "description": "Enforce minimum letter-spacing, word-spacing, and paragraph spacing per accessibility policy.",
    "fixable": false,
    "category": "css-a11y",
    "plugin": "css",
    "messages": {
      "letterSpacingTooSmall": "Letter spacing `{{value}}` ({{resolved}}em) is below the minimum `{{min}}em` for policy `{{policy}}`.",
      "wordSpacingTooSmall": "Word spacing `{{value}}` ({{resolved}}em) is below the minimum `{{min}}em` for policy `{{policy}}`.",
      "paragraphSpacingTooSmall": "Paragraph spacing `{{value}}` ({{resolved}}em) is below the minimum `{{min}}em` ({{minMultiplier}}× font-size) for policy `{{policy}}`."
    }
  },
  {
    "id": "css-policy-touch-target",
    "severity": "warn",
    "description": "Enforce minimum interactive element sizes per accessibility policy.",
    "fixable": false,
    "category": "css-a11y",
    "plugin": "css",
    "messages": {
      "heightTooSmall": "`{{property}}` of `{{value}}` ({{resolved}}px) is below the minimum `{{min}}px` for `{{element}}` elements in policy `{{policy}}`.",
      "widthTooSmall": "`{{property}}` of `{{value}}` ({{resolved}}px) is below the minimum `{{min}}px` for `{{element}}` elements in policy `{{policy}}`.",
      "paddingTooSmall": "Horizontal padding `{{value}}` ({{resolved}}px) is below the minimum `{{min}}px` for `{{element}}` elements in policy `{{policy}}`."
    }
  },
  {
    "id": "css-policy-typography",
    "severity": "warn",
    "description": "Enforce minimum font sizes and line heights per accessibility policy.",
    "fixable": false,
    "category": "css-a11y",
    "plugin": "css",
    "messages": {
      "fontTooSmall": "Font size `{{value}}` ({{resolved}}px) is below the `{{context}}` minimum of `{{min}}px` for policy `{{policy}}`.",
      "lineHeightTooSmall": "Line height `{{value}}` is below the `{{context}}` minimum of `{{min}}` for policy `{{policy}}`."
    }
  },
  {
    "id": "css-require-reduced-motion-override",
    "severity": "warn",
    "description": "Require reduced-motion override for animated selectors.",
    "fixable": false,
    "category": "css-a11y",
    "plugin": "css",
    "messages": {
      "missingReducedMotion": "Animated selector `{{selector}}` lacks prefers-reduced-motion override."
    }
  },
  {
    "id": "css-no-discrete-transition",
    "severity": "error",
    "description": "Disallow transitions on discrete CSS properties.",
    "fixable": false,
    "category": "css-animation",
    "plugin": "css",
    "messages": {
      "discreteTransition": "Property `{{property}}` is discrete and should not be transitioned."
    }
  },
  {
    "id": "css-no-empty-keyframes",
    "severity": "error",
    "description": "Disallow empty @keyframes rules.",
    "fixable": false,
    "category": "css-animation",
    "plugin": "css",
    "messages": {
      "emptyKeyframes": "@keyframes `{{name}}` has no effective keyframes."
    }
  },
  {
    "id": "no-layout-property-animation",
    "severity": "warn",
    "description": "Disallow animating layout-affecting properties.",
    "fixable": false,
    "category": "css-animation",
    "plugin": "css",
    "messages": {
      "avoidLayoutAnimation": "Avoid animating layout property `{{property}}`. Prefer transform or opacity to reduce layout thrashing."
    }
  },
  {
    "id": "no-transition-all",
    "severity": "warn",
    "description": "Disallow transition: all and transition-property: all.",
    "fixable": false,
    "category": "css-animation",
    "plugin": "css",
    "messages": {
      "avoidTransitionAll": "Avoid `transition: all`. Transition specific properties to reduce unnecessary style and paint work."
    }
  },
  {
    "id": "no-unknown-animation-name",
    "severity": "error",
    "description": "Disallow animation names that do not match declared keyframes.",
    "fixable": false,
    "category": "css-animation",
    "plugin": "css",
    "messages": {
      "unknownAnimationName": "Animation name `{{name}}` in `{{property}}` does not match any declared @keyframes."
    }
  },
  {
    "id": "no-unused-keyframes",
    "severity": "warn",
    "description": "Disallow unused @keyframes declarations.",
    "fixable": false,
    "category": "css-animation",
    "plugin": "css",
    "messages": {
      "unusedKeyframes": "@keyframes `{{name}}` is never referenced by animation declarations."
    }
  },
  {
    "id": "declaration-no-overridden-within-rule",
    "severity": "warn",
    "description": "Disallow duplicate declarations of the same property within a single rule block.",
    "fixable": false,
    "category": "css-cascade",
    "plugin": "css",
    "messages": {
      "overriddenWithinRule": "Declaration `{{property}}` is overridden later in the same rule. Keep one final declaration per property."
    }
  },
  {
    "id": "media-query-overlap-conflict",
    "severity": "warn",
    "description": "Disallow conflicting declarations in partially overlapping media queries.",
    "fixable": false,
    "category": "css-cascade",
    "plugin": "css",
    "messages": {
      "mediaOverlapConflict": "Overlapping media queries set different `{{property}}` values for `{{selector}}` in the same overlap range."
    }
  },
  {
    "id": "no-descending-specificity-conflict",
    "severity": "warn",
    "description": "Disallow lower-specificity selectors after higher-specificity selectors for the same property.",
    "fixable": false,
    "category": "css-cascade",
    "plugin": "css",
    "messages": {
      "descendingSpecificity": "Lower-specificity selector `{{laterSelector}}` appears after `{{earlierSelector}}` for `{{property}}`, creating brittle cascade behavior."
    }
  },
  {
    "id": "no-layer-order-inversion",
    "severity": "warn",
    "description": "Disallow source-order assumptions that are inverted by layer precedence.",
    "fixable": false,
    "category": "css-cascade",
    "plugin": "css",
    "messages": {
      "layerOrderInversion": "Declaration for `{{property}}` in selector `{{selector}}` appears later but is overridden by an earlier declaration due to @layer precedence."
    }
  },
  {
    "id": "no-redundant-override-pairs",
    "severity": "warn",
    "description": "Disallow declarations that are deterministically overridden in the same selector context.",
    "fixable": false,
    "category": "css-cascade",
    "plugin": "css",
    "messages": {
      "redundantOverride": "Declaration `{{property}}` is always overridden later by the same selector in the same cascade context."
    }
  },
  {
    "id": "css-no-unreferenced-component-class",
    "severity": "warn",
    "description": "Detect CSS classes that are never referenced by static JSX class attributes.",
    "fixable": false,
    "category": "css-jsx",
    "plugin": "cross-file",
    "messages": {
      "unreferencedClass": "CSS class '{{className}}' is defined but not referenced by static JSX class attributes"
    }
  },
  {
    "id": "jsx-classlist-boolean-values",
    "severity": "error",
    "description": "Require classList values to be boolean-like expressions.",
    "fixable": false,
    "category": "css-jsx",
    "plugin": "cross-file",
    "messages": {
      "nonBooleanValue": "classList value for `{{name}}` must be boolean."
    }
  },
  {
    "id": "jsx-classlist-no-accessor-reference",
    "severity": "error",
    "description": "Disallow passing accessor references directly as classList values.",
    "fixable": false,
    "category": "css-jsx",
    "plugin": "cross-file",
    "messages": {
      "accessorReference": "Signal accessor `{{name}}` must be called in classList value (use {{name}}())."
    }
  },
  {
    "id": "jsx-classlist-no-constant-literals",
    "severity": "warn",
    "description": "Disallow classList entries with constant true/false values.",
    "fixable": false,
    "category": "css-jsx",
    "plugin": "cross-file",
    "messages": {
      "constantEntry": "classList entry `{{name}}: {{value}}` is constant; move it to static class."
    }
  },
  {
    "id": "jsx-classlist-static-keys",
    "severity": "error",
    "description": "Require classList keys to be static and non-computed.",
    "fixable": false,
    "category": "css-jsx",
    "plugin": "cross-file",
    "messages": {
      "nonStaticKey": "classList key must be statically known for reliable class mapping."
    }
  },
  {
    "id": "jsx-layout-classlist-geometry-toggle",
    "severity": "warn",
    "description": "Flag classList-driven class toggles that map to layout-affecting CSS geometry changes.",
    "fixable": false,
    "category": "css-jsx",
    "plugin": "cross-file",
    "messages": {
      "classListGeometryToggle": "classList toggles '{{className}}', and matching CSS changes layout-affecting '{{property}}', which can cause CLS."
    }
  },
  {
    "id": "jsx-layout-fill-image-parent-must-be-sized",
    "severity": "warn",
    "description": "Require stable parent size and positioning for fill-image component usage.",
    "fixable": false,
    "category": "css-jsx",
    "plugin": "cross-file",
    "messages": {
      "unsizedFillParent": "Fill-image component '{{component}}' is inside a parent without stable size/position; add parent sizing (height/min-height/aspect-ratio) and non-static position to avoid CLS."
    }
  },
  {
    "id": "jsx-layout-picture-source-ratio-consistency",
    "severity": "warn",
    "description": "Require consistent intrinsic aspect ratios across <picture> sources and fallback image.",
    "fixable": false,
    "category": "css-jsx",
    "plugin": "cross-file",
    "messages": {
      "inconsistentPictureRatio": "`<picture>` source ratio {{sourceRatio}} differs from fallback img ratio {{imgRatio}}, which can cause reserved-space mismatch and CLS."
    }
  },
  {
    "id": "jsx-layout-unstable-style-toggle",
    "severity": "warn",
    "description": "Flag dynamic inline style values on layout-sensitive properties that can trigger CLS.",
    "fixable": false,
    "category": "css-jsx",
    "plugin": "cross-file",
    "messages": {
      "unstableLayoutStyleToggle": "Dynamic style value for '{{property}}' can toggle layout geometry at runtime and cause CLS."
    }
  },
  {
    "id": "jsx-no-duplicate-class-token-class-classlist",
    "severity": "warn",
    "description": "Disallow duplicate class tokens between class and classList on the same JSX element.",
    "fixable": false,
    "category": "css-jsx",
    "plugin": "cross-file",
    "messages": {
      "duplicateClassToken": "Class token `{{name}}` appears in both class and classList."
    }
  },
  {
    "id": "jsx-no-undefined-css-class",
    "severity": "error",
    "description": "Detect undefined CSS class names in JSX",
    "fixable": false,
    "category": "css-jsx",
    "plugin": "cross-file",
    "messages": {
      "undefinedClass": "CSS class '{{className}}' is not defined in project CSS files"
    }
  },
  {
    "id": "jsx-style-kebab-case-keys",
    "severity": "error",
    "description": "Require kebab-case keys in JSX style object literals.",
    "fixable": false,
    "category": "css-jsx",
    "plugin": "cross-file",
    "messages": {
      "kebabStyleKey": "Style key `{{name}}` should be `{{kebab}}` in Solid style objects."
    }
  },
  {
    "id": "jsx-style-no-function-values",
    "severity": "error",
    "description": "Disallow function values in JSX style objects.",
    "fixable": false,
    "category": "css-jsx",
    "plugin": "cross-file",
    "messages": {
      "functionStyleValue": "Style value for `{{name}}` is a function; pass computed value instead."
    }
  },
  {
    "id": "jsx-style-no-unused-custom-prop",
    "severity": "warn",
    "description": "Detect inline style custom properties that are never consumed by CSS var() references.",
    "fixable": false,
    "category": "css-jsx",
    "plugin": "cross-file",
    "messages": {
      "unusedInlineVar": "Inline custom property `{{name}}` is never read via var({{name}})."
    }
  },
  {
    "id": "jsx-style-policy",
    "severity": "warn",
    "description": "Enforce accessibility policy thresholds on inline JSX style objects.",
    "fixable": false,
    "category": "css-jsx",
    "plugin": "cross-file",
    "messages": {
      "fontTooSmall": "Inline style `{{prop}}: {{value}}` ({{resolved}}px) is below the minimum `{{min}}px` for policy `{{policy}}`.",
      "lineHeightTooSmall": "Inline style `line-height: {{value}}` is below the minimum `{{min}}` for policy `{{policy}}`.",
      "heightTooSmall": "Inline style `{{prop}}: {{value}}` ({{resolved}}px) is below the minimum `{{min}}px` for interactive elements in policy `{{policy}}`.",
      "letterSpacingTooSmall": "Inline style `letter-spacing: {{value}}` ({{resolved}}em) is below the minimum `{{min}}em` for policy `{{policy}}`.",
      "wordSpacingTooSmall": "Inline style `word-spacing: {{value}}` ({{resolved}}em) is below the minimum `{{min}}em` for policy `{{policy}}`."
    }
  },
  {
    "id": "css-layout-animation-layout-property",
    "severity": "warn",
    "description": "Disallow keyframe animations that mutate layout-affecting properties and can trigger CLS.",
    "fixable": false,
    "category": "css-layout",
    "plugin": "cross-file",
    "messages": {
      "animationLayoutProperty": "Animation '{{animation}}' mutates layout-affecting '{{property}}', which can trigger CLS. Prefer transform/opacity or reserve geometry."
    }
  },
  {
    "id": "css-layout-box-sizing-toggle-with-chrome",
    "severity": "warn",
    "description": "Disallow conditional box-sizing mode toggles when box chrome contributes to geometry shifts.",
    "fixable": false,
    "category": "css-layout",
    "plugin": "cross-file",
    "messages": {
      "boxSizingToggleWithChrome": "Conditional `box-sizing` toggle on '{{tag}}' combines with non-zero padding/border, which can shift layout and trigger CLS."
    }
  },
  {
    "id": "css-layout-conditional-display-collapse",
    "severity": "warn",
    "description": "Disallow conditional display collapse in flow without reserved geometry.",
    "fixable": false,
    "category": "css-layout",
    "plugin": "cross-file",
    "messages": {
      "conditionalDisplayCollapse": "Conditional display sets '{{display}}' on '{{tag}}' without stable reserved space, which can collapse/expand layout and cause CLS."
    }
  },
  {
    "id": "css-layout-conditional-offset-shift",
    "severity": "warn",
    "description": "Disallow conditional non-zero block-axis offsets that can trigger layout shifts.",
    "fixable": false,
    "category": "css-layout",
    "plugin": "cross-file",
    "messages": {
      "conditionalOffsetShift": "Conditional style applies non-zero '{{property}}' offset ({{value}}), which can cause layout shifts when conditions toggle."
    }
  },
  {
    "id": "css-layout-conditional-white-space-wrap-shift",
    "severity": "warn",
    "description": "Disallow conditional white-space wrapping mode toggles that can trigger CLS.",
    "fixable": false,
    "category": "css-layout",
    "plugin": "cross-file",
    "messages": {
      "conditionalWhiteSpaceShift": "Conditional white-space '{{whiteSpace}}' on '{{tag}}' can reflow text and shift siblings; keep wrapping behavior stable or reserve geometry."
    }
  },
  {
    "id": "css-layout-content-visibility-no-intrinsic-size",
    "severity": "warn",
    "description": "Require intrinsic size reservation when using content-visibility auto to avoid late layout shifts.",
    "fixable": false,
    "category": "css-layout",
    "plugin": "cross-file",
    "messages": {
      "missingIntrinsicSize": "`content-visibility: auto` on '{{tag}}' lacks intrinsic size reservation (`contain-intrinsic-size`/min-height/height/aspect-ratio), which can cause CLS."
    }
  },
  {
    "id": "css-layout-dynamic-slot-no-reserved-space",
    "severity": "warn",
    "description": "Require reserved block space for dynamic content containers to avoid layout shifts.",
    "fixable": false,
    "category": "css-layout",
    "plugin": "cross-file",
    "messages": {
      "dynamicSlotNoReservedSpace": "Dynamic content container '{{tag}}' does not reserve block space (min-height/height/aspect-ratio/contain-intrinsic-size), which can cause CLS."
    }
  },
  {
    "id": "css-layout-font-swap-instability",
    "severity": "warn",
    "description": "Require metric overrides for swapping webfonts to reduce layout shifts during font load.",
    "fixable": false,
    "category": "css-layout",
    "plugin": "cross-file",
    "messages": {
      "unstableFontSwap": "`@font-face` for '{{family}}' uses `font-display: {{display}}` without metric overrides (for example `size-adjust`), which can cause CLS when the webfont swaps in."
    }
  },
  {
    "id": "css-layout-overflow-anchor-instability",
    "severity": "warn",
    "description": "Disallow overflow-anchor none on dynamic or scrollable containers prone to visible layout shifts.",
    "fixable": false,
    "category": "css-layout",
    "plugin": "cross-file",
    "messages": {
      "unstableOverflowAnchor": "Element '{{tag}}' sets `overflow-anchor: none` on a {{context}} container; disabling scroll anchoring can amplify visible layout shifts."
    }
  },
  {
    "id": "css-layout-overflow-mode-toggle-instability",
    "severity": "warn",
    "description": "Disallow conditional overflow mode switches that can introduce scrollbar-induced layout shifts.",
    "fixable": false,
    "category": "css-layout",
    "plugin": "cross-file",
    "messages": {
      "overflowModeToggle": "Conditional overflow mode changes scrolling ('{{overflow}}') on '{{tag}}' without `scrollbar-gutter: stable`, which can trigger CLS."
    }
  },
  {
    "id": "css-layout-scrollbar-gutter-instability",
    "severity": "warn",
    "description": "Require stable scrollbar gutters for scrollable containers to reduce layout shifts.",
    "fixable": false,
    "category": "css-layout",
    "plugin": "cross-file",
    "messages": {
      "missingScrollbarGutter": "Scrollable container '{{tag}}' uses overflow auto/scroll without `scrollbar-gutter: stable`, which can trigger CLS when scrollbars appear."
    }
  },
  {
    "id": "css-layout-sibling-alignment-outlier",
    "severity": "warn",
    "description": "Detect vertical alignment outliers between sibling elements in shared layout containers.",
    "fixable": false,
    "category": "css-layout",
    "plugin": "cross-file",
    "messages": {
      "misalignedSibling": "Vertically misaligned '{{subject}}' in '{{parent}}'.{{fix}}{{offsetClause}}"
    }
  },
  {
    "id": "css-layout-stateful-box-model-shift",
    "severity": "warn",
    "description": "Disallow stateful selector changes that alter element geometry and trigger layout shifts.",
    "fixable": false,
    "category": "css-layout",
    "plugin": "cross-file",
    "messages": {
      "statefulBoxModelShift": "State selector '{{selector}}' changes layout-affecting '{{property}}'. Keep geometry stable across states to avoid CLS."
    }
  },
  {
    "id": "css-layout-transition-layout-property",
    "severity": "warn",
    "description": "Disallow transitions that animate layout-affecting geometry properties.",
    "fixable": false,
    "category": "css-layout",
    "plugin": "cross-file",
    "messages": {
      "transitionLayoutProperty": "Transition '{{property}}' in '{{declaration}}' animates layout-affecting geometry. Prefer transform/opacity to avoid CLS."
    }
  },
  {
    "id": "css-layout-unsized-replaced-element",
    "severity": "warn",
    "description": "Require stable reserved geometry for replaced media elements to prevent layout shifts.",
    "fixable": false,
    "category": "css-layout",
    "plugin": "cross-file",
    "messages": {
      "unsizedReplacedElement": "Replaced element '{{tag}}' has no stable reserved size (width/height or aspect-ratio with a dimension), which can cause CLS."
    }
  },
  {
    "id": "css-no-custom-property-cycle",
    "severity": "error",
    "description": "Disallow cycles in custom property references.",
    "fixable": false,
    "category": "css-property",
    "plugin": "css",
    "messages": {
      "variableCycle": "Custom property cycle detected involving `{{name}}`."
    }
  },
  {
    "id": "css-no-hardcoded-z-index",
    "severity": "warn",
    "description": "Disallow hardcoded positive z-index literals.",
    "fixable": false,
    "category": "css-property",
    "plugin": "css",
    "messages": {
      "hardcodedZ": "Use a z-index token variable instead of literal `{{value}}`."
    }
  },
  {
    "id": "css-no-legacy-vh-100",
    "severity": "warn",
    "description": "Disallow 100vh in viewport sizing declarations.",
    "fixable": false,
    "category": "css-property",
    "plugin": "css",
    "messages": {
      "avoidLegacyVh": "Use 100dvh/100svh instead of `100vh` for mobile-safe viewport sizing."
    }
  },
  {
    "id": "css-z-index-requires-positioned-context",
    "severity": "warn",
    "description": "Require positioned context when using z-index.",
    "fixable": false,
    "category": "css-property",
    "plugin": "css",
    "messages": {
      "zIndexNoContext": "`z-index` has no guaranteed effect without a positioned context."
    }
  },
  {
    "id": "no-important",
    "severity": "warn",
    "description": "Disallow !important declarations.",
    "fixable": false,
    "category": "css-property",
    "plugin": "css",
    "messages": {
      "avoidImportant": "Avoid `!important` on `{{property}}`. It increases override cost and usually signals specificity debt."
    }
  },
  {
    "id": "no-unresolved-custom-properties",
    "severity": "error",
    "description": "Disallow unresolved custom property references.",
    "fixable": false,
    "category": "css-property",
    "plugin": "css",
    "messages": {
      "unresolvedCustomProperty": "Custom property reference `{{name}}` is unresolved in `{{property}}`. Define it or provide a fallback value."
    }
  },
  {
    "id": "no-unused-custom-properties",
    "severity": "warn",
    "description": "Disallow unused CSS custom properties.",
    "fixable": false,
    "category": "css-property",
    "plugin": "css",
    "messages": {
      "unusedCustomProperty": "Custom property `{{name}}` is never referenced within the project CSS."
    }
  },
  {
    "id": "no-complex-selectors",
    "severity": "warn",
    "description": "Disallow deep selectors that are expensive to match.",
    "fixable": false,
    "category": "css-selector",
    "plugin": "css",
    "messages": {
      "selectorTooDeep": "Selector `{{selector}}` has depth {{depth}}. Deep selectors increase style recalculation cost and are fragile across component rerenders."
    }
  },
  {
    "id": "no-duplicate-selectors",
    "severity": "warn",
    "description": "Disallow duplicate selector blocks.",
    "fixable": false,
    "category": "css-selector",
    "plugin": "css",
    "messages": {
      "duplicateSelector": "Selector `{{selector}}` is duplicated {{count}} times. Merge declarations to avoid cascade ambiguity."
    }
  },
  {
    "id": "no-id-selectors",
    "severity": "warn",
    "description": "Disallow ID selectors.",
    "fixable": false,
    "category": "css-selector",
    "plugin": "css",
    "messages": {
      "avoidId": "Avoid ID selector in `{{selector}}`. IDs raise specificity and make component-level styling harder to maintain."
    }
  },
  {
    "id": "selector-max-attribute-and-universal",
    "severity": "off",
    "description": "Disallow selectors with attribute or universal selectors beyond configured limits.",
    "fixable": false,
    "category": "css-selector",
    "plugin": "css",
    "messages": {
      "tooManyAttributes": "Selector `{{selector}}` uses {{count}} attribute selector(s). Maximum allowed is {{max}}.",
      "tooManyUniversals": "Selector `{{selector}}` uses {{count}} universal selector(s). Maximum allowed is {{max}}."
    }
  },
  {
    "id": "selector-max-specificity",
    "severity": "warn",
    "description": "Disallow selectors that exceed a specificity threshold.",
    "fixable": false,
    "category": "css-selector",
    "plugin": "css",
    "messages": {
      "maxSpecificity": "Selector `{{selector}}` specificity {{specificity}} exceeds max {{max}}. Reduce selector weight to keep the cascade predictable."
    }
  },
  {
    "id": "css-no-empty-rule",
    "severity": "warn",
    "description": "Disallow empty CSS rules.",
    "fixable": false,
    "category": "css-structure",
    "plugin": "css",
    "messages": {
      "emptyRule": "Empty rule `{{selector}}` should be removed."
    }
  },
  {
    "id": "css-no-unknown-container-name",
    "severity": "error",
    "description": "Disallow unknown named containers in @container queries.",
    "fixable": false,
    "category": "css-structure",
    "plugin": "css",
    "messages": {
      "unknownContainer": "Unknown container name `{{name}}` in @container query."
    }
  },
  {
    "id": "css-no-unused-container-name",
    "severity": "warn",
    "description": "Disallow unused named containers.",
    "fixable": false,
    "category": "css-structure",
    "plugin": "css",
    "messages": {
      "unusedContainer": "Container name `{{name}}` is declared but never queried."
    }
  },
  {
    "id": "layer-requirement-for-component-rules",
    "severity": "warn",
    "description": "Require style rules to be inside @layer when the file defines layers.",
    "fixable": false,
    "category": "css-structure",
    "plugin": "css",
    "messages": {
      "missingLayer": "Rule `{{selector}}` is not inside any @layer block while this file uses @layer. Place component rules inside an explicit layer."
    }
  },
  {
    "id": "components-return-once",
    "severity": "error",
    "description": "Disallow early returns in components. Solid components only run once, and so conditionals should be inside JSX.",
    "fixable": true,
    "category": "jsx",
    "plugin": "solid",
    "messages": {
      "noEarlyReturn": "Early returns in Solid components break reactivity because the component function only runs once. Use <Show> or <Switch>/<Match> inside the JSX to conditionally render content instead of returning early from the function.",
      "noConditionalReturn": "Conditional expressions in return statements break reactivity because Solid components only run once. Wrap the condition in <Show when={...}> for a single condition, or <Switch>/<Match> for multiple conditions."
    }
  },
  {
    "id": "jsx-no-duplicate-props",
    "severity": "error",
    "description": "Disallow passing the same prop twice in JSX.",
    "fixable": true,
    "category": "jsx",
    "plugin": "solid",
    "messages": {
      "noDuplicateProps": "Duplicate prop detected. Each prop should only be specified once; the second value will override the first.",
      "noDuplicateClass": "Duplicate `class` prop detected. While this might appear to work, it can break unexpectedly because only one class binding is applied. Use `classList` to conditionally apply multiple classes.",
      "noDuplicateChildren": "Conflicting children: {{used}}. Only one method of setting children is allowed at a time."
    }
  },
  {
    "id": "jsx-no-script-url",
    "severity": "error",
    "description": "Disallow javascript: URLs.",
    "fixable": true,
    "category": "jsx",
    "plugin": "solid",
    "messages": {
      "noJSURL": "Using javascript: URLs is a security risk because it can enable cross-site scripting (XSS) attacks. Use an event handler like onClick instead, or navigate programmatically with useNavigate()."
    }
  },
  {
    "id": "jsx-no-undef",
    "severity": "error",
    "description": "Disallow references to undefined variables in JSX. Handles custom directives.",
    "fixable": false,
    "category": "jsx",
    "plugin": "solid",
    "messages": {
      "customDirectiveUndefined": "Custom directive '{{identifier}}' is not defined. Directives must be imported or declared in scope before use (e.g., `const {{identifier}} = (el, accessor) => { ... }`)."
    }
  },
  {
    "id": "jsx-uses-vars",
    "severity": "warn",
    "description": "Detect imported components and directives that are never used in JSX.",
    "fixable": false,
    "category": "jsx",
    "plugin": "solid",
    "messages": {
      "unusedComponent": "Component '{{name}}' is imported but never used in JSX.",
      "unusedDirective": "Directive '{{name}}' is imported but never used in JSX."
    }
  },
  {
    "id": "no-innerhtml",
    "severity": "error",
    "description": "Disallow usage of the innerHTML attribute, which can lead to security vulnerabilities.",
    "fixable": true,
    "category": "jsx",
    "plugin": "solid",
    "messages": {
      "dangerous": "Using innerHTML with dynamic content is a security risk. Unsanitized user input can lead to cross-site scripting (XSS) attacks. Use a sanitization library or render content safely.",
      "conflict": "The innerHTML prop will overwrite all child elements. Remove the children or use innerHTML on an empty element.",
      "notHtml": "The innerHTML value doesn't appear to be HTML. If you're setting text content, use innerText instead for clarity and safety.",
      "dangerouslySetInnerHTML": "The dangerouslySetInnerHTML is a React prop that Solid doesn't support. Use innerHTML instead."
    }
  },
  {
    "id": "no-unknown-namespaces",
    "severity": "error",
    "description": "Enforce using only Solid-specific namespaced attribute names (i.e. `'on:'` in `<div on:click={...} />`).",
    "fixable": false,
    "category": "jsx",
    "plugin": "solid",
    "messages": {
      "unknownNamespace": "'{{namespace}}:' is not a recognized Solid namespace. Valid namespaces are: {{validNamespaces}}.",
      "styleNamespace": "The 'style:' namespace works but is discouraged. Use the style prop with an object instead: style={{ {{property}}: value }}.",
      "classNamespace": "The 'class:' namespace works but is discouraged. Use the classList prop instead: classList={{ \"{{className}}\": condition }}.",
      "componentNamespace": "Namespaced attributes like '{{namespace}}:' only work on DOM elements, not components. The '{{fullName}}' attribute will be passed as a regular prop named '{{fullName}}'."
    }
  },
  {
    "id": "show-truthy-conversion",
    "severity": "error",
    "description": "Detect <Show when={expr}> where expr is not explicitly boolean, which may have unexpected truthy/falsy behavior.",
    "fixable": true,
    "category": "jsx",
    "plugin": "solid",
    "messages": {
      "showNonBoolean": "<Show when={{{{expr}}}}> uses truthy/falsy conversion. Value '0' or empty string '' will hide content. Use explicit boolean: when={Boolean({{expr}})} or when={{{expr}}} != null}"
    }
  },
  {
    "id": "suspense-boundary-missing",
    "severity": "error",
    "description": "Detect missing fallback props on Suspense/ErrorBoundary, and lazy components without Suspense wrapper.",
    "fixable": false,
    "category": "jsx",
    "plugin": "solid",
    "messages": {
      "suspenseNoFallback": "<Suspense> should have a fallback prop to show while children are loading. Add: fallback={<Loading />}",
      "errorBoundaryNoFallback": "<ErrorBoundary> should have a fallback prop to show when an error occurs. Add: fallback={(err) => <Error error={err} />}",
      "lazyNoSuspense": "Lazy component '{{name}}' must be wrapped in a <Suspense> boundary. Add a <Suspense fallback={...}> ancestor."
    }
  },
  {
    "id": "validate-jsx-nesting",
    "severity": "error",
    "description": "Validates that HTML elements are nested according to the HTML5 specification.",
    "fixable": false,
    "category": "jsx",
    "plugin": "solid",
    "messages": {
      "invalidNesting": "Invalid HTML nesting: <{{child}}> cannot be a child of <{{parent}}>. {{reason}}.",
      "voidElementWithChildren": "<{{parent}}> is a void element and cannot have children. Found <{{child}}> as a child.",
      "invalidListChild": "<{{child}}> is not a valid direct child of <{{parent}}>. Only <li> elements can be direct children of <ul> and <ol>.",
      "invalidSelectChild": "<{{child}}> is not a valid direct child of <select>. Only <option> and <optgroup> elements are allowed.",
      "invalidTableChild": "<{{child}}> is not a valid direct child of <{{parent}}>. Expected: {{expected}}.",
      "invalidDlChild": "<{{child}}> is not a valid direct child of <dl>. Only <dt>, <dd>, and <div> elements are allowed."
    }
  },
  {
    "id": "avoid-arguments-object",
    "severity": "warn",
    "description": "Disallow arguments object (use rest parameters instead).",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "avoidArguments": "arguments object can prevent V8 optimization. Use rest parameters (...args) instead."
    }
  },
  {
    "id": "avoid-chained-array-methods",
    "severity": "warn",
    "description": "Flags chained array methods creating 3+ intermediate arrays, or filter().map() pattern.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "avoidChainedArrayMethods": "Chain creates {{count}} intermediate array(s). Consider reduce() or a loop. Chain: {{chain}}",
      "mapJoinHotPath": "map().join() inside loops allocates intermediate arrays on a hot path. Prefer single-pass string construction."
    }
  },
  {
    "id": "avoid-defensive-copy-for-scalar-stat",
    "severity": "warn",
    "description": "Disallow defensive array copies passed into scalar statistic calls.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "defensiveCopy": "Defensive copy before scalar statistic '{{stat}}' allocates unnecessarily. Prefer readonly/non-mutating scalar computation."
    }
  },
  {
    "id": "avoid-delete-operator",
    "severity": "warn",
    "description": "Disallow delete operator on objects (causes V8 deoptimization).",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "avoidDelete": "delete operator transitions object to slow mode. Use `obj.prop = undefined` or destructuring instead."
    }
  },
  {
    "id": "avoid-function-allocation-in-hot-loop",
    "severity": "warn",
    "description": "Disallow creating closures inside loops.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "closureInLoop": "Function created inside loop allocates new closure per iteration. Consider hoisting or using event delegation."
    }
  },
  {
    "id": "avoid-hidden-class-transition",
    "severity": "warn",
    "description": "Suggest consistent object shapes to avoid V8 hidden class transitions.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "hiddenClassTransition": "Property '{{property}}' added conditionally to '{{object}}' creates inconsistent object shapes. Initialize '{{property}}' in the object literal."
    }
  },
  {
    "id": "avoid-intermediate-map-copy",
    "severity": "warn",
    "description": "Disallow temporary Map allocations that are copied key-for-key into another Map.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "intermediateMapCopy": "Intermediate Map '{{tempName}}' is copied into '{{outName}}' key-for-key. Build output directly to avoid extra allocation."
    }
  },
  {
    "id": "avoid-megamorphic-property-access",
    "severity": "warn",
    "description": "Avoid property access on `any` or wide union types to prevent V8 deoptimization.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "megamorphicAccess": "Property access on `any` or wide union type causes V8 deoptimization. Consider narrowing the type."
    }
  },
  {
    "id": "avoid-quadratic-pair-comparison",
    "severity": "warn",
    "description": "Disallow nested for-loops over the same collection creating O(n²) pair comparison.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "quadraticPair": "Nested loops over `{{collection}}` create O(n²) pair comparison. Group by a key property first."
    }
  },
  {
    "id": "avoid-quadratic-spread",
    "severity": "error",
    "description": "Disallow spreading accumulator in reduce callbacks (O(n²) complexity).",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "quadraticSpread": "Spreading accumulator in reduce creates O(n²) complexity. Use push() instead."
    }
  },
  {
    "id": "avoid-repeated-indexof-check",
    "severity": "warn",
    "description": "Disallow 3+ .indexOf() calls on the same array variable in one function.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "repeatedIndexOf": "{{count}} .indexOf() calls on `{{name}}` in the same function. Use a Set, regex, or single-pass scan instead."
    }
  },
  {
    "id": "avoid-slice-sort-pattern",
    "severity": "warn",
    "description": "Disallow .slice().sort() and .slice().reverse() chains. Use .toSorted()/.toReversed().",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "sliceSort": ".slice().sort() creates an intermediate array. Use .toSorted() instead.",
      "sliceReverse": ".slice().reverse() creates an intermediate array. Use .toReversed() instead.",
      "spreadSort": "[...array].sort() creates an intermediate array. Use .toSorted() instead.",
      "spreadReverse": "[...array].reverse() creates an intermediate array. Use .toReversed() instead."
    }
  },
  {
    "id": "avoid-sparse-arrays",
    "severity": "warn",
    "description": "Disallow new Array(n) without fill (creates holey array).",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "sparseArray": "new Array(n) creates a holey array. Use Array.from() or .fill() instead."
    }
  },
  {
    "id": "avoid-spread-sort-map-join-pipeline",
    "severity": "warn",
    "description": "Disallow [...iterable].sort().map().join() pipelines on hot paths.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "spreadSortMapJoin": "Spread+sort+map+join pipeline allocates multiple intermediates. Prefer single-pass string construction on hot paths."
    }
  },
  {
    "id": "bounded-worklist-traversal",
    "severity": "warn",
    "description": "Detect queue/worklist traversals with unbounded growth and no guard.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "boundedWorklist": "Worklist '{{name}}' grows via push() without visited set or explicit size bound. Add traversal guard to prevent pathological growth."
    }
  },
  {
    "id": "closure-captured-scope",
    "severity": "warn",
    "description": "Detect closures returned from scopes containing large allocations that may be retained.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "capturedScope": "Returned closure shares scope with large allocation '{{name}}'. V8 may retain the allocation via scope capture even though the closure doesn't reference it. Move the allocation to an inner scope."
    }
  },
  {
    "id": "closure-dom-circular",
    "severity": "warn",
    "description": "Detect event handler property assignments that create closure-DOM circular references.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "circularRef": "Event handler on '{{param}}' creates a closure that captures '{{param}}', forming a closure-DOM circular reference. Use addEventListener with a named handler for easier cleanup."
    }
  },
  {
    "id": "create-root-dispose",
    "severity": "warn",
    "description": "Detect createRoot with unused dispose parameter.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "unusedDispose": "createRoot() dispose parameter is never used. The reactive tree will never be cleaned up. Call dispose(), return it, or pass it to onCleanup()."
    }
  },
  {
    "id": "detached-dom-reference",
    "severity": "warn",
    "description": "Detect DOM query results stored in module-scoped variables that may hold detached nodes.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "detachedRef": "DOM query result from '{{method}}' stored in module-scoped variable '{{name}}'. If the DOM node is removed, this reference prevents garbage collection. Use a local variable or WeakRef instead."
    }
  },
  {
    "id": "effect-outside-root",
    "severity": "error",
    "description": "Detect reactive computations created outside a reactive root (no Owner).",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "orphanedEffect": "{{primitive}}() called outside a reactive root. Without an Owner, this computation is never disposed and leaks memory. Wrap in a component, createRoot, or runWithOwner."
    }
  },
  {
    "id": "finalization-registry-leak",
    "severity": "error",
    "description": "Detect FinalizationRegistry.register() where heldValue references the target.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "selfReference": "FinalizationRegistry.register() heldValue references the target '{{name}}'. This strong reference prevents the target from being garbage collected, defeating the purpose of the registry."
    }
  },
  {
    "id": "no-char-array-materialization",
    "severity": "warn",
    "description": "Disallow split(\"\"), Array.from(str), or [...str] in parsing loops.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "charArrayMaterialization": "Character array materialization via {{pattern}} in parsing loops allocates O(n) extra memory. Prefer index-based scanning."
    }
  },
  {
    "id": "no-double-pass-delimiter-count",
    "severity": "warn",
    "description": "Disallow split-based delimiter counting followed by additional split passes.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "doublePassDelimiterCount": "Delimiter counting via `split(...).length` plus another `split(...)` repeats full-string passes. Prefer one indexed scan."
    }
  },
  {
    "id": "no-full-split-in-hot-parse",
    "severity": "warn",
    "description": "Disallow full split() materialization inside hot string parsing loops.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "fullSplitInHotParse": "`split()` inside parsing loops materializes full token arrays each iteration. Prefer cursor/index scanning."
    }
  },
  {
    "id": "no-heavy-parser-constructor-in-loop",
    "severity": "warn",
    "description": "Disallow constructing heavy parsing helpers inside loops.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "heavyParserConstructor": "`new {{ctor}}(...)` inside parsing loops repeatedly allocates heavy parser helpers. Hoist and reuse instances."
    }
  },
  {
    "id": "no-leaked-abort-controller",
    "severity": "warn",
    "description": "Detect AbortController in effects without abort() in onCleanup.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "leakedAbort": "new AbortController() inside a reactive effect without onCleanup. Add onCleanup(() => controller.abort())."
    }
  },
  {
    "id": "no-leaked-animation-frame",
    "severity": "warn",
    "description": "Detect requestAnimationFrame in effects without cancelAnimationFrame in onCleanup.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "leakedRaf": "requestAnimationFrame() inside a reactive effect without onCleanup. Add onCleanup(() => cancelAnimationFrame(id))."
    }
  },
  {
    "id": "no-leaked-event-listener",
    "severity": "warn",
    "description": "Detect addEventListener in effects without removeEventListener in onCleanup.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "leakedListener": "addEventListener() inside a reactive effect without onCleanup. Each re-run leaks a listener. Add onCleanup(() => removeEventListener(...))."
    }
  },
  {
    "id": "no-leaked-observer",
    "severity": "warn",
    "description": "Detect Observer APIs in effects without disconnect() in onCleanup.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "leakedObserver": "new {{type}}() inside a reactive effect without onCleanup. Add onCleanup(() => observer.disconnect())."
    }
  },
  {
    "id": "no-leaked-subscription",
    "severity": "warn",
    "description": "Detect WebSocket/EventSource/BroadcastChannel in effects without close() in onCleanup.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "leakedSubscription": "new {{type}}() inside a reactive effect without onCleanup. Add onCleanup(() => instance.close())."
    }
  },
  {
    "id": "no-leaked-timer",
    "severity": "warn",
    "description": "Detect setInterval/setTimeout in effects without onCleanup to clear them.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "leakedTimer": "{{setter}}() inside a reactive effect without onCleanup. Each re-run leaks a timer. Add onCleanup(() => {{clearer}}(id))."
    }
  },
  {
    "id": "no-loop-string-plus-equals",
    "severity": "warn",
    "description": "Disallow repeated string += accumulation in parsing loops.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "loopStringPlusEquals": "Repeated string `+=` in parsing loops creates avoidable allocations. Buffer chunks and join once."
    }
  },
  {
    "id": "no-multipass-split-pipeline",
    "severity": "warn",
    "description": "Disallow multipass split/map/filter pipelines in parsing code.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "multipassSplit": "`split()` followed by multiple array passes allocates heavily on parsing paths. Prefer single-pass parsing."
    }
  },
  {
    "id": "no-per-char-substring-scan",
    "severity": "warn",
    "description": "Disallow per-character substring/charAt scanning patterns in loops.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "perCharSubstring": "Per-character `{{method}}()` scanning in loops allocates extra strings. Prefer index + charCodeAt scanning."
    }
  },
  {
    "id": "no-repeated-token-normalization",
    "severity": "warn",
    "description": "Disallow repeated trim/lower/upper normalization chains on the same token in one function.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "repeatedTokenNormalization": "Repeated token normalization `{{chain}}` on `{{name}}` in one function. Compute once and reuse."
    }
  },
  {
    "id": "no-rescan-indexof-loop",
    "severity": "warn",
    "description": "Disallow repeated indexOf/includes scans from start in parsing loops.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "rescanIndexOf": "Repeated `{{method}}()` from string start inside loops rescans prior text. Pass a cursor start index."
    }
  },
  {
    "id": "no-rest-slice-loop",
    "severity": "warn",
    "description": "Disallow repeated self-slice reassignment loops in string parsing code.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "restSliceLoop": "Repeated `{{name}} = {{name}}.{{method}}(...)` in loops creates string churn. Track cursor indexes instead."
    }
  },
  {
    "id": "no-shift-splice-head-consume",
    "severity": "warn",
    "description": "Disallow shift/splice(0,1) head-consume patterns in loops.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "headConsume": "Head-consuming `{{method}}()` inside loops causes array reindexing costs. Use index cursor iteration instead."
    }
  },
  {
    "id": "no-write-only-index",
    "severity": "warn",
    "description": "Detect index structures that are written but never queried by key.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "writeOnlyIndex": "Index '{{name}}' is built via writes but never queried by key. Remove it or use direct collection flow."
    }
  },
  {
    "id": "prefer-charcode-over-regex-test",
    "severity": "warn",
    "description": "Prefer charCodeAt() range checks over regex .test() for single-character classification.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "regexTest": "Regex `{{pattern}}`.test() on a single character. Use charCodeAt() range checks instead."
    }
  },
  {
    "id": "prefer-index-scan-over-string-iterator",
    "severity": "warn",
    "description": "Prefer index-based string scanning over for-of iteration in ASCII parser code.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "preferIndexScan": "ASCII parsing loops should avoid `for...of` string iteration. Prefer indexed scanning with charCodeAt for lower overhead."
    }
  },
  {
    "id": "prefer-lazy-property-access",
    "severity": "warn",
    "description": "Suggests moving property access after early returns when not used immediately.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "preferLazyPropertyAccess": "Property '{{propertyName}}' assigned to '{{variableName}}' before early return but not used there. Move assignment after early returns."
    }
  },
  {
    "id": "prefer-map-lookup-over-linear-scan",
    "severity": "warn",
    "description": "Disallow repeated linear scans over fixed literal collections in hot paths.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "preferMapLookup": "Linear scan over fixed collection '{{name}}' in '{{fnName}}'. Precompute Map/Set lookup for O(1) access."
    }
  },
  {
    "id": "prefer-map-over-object-dictionary",
    "severity": "warn",
    "description": "Suggest Map for dictionary-like objects with dynamic keys.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "preferMap": "Dynamic key assignment on dictionary object causes hidden class transitions. Consider using Map."
    }
  },
  {
    "id": "prefer-precompiled-regex",
    "severity": "warn",
    "description": "Prefer hoisting regex literals to module-level constants to avoid repeated compilation.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "inlineRegex": "Regex `{{pattern}}` is compiled on every call. Hoist to a module-level constant."
    }
  },
  {
    "id": "prefer-set-has-over-equality-chain",
    "severity": "warn",
    "description": "Disallow 4+ guard-style equality checks against string literals on the same variable. Use a Set.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "equalityChain": "{{count}} equality checks against `{{name}}`. Extract literals to a Set and use .has() instead."
    }
  },
  {
    "id": "prefer-set-lookup-in-loop",
    "severity": "warn",
    "description": "Disallow linear search methods (.includes/.indexOf) on arrays inside loops.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "preferSet": "`.{{method}}()` on `{{name}}` called inside a loop. Convert to a Set for O(1) lookups."
    }
  },
  {
    "id": "recursive-timer",
    "severity": "warn",
    "description": "Detect setTimeout that recursively calls its enclosing function.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "recursiveTimer": "setTimeout() recursively calls '{{name}}', creating an unbreakable polling loop. Add a termination condition or use setInterval with cleanup."
    }
  },
  {
    "id": "self-referencing-store",
    "severity": "error",
    "description": "Detect setStore() where the value argument references the store itself.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "selfReference": "setStore() value references the store variable '{{name}}', creating a circular proxy reference. This prevents garbage collection and can cause infinite loops."
    }
  },
  {
    "id": "unbounded-collection",
    "severity": "warn",
    "description": "Detect module-scoped Map/Set/Array that only grow without removal.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "unboundedCollection": "Module-scoped {{type}} '{{name}}' only uses additive methods ({{methods}}). Without removal or clearing, this grows unbounded. Consider WeakMap, LRU eviction, or periodic clear()."
    }
  },
  {
    "id": "unbounded-signal-accumulation",
    "severity": "warn",
    "description": "Detect signal setters that accumulate data without truncation via spread+append pattern.",
    "fixable": false,
    "category": "performance",
    "plugin": "solid",
    "messages": {
      "unbounded": "Signal setter '{{name}}' accumulates data without bounds. The array grows monotonically via spread+append. Add truncation (e.g. prev.slice(-limit)) to prevent unbounded growth."
    }
  },
  {
    "id": "async-tracked",
    "severity": "error",
    "description": "Disallow async functions in tracked scopes (createEffect, createMemo, etc.)",
    "fixable": false,
    "category": "reactivity",
    "plugin": "solid",
    "messages": {
      "asyncCreateEffect": "Async function{{fnName}} in createEffect loses tracking after await. Read all signals before the first await, or use createResource for async data fetching.",
      "asyncCreateMemo": "Async function{{fnName}} in createMemo won't work correctly. createMemo must be synchronous. For async derived data, use createResource instead.",
      "asyncCreateComputed": "Async function{{fnName}} in createComputed won't track properly. createComputed must be synchronous—signal reads after await won't trigger re-computation.",
      "asyncCreateRenderEffect": "Async function{{fnName}} in createRenderEffect breaks DOM update timing. createRenderEffect must be synchronous. Move async work to onMount or createResource.",
      "asyncTrackedGeneric": "Async function{{fnName}} in {{source}} won't track reactivity after await. Solid's tracking only works synchronously—signal reads after await are ignored."
    }
  },
  {
    "id": "children-helper-misuse",
    "severity": "error",
    "description": "Detect misuse of the children() helper that causes unnecessary re-computation or breaks reactivity",
    "fixable": false,
    "category": "reactivity",
    "plugin": "solid",
    "messages": {
      "multipleChildrenCalls": "The children() helper should only be called once per component. Each call re-resolves children, causing unnecessary computation. Store the result and reuse the accessor.",
      "directChildrenAccess": "Access props.children through the children() helper in reactive contexts. Direct access won't properly resolve or track children. Use: const resolved = children(() => props.children);"
    }
  },
  {
    "id": "cleanup-scope",
    "severity": "error",
    "description": "Detect onCleanup called outside of a valid reactive scope",
    "fixable": false,
    "category": "reactivity",
    "plugin": "solid",
    "messages": {
      "cleanupOutsideScope": "onCleanup() called outside a reactive scope ({{location}}). The cleanup function will never execute unless this code runs within a component, effect, createRoot, or runWithOwner."
    }
  },
  {
    "id": "derived-signal",
    "severity": "error",
    "description": "Detect functions that capture reactive values but are called in untracked contexts",
    "fixable": false,
    "category": "reactivity",
    "plugin": "solid",
    "messages": {
      "moduleScopeInit": "Assigning '{{fnName}}()' to '{{varName}}' at module scope runs once at startup. It captures {{vars}} which won't trigger updates.",
      "moduleScopeCall": "'{{fnName}}()' at module scope executes once when the module loads. It captures {{vars}}—changes won't cause this to re-run.",
      "componentTopLevelInit": "'{{fnName}}()' assigned to '{{varName}}' in '{{componentName}}' captures a one-time snapshot of {{vars}}. Changes won't update '{{varName}}'. Call in JSX or use createMemo().",
      "componentTopLevelCall": "'{{fnName}}()' at top-level of '{{componentName}}' runs once and captures a snapshot of {{vars}}. Changes won't re-run this. Move inside JSX: {{{fnName}}()} or wrap with createMemo().",
      "utilityFnCall": "'{{fnName}}()' inside '{{utilityName}}' won't be reactive. Call '{{utilityName}}' from a tracked scope (createEffect, JSX), or pass {{vars}} as parameters.",
      "syncCallbackCall": "'{{fnName}}()' inside {{methodName}}() callback runs outside a tracking scope. The result captures a snapshot of {{vars}} that won't update.",
      "untrackedCall": "'{{fnName}}()' called in an untracked context. It captures {{vars}} which won't trigger updates here. Move to JSX or a tracked scope."
    }
  },
  {
    "id": "effect-as-memo",
    "severity": "error",
    "description": "Detect createEffect that only sets a derived signal value, which should be createMemo instead",
    "fixable": true,
    "category": "reactivity",
    "plugin": "solid",
    "messages": {
      "effectAsMemo": "This createEffect only computes a derived value. Use createMemo() instead: const {{signalName}} = createMemo(() => {{expression}});"
    }
  },
  {
    "id": "effect-as-mount",
    "severity": "error",
    "description": "Detect createEffect/createRenderEffect with no reactive dependencies that should be onMount instead",
    "fixable": true,
    "category": "reactivity",
    "plugin": "solid",
    "messages": {
      "effectAsMount": "This {{primitive}} has no reactive dependencies and runs only once. Use onMount() for initialization logic that doesn't need to re-run."
    }
  },
  {
    "id": "inline-component",
    "severity": "error",
    "description": "Detect component functions defined inside other components, which causes remount on every parent update",
    "fixable": false,
    "category": "reactivity",
    "plugin": "solid",
    "messages": {
      "inlineComponent": "Component '{{name}}' is defined inside another component. This creates a new component type on every render, causing unmount/remount. Move the component definition outside."
    }
  },
  {
    "id": "no-top-level-signal-call",
    "severity": "error",
    "description": "Disallow calling signals at component top-level (captures stale snapshots)",
    "fixable": false,
    "category": "reactivity",
    "plugin": "solid",
    "messages": {
      "assignedToVar": "'{{name}}()' assigned to '{{varName}}' in {{componentName}} captures a one-time snapshot. '{{varName}}' won't update when {{name}} changes. Use createMemo(): `const {{varName}} = createMemo(() => {{name}}());`",
      "computedValue": "'{{name}}()' in computation at top-level of {{componentName}} captures a stale snapshot. Wrap with createMemo(): `const {{varName}} = createMemo(() => /* computation using {{name}}() */);`",
      "templateLiteral": "'{{name}}()' in template literal at top-level of {{componentName}} captures a stale snapshot. Use createMemo() or compute directly in JSX: `{`Hello, ${{{name}}()}!`}`",
      "destructuring": "Destructuring '{{name}}()' at top-level of {{componentName}} captures a stale snapshot. Access properties in JSX or createMemo(): `{{{name}}().propertyName}`",
      "objectLiteral": "'{{name}}()' in object literal at top-level of {{componentName}} captures a stale snapshot. Use createMemo() for the object, or spread in JSX.",
      "arrayCreation": "'{{name}}()' in array creation at top-level of {{componentName}} captures a stale snapshot. Wrap with createMemo(): `const items = createMemo(() => Array.from(...));`",
      "earlyReturn": "'{{name}}()' in early return at top-level of {{componentName}} captures a stale snapshot. Use <Show when={{{name}}()}> for conditional rendering instead.",
      "conditionalAssign": "'{{name}}()' in ternary at top-level of {{componentName}} captures a stale snapshot. Use createMemo() or compute in JSX: `{{{name}}() ? 'Yes' : 'No'}`",
      "functionArgument": "'{{name}}()' passed as argument at top-level of {{componentName}} captures a stale snapshot. Move to createEffect() or compute in JSX.",
      "syncCallback": "'{{name}}()' inside {{methodName}}() at top-level of {{componentName}} captures a stale snapshot. Wrap the entire computation in createMemo(): `const result = createMemo(() => items.{{methodName}}(...));`",
      "topLevelCall": "'{{name}}()' at top-level of {{componentName}} captures a one-time snapshot. Changes to {{name}} won't update the result. Call directly in JSX or wrap in createMemo()."
    }
  },
  {
    "id": "ref-early-access",
    "severity": "error",
    "description": "Detect accessing refs before they are assigned (before mount)",
    "fixable": false,
    "category": "reactivity",
    "plugin": "solid",
    "messages": {
      "refBeforeMount": "Ref '{{name}}' is accessed before component mounts. Refs are undefined until after mount. Access in onMount(), createEffect(), or event handlers."
    }
  },
  {
    "id": "resource-access-unchecked",
    "severity": "error",
    "description": "Detect accessing resource data without checking loading/error state.",
    "fixable": false,
    "category": "reactivity",
    "plugin": "solid",
    "messages": {
      "resourceUnchecked": "Accessing resource '{{name}}' without checking loading/error state may return undefined. Wrap in <Show when={!{{name}}.loading}> or <Suspense>."
    }
  },
  {
    "id": "resource-implicit-suspense",
    "severity": "warn",
    "description": "Detect createResource that implicitly triggers or permanently breaks Suspense boundaries.",
    "fixable": true,
    "category": "reactivity",
    "plugin": "solid",
    "messages": {
      "loadingMismatch": "createResource '{{name}}' has no initialValue but uses {{name}}.loading for manual loading UI. Suspense intercepts before your loading UI renders — the component is unmounted before the <Show>/<Switch> evaluates. Replace createResource with onMount + createSignal to decouple from Suspense entirely.",
      "conditionalSuspense": "createResource '{{name}}' is inside a conditional mount point ({{mountTag}}) with a distant Suspense boundary. The SuspenseContext increment fires when the fetcher's Promise is pending and unmounts the entire page subtree — initialValue does NOT prevent this. Replace createResource with onMount + createSignal to avoid Suspense interaction.",
      "missingErrorBoundary": "createResource '{{name}}' has no <ErrorBoundary> between its component and the nearest <Suspense>. When the fetcher throws (network error, 401/403/503, timeout), the error propagates to Suspense which has no error handling — the boundary breaks permanently. Wrap the component in <ErrorBoundary> or replace createResource with onMount + createSignal and catch errors in the fetcher."
    }
  },
  {
    "id": "resource-refetch-loop",
    "severity": "error",
    "description": "Detect refetch() calls inside createEffect which can cause infinite loops",
    "fixable": false,
    "category": "reactivity",
    "plugin": "solid",
    "messages": {
      "refetchInEffect": "Calling {{name}}.refetch() inside createEffect may cause infinite loops. The resource tracks its own dependencies. Move refetch to an event handler or use on() to control dependencies."
    }
  },
  {
    "id": "signal-call",
    "severity": "error",
    "description": "Require signals to be called as functions when used in tracked contexts",
    "fixable": true,
    "category": "reactivity",
    "plugin": "solid",
    "messages": {
      "signalInJsxText": "Signal '{{name}}' in JSX text should be called: {{{name}}()}. Without (), you're rendering the function, not its value.",
      "signalInJsxAttribute": "Signal '{{name}}' in JSX attribute should be called: {{attr}}={{{name}}()}. Without (), the attribute won't update reactively.",
      "signalInTernary": "Signal '{{name}}' in ternary should be called: {{name}}() ? ... : .... The condition won't react to changes without ().",
      "signalInLogical": "Signal '{{name}}' in logical expression should be called: {{name}}() && .... Without (), this always evaluates to truthy (functions are truthy).",
      "signalInComparison": "Signal '{{name}}' in comparison should be called: {{name}}() === .... Comparing functions always returns false.",
      "signalInArithmetic": "Signal '{{name}}' in arithmetic should be called: {{name}}() + .... Math on functions produces NaN.",
      "signalInTemplate": "Signal '{{name}}' in template literal should be called: `...${{{name}}()}...`. Without (), you're embedding '[Function]'.",
      "signalInTrackedScope": "Signal '{{name}}' in {{where}} should be called: {{name}}(). Without (), reactivity is lost.",
      "badSignal": "The reactive variable '{{name}}' should be called as a function when used in {{where}}."
    }
  },
  {
    "id": "signal-in-loop",
    "severity": "error",
    "description": "Detect problematic signal usage inside For/Index loop callbacks",
    "fixable": false,
    "category": "reactivity",
    "plugin": "solid",
    "messages": {
      "signalInLoop": "Creating signals inside <{{component}}> callback creates new signals on each render. Use a store at the parent level, or derive state from the index.",
      "signalCallInvariant": "Signal '{{name}}' called inside <{{component}}> produces the same value for every item. Extract to a variable or memoize with createMemo() before the loop.",
      "derivedCallInvariant": "'{{name}}()' inside <{{component}}> captures {{captures}} but doesn't use the loop item. Extract the call before the loop or pass the item as a parameter."
    }
  },
  {
    "id": "store-reactive-break",
    "severity": "error",
    "description": "Detect patterns that break store reactivity: spreading stores, top-level property extraction, or destructuring",
    "fixable": false,
    "category": "reactivity",
    "plugin": "solid",
    "messages": {
      "storeSpread": "Spreading a store ({...store}) creates a static snapshot that won't update. Access store properties directly in JSX or tracked contexts.",
      "storeTopLevelAccess": "Accessing store property '{{property}}' at component top-level captures the value once. Access store.{{property}} directly in JSX or wrap in createMemo().",
      "storeDestructure": "Destructuring a store breaks reactivity. Access properties via store.{{property}} instead of destructuring."
    }
  },
  {
    "id": "transition-pending-unchecked",
    "severity": "error",
    "description": "Detect useTransition usage without handling the isPending state",
    "fixable": false,
    "category": "reactivity",
    "plugin": "solid",
    "messages": {
      "pendingUnchecked": "useTransition returns [isPending, startTransition]. The isPending state should be used to show loading UI during transitions."
    }
  },
  {
    "id": "batch-optimization",
    "severity": "warn",
    "description": "Suggest using batch() when multiple signal setters are called in the same synchronous scope",
    "fixable": true,
    "category": "solid",
    "plugin": "solid",
    "messages": {
      "multipleSetters": "Multiple signal updates in the same scope cause multiple re-renders. Wrap in batch() for a single update: batch(() => { {{setters}} });"
    }
  },
  {
    "id": "imports",
    "severity": "error",
    "description": "Enforce consistent imports from \"solid-js\", \"solid-js/web\", and \"solid-js/store\".",
    "fixable": false,
    "category": "solid",
    "plugin": "solid",
    "messages": {
      "preferSource": "Prefer importing {{name}} from \"{{source}}\"."
    }
  },
  {
    "id": "index-vs-for",
    "severity": "warn",
    "description": "Suggest <For> for object arrays and <Index> for primitive arrays.",
    "fixable": true,
    "category": "solid",
    "plugin": "solid",
    "messages": {
      "indexWithObjects": "<Index> with object arrays causes the item accessor to change on any array mutation. Use <For> for objects to maintain reference stability.",
      "forWithPrimitives": "<For> with primitive arrays (strings, numbers) keys by value, which may cause unexpected re-renders. Consider <Index> if index stability is preferred."
    }
  },
  {
    "id": "no-react-deps",
    "severity": "error",
    "description": "Disallow usage of dependency arrays in `createEffect`, `createMemo`, and `createRenderEffect`.",
    "fixable": true,
    "category": "solid",
    "plugin": "solid",
    "messages": {
      "noUselessDep": "In Solid, `{{name}}` doesn't accept a dependency array because it automatically tracks its dependencies. If you really need to override the list of dependencies, use `on`."
    }
  },
  {
    "id": "no-react-specific-props",
    "severity": "error",
    "description": "Disallow usage of React-specific `className`/`htmlFor` props, which were deprecated in v1.4.0.",
    "fixable": true,
    "category": "solid",
    "plugin": "solid",
    "messages": {
      "prefer": "Prefer the `{{to}}` prop over the deprecated `{{from}}` prop.",
      "noUselessKey": "Elements in a <For> or <Index> list do not need a key prop."
    }
  },
  {
    "id": "prefer-for",
    "severity": "warn",
    "description": "Enforce using Solid's `<For />` component for mapping an array to JSX elements.",
    "fixable": true,
    "category": "solid",
    "plugin": "solid",
    "messages": {
      "preferFor": "Prefer Solid's `<For each={...}>` component for rendering lists of objects. Array#map recreates all DOM elements on every update, while <For> updates only changed items by keying on reference.",
      "preferIndex": "Prefer Solid's `<Index each={...}>` component for rendering lists of primitives. Array#map recreates all DOM elements on every update, while <Index> updates only changed items by keying on index position.",
      "preferForOrIndex": "Prefer Solid's `<For />` or `<Index />` component for rendering lists. Use <For> when items are objects (keys by reference), or <Index> when items are primitives like strings/numbers (keys by index). Array#map recreates all DOM elements on every update."
    }
  },
  {
    "id": "prefer-memo-complex-styles",
    "severity": "warn",
    "description": "Enforce extracting complex style computations to createMemo for better approach. Complex inline style objects are rebuilt on every render, which can impact approach.",
    "fixable": false,
    "category": "solid",
    "plugin": "solid",
    "messages": {
      "preferMemoComplexStyle": "Complex style computation should be extracted to createMemo() for better approach. This style object contains {{complexity}} conditional expressions that are recalculated on every render.",
      "preferMemoConditionalSpread": "Conditional spread operators in style objects should be extracted to createMemo(). Pattern like `...(condition ? {...} : {})` creates new objects on every render."
    }
  },
  {
    "id": "prefer-show",
    "severity": "warn",
    "description": "Enforce using Solid's `<Show />` component for conditionally showing content. Solid's compiler covers this case, so it's a stylistic rule only.",
    "fixable": true,
    "category": "solid",
    "plugin": "solid",
    "messages": {
      "preferShowAnd": "Prefer Solid's `<Show when={...}>` component for conditional rendering. While Solid's compiler handles `&&` expressions, <Show> is more explicit and provides better readability for conditional content.",
      "preferShowTernary": "Prefer Solid's `<Show when={...} fallback={...}>` component for conditional rendering with a fallback. This provides clearer intent and better readability than ternary expressions."
    }
  },
  {
    "id": "self-closing-comp",
    "severity": "warn",
    "description": "Disallow extra closing tags for components without children.",
    "fixable": true,
    "category": "solid",
    "plugin": "solid",
    "messages": {
      "selfClose": "Empty elements should be self-closing. Use `<{{name}} />` instead of `<{{name}}></{{name}}>` for cleaner, more concise JSX.",
      "dontSelfClose": "This element should not be self-closing based on your configuration. Use `<{{name}}></{{name}}>` instead of `<{{name}} />` for explicit opening and closing tags."
    }
  },
  {
    "id": "style-prop",
    "severity": "warn",
    "description": "Require CSS properties in the `style` prop to be valid and kebab-cased (ex. 'font-size'), not camel-cased (ex. 'fontSize') like in React, and that property values with dimensions are strings, not numbers with implicit 'px' units.",
    "fixable": true,
    "category": "solid",
    "plugin": "solid",
    "messages": {
      "kebabStyleProp": "Solid uses kebab-case for CSS property names, not camelCase like React. Use '{{kebabName}}' instead of '{{name}}'.",
      "invalidStyleProp": "'{{name}}' is not a valid CSS property. Check for typos, or if this is a custom property, prefix it with '--' (e.g., '--{{name}}').",
      "numericStyleValue": "Numeric values for dimensional properties need explicit units in Solid. Unlike React, Solid does not auto-append 'px'. Use '{{value}}px' or another appropriate unit.",
      "stringStyle": "Use an object for the style prop instead of a string for better approach and type safety. Example: style={{ '{{prop}}': '{{value}}' }}."
    }
  }
] as const

/** Rules grouped by category. */
export const RULES_BY_CATEGORY: Readonly<Record<RuleCategory, readonly RuleEntry[]>> = {
  "correctness": [{"id":"avoid-conditional-spreads","severity":"error","description":"Disallow conditional spread operators that create empty objects. Patterns like `...(condition ? {...} : {})` are fragile and create unnecessary object creations.","fixable":false,"category":"correctness","plugin":"solid","messages":{"avoidConditionalSpread":"Avoid conditional spread with empty object fallback. Instead of `...(cond ? {...} : {})`, build the object first with conditional property assignment, then spread once.","avoidLogicalAndSpread":"Avoid logical AND spread pattern. Instead of `...(cond && {...})`, use explicit conditional property assignment for clarity."}},{"id":"avoid-non-null-assertions","severity":"error","description":"Disallow non-null assertion operator (`!`). Use optional chaining, nullish coalescing, or proper type narrowing instead.","fixable":true,"category":"correctness","plugin":"solid","messages":{"avoidNonNull":"Avoid non-null assertion on \"{{name}}\". Non-null assertions bypass type safety. Use optional chaining (`?.`), nullish coalescing (`??`), or proper type narrowing instead."}},{"id":"avoid-object-assign","severity":"error","description":"Disallow Object.assign(). Prefer object spread syntax or structuredClone() for copying objects.","fixable":true,"category":"correctness","plugin":"solid","messages":{"avoidMerge":"Avoid Object.assign() for merging. Use object spread syntax { ...obj } instead.","avoidMutation":"Avoid Object.assign() for mutation. Consider immutable patterns like { ...existing, ...props }."}},{"id":"avoid-object-spread","severity":"error","description":"Disallow object spread operators that break Solid's fine-grained reactivity.","fixable":true,"category":"correctness","plugin":"solid","messages":{"avoidObjectCopy":"Avoid object spread for copying. Use direct property access.","avoidObjectMerge":"Avoid object spread for merging. Use mergeProps() from 'solid-js'.","avoidObjectUpdate":"Avoid object spread for updates. Use produce() or direct assignment.","avoidJsxSpread":"Avoid JSX prop spreading. Use splitProps() to separate props.","avoidRestDestructure":"Avoid rest destructuring. Use splitProps() from 'solid-js'.","avoidPropsSpread":"Spreading props breaks reactivity. Use splitProps() to separate known props.","avoidStoreSpread":"Spreading store creates a static snapshot. Access properties directly.","avoidSignalSpread":"Spreading signal result captures current value. Wrap in createMemo().","avoidClassListSpread":"Spreading in classList breaks reactivity. Wrap in createMemo().","avoidStyleSpread":"Spreading in style breaks reactivity. Wrap in createMemo().","unnecessarySplitProps":"Unnecessary splitProps with empty array. Remove it and use {{source}} directly."}},{"id":"avoid-type-casting","severity":"error","description":"Disallow type casting methods that bypass TypeScript's type safety. Includes unnecessary casts, double assertions, casting to any, type predicates, and unsafe generic assertions.","fixable":true,"category":"correctness","plugin":"solid","messages":{"unnecessaryCast":"Unnecessary type assertion: \"{{name}}\" is already of type \"{{exprType}}\", which is assignable to \"{{type}}\". Remove the cast - it adds noise and suggests you don't understand the types.","doubleAssertion":"Double assertion detected: \"{{name}}\" is cast through unknown/any to \"{{type}}\". This bypasses type safety. You are creating sloppy architecture.","castToAny":"Casting \"{{name}}\" to `any` disables all type checking. Use `unknown` with proper type guards, or fix the underlying type issue.","castToUnknown":"Casting to `unknown` requires runtime type checks before use. You are creating sloppy architecture.","simpleAssertion":"Type assertion on \"{{name}}\" to \"{{type}}\" bypasses type checking. Why are you doing this? Do you EVEN need this? This is sloppy architecture.","assertionInLoop":"Type assertion on \"{{name}}\" inside a loop. Repeated casts to \"{{type}}\" without validation can mask type errors. Consider validating the type once before the loop.","importAssertion":"Type assertion on dynamic import to \"{{type}}\". Import types should be validated at runtime or use proper module type declarations.","typePredicate":"Type predicate function asserts \"{{param}}\" is \"{{type}}\". Why are you doing this? Do you EVEN need this? This is sloppy architecture.","unsafeGeneric":"Casting to generic type parameter \"{{typeParam}}\" without runtime validation. The function returns an unverified type. This is sloppy architecture."}},{"id":"avoid-unsafe-type-annotations","severity":"error","description":"Disallow `any` and `unknown` in value-level type annotation positions (parameters, returns, variables, properties)","fixable":false,"category":"correctness","plugin":"solid","messages":{"anyParameter":"Parameter '{{name}}' is typed `any`{{inFunction}}. This disables type checking for all callers. Use a specific type, a generic, or `unknown` with proper type narrowing.","anyReturn":"Function '{{name}}' returns `any`. This disables type checking for all callers. Use a specific return type.","anyVariable":"Variable '{{name}}' is typed `any`. This disables all type checking on this variable. Use a specific type or `unknown` with type narrowing.","anyProperty":"Property '{{name}}' is typed `any`. This disables type checking for all accesses. Use a specific type.","unknownParameter":"Parameter '{{name}}' is typed `unknown`{{inFunction}}. Callers can pass anything and the function body requires type narrowing on every use. Use a specific type or a generic constraint.","unknownReturn":"Function '{{name}}' returns `unknown`. Callers must narrow the return value before use. Use a specific return type or a generic.","unknownVariable":"Variable '{{name}}' is typed `unknown`. Every use requires type narrowing. Use a specific type or parse the value at the boundary.","unknownProperty":"Property '{{name}}' is typed `unknown`. Every access requires type narrowing. Use a specific type."}},{"id":"event-handlers","severity":"error","description":"Enforce naming DOM element event handlers consistently and prevent Solid's analysis from misunderstanding whether a prop should be an event handler.","fixable":true,"category":"correctness","plugin":"solid","messages":{"detectedAttr":"The \"{{name}}\" prop looks like an event handler but has a static value ({{staticValue}}), so Solid will treat it as an attribute instead of attaching an event listener. Use attr:{{name}} to make this explicit, or provide a function value.","naming":"The \"{{name}}\" prop is ambiguous. Solid cannot determine if this is an event handler or an attribute. Use {{handlerName}} for an event handler, or {{attrName}} for an attribute.","capitalization":"The \"{{name}}\" prop should be {{fixedName}} for Solid to recognize it as an event handler. Event handlers use camelCase with an uppercase letter after \"on\".","nonstandard":"The \"{{name}}\" prop uses a nonstandard event name. Use {{fixedName}} instead, which is the standard DOM event name that Solid recognizes.","makeHandler":"Change {{name}} to {{handlerName}} (event handler).","makeAttr":"Change {{name}} to {{attrName}} (attribute).","spreadHandler":"The \"{{name}}\" prop is being spread into JSX, which prevents Solid from attaching it as an event listener. Add it directly as a JSX attribute instead: {{name}}={...}."}},{"id":"missing-jsdoc-comments","severity":"error","description":"Require JSDoc comments on functions with appropriate tags for parameters, return values, and throws.","fixable":false,"category":"correctness","plugin":"solid","messages":{"missingJsdoc":"Function '{{name}}' is missing a JSDoc comment.","missingParam":"JSDoc for '{{name}}' is missing @param tag for '{{param}}'.","missingReturn":"JSDoc for '{{name}}' is missing @returns tag.","missingThrows":"JSDoc for '{{name}}' is missing @throws tag.","missingExample":"JSDoc for '{{name}}' is missing @example tag.","missingClassJsdoc":"Class '{{name}}' is missing a JSDoc comment.","missingPropertyJsdoc":"Property '{{name}}' is missing a JSDoc comment."}},{"id":"no-ai-slop-comments","severity":"error","description":"Disallow comments containing specified forbidden words or phrases. Useful for enforcing comment style guidelines and detecting AI-generated boilerplate.","fixable":true,"category":"correctness","plugin":"solid","messages":{"forbiddenWord":"Comment contains forbidden word '{{word}}'."}},{"id":"no-array-handlers","severity":"error","description":"Disallow array handlers in JSX event properties.","fixable":false,"category":"correctness","plugin":"solid","messages":{"noArrayHandlers":"Passing an array to \"{{handlerName}}\" is type-unsafe. The array syntax `[handler, data]` passes data as the first argument, making the event object the second argument. Use a closure instead: `{{handlerName}}={() => handler(data)}`."}},{"id":"no-banner-comments","severity":"error","description":"Disallow banner-style comments with repeated separator characters.","fixable":true,"category":"correctness","plugin":"solid","messages":{"banner":"Avoid banner-style comments with repeated separator characters. Use simple comments instead."}},{"id":"no-destructure","severity":"error","description":"Disallow destructuring props in Solid components. Props must be accessed via property access (props.x) to preserve reactivity.","fixable":false,"category":"correctness","plugin":"solid","messages":{"noDestructure":"Destructuring component props breaks Solid's reactivity. Props are reactive getters, so `{ a }` captures the value at component creation time and won't update. Use `props.a` to access props reactively.","noDestructureWithDefaults":"Destructuring component props breaks Solid's reactivity. For default values, use `mergeProps({ a: defaultValue }, props)` instead of `{ a = defaultValue }`.","noDestructureWithRest":"Destructuring component props breaks Solid's reactivity. For rest patterns, use `splitProps(props, ['a', 'b'])` instead of `{ a, b, ...rest }`.","noDestructureWithBoth":"Destructuring component props breaks Solid's reactivity. For default values with rest, use `splitProps(mergeProps({ a: defaultValue }, props), ['a'])` to combine both patterns."}},{"id":"no-inline-imports","severity":"error","description":"Disallow inline type imports. Import types at the top of the file for clarity and maintainability.","fixable":false,"category":"correctness","plugin":"solid","messages":{"inlineImport":"Avoid inline imports. Import `{{specifier}}` at the top of the file instead."}},{"id":"string-concat-in-loop","severity":"error","description":"Disallow string concatenation with += inside loops. Use array.push() and .join() instead.","fixable":false,"category":"correctness","plugin":"solid","messages":{"stringConcatInLoop":"Avoid string concatenation with += inside loops. Use an array with .push() and .join() instead."}}],
  "css-a11y": [{"id":"css-no-outline-none-without-focus-visible","severity":"error","description":"Disallow removing outline without explicit focus-visible replacement.","fixable":false,"category":"css-a11y","plugin":"css","messages":{"missingFocusVisible":"Focus outline removed without matching `:focus-visible` replacement."}},{"id":"css-policy-contrast","severity":"warn","description":"Enforce minimum contrast ratio between foreground and background colors per accessibility policy.","fixable":false,"category":"css-a11y","plugin":"css","messages":{"insufficientContrast":"Contrast ratio `{{ratio}}:1` between `{{fg}}` and `{{bg}}` is below the minimum `{{min}}:1` for `{{textSize}}` text in policy `{{policy}}`."}},{"id":"css-policy-spacing","severity":"warn","description":"Enforce minimum letter-spacing, word-spacing, and paragraph spacing per accessibility policy.","fixable":false,"category":"css-a11y","plugin":"css","messages":{"letterSpacingTooSmall":"Letter spacing `{{value}}` ({{resolved}}em) is below the minimum `{{min}}em` for policy `{{policy}}`.","wordSpacingTooSmall":"Word spacing `{{value}}` ({{resolved}}em) is below the minimum `{{min}}em` for policy `{{policy}}`.","paragraphSpacingTooSmall":"Paragraph spacing `{{value}}` ({{resolved}}em) is below the minimum `{{min}}em` ({{minMultiplier}}× font-size) for policy `{{policy}}`."}},{"id":"css-policy-touch-target","severity":"warn","description":"Enforce minimum interactive element sizes per accessibility policy.","fixable":false,"category":"css-a11y","plugin":"css","messages":{"heightTooSmall":"`{{property}}` of `{{value}}` ({{resolved}}px) is below the minimum `{{min}}px` for `{{element}}` elements in policy `{{policy}}`.","widthTooSmall":"`{{property}}` of `{{value}}` ({{resolved}}px) is below the minimum `{{min}}px` for `{{element}}` elements in policy `{{policy}}`.","paddingTooSmall":"Horizontal padding `{{value}}` ({{resolved}}px) is below the minimum `{{min}}px` for `{{element}}` elements in policy `{{policy}}`."}},{"id":"css-policy-typography","severity":"warn","description":"Enforce minimum font sizes and line heights per accessibility policy.","fixable":false,"category":"css-a11y","plugin":"css","messages":{"fontTooSmall":"Font size `{{value}}` ({{resolved}}px) is below the `{{context}}` minimum of `{{min}}px` for policy `{{policy}}`.","lineHeightTooSmall":"Line height `{{value}}` is below the `{{context}}` minimum of `{{min}}` for policy `{{policy}}`."}},{"id":"css-require-reduced-motion-override","severity":"warn","description":"Require reduced-motion override for animated selectors.","fixable":false,"category":"css-a11y","plugin":"css","messages":{"missingReducedMotion":"Animated selector `{{selector}}` lacks prefers-reduced-motion override."}}],
  "css-animation": [{"id":"css-no-discrete-transition","severity":"error","description":"Disallow transitions on discrete CSS properties.","fixable":false,"category":"css-animation","plugin":"css","messages":{"discreteTransition":"Property `{{property}}` is discrete and should not be transitioned."}},{"id":"css-no-empty-keyframes","severity":"error","description":"Disallow empty @keyframes rules.","fixable":false,"category":"css-animation","plugin":"css","messages":{"emptyKeyframes":"@keyframes `{{name}}` has no effective keyframes."}},{"id":"no-layout-property-animation","severity":"warn","description":"Disallow animating layout-affecting properties.","fixable":false,"category":"css-animation","plugin":"css","messages":{"avoidLayoutAnimation":"Avoid animating layout property `{{property}}`. Prefer transform or opacity to reduce layout thrashing."}},{"id":"no-transition-all","severity":"warn","description":"Disallow transition: all and transition-property: all.","fixable":false,"category":"css-animation","plugin":"css","messages":{"avoidTransitionAll":"Avoid `transition: all`. Transition specific properties to reduce unnecessary style and paint work."}},{"id":"no-unknown-animation-name","severity":"error","description":"Disallow animation names that do not match declared keyframes.","fixable":false,"category":"css-animation","plugin":"css","messages":{"unknownAnimationName":"Animation name `{{name}}` in `{{property}}` does not match any declared @keyframes."}},{"id":"no-unused-keyframes","severity":"warn","description":"Disallow unused @keyframes declarations.","fixable":false,"category":"css-animation","plugin":"css","messages":{"unusedKeyframes":"@keyframes `{{name}}` is never referenced by animation declarations."}}],
  "css-cascade": [{"id":"declaration-no-overridden-within-rule","severity":"warn","description":"Disallow duplicate declarations of the same property within a single rule block.","fixable":false,"category":"css-cascade","plugin":"css","messages":{"overriddenWithinRule":"Declaration `{{property}}` is overridden later in the same rule. Keep one final declaration per property."}},{"id":"media-query-overlap-conflict","severity":"warn","description":"Disallow conflicting declarations in partially overlapping media queries.","fixable":false,"category":"css-cascade","plugin":"css","messages":{"mediaOverlapConflict":"Overlapping media queries set different `{{property}}` values for `{{selector}}` in the same overlap range."}},{"id":"no-descending-specificity-conflict","severity":"warn","description":"Disallow lower-specificity selectors after higher-specificity selectors for the same property.","fixable":false,"category":"css-cascade","plugin":"css","messages":{"descendingSpecificity":"Lower-specificity selector `{{laterSelector}}` appears after `{{earlierSelector}}` for `{{property}}`, creating brittle cascade behavior."}},{"id":"no-layer-order-inversion","severity":"warn","description":"Disallow source-order assumptions that are inverted by layer precedence.","fixable":false,"category":"css-cascade","plugin":"css","messages":{"layerOrderInversion":"Declaration for `{{property}}` in selector `{{selector}}` appears later but is overridden by an earlier declaration due to @layer precedence."}},{"id":"no-redundant-override-pairs","severity":"warn","description":"Disallow declarations that are deterministically overridden in the same selector context.","fixable":false,"category":"css-cascade","plugin":"css","messages":{"redundantOverride":"Declaration `{{property}}` is always overridden later by the same selector in the same cascade context."}}],
  "css-jsx": [{"id":"css-no-unreferenced-component-class","severity":"warn","description":"Detect CSS classes that are never referenced by static JSX class attributes.","fixable":false,"category":"css-jsx","plugin":"cross-file","messages":{"unreferencedClass":"CSS class '{{className}}' is defined but not referenced by static JSX class attributes"}},{"id":"jsx-classlist-boolean-values","severity":"error","description":"Require classList values to be boolean-like expressions.","fixable":false,"category":"css-jsx","plugin":"cross-file","messages":{"nonBooleanValue":"classList value for `{{name}}` must be boolean."}},{"id":"jsx-classlist-no-accessor-reference","severity":"error","description":"Disallow passing accessor references directly as classList values.","fixable":false,"category":"css-jsx","plugin":"cross-file","messages":{"accessorReference":"Signal accessor `{{name}}` must be called in classList value (use {{name}}())."}},{"id":"jsx-classlist-no-constant-literals","severity":"warn","description":"Disallow classList entries with constant true/false values.","fixable":false,"category":"css-jsx","plugin":"cross-file","messages":{"constantEntry":"classList entry `{{name}}: {{value}}` is constant; move it to static class."}},{"id":"jsx-classlist-static-keys","severity":"error","description":"Require classList keys to be static and non-computed.","fixable":false,"category":"css-jsx","plugin":"cross-file","messages":{"nonStaticKey":"classList key must be statically known for reliable class mapping."}},{"id":"jsx-layout-classlist-geometry-toggle","severity":"warn","description":"Flag classList-driven class toggles that map to layout-affecting CSS geometry changes.","fixable":false,"category":"css-jsx","plugin":"cross-file","messages":{"classListGeometryToggle":"classList toggles '{{className}}', and matching CSS changes layout-affecting '{{property}}', which can cause CLS."}},{"id":"jsx-layout-fill-image-parent-must-be-sized","severity":"warn","description":"Require stable parent size and positioning for fill-image component usage.","fixable":false,"category":"css-jsx","plugin":"cross-file","messages":{"unsizedFillParent":"Fill-image component '{{component}}' is inside a parent without stable size/position; add parent sizing (height/min-height/aspect-ratio) and non-static position to avoid CLS."}},{"id":"jsx-layout-picture-source-ratio-consistency","severity":"warn","description":"Require consistent intrinsic aspect ratios across <picture> sources and fallback image.","fixable":false,"category":"css-jsx","plugin":"cross-file","messages":{"inconsistentPictureRatio":"`<picture>` source ratio {{sourceRatio}} differs from fallback img ratio {{imgRatio}}, which can cause reserved-space mismatch and CLS."}},{"id":"jsx-layout-unstable-style-toggle","severity":"warn","description":"Flag dynamic inline style values on layout-sensitive properties that can trigger CLS.","fixable":false,"category":"css-jsx","plugin":"cross-file","messages":{"unstableLayoutStyleToggle":"Dynamic style value for '{{property}}' can toggle layout geometry at runtime and cause CLS."}},{"id":"jsx-no-duplicate-class-token-class-classlist","severity":"warn","description":"Disallow duplicate class tokens between class and classList on the same JSX element.","fixable":false,"category":"css-jsx","plugin":"cross-file","messages":{"duplicateClassToken":"Class token `{{name}}` appears in both class and classList."}},{"id":"jsx-no-undefined-css-class","severity":"error","description":"Detect undefined CSS class names in JSX","fixable":false,"category":"css-jsx","plugin":"cross-file","messages":{"undefinedClass":"CSS class '{{className}}' is not defined in project CSS files"}},{"id":"jsx-style-kebab-case-keys","severity":"error","description":"Require kebab-case keys in JSX style object literals.","fixable":false,"category":"css-jsx","plugin":"cross-file","messages":{"kebabStyleKey":"Style key `{{name}}` should be `{{kebab}}` in Solid style objects."}},{"id":"jsx-style-no-function-values","severity":"error","description":"Disallow function values in JSX style objects.","fixable":false,"category":"css-jsx","plugin":"cross-file","messages":{"functionStyleValue":"Style value for `{{name}}` is a function; pass computed value instead."}},{"id":"jsx-style-no-unused-custom-prop","severity":"warn","description":"Detect inline style custom properties that are never consumed by CSS var() references.","fixable":false,"category":"css-jsx","plugin":"cross-file","messages":{"unusedInlineVar":"Inline custom property `{{name}}` is never read via var({{name}})."}},{"id":"jsx-style-policy","severity":"warn","description":"Enforce accessibility policy thresholds on inline JSX style objects.","fixable":false,"category":"css-jsx","plugin":"cross-file","messages":{"fontTooSmall":"Inline style `{{prop}}: {{value}}` ({{resolved}}px) is below the minimum `{{min}}px` for policy `{{policy}}`.","lineHeightTooSmall":"Inline style `line-height: {{value}}` is below the minimum `{{min}}` for policy `{{policy}}`.","heightTooSmall":"Inline style `{{prop}}: {{value}}` ({{resolved}}px) is below the minimum `{{min}}px` for interactive elements in policy `{{policy}}`.","letterSpacingTooSmall":"Inline style `letter-spacing: {{value}}` ({{resolved}}em) is below the minimum `{{min}}em` for policy `{{policy}}`.","wordSpacingTooSmall":"Inline style `word-spacing: {{value}}` ({{resolved}}em) is below the minimum `{{min}}em` for policy `{{policy}}`."}}],
  "css-layout": [{"id":"css-layout-animation-layout-property","severity":"warn","description":"Disallow keyframe animations that mutate layout-affecting properties and can trigger CLS.","fixable":false,"category":"css-layout","plugin":"cross-file","messages":{"animationLayoutProperty":"Animation '{{animation}}' mutates layout-affecting '{{property}}', which can trigger CLS. Prefer transform/opacity or reserve geometry."}},{"id":"css-layout-box-sizing-toggle-with-chrome","severity":"warn","description":"Disallow conditional box-sizing mode toggles when box chrome contributes to geometry shifts.","fixable":false,"category":"css-layout","plugin":"cross-file","messages":{"boxSizingToggleWithChrome":"Conditional `box-sizing` toggle on '{{tag}}' combines with non-zero padding/border, which can shift layout and trigger CLS."}},{"id":"css-layout-conditional-display-collapse","severity":"warn","description":"Disallow conditional display collapse in flow without reserved geometry.","fixable":false,"category":"css-layout","plugin":"cross-file","messages":{"conditionalDisplayCollapse":"Conditional display sets '{{display}}' on '{{tag}}' without stable reserved space, which can collapse/expand layout and cause CLS."}},{"id":"css-layout-conditional-offset-shift","severity":"warn","description":"Disallow conditional non-zero block-axis offsets that can trigger layout shifts.","fixable":false,"category":"css-layout","plugin":"cross-file","messages":{"conditionalOffsetShift":"Conditional style applies non-zero '{{property}}' offset ({{value}}), which can cause layout shifts when conditions toggle."}},{"id":"css-layout-conditional-white-space-wrap-shift","severity":"warn","description":"Disallow conditional white-space wrapping mode toggles that can trigger CLS.","fixable":false,"category":"css-layout","plugin":"cross-file","messages":{"conditionalWhiteSpaceShift":"Conditional white-space '{{whiteSpace}}' on '{{tag}}' can reflow text and shift siblings; keep wrapping behavior stable or reserve geometry."}},{"id":"css-layout-content-visibility-no-intrinsic-size","severity":"warn","description":"Require intrinsic size reservation when using content-visibility auto to avoid late layout shifts.","fixable":false,"category":"css-layout","plugin":"cross-file","messages":{"missingIntrinsicSize":"`content-visibility: auto` on '{{tag}}' lacks intrinsic size reservation (`contain-intrinsic-size`/min-height/height/aspect-ratio), which can cause CLS."}},{"id":"css-layout-dynamic-slot-no-reserved-space","severity":"warn","description":"Require reserved block space for dynamic content containers to avoid layout shifts.","fixable":false,"category":"css-layout","plugin":"cross-file","messages":{"dynamicSlotNoReservedSpace":"Dynamic content container '{{tag}}' does not reserve block space (min-height/height/aspect-ratio/contain-intrinsic-size), which can cause CLS."}},{"id":"css-layout-font-swap-instability","severity":"warn","description":"Require metric overrides for swapping webfonts to reduce layout shifts during font load.","fixable":false,"category":"css-layout","plugin":"cross-file","messages":{"unstableFontSwap":"`@font-face` for '{{family}}' uses `font-display: {{display}}` without metric overrides (for example `size-adjust`), which can cause CLS when the webfont swaps in."}},{"id":"css-layout-overflow-anchor-instability","severity":"warn","description":"Disallow overflow-anchor none on dynamic or scrollable containers prone to visible layout shifts.","fixable":false,"category":"css-layout","plugin":"cross-file","messages":{"unstableOverflowAnchor":"Element '{{tag}}' sets `overflow-anchor: none` on a {{context}} container; disabling scroll anchoring can amplify visible layout shifts."}},{"id":"css-layout-overflow-mode-toggle-instability","severity":"warn","description":"Disallow conditional overflow mode switches that can introduce scrollbar-induced layout shifts.","fixable":false,"category":"css-layout","plugin":"cross-file","messages":{"overflowModeToggle":"Conditional overflow mode changes scrolling ('{{overflow}}') on '{{tag}}' without `scrollbar-gutter: stable`, which can trigger CLS."}},{"id":"css-layout-scrollbar-gutter-instability","severity":"warn","description":"Require stable scrollbar gutters for scrollable containers to reduce layout shifts.","fixable":false,"category":"css-layout","plugin":"cross-file","messages":{"missingScrollbarGutter":"Scrollable container '{{tag}}' uses overflow auto/scroll without `scrollbar-gutter: stable`, which can trigger CLS when scrollbars appear."}},{"id":"css-layout-sibling-alignment-outlier","severity":"warn","description":"Detect vertical alignment outliers between sibling elements in shared layout containers.","fixable":false,"category":"css-layout","plugin":"cross-file","messages":{"misalignedSibling":"Vertically misaligned '{{subject}}' in '{{parent}}'.{{fix}}{{offsetClause}}"}},{"id":"css-layout-stateful-box-model-shift","severity":"warn","description":"Disallow stateful selector changes that alter element geometry and trigger layout shifts.","fixable":false,"category":"css-layout","plugin":"cross-file","messages":{"statefulBoxModelShift":"State selector '{{selector}}' changes layout-affecting '{{property}}'. Keep geometry stable across states to avoid CLS."}},{"id":"css-layout-transition-layout-property","severity":"warn","description":"Disallow transitions that animate layout-affecting geometry properties.","fixable":false,"category":"css-layout","plugin":"cross-file","messages":{"transitionLayoutProperty":"Transition '{{property}}' in '{{declaration}}' animates layout-affecting geometry. Prefer transform/opacity to avoid CLS."}},{"id":"css-layout-unsized-replaced-element","severity":"warn","description":"Require stable reserved geometry for replaced media elements to prevent layout shifts.","fixable":false,"category":"css-layout","plugin":"cross-file","messages":{"unsizedReplacedElement":"Replaced element '{{tag}}' has no stable reserved size (width/height or aspect-ratio with a dimension), which can cause CLS."}}],
  "css-property": [{"id":"css-no-custom-property-cycle","severity":"error","description":"Disallow cycles in custom property references.","fixable":false,"category":"css-property","plugin":"css","messages":{"variableCycle":"Custom property cycle detected involving `{{name}}`."}},{"id":"css-no-hardcoded-z-index","severity":"warn","description":"Disallow hardcoded positive z-index literals.","fixable":false,"category":"css-property","plugin":"css","messages":{"hardcodedZ":"Use a z-index token variable instead of literal `{{value}}`."}},{"id":"css-no-legacy-vh-100","severity":"warn","description":"Disallow 100vh in viewport sizing declarations.","fixable":false,"category":"css-property","plugin":"css","messages":{"avoidLegacyVh":"Use 100dvh/100svh instead of `100vh` for mobile-safe viewport sizing."}},{"id":"css-z-index-requires-positioned-context","severity":"warn","description":"Require positioned context when using z-index.","fixable":false,"category":"css-property","plugin":"css","messages":{"zIndexNoContext":"`z-index` has no guaranteed effect without a positioned context."}},{"id":"no-important","severity":"warn","description":"Disallow !important declarations.","fixable":false,"category":"css-property","plugin":"css","messages":{"avoidImportant":"Avoid `!important` on `{{property}}`. It increases override cost and usually signals specificity debt."}},{"id":"no-unresolved-custom-properties","severity":"error","description":"Disallow unresolved custom property references.","fixable":false,"category":"css-property","plugin":"css","messages":{"unresolvedCustomProperty":"Custom property reference `{{name}}` is unresolved in `{{property}}`. Define it or provide a fallback value."}},{"id":"no-unused-custom-properties","severity":"warn","description":"Disallow unused CSS custom properties.","fixable":false,"category":"css-property","plugin":"css","messages":{"unusedCustomProperty":"Custom property `{{name}}` is never referenced within the project CSS."}}],
  "css-selector": [{"id":"no-complex-selectors","severity":"warn","description":"Disallow deep selectors that are expensive to match.","fixable":false,"category":"css-selector","plugin":"css","messages":{"selectorTooDeep":"Selector `{{selector}}` has depth {{depth}}. Deep selectors increase style recalculation cost and are fragile across component rerenders."}},{"id":"no-duplicate-selectors","severity":"warn","description":"Disallow duplicate selector blocks.","fixable":false,"category":"css-selector","plugin":"css","messages":{"duplicateSelector":"Selector `{{selector}}` is duplicated {{count}} times. Merge declarations to avoid cascade ambiguity."}},{"id":"no-id-selectors","severity":"warn","description":"Disallow ID selectors.","fixable":false,"category":"css-selector","plugin":"css","messages":{"avoidId":"Avoid ID selector in `{{selector}}`. IDs raise specificity and make component-level styling harder to maintain."}},{"id":"selector-max-attribute-and-universal","severity":"off","description":"Disallow selectors with attribute or universal selectors beyond configured limits.","fixable":false,"category":"css-selector","plugin":"css","messages":{"tooManyAttributes":"Selector `{{selector}}` uses {{count}} attribute selector(s). Maximum allowed is {{max}}.","tooManyUniversals":"Selector `{{selector}}` uses {{count}} universal selector(s). Maximum allowed is {{max}}."}},{"id":"selector-max-specificity","severity":"warn","description":"Disallow selectors that exceed a specificity threshold.","fixable":false,"category":"css-selector","plugin":"css","messages":{"maxSpecificity":"Selector `{{selector}}` specificity {{specificity}} exceeds max {{max}}. Reduce selector weight to keep the cascade predictable."}}],
  "css-structure": [{"id":"css-no-empty-rule","severity":"warn","description":"Disallow empty CSS rules.","fixable":false,"category":"css-structure","plugin":"css","messages":{"emptyRule":"Empty rule `{{selector}}` should be removed."}},{"id":"css-no-unknown-container-name","severity":"error","description":"Disallow unknown named containers in @container queries.","fixable":false,"category":"css-structure","plugin":"css","messages":{"unknownContainer":"Unknown container name `{{name}}` in @container query."}},{"id":"css-no-unused-container-name","severity":"warn","description":"Disallow unused named containers.","fixable":false,"category":"css-structure","plugin":"css","messages":{"unusedContainer":"Container name `{{name}}` is declared but never queried."}},{"id":"layer-requirement-for-component-rules","severity":"warn","description":"Require style rules to be inside @layer when the file defines layers.","fixable":false,"category":"css-structure","plugin":"css","messages":{"missingLayer":"Rule `{{selector}}` is not inside any @layer block while this file uses @layer. Place component rules inside an explicit layer."}}],
  "jsx": [{"id":"components-return-once","severity":"error","description":"Disallow early returns in components. Solid components only run once, and so conditionals should be inside JSX.","fixable":true,"category":"jsx","plugin":"solid","messages":{"noEarlyReturn":"Early returns in Solid components break reactivity because the component function only runs once. Use <Show> or <Switch>/<Match> inside the JSX to conditionally render content instead of returning early from the function.","noConditionalReturn":"Conditional expressions in return statements break reactivity because Solid components only run once. Wrap the condition in <Show when={...}> for a single condition, or <Switch>/<Match> for multiple conditions."}},{"id":"jsx-no-duplicate-props","severity":"error","description":"Disallow passing the same prop twice in JSX.","fixable":true,"category":"jsx","plugin":"solid","messages":{"noDuplicateProps":"Duplicate prop detected. Each prop should only be specified once; the second value will override the first.","noDuplicateClass":"Duplicate `class` prop detected. While this might appear to work, it can break unexpectedly because only one class binding is applied. Use `classList` to conditionally apply multiple classes.","noDuplicateChildren":"Conflicting children: {{used}}. Only one method of setting children is allowed at a time."}},{"id":"jsx-no-script-url","severity":"error","description":"Disallow javascript: URLs.","fixable":true,"category":"jsx","plugin":"solid","messages":{"noJSURL":"Using javascript: URLs is a security risk because it can enable cross-site scripting (XSS) attacks. Use an event handler like onClick instead, or navigate programmatically with useNavigate()."}},{"id":"jsx-no-undef","severity":"error","description":"Disallow references to undefined variables in JSX. Handles custom directives.","fixable":false,"category":"jsx","plugin":"solid","messages":{"customDirectiveUndefined":"Custom directive '{{identifier}}' is not defined. Directives must be imported or declared in scope before use (e.g., `const {{identifier}} = (el, accessor) => { ... }`)."}},{"id":"jsx-uses-vars","severity":"warn","description":"Detect imported components and directives that are never used in JSX.","fixable":false,"category":"jsx","plugin":"solid","messages":{"unusedComponent":"Component '{{name}}' is imported but never used in JSX.","unusedDirective":"Directive '{{name}}' is imported but never used in JSX."}},{"id":"no-innerhtml","severity":"error","description":"Disallow usage of the innerHTML attribute, which can lead to security vulnerabilities.","fixable":true,"category":"jsx","plugin":"solid","messages":{"dangerous":"Using innerHTML with dynamic content is a security risk. Unsanitized user input can lead to cross-site scripting (XSS) attacks. Use a sanitization library or render content safely.","conflict":"The innerHTML prop will overwrite all child elements. Remove the children or use innerHTML on an empty element.","notHtml":"The innerHTML value doesn't appear to be HTML. If you're setting text content, use innerText instead for clarity and safety.","dangerouslySetInnerHTML":"The dangerouslySetInnerHTML is a React prop that Solid doesn't support. Use innerHTML instead."}},{"id":"no-unknown-namespaces","severity":"error","description":"Enforce using only Solid-specific namespaced attribute names (i.e. `'on:'` in `<div on:click={...} />`).","fixable":false,"category":"jsx","plugin":"solid","messages":{"unknownNamespace":"'{{namespace}}:' is not a recognized Solid namespace. Valid namespaces are: {{validNamespaces}}.","styleNamespace":"The 'style:' namespace works but is discouraged. Use the style prop with an object instead: style={{ {{property}}: value }}.","classNamespace":"The 'class:' namespace works but is discouraged. Use the classList prop instead: classList={{ \"{{className}}\": condition }}.","componentNamespace":"Namespaced attributes like '{{namespace}}:' only work on DOM elements, not components. The '{{fullName}}' attribute will be passed as a regular prop named '{{fullName}}'."}},{"id":"show-truthy-conversion","severity":"error","description":"Detect <Show when={expr}> where expr is not explicitly boolean, which may have unexpected truthy/falsy behavior.","fixable":true,"category":"jsx","plugin":"solid","messages":{"showNonBoolean":"<Show when={{{{expr}}}}> uses truthy/falsy conversion. Value '0' or empty string '' will hide content. Use explicit boolean: when={Boolean({{expr}})} or when={{{expr}}} != null}"}},{"id":"suspense-boundary-missing","severity":"error","description":"Detect missing fallback props on Suspense/ErrorBoundary, and lazy components without Suspense wrapper.","fixable":false,"category":"jsx","plugin":"solid","messages":{"suspenseNoFallback":"<Suspense> should have a fallback prop to show while children are loading. Add: fallback={<Loading />}","errorBoundaryNoFallback":"<ErrorBoundary> should have a fallback prop to show when an error occurs. Add: fallback={(err) => <Error error={err} />}","lazyNoSuspense":"Lazy component '{{name}}' must be wrapped in a <Suspense> boundary. Add a <Suspense fallback={...}> ancestor."}},{"id":"validate-jsx-nesting","severity":"error","description":"Validates that HTML elements are nested according to the HTML5 specification.","fixable":false,"category":"jsx","plugin":"solid","messages":{"invalidNesting":"Invalid HTML nesting: <{{child}}> cannot be a child of <{{parent}}>. {{reason}}.","voidElementWithChildren":"<{{parent}}> is a void element and cannot have children. Found <{{child}}> as a child.","invalidListChild":"<{{child}}> is not a valid direct child of <{{parent}}>. Only <li> elements can be direct children of <ul> and <ol>.","invalidSelectChild":"<{{child}}> is not a valid direct child of <select>. Only <option> and <optgroup> elements are allowed.","invalidTableChild":"<{{child}}> is not a valid direct child of <{{parent}}>. Expected: {{expected}}.","invalidDlChild":"<{{child}}> is not a valid direct child of <dl>. Only <dt>, <dd>, and <div> elements are allowed."}}],
  "performance": [{"id":"avoid-arguments-object","severity":"warn","description":"Disallow arguments object (use rest parameters instead).","fixable":false,"category":"performance","plugin":"solid","messages":{"avoidArguments":"arguments object can prevent V8 optimization. Use rest parameters (...args) instead."}},{"id":"avoid-chained-array-methods","severity":"warn","description":"Flags chained array methods creating 3+ intermediate arrays, or filter().map() pattern.","fixable":false,"category":"performance","plugin":"solid","messages":{"avoidChainedArrayMethods":"Chain creates {{count}} intermediate array(s). Consider reduce() or a loop. Chain: {{chain}}","mapJoinHotPath":"map().join() inside loops allocates intermediate arrays on a hot path. Prefer single-pass string construction."}},{"id":"avoid-defensive-copy-for-scalar-stat","severity":"warn","description":"Disallow defensive array copies passed into scalar statistic calls.","fixable":false,"category":"performance","plugin":"solid","messages":{"defensiveCopy":"Defensive copy before scalar statistic '{{stat}}' allocates unnecessarily. Prefer readonly/non-mutating scalar computation."}},{"id":"avoid-delete-operator","severity":"warn","description":"Disallow delete operator on objects (causes V8 deoptimization).","fixable":false,"category":"performance","plugin":"solid","messages":{"avoidDelete":"delete operator transitions object to slow mode. Use `obj.prop = undefined` or destructuring instead."}},{"id":"avoid-function-allocation-in-hot-loop","severity":"warn","description":"Disallow creating closures inside loops.","fixable":false,"category":"performance","plugin":"solid","messages":{"closureInLoop":"Function created inside loop allocates new closure per iteration. Consider hoisting or using event delegation."}},{"id":"avoid-hidden-class-transition","severity":"warn","description":"Suggest consistent object shapes to avoid V8 hidden class transitions.","fixable":false,"category":"performance","plugin":"solid","messages":{"hiddenClassTransition":"Property '{{property}}' added conditionally to '{{object}}' creates inconsistent object shapes. Initialize '{{property}}' in the object literal."}},{"id":"avoid-intermediate-map-copy","severity":"warn","description":"Disallow temporary Map allocations that are copied key-for-key into another Map.","fixable":false,"category":"performance","plugin":"solid","messages":{"intermediateMapCopy":"Intermediate Map '{{tempName}}' is copied into '{{outName}}' key-for-key. Build output directly to avoid extra allocation."}},{"id":"avoid-megamorphic-property-access","severity":"warn","description":"Avoid property access on `any` or wide union types to prevent V8 deoptimization.","fixable":false,"category":"performance","plugin":"solid","messages":{"megamorphicAccess":"Property access on `any` or wide union type causes V8 deoptimization. Consider narrowing the type."}},{"id":"avoid-quadratic-pair-comparison","severity":"warn","description":"Disallow nested for-loops over the same collection creating O(n²) pair comparison.","fixable":false,"category":"performance","plugin":"solid","messages":{"quadraticPair":"Nested loops over `{{collection}}` create O(n²) pair comparison. Group by a key property first."}},{"id":"avoid-quadratic-spread","severity":"error","description":"Disallow spreading accumulator in reduce callbacks (O(n²) complexity).","fixable":false,"category":"performance","plugin":"solid","messages":{"quadraticSpread":"Spreading accumulator in reduce creates O(n²) complexity. Use push() instead."}},{"id":"avoid-repeated-indexof-check","severity":"warn","description":"Disallow 3+ .indexOf() calls on the same array variable in one function.","fixable":false,"category":"performance","plugin":"solid","messages":{"repeatedIndexOf":"{{count}} .indexOf() calls on `{{name}}` in the same function. Use a Set, regex, or single-pass scan instead."}},{"id":"avoid-slice-sort-pattern","severity":"warn","description":"Disallow .slice().sort() and .slice().reverse() chains. Use .toSorted()/.toReversed().","fixable":false,"category":"performance","plugin":"solid","messages":{"sliceSort":".slice().sort() creates an intermediate array. Use .toSorted() instead.","sliceReverse":".slice().reverse() creates an intermediate array. Use .toReversed() instead.","spreadSort":"[...array].sort() creates an intermediate array. Use .toSorted() instead.","spreadReverse":"[...array].reverse() creates an intermediate array. Use .toReversed() instead."}},{"id":"avoid-sparse-arrays","severity":"warn","description":"Disallow new Array(n) without fill (creates holey array).","fixable":false,"category":"performance","plugin":"solid","messages":{"sparseArray":"new Array(n) creates a holey array. Use Array.from() or .fill() instead."}},{"id":"avoid-spread-sort-map-join-pipeline","severity":"warn","description":"Disallow [...iterable].sort().map().join() pipelines on hot paths.","fixable":false,"category":"performance","plugin":"solid","messages":{"spreadSortMapJoin":"Spread+sort+map+join pipeline allocates multiple intermediates. Prefer single-pass string construction on hot paths."}},{"id":"bounded-worklist-traversal","severity":"warn","description":"Detect queue/worklist traversals with unbounded growth and no guard.","fixable":false,"category":"performance","plugin":"solid","messages":{"boundedWorklist":"Worklist '{{name}}' grows via push() without visited set or explicit size bound. Add traversal guard to prevent pathological growth."}},{"id":"closure-captured-scope","severity":"warn","description":"Detect closures returned from scopes containing large allocations that may be retained.","fixable":false,"category":"performance","plugin":"solid","messages":{"capturedScope":"Returned closure shares scope with large allocation '{{name}}'. V8 may retain the allocation via scope capture even though the closure doesn't reference it. Move the allocation to an inner scope."}},{"id":"closure-dom-circular","severity":"warn","description":"Detect event handler property assignments that create closure-DOM circular references.","fixable":false,"category":"performance","plugin":"solid","messages":{"circularRef":"Event handler on '{{param}}' creates a closure that captures '{{param}}', forming a closure-DOM circular reference. Use addEventListener with a named handler for easier cleanup."}},{"id":"create-root-dispose","severity":"warn","description":"Detect createRoot with unused dispose parameter.","fixable":false,"category":"performance","plugin":"solid","messages":{"unusedDispose":"createRoot() dispose parameter is never used. The reactive tree will never be cleaned up. Call dispose(), return it, or pass it to onCleanup()."}},{"id":"detached-dom-reference","severity":"warn","description":"Detect DOM query results stored in module-scoped variables that may hold detached nodes.","fixable":false,"category":"performance","plugin":"solid","messages":{"detachedRef":"DOM query result from '{{method}}' stored in module-scoped variable '{{name}}'. If the DOM node is removed, this reference prevents garbage collection. Use a local variable or WeakRef instead."}},{"id":"effect-outside-root","severity":"error","description":"Detect reactive computations created outside a reactive root (no Owner).","fixable":false,"category":"performance","plugin":"solid","messages":{"orphanedEffect":"{{primitive}}() called outside a reactive root. Without an Owner, this computation is never disposed and leaks memory. Wrap in a component, createRoot, or runWithOwner."}},{"id":"finalization-registry-leak","severity":"error","description":"Detect FinalizationRegistry.register() where heldValue references the target.","fixable":false,"category":"performance","plugin":"solid","messages":{"selfReference":"FinalizationRegistry.register() heldValue references the target '{{name}}'. This strong reference prevents the target from being garbage collected, defeating the purpose of the registry."}},{"id":"no-char-array-materialization","severity":"warn","description":"Disallow split(\"\"), Array.from(str), or [...str] in parsing loops.","fixable":false,"category":"performance","plugin":"solid","messages":{"charArrayMaterialization":"Character array materialization via {{pattern}} in parsing loops allocates O(n) extra memory. Prefer index-based scanning."}},{"id":"no-double-pass-delimiter-count","severity":"warn","description":"Disallow split-based delimiter counting followed by additional split passes.","fixable":false,"category":"performance","plugin":"solid","messages":{"doublePassDelimiterCount":"Delimiter counting via `split(...).length` plus another `split(...)` repeats full-string passes. Prefer one indexed scan."}},{"id":"no-full-split-in-hot-parse","severity":"warn","description":"Disallow full split() materialization inside hot string parsing loops.","fixable":false,"category":"performance","plugin":"solid","messages":{"fullSplitInHotParse":"`split()` inside parsing loops materializes full token arrays each iteration. Prefer cursor/index scanning."}},{"id":"no-heavy-parser-constructor-in-loop","severity":"warn","description":"Disallow constructing heavy parsing helpers inside loops.","fixable":false,"category":"performance","plugin":"solid","messages":{"heavyParserConstructor":"`new {{ctor}}(...)` inside parsing loops repeatedly allocates heavy parser helpers. Hoist and reuse instances."}},{"id":"no-leaked-abort-controller","severity":"warn","description":"Detect AbortController in effects without abort() in onCleanup.","fixable":false,"category":"performance","plugin":"solid","messages":{"leakedAbort":"new AbortController() inside a reactive effect without onCleanup. Add onCleanup(() => controller.abort())."}},{"id":"no-leaked-animation-frame","severity":"warn","description":"Detect requestAnimationFrame in effects without cancelAnimationFrame in onCleanup.","fixable":false,"category":"performance","plugin":"solid","messages":{"leakedRaf":"requestAnimationFrame() inside a reactive effect without onCleanup. Add onCleanup(() => cancelAnimationFrame(id))."}},{"id":"no-leaked-event-listener","severity":"warn","description":"Detect addEventListener in effects without removeEventListener in onCleanup.","fixable":false,"category":"performance","plugin":"solid","messages":{"leakedListener":"addEventListener() inside a reactive effect without onCleanup. Each re-run leaks a listener. Add onCleanup(() => removeEventListener(...))."}},{"id":"no-leaked-observer","severity":"warn","description":"Detect Observer APIs in effects without disconnect() in onCleanup.","fixable":false,"category":"performance","plugin":"solid","messages":{"leakedObserver":"new {{type}}() inside a reactive effect without onCleanup. Add onCleanup(() => observer.disconnect())."}},{"id":"no-leaked-subscription","severity":"warn","description":"Detect WebSocket/EventSource/BroadcastChannel in effects without close() in onCleanup.","fixable":false,"category":"performance","plugin":"solid","messages":{"leakedSubscription":"new {{type}}() inside a reactive effect without onCleanup. Add onCleanup(() => instance.close())."}},{"id":"no-leaked-timer","severity":"warn","description":"Detect setInterval/setTimeout in effects without onCleanup to clear them.","fixable":false,"category":"performance","plugin":"solid","messages":{"leakedTimer":"{{setter}}() inside a reactive effect without onCleanup. Each re-run leaks a timer. Add onCleanup(() => {{clearer}}(id))."}},{"id":"no-loop-string-plus-equals","severity":"warn","description":"Disallow repeated string += accumulation in parsing loops.","fixable":false,"category":"performance","plugin":"solid","messages":{"loopStringPlusEquals":"Repeated string `+=` in parsing loops creates avoidable allocations. Buffer chunks and join once."}},{"id":"no-multipass-split-pipeline","severity":"warn","description":"Disallow multipass split/map/filter pipelines in parsing code.","fixable":false,"category":"performance","plugin":"solid","messages":{"multipassSplit":"`split()` followed by multiple array passes allocates heavily on parsing paths. Prefer single-pass parsing."}},{"id":"no-per-char-substring-scan","severity":"warn","description":"Disallow per-character substring/charAt scanning patterns in loops.","fixable":false,"category":"performance","plugin":"solid","messages":{"perCharSubstring":"Per-character `{{method}}()` scanning in loops allocates extra strings. Prefer index + charCodeAt scanning."}},{"id":"no-repeated-token-normalization","severity":"warn","description":"Disallow repeated trim/lower/upper normalization chains on the same token in one function.","fixable":false,"category":"performance","plugin":"solid","messages":{"repeatedTokenNormalization":"Repeated token normalization `{{chain}}` on `{{name}}` in one function. Compute once and reuse."}},{"id":"no-rescan-indexof-loop","severity":"warn","description":"Disallow repeated indexOf/includes scans from start in parsing loops.","fixable":false,"category":"performance","plugin":"solid","messages":{"rescanIndexOf":"Repeated `{{method}}()` from string start inside loops rescans prior text. Pass a cursor start index."}},{"id":"no-rest-slice-loop","severity":"warn","description":"Disallow repeated self-slice reassignment loops in string parsing code.","fixable":false,"category":"performance","plugin":"solid","messages":{"restSliceLoop":"Repeated `{{name}} = {{name}}.{{method}}(...)` in loops creates string churn. Track cursor indexes instead."}},{"id":"no-shift-splice-head-consume","severity":"warn","description":"Disallow shift/splice(0,1) head-consume patterns in loops.","fixable":false,"category":"performance","plugin":"solid","messages":{"headConsume":"Head-consuming `{{method}}()` inside loops causes array reindexing costs. Use index cursor iteration instead."}},{"id":"no-write-only-index","severity":"warn","description":"Detect index structures that are written but never queried by key.","fixable":false,"category":"performance","plugin":"solid","messages":{"writeOnlyIndex":"Index '{{name}}' is built via writes but never queried by key. Remove it or use direct collection flow."}},{"id":"prefer-charcode-over-regex-test","severity":"warn","description":"Prefer charCodeAt() range checks over regex .test() for single-character classification.","fixable":false,"category":"performance","plugin":"solid","messages":{"regexTest":"Regex `{{pattern}}`.test() on a single character. Use charCodeAt() range checks instead."}},{"id":"prefer-index-scan-over-string-iterator","severity":"warn","description":"Prefer index-based string scanning over for-of iteration in ASCII parser code.","fixable":false,"category":"performance","plugin":"solid","messages":{"preferIndexScan":"ASCII parsing loops should avoid `for...of` string iteration. Prefer indexed scanning with charCodeAt for lower overhead."}},{"id":"prefer-lazy-property-access","severity":"warn","description":"Suggests moving property access after early returns when not used immediately.","fixable":false,"category":"performance","plugin":"solid","messages":{"preferLazyPropertyAccess":"Property '{{propertyName}}' assigned to '{{variableName}}' before early return but not used there. Move assignment after early returns."}},{"id":"prefer-map-lookup-over-linear-scan","severity":"warn","description":"Disallow repeated linear scans over fixed literal collections in hot paths.","fixable":false,"category":"performance","plugin":"solid","messages":{"preferMapLookup":"Linear scan over fixed collection '{{name}}' in '{{fnName}}'. Precompute Map/Set lookup for O(1) access."}},{"id":"prefer-map-over-object-dictionary","severity":"warn","description":"Suggest Map for dictionary-like objects with dynamic keys.","fixable":false,"category":"performance","plugin":"solid","messages":{"preferMap":"Dynamic key assignment on dictionary object causes hidden class transitions. Consider using Map."}},{"id":"prefer-precompiled-regex","severity":"warn","description":"Prefer hoisting regex literals to module-level constants to avoid repeated compilation.","fixable":false,"category":"performance","plugin":"solid","messages":{"inlineRegex":"Regex `{{pattern}}` is compiled on every call. Hoist to a module-level constant."}},{"id":"prefer-set-has-over-equality-chain","severity":"warn","description":"Disallow 4+ guard-style equality checks against string literals on the same variable. Use a Set.","fixable":false,"category":"performance","plugin":"solid","messages":{"equalityChain":"{{count}} equality checks against `{{name}}`. Extract literals to a Set and use .has() instead."}},{"id":"prefer-set-lookup-in-loop","severity":"warn","description":"Disallow linear search methods (.includes/.indexOf) on arrays inside loops.","fixable":false,"category":"performance","plugin":"solid","messages":{"preferSet":"`.{{method}}()` on `{{name}}` called inside a loop. Convert to a Set for O(1) lookups."}},{"id":"recursive-timer","severity":"warn","description":"Detect setTimeout that recursively calls its enclosing function.","fixable":false,"category":"performance","plugin":"solid","messages":{"recursiveTimer":"setTimeout() recursively calls '{{name}}', creating an unbreakable polling loop. Add a termination condition or use setInterval with cleanup."}},{"id":"self-referencing-store","severity":"error","description":"Detect setStore() where the value argument references the store itself.","fixable":false,"category":"performance","plugin":"solid","messages":{"selfReference":"setStore() value references the store variable '{{name}}', creating a circular proxy reference. This prevents garbage collection and can cause infinite loops."}},{"id":"unbounded-collection","severity":"warn","description":"Detect module-scoped Map/Set/Array that only grow without removal.","fixable":false,"category":"performance","plugin":"solid","messages":{"unboundedCollection":"Module-scoped {{type}} '{{name}}' only uses additive methods ({{methods}}). Without removal or clearing, this grows unbounded. Consider WeakMap, LRU eviction, or periodic clear()."}},{"id":"unbounded-signal-accumulation","severity":"warn","description":"Detect signal setters that accumulate data without truncation via spread+append pattern.","fixable":false,"category":"performance","plugin":"solid","messages":{"unbounded":"Signal setter '{{name}}' accumulates data without bounds. The array grows monotonically via spread+append. Add truncation (e.g. prev.slice(-limit)) to prevent unbounded growth."}}],
  "reactivity": [{"id":"async-tracked","severity":"error","description":"Disallow async functions in tracked scopes (createEffect, createMemo, etc.)","fixable":false,"category":"reactivity","plugin":"solid","messages":{"asyncCreateEffect":"Async function{{fnName}} in createEffect loses tracking after await. Read all signals before the first await, or use createResource for async data fetching.","asyncCreateMemo":"Async function{{fnName}} in createMemo won't work correctly. createMemo must be synchronous. For async derived data, use createResource instead.","asyncCreateComputed":"Async function{{fnName}} in createComputed won't track properly. createComputed must be synchronous—signal reads after await won't trigger re-computation.","asyncCreateRenderEffect":"Async function{{fnName}} in createRenderEffect breaks DOM update timing. createRenderEffect must be synchronous. Move async work to onMount or createResource.","asyncTrackedGeneric":"Async function{{fnName}} in {{source}} won't track reactivity after await. Solid's tracking only works synchronously—signal reads after await are ignored."}},{"id":"children-helper-misuse","severity":"error","description":"Detect misuse of the children() helper that causes unnecessary re-computation or breaks reactivity","fixable":false,"category":"reactivity","plugin":"solid","messages":{"multipleChildrenCalls":"The children() helper should only be called once per component. Each call re-resolves children, causing unnecessary computation. Store the result and reuse the accessor.","directChildrenAccess":"Access props.children through the children() helper in reactive contexts. Direct access won't properly resolve or track children. Use: const resolved = children(() => props.children);"}},{"id":"cleanup-scope","severity":"error","description":"Detect onCleanup called outside of a valid reactive scope","fixable":false,"category":"reactivity","plugin":"solid","messages":{"cleanupOutsideScope":"onCleanup() called outside a reactive scope ({{location}}). The cleanup function will never execute unless this code runs within a component, effect, createRoot, or runWithOwner."}},{"id":"derived-signal","severity":"error","description":"Detect functions that capture reactive values but are called in untracked contexts","fixable":false,"category":"reactivity","plugin":"solid","messages":{"moduleScopeInit":"Assigning '{{fnName}}()' to '{{varName}}' at module scope runs once at startup. It captures {{vars}} which won't trigger updates.","moduleScopeCall":"'{{fnName}}()' at module scope executes once when the module loads. It captures {{vars}}—changes won't cause this to re-run.","componentTopLevelInit":"'{{fnName}}()' assigned to '{{varName}}' in '{{componentName}}' captures a one-time snapshot of {{vars}}. Changes won't update '{{varName}}'. Call in JSX or use createMemo().","componentTopLevelCall":"'{{fnName}}()' at top-level of '{{componentName}}' runs once and captures a snapshot of {{vars}}. Changes won't re-run this. Move inside JSX: {{{fnName}}()} or wrap with createMemo().","utilityFnCall":"'{{fnName}}()' inside '{{utilityName}}' won't be reactive. Call '{{utilityName}}' from a tracked scope (createEffect, JSX), or pass {{vars}} as parameters.","syncCallbackCall":"'{{fnName}}()' inside {{methodName}}() callback runs outside a tracking scope. The result captures a snapshot of {{vars}} that won't update.","untrackedCall":"'{{fnName}}()' called in an untracked context. It captures {{vars}} which won't trigger updates here. Move to JSX or a tracked scope."}},{"id":"effect-as-memo","severity":"error","description":"Detect createEffect that only sets a derived signal value, which should be createMemo instead","fixable":true,"category":"reactivity","plugin":"solid","messages":{"effectAsMemo":"This createEffect only computes a derived value. Use createMemo() instead: const {{signalName}} = createMemo(() => {{expression}});"}},{"id":"effect-as-mount","severity":"error","description":"Detect createEffect/createRenderEffect with no reactive dependencies that should be onMount instead","fixable":true,"category":"reactivity","plugin":"solid","messages":{"effectAsMount":"This {{primitive}} has no reactive dependencies and runs only once. Use onMount() for initialization logic that doesn't need to re-run."}},{"id":"inline-component","severity":"error","description":"Detect component functions defined inside other components, which causes remount on every parent update","fixable":false,"category":"reactivity","plugin":"solid","messages":{"inlineComponent":"Component '{{name}}' is defined inside another component. This creates a new component type on every render, causing unmount/remount. Move the component definition outside."}},{"id":"no-top-level-signal-call","severity":"error","description":"Disallow calling signals at component top-level (captures stale snapshots)","fixable":false,"category":"reactivity","plugin":"solid","messages":{"assignedToVar":"'{{name}}()' assigned to '{{varName}}' in {{componentName}} captures a one-time snapshot. '{{varName}}' won't update when {{name}} changes. Use createMemo(): `const {{varName}} = createMemo(() => {{name}}());`","computedValue":"'{{name}}()' in computation at top-level of {{componentName}} captures a stale snapshot. Wrap with createMemo(): `const {{varName}} = createMemo(() => /* computation using {{name}}() */);`","templateLiteral":"'{{name}}()' in template literal at top-level of {{componentName}} captures a stale snapshot. Use createMemo() or compute directly in JSX: `{`Hello, ${{{name}}()}!`}`","destructuring":"Destructuring '{{name}}()' at top-level of {{componentName}} captures a stale snapshot. Access properties in JSX or createMemo(): `{{{name}}().propertyName}`","objectLiteral":"'{{name}}()' in object literal at top-level of {{componentName}} captures a stale snapshot. Use createMemo() for the object, or spread in JSX.","arrayCreation":"'{{name}}()' in array creation at top-level of {{componentName}} captures a stale snapshot. Wrap with createMemo(): `const items = createMemo(() => Array.from(...));`","earlyReturn":"'{{name}}()' in early return at top-level of {{componentName}} captures a stale snapshot. Use <Show when={{{name}}()}> for conditional rendering instead.","conditionalAssign":"'{{name}}()' in ternary at top-level of {{componentName}} captures a stale snapshot. Use createMemo() or compute in JSX: `{{{name}}() ? 'Yes' : 'No'}`","functionArgument":"'{{name}}()' passed as argument at top-level of {{componentName}} captures a stale snapshot. Move to createEffect() or compute in JSX.","syncCallback":"'{{name}}()' inside {{methodName}}() at top-level of {{componentName}} captures a stale snapshot. Wrap the entire computation in createMemo(): `const result = createMemo(() => items.{{methodName}}(...));`","topLevelCall":"'{{name}}()' at top-level of {{componentName}} captures a one-time snapshot. Changes to {{name}} won't update the result. Call directly in JSX or wrap in createMemo()."}},{"id":"ref-early-access","severity":"error","description":"Detect accessing refs before they are assigned (before mount)","fixable":false,"category":"reactivity","plugin":"solid","messages":{"refBeforeMount":"Ref '{{name}}' is accessed before component mounts. Refs are undefined until after mount. Access in onMount(), createEffect(), or event handlers."}},{"id":"resource-access-unchecked","severity":"error","description":"Detect accessing resource data without checking loading/error state.","fixable":false,"category":"reactivity","plugin":"solid","messages":{"resourceUnchecked":"Accessing resource '{{name}}' without checking loading/error state may return undefined. Wrap in <Show when={!{{name}}.loading}> or <Suspense>."}},{"id":"resource-implicit-suspense","severity":"warn","description":"Detect createResource that implicitly triggers or permanently breaks Suspense boundaries.","fixable":true,"category":"reactivity","plugin":"solid","messages":{"loadingMismatch":"createResource '{{name}}' has no initialValue but uses {{name}}.loading for manual loading UI. Suspense intercepts before your loading UI renders — the component is unmounted before the <Show>/<Switch> evaluates. Replace createResource with onMount + createSignal to decouple from Suspense entirely.","conditionalSuspense":"createResource '{{name}}' is inside a conditional mount point ({{mountTag}}) with a distant Suspense boundary. The SuspenseContext increment fires when the fetcher's Promise is pending and unmounts the entire page subtree — initialValue does NOT prevent this. Replace createResource with onMount + createSignal to avoid Suspense interaction.","missingErrorBoundary":"createResource '{{name}}' has no <ErrorBoundary> between its component and the nearest <Suspense>. When the fetcher throws (network error, 401/403/503, timeout), the error propagates to Suspense which has no error handling — the boundary breaks permanently. Wrap the component in <ErrorBoundary> or replace createResource with onMount + createSignal and catch errors in the fetcher."}},{"id":"resource-refetch-loop","severity":"error","description":"Detect refetch() calls inside createEffect which can cause infinite loops","fixable":false,"category":"reactivity","plugin":"solid","messages":{"refetchInEffect":"Calling {{name}}.refetch() inside createEffect may cause infinite loops. The resource tracks its own dependencies. Move refetch to an event handler or use on() to control dependencies."}},{"id":"signal-call","severity":"error","description":"Require signals to be called as functions when used in tracked contexts","fixable":true,"category":"reactivity","plugin":"solid","messages":{"signalInJsxText":"Signal '{{name}}' in JSX text should be called: {{{name}}()}. Without (), you're rendering the function, not its value.","signalInJsxAttribute":"Signal '{{name}}' in JSX attribute should be called: {{attr}}={{{name}}()}. Without (), the attribute won't update reactively.","signalInTernary":"Signal '{{name}}' in ternary should be called: {{name}}() ? ... : .... The condition won't react to changes without ().","signalInLogical":"Signal '{{name}}' in logical expression should be called: {{name}}() && .... Without (), this always evaluates to truthy (functions are truthy).","signalInComparison":"Signal '{{name}}' in comparison should be called: {{name}}() === .... Comparing functions always returns false.","signalInArithmetic":"Signal '{{name}}' in arithmetic should be called: {{name}}() + .... Math on functions produces NaN.","signalInTemplate":"Signal '{{name}}' in template literal should be called: `...${{{name}}()}...`. Without (), you're embedding '[Function]'.","signalInTrackedScope":"Signal '{{name}}' in {{where}} should be called: {{name}}(). Without (), reactivity is lost.","badSignal":"The reactive variable '{{name}}' should be called as a function when used in {{where}}."}},{"id":"signal-in-loop","severity":"error","description":"Detect problematic signal usage inside For/Index loop callbacks","fixable":false,"category":"reactivity","plugin":"solid","messages":{"signalInLoop":"Creating signals inside <{{component}}> callback creates new signals on each render. Use a store at the parent level, or derive state from the index.","signalCallInvariant":"Signal '{{name}}' called inside <{{component}}> produces the same value for every item. Extract to a variable or memoize with createMemo() before the loop.","derivedCallInvariant":"'{{name}}()' inside <{{component}}> captures {{captures}} but doesn't use the loop item. Extract the call before the loop or pass the item as a parameter."}},{"id":"store-reactive-break","severity":"error","description":"Detect patterns that break store reactivity: spreading stores, top-level property extraction, or destructuring","fixable":false,"category":"reactivity","plugin":"solid","messages":{"storeSpread":"Spreading a store ({...store}) creates a static snapshot that won't update. Access store properties directly in JSX or tracked contexts.","storeTopLevelAccess":"Accessing store property '{{property}}' at component top-level captures the value once. Access store.{{property}} directly in JSX or wrap in createMemo().","storeDestructure":"Destructuring a store breaks reactivity. Access properties via store.{{property}} instead of destructuring."}},{"id":"transition-pending-unchecked","severity":"error","description":"Detect useTransition usage without handling the isPending state","fixable":false,"category":"reactivity","plugin":"solid","messages":{"pendingUnchecked":"useTransition returns [isPending, startTransition]. The isPending state should be used to show loading UI during transitions."}}],
  "solid": [{"id":"batch-optimization","severity":"warn","description":"Suggest using batch() when multiple signal setters are called in the same synchronous scope","fixable":true,"category":"solid","plugin":"solid","messages":{"multipleSetters":"Multiple signal updates in the same scope cause multiple re-renders. Wrap in batch() for a single update: batch(() => { {{setters}} });"}},{"id":"imports","severity":"error","description":"Enforce consistent imports from \"solid-js\", \"solid-js/web\", and \"solid-js/store\".","fixable":false,"category":"solid","plugin":"solid","messages":{"preferSource":"Prefer importing {{name}} from \"{{source}}\"."}},{"id":"index-vs-for","severity":"warn","description":"Suggest <For> for object arrays and <Index> for primitive arrays.","fixable":true,"category":"solid","plugin":"solid","messages":{"indexWithObjects":"<Index> with object arrays causes the item accessor to change on any array mutation. Use <For> for objects to maintain reference stability.","forWithPrimitives":"<For> with primitive arrays (strings, numbers) keys by value, which may cause unexpected re-renders. Consider <Index> if index stability is preferred."}},{"id":"no-react-deps","severity":"error","description":"Disallow usage of dependency arrays in `createEffect`, `createMemo`, and `createRenderEffect`.","fixable":true,"category":"solid","plugin":"solid","messages":{"noUselessDep":"In Solid, `{{name}}` doesn't accept a dependency array because it automatically tracks its dependencies. If you really need to override the list of dependencies, use `on`."}},{"id":"no-react-specific-props","severity":"error","description":"Disallow usage of React-specific `className`/`htmlFor` props, which were deprecated in v1.4.0.","fixable":true,"category":"solid","plugin":"solid","messages":{"prefer":"Prefer the `{{to}}` prop over the deprecated `{{from}}` prop.","noUselessKey":"Elements in a <For> or <Index> list do not need a key prop."}},{"id":"prefer-for","severity":"warn","description":"Enforce using Solid's `<For />` component for mapping an array to JSX elements.","fixable":true,"category":"solid","plugin":"solid","messages":{"preferFor":"Prefer Solid's `<For each={...}>` component for rendering lists of objects. Array#map recreates all DOM elements on every update, while <For> updates only changed items by keying on reference.","preferIndex":"Prefer Solid's `<Index each={...}>` component for rendering lists of primitives. Array#map recreates all DOM elements on every update, while <Index> updates only changed items by keying on index position.","preferForOrIndex":"Prefer Solid's `<For />` or `<Index />` component for rendering lists. Use <For> when items are objects (keys by reference), or <Index> when items are primitives like strings/numbers (keys by index). Array#map recreates all DOM elements on every update."}},{"id":"prefer-memo-complex-styles","severity":"warn","description":"Enforce extracting complex style computations to createMemo for better approach. Complex inline style objects are rebuilt on every render, which can impact approach.","fixable":false,"category":"solid","plugin":"solid","messages":{"preferMemoComplexStyle":"Complex style computation should be extracted to createMemo() for better approach. This style object contains {{complexity}} conditional expressions that are recalculated on every render.","preferMemoConditionalSpread":"Conditional spread operators in style objects should be extracted to createMemo(). Pattern like `...(condition ? {...} : {})` creates new objects on every render."}},{"id":"prefer-show","severity":"warn","description":"Enforce using Solid's `<Show />` component for conditionally showing content. Solid's compiler covers this case, so it's a stylistic rule only.","fixable":true,"category":"solid","plugin":"solid","messages":{"preferShowAnd":"Prefer Solid's `<Show when={...}>` component for conditional rendering. While Solid's compiler handles `&&` expressions, <Show> is more explicit and provides better readability for conditional content.","preferShowTernary":"Prefer Solid's `<Show when={...} fallback={...}>` component for conditional rendering with a fallback. This provides clearer intent and better readability than ternary expressions."}},{"id":"self-closing-comp","severity":"warn","description":"Disallow extra closing tags for components without children.","fixable":true,"category":"solid","plugin":"solid","messages":{"selfClose":"Empty elements should be self-closing. Use `<{{name}} />` instead of `<{{name}}></{{name}}>` for cleaner, more concise JSX.","dontSelfClose":"This element should not be self-closing based on your configuration. Use `<{{name}}></{{name}}>` instead of `<{{name}} />` for explicit opening and closing tags."}},{"id":"style-prop","severity":"warn","description":"Require CSS properties in the `style` prop to be valid and kebab-cased (ex. 'font-size'), not camel-cased (ex. 'fontSize') like in React, and that property values with dimensions are strings, not numbers with implicit 'px' units.","fixable":true,"category":"solid","plugin":"solid","messages":{"kebabStyleProp":"Solid uses kebab-case for CSS property names, not camelCase like React. Use '{{kebabName}}' instead of '{{name}}'.","invalidStyleProp":"'{{name}}' is not a valid CSS property. Check for typos, or if this is a custom property, prefix it with '--' (e.g., '--{{name}}').","numericStyleValue":"Numeric values for dimensional properties need explicit units in Solid. Unlike React, Solid does not auto-append 'px'. Use '{{value}}px' or another appropriate unit.","stringStyle":"Use an object for the style prop instead of a string for better approach and type safety. Example: style={{ '{{prop}}': '{{value}}' }}."}}],
} as const

/** All rule categories, sorted alphabetically. */
export const RULE_CATEGORIES: readonly RuleCategory[] = ["correctness","css-a11y","css-animation","css-cascade","css-jsx","css-layout","css-property","css-selector","css-structure","jsx","performance","reactivity","solid"] as const

/** Lookup a rule by ID. Returns undefined if not found. */
export function getRule(id: string): RuleEntry | undefined {
  for (let i = 0; i < RULES.length; i++) {
    const rule = RULES[i]
    if (rule && rule.id === id) return rule
  }
  return undefined
}
