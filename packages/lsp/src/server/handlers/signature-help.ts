/**
 * Signature Help Handler
 *
 * Delegates to ts.LanguageService.getSignatureHelpItems() for general signatures.
 * Overlays richer documentation for Solid.js primitives from a static lookup table.
 */

import type {
  SignatureHelpParams,
  SignatureHelp,
  SignatureInformation,
  ParameterInformation,
} from "vscode-languageserver";
import ts from "typescript";

import type { HandlerContext } from "./handler-context";
import { positionToOffset } from "./ts-utils";
import { uriToPath } from "@drskillissue/ganko-shared";

/** Solid primitive signatures — zero-cost static lookup for rich docs */
const SOLID_SIGNATURES: ReadonlyMap<string, SignatureInformation> = new Map([
  ["createSignal", {
    label: "createSignal<T>(value: T, options?: SignalOptions<T>): [Accessor<T>, Setter<T>]",
    documentation: {
      kind: "markdown",
      value: "Creates a reactive signal with a getter and setter.\n\n```tsx\nconst [count, setCount] = createSignal(0);\n```",
    },
    parameters: [
      { label: "value: T", documentation: "Initial value for the signal" },
      { label: "options?: SignalOptions<T>", documentation: "Optional configuration (equals, name)" },
    ],
  }],
  ["createEffect", {
    label: "createEffect<T>(fn: (v: T) => T, value?: T): void",
    documentation: {
      kind: "markdown",
      value: "Creates a reactive effect that runs when its dependencies change.\n\n```tsx\ncreateEffect(() => console.log(count()));\n```",
    },
    parameters: [
      { label: "fn: (v: T) => T", documentation: "Effect function. Receives previous value, returns next." },
      { label: "value?: T", documentation: "Initial value passed to first run" },
    ],
  }],
  ["createMemo", {
    label: "createMemo<T>(fn: () => T, value?: T, options?: MemoOptions<T>): Accessor<T>",
    documentation: {
      kind: "markdown",
      value: "Creates a memoized derived value that only recomputes when dependencies change.\n\n```tsx\nconst doubled = createMemo(() => count() * 2);\n```",
    },
    parameters: [
      { label: "fn: () => T", documentation: "Computation function" },
      { label: "value?: T", documentation: "Initial value" },
      { label: "options?: MemoOptions<T>", documentation: "Optional configuration" },
    ],
  }],
  ["createStore", {
    label: "createStore<T>(value: T): [Store<T>, SetStoreFunction<T>]",
    documentation: {
      kind: "markdown",
      value: "Creates a reactive store for complex nested state.\n\n```tsx\nconst [store, setStore] = createStore({ count: 0 });\n```",
    },
    parameters: [
      { label: "value: T", documentation: "Initial store value (object or array)" },
    ],
  }],
  ["createResource", {
    label: "createResource<T, S>(source: S | Accessor<S>, fetcher: (s: S) => Promise<T>, options?: ResourceOptions<T>): Resource<T>",
    documentation: {
      kind: "markdown",
      value: "Creates an async resource that automatically refetches when source changes.\n\n```tsx\nconst [data] = createResource(id, fetchUser);\n```",
    },
    parameters: [
      { label: "source: S | Accessor<S>", documentation: "Source signal that triggers refetch" },
      { label: "fetcher: (s: S) => Promise<T>", documentation: "Async function to fetch data" },
      { label: "options?: ResourceOptions<T>", documentation: "Optional configuration" },
    ],
  }],
  ["createContext", {
    label: "createContext<T>(defaultValue?: T): Context<T>",
    documentation: {
      kind: "markdown",
      value: "Creates a context for dependency injection.\n\n```tsx\nconst ThemeContext = createContext('light');\n```",
    },
    parameters: [
      { label: "defaultValue?: T", documentation: "Default value when no provider exists" },
    ],
  }],
  ["onMount", {
    label: "onMount(fn: () => void): void",
    documentation: {
      kind: "markdown",
      value: "Runs a function once when the component mounts.\n\n```tsx\nonMount(() => console.log('mounted'));\n```",
    },
    parameters: [
      { label: "fn: () => void", documentation: "Function to run on mount" },
    ],
  }],
  ["onCleanup", {
    label: "onCleanup(fn: () => void): void",
    documentation: {
      kind: "markdown",
      value: "Registers a cleanup function for the current reactive scope.\n\n```tsx\nonCleanup(() => clearInterval(interval));\n```",
    },
    parameters: [
      { label: "fn: () => void", documentation: "Cleanup function" },
    ],
  }],
  ["batch", {
    label: "batch<T>(fn: () => T): T",
    documentation: {
      kind: "markdown",
      value: "Batches multiple signal updates into a single update.\n\n```tsx\nbatch(() => {\n  setCount(1);\n  setName('test');\n});\n```",
    },
    parameters: [
      { label: "fn: () => T", documentation: "Function containing updates to batch" },
    ],
  }],
  ["untrack", {
    label: "untrack<T>(fn: () => T): T",
    documentation: {
      kind: "markdown",
      value: "Reads signals without tracking them as dependencies.\n\n```tsx\nconst value = untrack(() => count());\n```",
    },
    parameters: [
      { label: "fn: () => T", documentation: "Function to execute without tracking" },
    ],
  }],
  ["on", {
    label: "on<S, T>(deps: S, fn: (input: S, prevInput: S, prev: T) => T, options?: OnOptions): (prev: T) => T",
    documentation: {
      kind: "markdown",
      value: "Creates an effect with explicit dependencies.\n\n```tsx\ncreateEffect(on(count, (value) => console.log(value)));\n```",
    },
    parameters: [
      { label: "deps: S", documentation: "Signal(s) to depend on (NOT called!)" },
      { label: "fn: (input: S, prevInput: S, prev: T) => T", documentation: "Effect callback" },
      { label: "options?: OnOptions", documentation: "Optional: { defer: boolean }" },
    ],
  }],
]);

/**
 * Handle textDocument/signatureHelp request.
 *
 * Delegates to TypeScript's language service for signature info,
 * then overlays Solid-specific documentation when the callee is
 * a known Solid primitive.
 */
export function handleSignatureHelp(
  params: SignatureHelpParams,
  ctx: HandlerContext,
): SignatureHelp | null {
  const path = uriToPath(params.textDocument.uri);
  const tsFile = ctx.getTSFileInfo(path);
  if (!tsFile) return null;
  const { ls, sf } = tsFile;

  const offset = positionToOffset(sf, params.position);

  const items = ls.getSignatureHelpItems(path, offset, undefined);
  if (!items || items.items.length === 0) return null;

  const signatures = new Array<SignatureInformation>(items.items.length);
  const separator = ts.displayPartsToString(items.items[0]?.separatorDisplayParts);

  for (let i = 0; i < items.items.length; i++) {
    const item = items.items[i];
    if (!item) continue;

    /** Check for Solid signature overlay */
    const name = item.prefixDisplayParts.length > 0
      ? extractFunctionName(item.prefixDisplayParts)
      : "";
    const solidSig = SOLID_SIGNATURES.get(name);

    if (solidSig) {
      signatures[i] = solidSig;
      continue;
    }

    /** Build the display label from TS parts */
    const prefix = ts.displayPartsToString(item.prefixDisplayParts);
    const suffix = ts.displayPartsToString(item.suffixDisplayParts);
    const paramLabels = new Array<string>(item.parameters.length);
    for (let p = 0; p < item.parameters.length; p++) {
      const paramItem = item.parameters[p];
      if (!paramItem) continue;
      paramLabels[p] = ts.displayPartsToString(paramItem.displayParts);
    }
    const label = prefix + paramLabels.join(separator) + suffix;

    /** Build parameter infos */
    const parameters = new Array<ParameterInformation>(item.parameters.length);
    for (let p = 0; p < item.parameters.length; p++) {
      const param = item.parameters[p];
      if (!param) continue;
      const doc = param.documentation.length > 0
        ? ts.displayPartsToString(param.documentation)
        : undefined;
      const paramInfo: ParameterInformation = { label: paramLabels[p] ?? "" };
      if (doc !== undefined) paramInfo.documentation = doc;
      parameters[p] = paramInfo;
    }

    const documentation = item.documentation.length > 0
      ? ts.displayPartsToString(item.documentation)
      : undefined;

    const sigInfo: SignatureInformation = { label, parameters };
    if (documentation !== undefined) sigInfo.documentation = documentation;
    signatures[i] = sigInfo;
  }

  return {
    signatures,
    activeSignature: items.selectedItemIndex,
    activeParameter: items.argumentIndex,
  };
}

/**
 * Extract function name from TS display parts.
 * The prefix typically looks like "functionName(" — we want just the name.
 */
function extractFunctionName(parts: readonly { text: string }[]): string {
  const segments: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const text = part.text;
    if (text === "(") break;
    segments.push(text);
  }
  const raw = segments.join("");
  /** Strip any leading qualifiers (e.g. "import1.") */
  const dot = raw.lastIndexOf(".");
  return dot >= 0 ? raw.slice(dot + 1).trim() : raw.trim();
}
