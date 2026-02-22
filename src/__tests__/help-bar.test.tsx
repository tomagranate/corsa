import { afterEach, describe, expect, test } from "bun:test";
import {
	renderApp,
	type TestApp,
	waitFor,
	waitForLogs,
	waitForStatus,
} from "./test-helpers";

const TEST_TOOL = { name: "test-tool", command: "sleep", args: ["999"] };
// Ignores SIGTERM so shutdown UI stays visible for ~2s before natural exit
const SHUTDOWN_TEST_TOOL = {
	name: "test-tool",
	command: "sh",
	args: ["-c", "trap '' TERM; sleep 2"],
};
const SEARCH_TOOL = { name: "test-tool", command: "printf", args: ["hello\n"] };
const INTERACTIVE_TOOL = {
	name: "cat-tool",
	command: "cat",
	interactive: true,
};

function getHelpBarLine(frame: string): string {
	const lines = frame.split("\n").filter(Boolean);
	return lines[lines.length - 1] ?? "";
}

describe("help bar", () => {
	let app: TestApp;

	afterEach(async () => {
		await app?.cleanup();
	});

	test("shows shutdown hint during shutdown", async () => {
		app = await renderApp({ tools: [SHUTDOWN_TEST_TOOL] });
		await waitForStatus(app.processManager, 0, "running");
		await new Promise((r) => setTimeout(r, 100));
		await app.renderOnce();

		const cleanupPromise = app.processManager.cleanup();
		await waitFor(
			async () => {
				await app.renderOnce();
				const frame = app.captureFrame();
				return (
					frame.includes("force quit") ||
					frame.includes("Ctrl+C") ||
					frame.includes("^C") ||
					frame.includes("quit")
				);
			},
			5000,
			50,
		);

		await cleanupPromise;
	});

	test("shows default hints in normal mode", async () => {
		app = await renderApp({ tools: [TEST_TOOL] });
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		const frame = app.captureFrame();
		const lastLine = getHelpBarLine(frame);
		expect(
			lastLine.includes("Ctrl+P") ||
				lastLine.includes("palette") ||
				lastLine.includes("^P"),
		).toBe(true);
		expect(
			lastLine.includes("?") ||
				lastLine.includes("shortcuts") ||
				lastLine.includes("keys"),
		).toBe(true);
	});

	test("shows search hints in search mode", async () => {
		app = await renderApp({ tools: [SEARCH_TOOL] });
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();

		app.mockInput.pressKey("/");
		await app.renderOnce();

		const frame = app.captureFrame();
		const lastLine = getHelpBarLine(frame);
		expect(
			lastLine.includes("Enter") ||
				lastLine.includes("Esc") ||
				lastLine.includes("^F") ||
				lastLine.includes("^H"),
		).toBe(true);
	});

	test("shows input hints in input mode", async () => {
		app = await renderApp({ tools: [INTERACTIVE_TOOL] });
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		app.mockInput.pressKey("i");
		await app.renderOnce();

		const frame = app.captureFrame();
		const lastLine = getHelpBarLine(frame);
		expect(
			lastLine.includes("exit input") ||
				lastLine.includes("Esc") ||
				lastLine.includes("⎋"),
		).toBe(true);
	});

	test("shows palette hints when palette is open", async () => {
		app = await renderApp({ tools: [TEST_TOOL] });
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		app.mockInput.pressKey("p", { ctrl: true });
		await app.renderOnce();

		const frame = app.captureFrame();
		const lastLine = getHelpBarLine(frame);
		expect(
			lastLine.includes("navigate") ||
				lastLine.includes("select") ||
				lastLine.includes("↑↓") ||
				lastLine.includes("nav") ||
				lastLine.includes("sel"),
		).toBe(true);
	});

	test("responsive formatting at narrow widths", async () => {
		app = await renderApp({
			tools: [TEST_TOOL],
			width: 40,
			height: 40,
		});
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		const frame = app.captureFrame();
		const lastLine = getHelpBarLine(frame);
		// At width 40, hints should still show something (may be compact/truncated)
		expect(lastLine.length).toBeGreaterThan(0);
		expect(
			lastLine.includes("^P") ||
				lastLine.includes("?") ||
				lastLine.includes("/") ||
				lastLine.includes("palette") ||
				lastLine.includes("keys"),
		).toBe(true);
	});
});
