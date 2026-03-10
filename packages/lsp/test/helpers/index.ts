/**
 * Test Helpers Index
 *
 * Re-exports all test utilities from a single module.
 */

// Test server
export { TestServer, createTestServer, type PrepareRenameResult } from "./test-server";

// LSP protocol client
export { LSPClient, type PublishedDiagnostics } from "./lsp-client";

// Server pool
export { ServerPool, serverPool, createServerPool } from "./server-pool";

// Position utilities
export {
  parseMarker,
  parseMarkers,
  findPosition,
  findNthPosition,
  findAllPositions,
  offsetToPosition,
  positionToOffset,
  range,
  wordRange,
  pointRange,
  lineRange,
  positionsEqual,
  rangesEqual,
  positionInRange,
  type MarkerResult,
} from "./position";

// Assertions
export {
  customMatchers,
  assertContainsUri,
  assertLocationCount,
  assertAtLine,
  assertRange,
  assertPosition,
  type LocationMatcher,
} from "./assertions";
