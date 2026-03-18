/**
 * Logger Unit Tests
 *
 * Covers prefixLogger, createFileWriter, createCompositeWriter,
 * and createStderrWriter.
 */
import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { prefixLogger, createLogger, noopLogger, Level } from "@drskillissue/ganko-shared";
import type { LogWriter } from "@drskillissue/ganko-shared";
import { createFileWriter, createCompositeWriter } from "../../src/core/logger";

const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

describe("prefixLogger", () => {
  it("prepends prefix to all log methods", () => {
    const calls: string[] = [];
    const writer: LogWriter = {
      trace(m) { calls.push(`trace:${m}`); },
      debug(m) { calls.push(`debug:${m}`); },
      info(m) { calls.push(`info:${m}`); },
      warning(m) { calls.push(`warning:${m}`); },
      error(m) { calls.push(`error:${m}`); },
      critical(m) { calls.push(`critical:${m}`); },
    };
    const root = createLogger(writer, "trace");
    const prefixed = prefixLogger(root, "cache");

    prefixed.trace("hit");
    prefixed.debug("miss");
    prefixed.info("built");
    prefixed.warning("stale");
    prefixed.error("failed");
    prefixed.critical("crash");

    expect(calls).toEqual([
      "trace:[cache] hit",
      "debug:[cache] miss",
      "info:[cache] built",
      "warning:[cache] stale",
      "error:[cache] failed",
      "critical:[cache] crash",
    ]);
  });

  it("delegates isLevelEnabled and level to underlying logger", () => {
    const root = createLogger({
      trace() {}, debug() {}, info() {},
      warning() {}, error() {}, critical() {},
    }, "warning");
    const prefixed = prefixLogger(root, "gc");

    expect(prefixed.isLevelEnabled(Level.Warning)).toBe(true);
    expect(prefixed.isLevelEnabled(Level.Debug)).toBe(false);
    expect(prefixed.level).toBe("warning");
  });

  it("reflects level changes on the root logger", () => {
    const root = createLogger({
      trace() {}, debug() {}, info() {},
      warning() {}, error() {}, critical() {},
    }, "info");
    const prefixed = prefixLogger(root, "gc");

    expect(prefixed.level).toBe("info");
    root.setLevel("error");
    expect(prefixed.level).toBe("error");
  });

  it("returns isLevelEnabled=false when wrapping noopLogger", () => {
    const prefixed = prefixLogger(noopLogger, "test");
    expect(prefixed.isLevelEnabled(Level.Trace)).toBe(false);
    expect(prefixed.level).toBe("off");
  });

  it("passes error parameter through to underlying logger", () => {
    const captured: Array<{ msg: string; err: string }> = [];
    const writer: LogWriter = {
      trace() {}, debug() {}, info() {}, warning() {},
      error(m) { captured.push({ msg: m, err: "" }); },
      critical(m) { captured.push({ msg: m, err: "" }); },
    };
    const root = createLogger(writer, "error");
    const prefixed = prefixLogger(root, "test");

    const testErr = new Error("boom");
    prefixed.error("operation failed", testErr);

    expect(captured).toHaveLength(1);
    expect(captured[0]?.msg).toContain("[test] operation failed");
    expect(captured[0]?.msg).toContain("boom");
  });
});

describe("createCompositeWriter", () => {
  function mockWriter(): { writer: LogWriter; calls: string[] } {
    const calls: string[] = [];
    const writer: LogWriter = {
      trace(m) { calls.push(`trace:${m}`); },
      debug(m) { calls.push(`debug:${m}`); },
      info(m) { calls.push(`info:${m}`); },
      warning(m) { calls.push(`warning:${m}`); },
      error(m) { calls.push(`error:${m}`); },
      critical(m) { calls.push(`critical:${m}`); },
    };
    return { writer, calls };
  }

  it("fans out all methods to all writers", () => {
    const a = mockWriter();
    const b = mockWriter();
    const composite = createCompositeWriter(a.writer, b.writer);

    composite.trace("t");
    composite.debug("d");
    composite.info("i");
    composite.warning("w");
    composite.error("e");
    composite.critical("c");

    const expected = ["trace:t", "debug:d", "info:i", "warning:w", "error:e", "critical:c"];
    expect(a.calls).toEqual(expected);
    expect(b.calls).toEqual(expected);
  });

  it("works with a single writer", () => {
    const a = mockWriter();
    const composite = createCompositeWriter(a.writer);

    composite.info("hello");
    expect(a.calls).toEqual(["info:hello"]);
  });

  it("works with three writers", () => {
    const a = mockWriter();
    const b = mockWriter();
    const c = mockWriter();
    const composite = createCompositeWriter(a.writer, b.writer, c.writer);

    composite.error("fail");
    expect(a.calls).toEqual(["error:fail"]);
    expect(b.calls).toEqual(["error:fail"]);
    expect(c.calls).toEqual(["error:fail"]);
  });
});

describe("createFileWriter", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes log lines to file", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ganko-log-test-"));
    const logPath = join(tempDir, "test.log");
    const { writer, close } = createFileWriter(logPath);

    writer.info("hello world");
    writer.error("something broke");
    await close();

    const content = readFileSync(logPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("[info] hello world");
    expect(lines[1]).toContain("[error] something broke");
  });

  it("includes ISO timestamp in each line", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ganko-log-test-"));
    const logPath = join(tempDir, "timestamp.log");
    const { writer, close } = createFileWriter(logPath);

    writer.debug("ts check");
    await close();

    const content = readFileSync(logPath, "utf-8").trim();
    expect(content).toMatch(ISO_TIMESTAMP_RE);
  });

  it("appends to existing file", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ganko-log-test-"));
    const logPath = join(tempDir, "append.log");

    const first = createFileWriter(logPath);
    first.writer.info("first");
    await first.close();

    const second = createFileWriter(logPath);
    second.writer.info("second");
    await second.close();

    const content = readFileSync(logPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("first");
    expect(lines[1]).toContain("second");
  });

  it("writes all log levels with correct tags", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ganko-log-test-"));
    const logPath = join(tempDir, "levels.log");
    const { writer, close } = createFileWriter(logPath);

    writer.trace("t");
    writer.debug("d");
    writer.info("i");
    writer.warning("w");
    writer.error("e");
    writer.critical("c");
    await close();

    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("[trace] t");
    expect(content).toContain("[debug] d");
    expect(content).toContain("[info] i");
    expect(content).toContain("[warning] w");
    expect(content).toContain("[error] e");
    expect(content).toContain("[CRITICAL] c");
  });
});
