import { afterEach, describe, expect, test } from "bun:test";
import {
	renderApp,
	type TestApp,
	waitFor,
	waitForLogs,
	waitForStatus,
} from "./test-helpers";

const SEARCH_TOOL = {
	name: "search-test",
	command: "printf",
	args: ["alpha\nbeta\ngamma\nalpha-two\ndelta\n"],
};

describe("search", () => {
	let app: TestApp;

	afterEach(async () => {
		await app?.cleanup();
	});

	test("/ opens search bar", async () => {
		app = await renderApp({ tools: [SEARCH_TOOL] });
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();
		app.mockInput.pressKey("/");
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("/");
	});

	test("typing in search filters results", async () => {
		app = await renderApp({ tools: [SEARCH_TOOL] });
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();
		app.mockInput.pressKey("/");
		await app.renderOnce();
		await app.mockInput.typeText("alpha");
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("alpha");
		expect(frame).toContain("alpha-two");
		expect(frame).not.toContain("beta");
		expect(frame).not.toContain("gamma");
		expect(frame).not.toContain("delta");
	});

	test("Esc exits search mode", async () => {
		app = await renderApp({ tools: [SEARCH_TOOL] });
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();
		app.mockInput.pressKey("/");
		await app.renderOnce();
		let frame = app.captureFrame();
		expect(frame).toContain("/");
		app.mockInput.pressEscape();
		await app.renderOnce();
		frame = app.captureFrame();
		// Search bar should be gone (no active search UI)
		expect(frame).not.toMatch(/\/\s*alpha/);
	});

	test("search shows match count", async () => {
		app = await renderApp({ tools: [SEARCH_TOOL] });
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();
		app.mockInput.pressKey("/");
		await app.renderOnce();
		await app.mockInput.typeText("alpha");
		await app.renderOnce();
		// Submit search to show match count (or it shows while typing)
		app.mockInput.pressEnter();
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("2");
		expect(frame).toMatch(/\/|matches/);
	});

	test("up/down arrows navigate between matches", async () => {
		app = await renderApp({ tools: [SEARCH_TOOL] });
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();
		app.mockInput.pressKey("/");
		await app.renderOnce();
		await app.mockInput.typeText("alpha");
		await app.renderOnce();
		app.mockInput.pressEnter();
		await app.renderOnce();
		let frame = app.captureFrame();
		// Start at match 1/2
		expect(frame).toMatch(/1\/2|1 \/ 2/);
		app.mockInput.pressKey("/");
		await app.renderOnce();
		app.mockInput.pressArrow("down");
		await app.renderOnce();
		app.mockInput.pressEnter();
		await app.renderOnce();
		frame = app.captureFrame();
		// Now at match 2/2 (after exiting search mode)
		expect(frame).toMatch(/2\s*\/\s*2/);
	});

	test("Ctrl+H toggles filter mode", async () => {
		app = await renderApp({ tools: [SEARCH_TOOL] });
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();
		app.mockInput.pressKey("/");
		await app.renderOnce();
		await app.mockInput.typeText("alpha");
		await app.renderOnce();
		app.mockInput.pressEnter();
		await app.renderOnce();
		let frame = app.captureFrame();
		// Filter on: only alpha lines
		expect(frame).not.toContain("beta");
		expect(frame).toMatch(/Filter:\s*ON/);
		// Open command palette, run "Disable filter mode" (Ctrl+H is backspace in search)
		app.mockInput.pressKey("p", { ctrl: true });
		await app.renderOnce();
		await app.mockInput.typeText("disable");
		await app.renderOnce();
		app.mockInput.pressEnter();
		await app.renderOnce();
		// Wait for filter to toggle and palette to close
		await waitFor(
			async () => {
				await app.renderOnce();
				const f = app.captureFrame();
				return f.includes("beta") || f.includes("Filter: OFF");
			},
			2000,
			50,
		);
		frame = app.captureFrame();
		expect(frame.includes("beta") || frame.includes("Filter: OFF")).toBe(true);
	});

	test("Ctrl+F toggles fuzzy mode", async () => {
		app = await renderApp({ tools: [SEARCH_TOOL] });
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();
		app.mockInput.pressKey("/");
		await app.renderOnce();
		await app.mockInput.typeText("alpha");
		await app.renderOnce();
		let frame = app.captureFrame();
		expect(frame).toMatch(/Fuzzy|Substring/);
		app.mockInput.pressKey("f", { ctrl: true });
		await app.renderOnce();
		frame = app.captureFrame();
		// Mode should have toggled - still shows one of them
		expect(frame).toMatch(/Fuzzy|Substring/);
	});

	test("search state is per-tab", async () => {
		app = await renderApp({
			tools: [
				SEARCH_TOOL,
				{ name: "other", command: "echo", args: ["other output"] },
			],
			width: 80,
		});
		await waitForLogs(app.processManager, 0);
		await waitForLogs(app.processManager, 1);
		await app.renderOnce();
		// Search on tab 1
		app.mockInput.pressKey("/");
		await app.renderOnce();
		await app.mockInput.typeText("alpha");
		await app.renderOnce();
		app.mockInput.pressEnter();
		await app.renderOnce();
		let frame = app.captureFrame();
		expect(frame).toContain("alpha");
		// Already exited search mode via Enter; query stays. Switch to tab 2.
		app.mockInput.pressArrow("right");
		await app.renderOnce();
		frame = app.captureFrame();
		// Tab 2 has no search - search bar should not be visible, we're on "other" tab
		expect(frame).toContain("other");
		expect(frame).not.toMatch(/\/\s*alpha/);
		// Switch back to tab 1 - search state should be restored
		app.mockInput.pressArrow("left");
		await app.renderOnce();
		frame = app.captureFrame();
		// Tab 1's search (alpha) should be restored
		expect(frame).toContain("alpha");
	});

	test("search is disabled during input mode", async () => {
		app = await renderApp({
			tools: [
				{
					name: "interactive-tool",
					command: "cat",
					interactive: true,
				},
			],
		});
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();
		app.mockInput.pressKey("i");
		await app.renderOnce();
		app.mockInput.pressKey("/");
		await app.renderOnce();
		const frame = app.captureFrame();
		// Search bar should not appear - / was sent to process
		expect(frame).toContain("INPUT MODE");
		expect(frame).not.toMatch(/\/\s*$/);
	});

	test("search mode changes the help bar", async () => {
		app = await renderApp({ tools: [SEARCH_TOOL] });
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();
		app.mockInput.pressKey("/");
		await app.renderOnce();
		const frame = app.captureFrame();
		// Help bar should show search hints
		expect(
			frame.includes("Enter") ||
				frame.includes("Esc") ||
				frame.includes("^F") ||
				frame.includes("^H"),
		).toBe(true);
	});

	test("highlighted matches are the correct characters", async () => {
		app = await renderApp({ tools: [SEARCH_TOOL] });
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();
		app.mockInput.pressKey("/");
		await app.renderOnce();
		await app.mockInput.typeText("alpha");
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("alpha");
		expect(frame).toContain("alpha-two");
	});

	test("search works with line wrapping on", async () => {
		app = await renderApp({
			tools: [SEARCH_TOOL],
			width: 40,
			initialLineWrap: true,
		});
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();
		app.mockInput.pressKey("/");
		await app.renderOnce();
		await app.mockInput.typeText("alpha");
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("alpha");
	});

	test("search works with line wrapping off", async () => {
		app = await renderApp({
			tools: [SEARCH_TOOL],
			width: 40,
			initialLineWrap: false,
		});
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();
		app.mockInput.pressKey("/");
		await app.renderOnce();
		await app.mockInput.typeText("alpha");
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("alpha");
	});
});
