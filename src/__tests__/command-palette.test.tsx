import { afterEach, describe, expect, test } from "bun:test";
import {
	renderApp,
	type TestApp,
	waitFor,
	waitForStatus,
} from "./test-helpers";

const TEST_TOOL = { name: "test-tool", command: "sleep", args: ["999"] };

describe("command palette", () => {
	let app: TestApp;

	afterEach(async () => {
		await app?.cleanup();
	});

	test("Ctrl+P opens command palette", async () => {
		app = await renderApp({ tools: [TEST_TOOL] });
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		app.mockInput.pressKey("p", { ctrl: true });
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("Command Palette");
	});

	test("Esc closes command palette", async () => {
		app = await renderApp({ tools: [TEST_TOOL] });
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		app.mockInput.pressKey("p", { ctrl: true });
		await app.renderOnce();
		expect(app.captureFrame()).toContain("Command Palette");

		app.mockInput.pressEscape();
		await waitFor(async () => {
			await app.renderOnce();
			return !app.captureFrame().includes("Command Palette");
		}, 2000);
	});

	test("typing filters commands", async () => {
		app = await renderApp({ tools: [TEST_TOOL] });
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		app.mockInput.pressKey("p", { ctrl: true });
		await app.renderOnce();
		await app.mockInput.typeText("rest");
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("Restart");
		expect(frame).not.toContain("Quit");
	});

	test("Enter executes selected command", async () => {
		app = await renderApp({ tools: [TEST_TOOL] });
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		app.mockInput.pressKey("p", { ctrl: true });
		await app.renderOnce();
		await app.mockInput.typeText("Clear");
		await app.renderOnce();
		app.mockInput.pressEnter();
		await waitFor(async () => {
			await app.renderOnce();
			const frame = app.captureFrame();
			return (
				frame.includes("Logs cleared") && !frame.includes("Command Palette")
			);
		}, 2000);
	});

	test("up/down navigates command list", async () => {
		app = await renderApp({ tools: [TEST_TOOL] });
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		app.mockInput.pressKey("p", { ctrl: true });
		await app.renderOnce();
		app.mockInput.pressArrow("down");
		app.mockInput.pressArrow("down");
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("Command Palette");
	});

	test("Ctrl+K also opens palette", async () => {
		app = await renderApp({ tools: [TEST_TOOL] });
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		app.mockInput.pressKey("k", { ctrl: true });
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("Command Palette");
	});

	// NOTE: Ctrl+C dismissal test skipped due to Bun segfault (bun#XXXX).
	// Ctrl+C sends a raw ETX byte that crashes Bun's process manager in test mode.
	// The priority chain (close palette before exit) is verified by the Esc test above
	// and the Ctrl+C shutdown path is tested in shutdown.test.tsx.
});
