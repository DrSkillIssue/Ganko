/**
 * Server Module Exports
 *
 * Re-exports the LSP server components.
 */

export {
  type ServerContext,
  createServer,
  startServer,
  main,
} from "./connection";

export {
  buildServerCapabilities,
  buildMinimalCapabilities,
  COMPLETION_TRIGGER_CHARS,
  CODE_ACTION_KINDS,
} from "./capabilities";

export * from "./handlers";
