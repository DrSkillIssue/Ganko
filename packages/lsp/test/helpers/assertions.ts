/**
 * Custom Vitest Matchers for LSP Testing
 *
 * Extends expect() with LSP-specific assertions.
 */

import type { Location, Range, Position } from "vscode-languageserver";
import { expect } from "vitest";

/**
 * Location matcher options.
 */
export interface LocationMatcher {
  uri?: string;
  line?: number;
  character?: number;
}

/**
 * Check if a location matches the expected values.
 */
function locationMatches(location: Location, expected: LocationMatcher): boolean {
  if (expected.uri !== undefined && !location.uri.includes(expected.uri)) {
    return false;
  }
  if (expected.line !== undefined && location.range.start.line !== expected.line) {
    return false;
  }
  if (expected.character !== undefined && location.range.start.character !== expected.character) {
    return false;
  }
  return true;
}

/**
 * Check if two ranges are equal.
 */
function rangesEqual(a: Range, b: Range): boolean {
  return (
    a.start.line === b.start.line &&
    a.start.character === b.start.character &&
    a.end.line === b.end.line &&
    a.end.character === b.end.character
  );
}

/**
 * Custom matchers for vitest.
 */
export const customMatchers = {
  /**
   * Check if value is a location matching expected criteria.
   */
  toHaveLocation(received: Location | Location[] | null, expected: LocationMatcher) {
    if (received === null) {
      return {
        pass: false,
        message: () => "Expected location but received null",
      };
    }

    const locations = Array.isArray(received) ? received : [received];

    if (locations.length === 0) {
      return {
        pass: false,
        message: () => "Expected location but received empty array",
      };
    }

    const hasMatch = locations.some((loc) => locationMatches(loc, expected));

    return {
      pass: hasMatch,
      message: () =>
        hasMatch
          ? `Expected locations not to match ${JSON.stringify(expected)}`
          : `Expected locations to match ${JSON.stringify(expected)}, received: ${JSON.stringify(
              locations.map((l) => ({
                uri: l.uri,
                line: l.range.start.line,
                character: l.range.start.character,
              })),
            )}`,
    };
  },

  /**
   * Check if value has a specific range.
   */
  toHaveRange(received: { range: Range } | null, expected: Range) {
    if (received === null) {
      return {
        pass: false,
        message: () => "Expected range but received null",
      };
    }

    const pass = rangesEqual(received.range, expected);

    return {
      pass,
      message: () =>
        pass
          ? `Expected range not to equal ${JSON.stringify(expected)}`
          : `Expected range to equal ${JSON.stringify(expected)}, received: ${JSON.stringify(
              received.range,
            )}`,
    };
  },

  /**
   * Check if locations array contains a location matching criteria.
   */
  toContainLocation(received: Location[] | null, expected: LocationMatcher) {
    if (received === null) {
      return {
        pass: false,
        message: () => "Expected locations but received null",
      };
    }

    const hasMatch = received.some((loc) => locationMatches(loc, expected));

    return {
      pass: hasMatch,
      message: () =>
        hasMatch
          ? `Expected locations not to contain ${JSON.stringify(expected)}`
          : `Expected locations to contain ${JSON.stringify(expected)}, received ${received.length} locations`,
    };
  },

  /**
   * Check if a location matches a specific file path.
   */
  toHaveUri(received: Location | Location[] | null, expectedUri: string) {
    if (received === null) {
      return {
        pass: false,
        message: () => "Expected location but received null",
      };
    }

    const locations = Array.isArray(received) ? received : [received];
    const hasMatch = locations.some((loc) => loc.uri.includes(expectedUri));

    return {
      pass: hasMatch,
      message: () =>
        hasMatch
          ? `Expected locations not to include URI containing "${expectedUri}"`
          : `Expected locations to include URI containing "${expectedUri}", received: ${locations.map((l) => l.uri).join(", ")}`,
    };
  },
};

/**
 * Assert that locations contain a file path.
 */
export function assertContainsUri(locations: Location[] | null, uri: string): void {
  expect(locations).not.toBeNull();
  const hasMatch = locations!.some((loc) => loc.uri.includes(uri));
  expect(hasMatch).toBe(true);
}

/**
 * Assert that locations have a specific count.
 */
export function assertLocationCount(locations: Location[] | null, count: number): void {
  expect(locations).not.toBeNull();
  expect(locations!.length).toBe(count);
}

/**
 * Assert that a location is at a specific line.
 */
export function assertAtLine(location: Location | null, line: number): void {
  expect(location).not.toBeNull();
  expect(location!.range.start.line).toBe(line);
}

/**
 * Assert that a range matches expected values.
 */
export function assertRange(
  actual: Range,
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number,
): void {
  expect(actual.start.line).toBe(startLine);
  expect(actual.start.character).toBe(startChar);
  expect(actual.end.line).toBe(endLine);
  expect(actual.end.character).toBe(endChar);
}

/**
 * Assert that a position matches expected values.
 */
export function assertPosition(actual: Position, line: number, character: number): void {
  expect(actual.line).toBe(line);
  expect(actual.character).toBe(character);
}

/**
 * Declare custom matchers for TypeScript.
 */
declare module "vitest" {
  interface Assertion<T> {
    toHaveLocation(expected: LocationMatcher): T;
    toHaveRange(expected: Range): T;
    toContainLocation(expected: LocationMatcher): T;
    toHaveUri(expectedUri: string): T;
  }
}
