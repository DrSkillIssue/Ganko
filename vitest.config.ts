import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /*
     * Both projects share a single worker pool with 6 threads.
     *
     * Ganko tests are CPU-bound (ts.createProgram per test) and run with
     * isolate: false so the module graph is loaded once per worker instead
     * of once per test file — cutting import overhead from ~70s to ~7s.
     *
     * LSP integration tests spawn child processes and are I/O-bound.
     * Running both concurrently in 6 shared workers keeps CPU contention
     * low enough that ganko's cross-file tests (which create multi-file
     * ts.Programs taking 3-7s each) don't timeout under pressure.
     */
    maxWorkers: 6,
    projects: [
      {
        test: {
          name: "ganko",
          root: "./packages/ganko",
          include: ["test/**/*.test.ts"],
          pool: "threads",
          isolate: false,
        },
      },
      {
        test: {
          name: "lsp",
          root: "./packages/lsp",
          include: ["test/**/*.test.ts"],
          setupFiles: ["test/setup.ts"],
          testTimeout: 30000,
          hookTimeout: 30000,
        },
      },
    ],
  },
});
