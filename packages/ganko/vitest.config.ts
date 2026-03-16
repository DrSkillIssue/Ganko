import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: [
            "test/solid/**/*.test.ts",
            "test/css/**/*.test.ts",
            "test/integration/**/*.test.ts",
            "test/cache.test.ts",
          ],
          // isolate: false reuses the module graph across test files within
          // each worker, eliminating redundant lib .d.ts parses.
          // Safe because ganko unit tests never use vi.mock() or vi.spyOn().
          isolate: false,
        },
      },
      {
        test: {
          name: "cross-file",
          include: ["test/cross-file/**/*.test.ts"],
          // Cross-file layout tests build large synthetic ASTs (320 elements,
          // 7 depth levels) and assert tight performance budgets measured via
          // internal wall-clock timers. They need:
          //  - isolate: true  → clean heap, no GC pressure from 1500+ unit tests
          //  - sequence only  → exclusive CPU so internal timers aren't inflated
          //                     by parallel fork contention
          isolate: true,
          testTimeout: 15_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
