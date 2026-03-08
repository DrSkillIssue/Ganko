import { StringInterner } from "@drskillissue/ganko-shared";

const CSS_PROPERTIES: readonly string[] = [
  "display", "position", "top", "right", "bottom", "left",
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border", "border-radius", "border-color", "border-width", "border-style",
  "background", "background-color", "background-image",
  "color", "font-size", "font-weight", "font-family", "line-height",
  "text-align", "text-decoration", "text-transform",
  "flex", "flex-direction", "flex-wrap", "align-items", "justify-content",
  "gap", "grid", "grid-template-columns", "grid-template-rows",
  "overflow", "z-index", "opacity", "cursor", "pointer-events",
  "transition", "transform", "animation", "animation-name",
  "box-shadow", "outline", "visibility",
  "container", "container-name", "container-type",
];

const AT_RULE_NAMES: readonly string[] = [
  "media", "keyframes", "font-face", "supports", "import", "layer",
  "container", "page", "charset", "namespace", "mixin", "function",
  "include", "extend", "use", "forward",
];

const PSEUDO_NAMES: readonly string[] = [
  "hover", "focus", "active", "visited", "first-child", "last-child",
  "nth-child", "nth-of-type", "not", "is", "where", "has",
  "root", "focus-visible", "focus-within", "disabled", "enabled",
  "checked", "empty", "before", "after", "first-line", "first-letter",
  "placeholder", "selection", "marker",
];

export function createCSSInterner(): StringInterner {
  const interner = new StringInterner();
  interner.internAll(CSS_PROPERTIES);
  interner.internAll(AT_RULE_NAMES);
  interner.internAll(PSEUDO_NAMES);
  return interner;
}
