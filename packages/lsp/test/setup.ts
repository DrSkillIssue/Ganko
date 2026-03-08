/**
 * Vitest Test Setup
 *
 * Global test setup and custom matchers for ganko tests.
 */

import { expect, beforeAll, afterAll } from "vitest";
import { customMatchers } from "./helpers/assertions";

expect.extend(customMatchers);

/**
 * Global test configuration.
 */
beforeAll(() => {
  // Any global setup can go here
});

afterAll(() => {
  // Any global cleanup can go here
});
