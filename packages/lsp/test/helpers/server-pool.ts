/**
 * Server Pool for Parallel Test Execution
 *
 * Pool of test servers for running tests in parallel without interference.
 * Each server maintains its own project state and file system.
 */

import { TestServer, createTestServer } from "./test-server";

/**
 * Pool of test servers for parallel test execution.
 */
export class ServerPool {
  private readonly available: TestServer[] = [];
  private readonly inUse: Set<TestServer> = new Set();
  private readonly maxSize: number;
  private readonly waitQueue: Array<(server: TestServer) => void> = [];

  constructor(maxSize: number = 4) {
    this.maxSize = maxSize;
  }

  /**
   * Get the current pool size.
   */
  get size(): number {
    return this.available.length + this.inUse.size;
  }

  /**
   * Get the number of available servers.
   */
  get availableCount(): number {
    return this.available.length;
  }

  /**
   * Get the number of servers in use.
   */
  get inUseCount(): number {
    return this.inUse.size;
  }

  /**
   * Acquire a server from the pool.
   *
   * Returns an available server, creates a new one if under the limit,
   * or waits for one to become available.
   */
  async acquire(): Promise<TestServer> {
    // Check for available server
    if (this.available.length > 0) {
      const server = this.available.pop()!;
      this.inUse.add(server);
      return server;
    }

    // Create new if under limit
    if (this.inUse.size < this.maxSize) {
      const server = createTestServer();
      this.inUse.add(server);
      return server;
    }

    // Wait for one to become available
    return new Promise<TestServer>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  /**
   * Release a server back to the pool.
   *
   * Clears the server state and either gives it to a waiting consumer
   * or adds it back to the available pool.
   */
  release(server: TestServer): void {
    this.inUse.delete(server);
    server.clear();

    // If there's a waiting consumer, give them the server directly
    if (this.waitQueue.length > 0) {
      const resolve = this.waitQueue.shift()!;
      this.inUse.add(server);
      resolve(server);
      return;
    }

    // Otherwise add back to available pool
    this.available.push(server);
  }

  /**
   * Execute a function with an acquired server.
   *
   * Automatically acquires a server, runs the function, and releases
   * the server when done (even if the function throws).
   */
  async withServer<T>(fn: (server: TestServer) => T | Promise<T>): Promise<T> {
    const server = await this.acquire();
    try {
      return await fn(server);
    } finally {
      this.release(server);
    }
  }

  /**
   * Dispose all servers in the pool.
   *
   * Should be called during test teardown to clean up resources.
   */
  dispose(): void {
    // Clear waiting queue with empty servers
    for (const resolve of this.waitQueue) {
      const server = createTestServer();
      resolve(server);
    }
    this.waitQueue.length = 0;

    // Clear all pools
    this.available.length = 0;
    this.inUse.clear();
  }

  /**
   * Pre-warm the pool by creating servers up to the max size.
   */
  prewarm(): void {
    while (this.available.length + this.inUse.size < this.maxSize) {
      this.available.push(createTestServer());
    }
  }
}

/**
 * Global pool instance for use across test files.
 */
export const serverPool = new ServerPool();

/**
 * Create a new server pool with a custom size.
 */
export function createServerPool(maxSize: number = 4): ServerPool {
  return new ServerPool(maxSize);
}
