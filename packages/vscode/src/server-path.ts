/**
 * Server module discovery.
 *
 * Pure function: takes extension path, returns server binary path or null.
 */
import path from "node:path";
import fs from "node:fs";

/** Find the bundled ganko server module, or null if missing. */
export function findServerModule(extensionPath: string): string | null {
  const bundled = path.join(extensionPath, "dist", "server", "dist", "entry.js");
  if (fs.existsSync(bundled)) return bundled;
  return null;
}
