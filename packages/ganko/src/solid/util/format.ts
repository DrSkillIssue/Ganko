/**
 * Formatting Utilities
 *
 * Helper functions for formatting data for display.
 */

/**
 * Truncate text for display in error messages.
 *
 * @param text - The text to truncate
 * @param maxLen - Maximum length before truncation (default: 40)
 * @returns The text, truncated with "..." if longer than maxLen
 */
export function truncateText(text: string, maxLen: number = 40): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 3) + "..."
}

/**
 * Format variable names for display in error messages.
 * Shows up to maxDisplay names, then "+N more".
 *
 * @param variables - Array of variables (or objects with name property)
 * @param maxDisplay - Maximum names to show before truncating (default: 3)
 * @returns Formatted string like "count", "count, items", or "a, b, c, +2 more"
 */
export function formatVariableNames(
  variables: readonly { name: string }[],
  maxDisplay: number = 3,
): string {
  const len = variables.length;
  if (len === 0) return "";
  const first = variables[0];
  if (!first) return "";
  if (len === 1) return first.name;

  const displayLen = Math.min(len, maxDisplay);
  const names: string[] = [];
  for (let i = 0; i < displayLen; i++) {
    const v = variables[i];
    if (!v) continue;
    names.push(v.name);
  }

  return len > maxDisplay ? `${names.join(", ")}, +${len - maxDisplay} more` : names.join(", ");
}
