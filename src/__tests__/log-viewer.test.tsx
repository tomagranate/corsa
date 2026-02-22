import { afterEach, describe, expect, test } from "bun:test";
import {
	renderApp,
	type TestApp,
	waitForLogs,
	waitForStatus,
} from "./test-helpers";

describe("log viewer", () => {
	let app: TestApp;

	afterEach(async () => {
		await app?.cleanup();
	});

	test("displays process output - echo prints text, frame contains it", async () => {
		app = await renderApp({
			tools: [{ name: "echo-tool", command: "echo", args: ["hello world"] }],
		});
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("hello world");
	});

	test("shows line numbers with showLineNumbers always", async () => {
		app = await renderApp({
			tools: [{ name: "echo-tool", command: "echo", args: ["line one"] }],
			config: { ui: { showLineNumbers: true } },
			width: 40,
		});
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("1│");
	});

	test("hides line numbers when never", async () => {
		app = await renderApp({
			tools: [{ name: "echo-tool", command: "echo", args: ["line one"] }],
			config: { ui: { showLineNumbers: false } },
			width: 120,
		});
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).not.toContain("1│");
	});

	test("shows scroll indicators when content overflows", async () => {
		const manyLines = Array.from(
			{ length: 100 },
			(_, i) => `line ${i + 1}`,
		).join("\n");
		app = await renderApp({
			tools: [
				{
					name: "printf-tool",
					command: "printf",
					args: [manyLines],
				},
			],
			width: 80,
			height: 12,
		});
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();
		// Wait for scroll info to update (polled every 100ms)
		await new Promise((r) => setTimeout(r, 150));
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("more");
	});

	test("line wrapping renders all characters across wrapped rows", async () => {
		const longString = "ABCDEFGHIJ".repeat(10);
		app = await renderApp({
			tools: [
				{
					name: "echo-tool",
					command: "echo",
					args: ["-n", longString],
				},
			],
			width: 40,
			initialLineWrap: true,
		});
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();
		const frame = app.captureFrame();
		for (const char of longString) {
			expect(frame).toContain(char);
		}
	});

	test("no wrapping truncates long lines", async () => {
		const longString = "ABCDEFGHIJ".repeat(10);
		app = await renderApp({
			tools: [
				{
					name: "echo-tool",
					command: "echo",
					args: ["-n", longString],
				},
			],
			width: 40,
			initialLineWrap: false,
		});
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();
		const frame = app.captureFrame();
		// When truncating, not all characters are visible (ellipsis cuts off)
		const visibleChars = frame.replace(/\s+/g, "");
		expect(visibleChars).not.toContain(longString);
	});

	test("w key toggles line wrap", async () => {
		const longString = "ABCDEFGHIJ".repeat(10);
		app = await renderApp({
			tools: [
				{
					name: "echo-tool",
					command: "echo",
					args: ["-n", longString],
				},
			],
			width: 40,
			initialLineWrap: true,
		});
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();
		const frameBefore = app.captureFrame();
		// With wrap on, full string should be present (as chars)
		expect(frameBefore).toContain("J");

		app.mockInput.pressKey("w");
		await app.renderOnce();
		const frameAfter = app.captureFrame();
		// After toggle, wrap is off - line is truncated (not all chars visible)
		expect(frameAfter).not.toContain("ABCDEFGHIJABCDEFGHIJABCDEFGHIJ");
	});

	test("empty state shows message", async () => {
		app = await renderApp({
			tools: [{ name: "sleep-tool", command: "sleep", args: ["999"] }],
		});
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("Waiting for output");
	});

	test("stderr lines are visually distinct", async () => {
		app = await renderApp({
			tools: [
				{
					name: "stderr-tool",
					command: "sh",
					args: ["-c", "echo stderr >&2"],
				},
			],
		});
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("stderr");
	});

	test("line wrapping preserves all content across rows", async () => {
		const knownString = "ABCDEFGHIJ".repeat(10);
		app = await renderApp({
			tools: [
				{
					name: "echo-tool",
					command: "echo",
					args: ["-n", knownString],
				},
			],
			width: 40,
			initialLineWrap: true,
		});
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();
		const frame = app.captureFrame();
		// With line wrap, content is preserved across wrapped rows - pattern appears multiple times
		const matches = frame.match(/ABCDEFGHIJ/g) ?? [];
		expect(matches.length).toBeGreaterThanOrEqual(2);
	});
});
