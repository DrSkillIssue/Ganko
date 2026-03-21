import { fileURLToPath, pathToFileURL } from "node:url";
import { canonicalPath } from "./path";

/**
 * URI schemes the server handles.
 * Only `file` scheme URIs produce analyzable paths.
 */
export type SupportedScheme = "file";

/**
 * Validate and convert a URI to a canonical file path.
 *
 * Returns null for non-file URIs (git:, untitled:, vscode-notebook-cell:, etc.)
 * so callers can reject unsupported schemes at the LSP boundary.
 *
 * @param uri - URI from the LSP client
 * @returns Canonical file path, or null if the URI scheme is not `file`
 */
export function uriToCanonicalPath(uri: string): string | null {
  if (!uri.startsWith("file:")) return null;
  return canonicalPath(fileURLToPath(uri));
}

/**
 * Convert a canonical file path to a file URI.
 *
 * @param path - Canonical file system path
 * @returns File URI string
 */
export function canonicalPathToUri(path: string): string {
  return pathToFileURL(path).href;
}
