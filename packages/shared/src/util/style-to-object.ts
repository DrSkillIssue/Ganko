/**
 * Style to Object Converter
 *
 * Thin wrapper around inline-style-parser that converts parsed
 * declarations to a plain object.
 *
 * Based on:
 * - https://github.com/remarkablemark/style-to-object
 *
 */
import type { Declaration } from "./inline-style-parser";
import parse from "./inline-style-parser";

export interface StyleObject {
  [name: string]: string;
}

type CallbackFn = (property: string, value: string, declaration: Declaration) => void;

/**
 * Converts an inline CSS style string to a JavaScript object.
 *
 * @param style - The CSS inline style string to convert
 * @param callbackFn - Optional callback function called for each CSS declaration
 * @returns A plain object mapping CSS property names to values, or null if style is empty/invalid
 */
export default function styleToObject(style: string, callbackFn?: CallbackFn): StyleObject | null {

  if (!style || typeof style !== "string") {
    return null;
  }

  const declarations = parse(style);
  const len = declarations.length;

  if (len === 0) {
    return null;
  }

  let styleObject: StyleObject | null = null;
  const hasCallbackFn = callbackFn !== undefined;

  for (let i = 0; i < len; i++) {
    const declaration = declarations[i];
    if (!declaration) continue;

    if (declaration.type !== "declaration") {
      continue;
    }

    const { property, value } = declaration;

    if (hasCallbackFn && callbackFn) {
      callbackFn(property, value, declaration);
    } else if (value) {
      if (styleObject === null) {
        styleObject = {};
      }
      styleObject[property] = value;
    }
  }

  return styleObject;
}

export { styleToObject };
