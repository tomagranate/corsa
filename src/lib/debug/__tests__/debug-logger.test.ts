import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import {
	clearDebugLog,
	createDebugLogger,
	DEFAULT_DEBUG_LOG_FILE,
	debugLog,
	disableDebugLogging,
	enableDebugLogging,
	getDebugLogPath,
	isDebugEnabled,
} from "../debug-logger";

const TEST_LOG_FILE = "/tmp/corsa-debug-test.log";
const CUSTOM_LOG_FILE = "/tmp/custom-log.log";

describe("debug-logger", () => {
	beforeEach(() => {
		// Clean up before each test
		disableDebugLogging();
		if (existsSync(TEST_LOG_FILE)) {
			unlinkSync(TEST_LOG_FILE);
		}
		if (existsSync(CUSTOM_LOG_FILE)) {
			unlinkSync(CUSTOM_LOG_FILE);
		}
	});

	afterEach(() => {
		// Clean up after each test
		disableDebugLogging();
		if (existsSync(TEST_LOG_FILE)) {
			unlinkSync(TEST_LOG_FILE);
		}
		if (existsSync(CUSTOM_LOG_FILE)) {
			unlinkSync(CUSTOM_LOG_FILE);
		}
	});

	describe("enableDebugLogging", () => {
		it("enables debug logging", () => {
			expect(isDebugEnabled()).toBe(false);
			enableDebugLogging(TEST_LOG_FILE);
			expect(isDebugEnabled()).toBe(true);
		});

		it("sets custom log file path", () => {
			enableDebugLogging(TEST_LOG_FILE);
			expect(getDebugLogPath()).toBe(TEST_LOG_FILE);
		});

		it("clears existing log file on enable", () => {
			// Create a log file with content
			enableDebugLogging(TEST_LOG_FILE);
			debugLog("test", "first message");

			// Re-enable should clear it
			enableDebugLogging(TEST_LOG_FILE);
			const content = readFileSync(TEST_LOG_FILE, "utf-8");
			expect(content).toBe("");
		});
	});

	describe("disableDebugLogging", () => {
		it("disables debug logging", () => {
			enableDebugLogging(TEST_LOG_FILE);
			expect(isDebugEnabled()).toBe(true);
			disableDebugLogging();
			expect(isDebugEnabled()).toBe(false);
		});
	});

	describe("debugLog", () => {
		it("writes nothing when disabled", () => {
			disableDebugLogging();
			debugLog("test", "should not appear");
			// File shouldn't exist since we're disabled
			expect(existsSync(TEST_LOG_FILE)).toBe(false);
		});

		it("writes log entry with timestamp and category", () => {
			enableDebugLogging(TEST_LOG_FILE);
			const before = Date.now();
			debugLog("TestCategory", "test message");
			const after = Date.now();

			const content = readFileSync(TEST_LOG_FILE, "utf-8");
			const lines = content.trim().split("\n");
			expect(lines).toHaveLength(1);

			const line = lines[0];
			expect(line).toBeDefined();
			const match = line?.match(/^(\d+) \[(\w+)\] (.+)$/);
			expect(match).not.toBeNull();
			if (!match) throw new Error("match should not be null");

			const [, timestamp, category, message] = match;
			expect(Number(timestamp)).toBeGreaterThanOrEqual(before);
			expect(Number(timestamp)).toBeLessThanOrEqual(after);
			expect(category).toBe("TestCategory");
			expect(message).toBe("test message");
		});

		it("includes data as JSON when provided", () => {
			enableDebugLogging(TEST_LOG_FILE);
			debugLog("test", "with data", { key: "value", num: 42 });

			const content = readFileSync(TEST_LOG_FILE, "utf-8");
			expect(content).toContain('{"key":"value","num":42}');
		});

		it("writes multiple log entries", () => {
			enableDebugLogging(TEST_LOG_FILE);
			debugLog("cat1", "message 1");
			debugLog("cat2", "message 2");
			debugLog("cat1", "message 3");

			const content = readFileSync(TEST_LOG_FILE, "utf-8");
			const lines = content.trim().split("\n");
			expect(lines).toHaveLength(3);
			expect(lines[0]).toContain("[cat1] message 1");
			expect(lines[1]).toContain("[cat2] message 2");
			expect(lines[2]).toContain("[cat1] message 3");
		});
	});

	describe("clearDebugLog", () => {
		it("clears the log file", () => {
			enableDebugLogging(TEST_LOG_FILE);
			debugLog("test", "message 1");
			debugLog("test", "message 2");

			clearDebugLog();

			const content = readFileSync(TEST_LOG_FILE, "utf-8");
			expect(content).toBe("");
		});
	});

	describe("createDebugLogger", () => {
		it("creates a scoped logger with pre-filled category", () => {
			enableDebugLogging(TEST_LOG_FILE);
			const log = createDebugLogger("MyComponent");

			log("first event");
			log("second event", { detail: "info" });

			const content = readFileSync(TEST_LOG_FILE, "utf-8");
			const lines = content.trim().split("\n");
			expect(lines).toHaveLength(2);
			expect(lines[0]).toContain("[MyComponent] first event");
			expect(lines[1]).toContain("[MyComponent] second event");
			expect(lines[1]).toContain('{"detail":"info"}');
		});

		it("does nothing when logging is disabled", () => {
			disableDebugLogging();
			const log = createDebugLogger("Test");
			log("should not appear");
			expect(existsSync(TEST_LOG_FILE)).toBe(false);
		});
	});

	describe("getDebugLogPath", () => {
		it("returns default path when not configured", () => {
			// disableDebugLogging resets to default
			disableDebugLogging();
			expect(getDebugLogPath()).toBe(DEFAULT_DEBUG_LOG_FILE);
			expect(DEFAULT_DEBUG_LOG_FILE.replaceAll("\\", "/")).toEndWith(
				"/corsa/debug.log",
			);
			expect(DEFAULT_DEBUG_LOG_FILE).not.toBe("/tmp/corsa-debug.log");
		});

		it("returns custom path after configuration", () => {
			enableDebugLogging(CUSTOM_LOG_FILE);
			expect(getDebugLogPath()).toBe(CUSTOM_LOG_FILE);
		});
	});
});
