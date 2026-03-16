import ts from "typescript";
import type { CSSGraph } from "../css/impl";
import type { SolidGraph } from "../solid/impl";
import { getPropertyKeyName } from "../solid/util/pattern-detection";
import { CHAR_HYPHEN } from "@drskillissue/ganko-shared";

export function getUnusedCSSClasses(solids: readonly SolidGraph[], css: CSSGraph): readonly string[] {
  const used = new Set<string>();

  for (let s = 0; s < solids.length; s++) {
    const solid = solids[s];
    if (!solid) continue;

    for (const [, idx] of solid.staticClassTokensByElementId) {
      if (idx.hasDynamicClass) continue;
      const tokens = idx.tokens;
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (!token) continue;
        used.add(token);
      }
    }

    for (const [, idx] of solid.staticClassListKeysByElementId) {
      const keys = idx.keys;
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (!key) continue;
        used.add(key);
      }
    }
  }

  const unused: string[] = [];
  for (const name of css.classNameIndex.keys()) {
    if (!used.has(name)) unused.push(name);
  }
  return unused;
}

export function getUndefinedCSSClasses(
  solids: readonly SolidGraph[],
  css: CSSGraph,
): readonly { className: string; file: string; elementId: number }[] {
  const result: { className: string; file: string; elementId: number }[] = [];
  const tailwind = css.tailwind;

  for (let s = 0; s < solids.length; s++) {
    const solid = solids[s];
    if (!solid) continue;
    const seenByElementId = new Map<number, Set<string>>();

    for (const [elementId, idx] of solid.staticClassTokensByElementId) {
      if (idx.hasDynamicClass) continue;
      const tokens = idx.tokens;
      for (let i = 0; i < tokens.length; i++) {
        const name = tokens[i];
        if (!name) continue;
        const existing = seenByElementId.get(elementId);
        if (existing) {
          if (existing.has(name)) continue;
          existing.add(name);
        } else {
          const next = new Set<string>();
          next.add(name);
          seenByElementId.set(elementId, next);
        }
        if (css.classNameIndex.has(name)) continue;
        if (tailwind !== null && tailwind.has(name)) continue;
        if (solid.inlineStyleClassNames.has(name)) continue;
        result.push({ className: name, file: solid.file, elementId });
      }
    }

    for (const [elementId, idx] of solid.staticClassListKeysByElementId) {
      const keys = idx.keys;
      for (let i = 0; i < keys.length; i++) {
        const name = keys[i];
        if (!name) continue;
        const existing = seenByElementId.get(elementId);
        if (existing) {
          if (existing.has(name)) continue;
          existing.add(name);
        } else {
          const next = new Set<string>();
          next.add(name);
          seenByElementId.set(elementId, next);
        }
        if (css.classNameIndex.has(name)) continue;
        if (tailwind !== null && tailwind.has(name)) continue;
        if (solid.inlineStyleClassNames.has(name)) continue;
        result.push({ className: name, file: solid.file, elementId });
      }
    }
  }

  return result;
}

export function getUndefinedVariableUsagesInJSX(
  solids: readonly SolidGraph[],
  css: CSSGraph,
): readonly { name: string; file: string; elementId: number }[] {
  const result: { name: string; file: string; elementId: number }[] = [];
  const seen = new Set<string>();

  for (let s = 0; s < solids.length; s++) {
    const solid = solids[s];
    if (!solid) continue;
    const props = solid.styleProperties;

    for (let i = 0; i < props.length; i++) {
      const entry = props[i];
      if (!entry) continue;
      const prop = entry.property;
      if (!ts.isPropertyAssignment(prop)) continue;
      if (ts.isComputedPropertyName(prop.name)) continue;
      const keyName = getPropertyKeyName(prop.name);
      if (keyName === null) continue;
      if (keyName.charCodeAt(0) !== CHAR_HYPHEN || keyName.charCodeAt(1) !== CHAR_HYPHEN) continue;
      if (seen.has(keyName)) continue;
      seen.add(keyName);
      if (!css.variablesByName.has(keyName)) {
        result.push({ name: keyName, file: solid.file, elementId: entry.element.id });
      }
    }
  }

  return result;
}
