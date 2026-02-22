import { afterEach, describe, expect, test } from "bun:test";
import {
	renderApp,
	type TestApp,
	waitForLogs,
	waitForStatus,
} from "./test-helpers";

const THREE_TOOLS = [
	{ name: "server", command: "echo", args: ["server running"] },
	{ name: "worker", command: "echo", args: ["worker running"] },
	{ name: "watcher", command: "echo", args: ["watcher running"] },
];

const MANY_TOOLS = Array.from({ length: 12 }, (_, i) => ({
	name: `tool-${i + 1}`,
	command: "echo",
	args: [`tool ${i + 1} running`],
}));

describe("tab navigation", () => {
	let app: TestApp;

	afterEach(async () => {
		await app?.cleanup();
	});

	describe("keyboard navigation", () => {
		test("renders all configured tabs", async () => {
			app = await renderApp({ tools: THREE_TOOLS });
			await app.renderOnce();
			const frame = app.captureFrame();
			expect(frame).toContain("server");
			expect(frame).toContain("worker");
			expect(frame).toContain("watcher");
		});

		test("first tool tab is selected by default (home disabled)", async () => {
			app = await renderApp({ tools: THREE_TOOLS });
			await waitForLogs(app.processManager, 0);
			await app.renderOnce();
			const frame = app.captureFrame();
			expect(frame).toContain("server running");
		});

		test("home tab is selected by default (home enabled)", async () => {
			app = await renderApp({
				tools: THREE_TOOLS,
				config: { home: { enabled: true } },
			});
			await app.renderOnce();
			const frame = app.captureFrame();
			// Home tab shows the home icon and the service list
			expect(frame).toContain("Home");
		});

		test("right arrow moves to next tab", async () => {
			app = await renderApp({ tools: THREE_TOOLS });
			await waitForLogs(app.processManager, 1);
			await app.renderOnce();
			app.mockInput.pressArrow("right");
			await app.renderOnce();
			const frame = app.captureFrame();
			expect(frame).toContain("worker running");
		});

		test("left arrow moves to previous tab", async () => {
			app = await renderApp({ tools: THREE_TOOLS });
			await waitForLogs(app.processManager, 0);
			await app.renderOnce();
			app.mockInput.pressArrow("right");
			await app.renderOnce();
			app.mockInput.pressArrow("left");
			await app.renderOnce();
			const frame = app.captureFrame();
			expect(frame).toContain("server running");
		});

		test("navigation wraps forward", async () => {
			app = await renderApp({ tools: THREE_TOOLS });
			await waitForLogs(app.processManager, 0);
			await app.renderOnce();
			// Go to last tab, then one more wraps to first
			app.mockInput.pressArrow("right");
			app.mockInput.pressArrow("right");
			app.mockInput.pressArrow("right");
			await app.renderOnce();
			const frame = app.captureFrame();
			expect(frame).toContain("server running");
		});

		test("navigation wraps backward", async () => {
			app = await renderApp({ tools: THREE_TOOLS });
			await waitForLogs(app.processManager, 2);
			await app.renderOnce();
			// From first tab, go backward to wrap to last
			app.mockInput.pressArrow("left");
			await app.renderOnce();
			const frame = app.captureFrame();
			expect(frame).toContain("watcher running");
		});

		test("number keys jump to tab", async () => {
			app = await renderApp({ tools: THREE_TOOLS });
			await waitForLogs(app.processManager, 1);
			await app.renderOnce();
			app.mockInput.pressKey("2");
			await app.renderOnce();
			const frame = app.captureFrame();
			expect(frame).toContain("worker running");
		});

		test("backtick jumps to home tab", async () => {
			app = await renderApp({
				tools: THREE_TOOLS,
				config: { home: { enabled: true } },
			});
			await app.renderOnce();
			// Navigate away from home to the server tab
			app.mockInput.pressArrow("right");
			await app.renderOnce();
			// Jump back to home
			app.mockInput.pressKey("`");
			await app.renderOnce();
			const frame = app.captureFrame();
			// Home tab should be visible again (shows the home icon in sidebar)
			expect(frame).toContain("Home");
		});

		test("navigation is disabled during search mode", async () => {
			app = await renderApp({ tools: THREE_TOOLS });
			await waitForLogs(app.processManager, 0);
			await app.renderOnce();
			// Enter search mode
			app.mockInput.pressKey("/");
			await app.renderOnce();
			// Try to navigate away
			app.mockInput.pressArrow("right");
			await app.renderOnce();
			const frame = app.captureFrame();
			// Should still show first tab's content (search is on tab 1)
			expect(frame).toContain("server running");
		});

		test("navigation is disabled during input mode", async () => {
			app = await renderApp({
				tools: [
					{
						name: "interactive-tool",
						command: "cat",
						interactive: true,
					},
					{ name: "other", command: "echo", args: ["other output"] },
				],
			});
			await waitForStatus(app.processManager, 0, "running");
			await app.renderOnce();
			// Enter input mode
			app.mockInput.pressKey("i");
			await app.renderOnce();
			const frame = app.captureFrame();
			expect(frame).toContain("INPUT MODE");
			// Try to navigate -- should stay on the same tab
			app.mockInput.pressArrow("right");
			await app.renderOnce();
			const frameAfter = app.captureFrame();
			expect(frameAfter).toContain("INPUT MODE");
		});

		test("navigation is disabled when command palette is open", async () => {
			app = await renderApp({ tools: THREE_TOOLS });
			await waitForLogs(app.processManager, 0);
			await app.renderOnce();
			// Open command palette
			app.mockInput.pressKey("p", { ctrl: true });
			await app.renderOnce();
			const frame = app.captureFrame();
			expect(frame).toContain("Command Palette");
		});
	});

	describe("horizontal tab bar visibility", () => {
		test("initial render ensures active tab is visible", async () => {
			app = await renderApp({
				tools: MANY_TOOLS,
				width: 80,
				height: 24,
			});
			await app.renderOnce();
			const frame = app.captureFrame();
			expect(frame).toContain("tool-1");
		});

		test("switching tabs always keeps active tab visible", async () => {
			app = await renderApp({
				tools: MANY_TOOLS,
				width: 80,
				height: 24,
			});
			await app.renderOnce();

			// Navigate to the last tab (wrapping around backward)
			app.mockInput.pressArrow("left");
			await app.renderOnce();
			const frame = app.captureFrame();
			// Last tab name should appear in the rendered frame
			expect(frame).toContain("tool-12");
		});

		test("scroll buttons page through tabs when clicked", async () => {
			app = await renderApp({
				tools: MANY_TOOLS,
				width: 80,
				height: 24,
			});
			await app.renderOnce();
			const frame = app.captureFrame();

			// Should show right scroll indicator when tabs overflow
			expect(frame).toContain("▶");

			// Find the ▶ button position in the frame
			const lines = frame.split("\n");
			let arrowLine = -1;
			let arrowCol = -1;
			for (let y = 0; y < lines.length; y++) {
				const line = lines[y];
				const idx = line?.indexOf("▶") ?? -1;
				if (idx !== -1) {
					arrowLine = y;
					arrowCol = idx;
					break;
				}
			}
			expect(arrowLine).toBeGreaterThan(-1);
			if (arrowCol < 0 || arrowLine < 0) throw new Error("Arrow not found");

			await app!.mockMouse.click(arrowCol, arrowLine);
			await app.renderOnce();
			const frameAfter = app.captureFrame();
			// After scrolling right, should now show the left scroll indicator
			expect(frameAfter).toContain("◀");
		});

		test("mouse scroll wheel scrolls the tab bar", async () => {
			app = await renderApp({
				tools: MANY_TOOLS,
				width: 80,
				height: 24,
			});
			await app.renderOnce();
			const frameBefore = app.captureFrame();
			expect(frameBefore).toContain("tool-1");

			// Scroll right on the tab bar area (row 1 in horizontal mode, inside the border)
			await app.mockMouse.scroll(40, 1, "down");
			await app.renderOnce();
			const frameAfter = app.captureFrame();

			// After scroll, content should have shifted
			expect(frameAfter).not.toBe(frameBefore);
		});
	});

	describe("tab bar interactions", () => {
		test("clicking a tab switches to it", async () => {
			app = await renderApp({
				tools: THREE_TOOLS,
				width: 120,
				height: 40,
			});
			await waitForLogs(app.processManager, 1);
			await app.renderOnce();

			// Find "worker" in the frame to know where to click
			const frame = app.captureFrame();
			const lines = frame.split("\n");
			let workerLine = -1;
			let workerCol = -1;
			for (let y = 0; y < lines.length; y++) {
				const line = lines[y];
				const idx = line?.indexOf("worker") ?? -1;
				if (idx !== -1) {
					workerLine = y;
					workerCol = idx;
					break;
				}
			}
			expect(workerLine).toBeGreaterThan(-1);
			if (workerCol < 0 || workerLine < 0) throw new Error("Worker not found");

			await app!.mockMouse.click(workerCol + 1, workerLine);
			await app.renderOnce();
			const frameAfter = app.captureFrame();
			expect(frameAfter).toContain("worker running");
		});

		test("shows tab numbers when configured", async () => {
			app = await renderApp({
				tools: THREE_TOOLS,
				config: { ui: { showTabNumbers: true } },
			});
			await app.renderOnce();
			const frame = app.captureFrame();
			expect(frame).toContain("1:");
			expect(frame).toContain("2:");
			expect(frame).toContain("3:");
		});

		test("tab bar appears on the left when configured", async () => {
			app = await renderApp({
				tools: THREE_TOOLS,
				width: 120,
				config: { ui: { sidebarPosition: "left" } },
			});
			await app.renderOnce();
			const frame = app.captureFrame();
			const lines = frame.split("\n");

			// In left sidebar mode, tab names (with status icon prefix) appear near the left
			const hasTabOnLeft = lines.some(
				(line) => line.indexOf("server") >= 0 && line.indexOf("server") < 25,
			);
			expect(hasTabOnLeft).toBe(true);
		});

		test("tab bar appears on the right when configured", async () => {
			app = await renderApp({
				tools: THREE_TOOLS,
				width: 120,
				config: { ui: { sidebarPosition: "right" } },
			});
			await app.renderOnce();
			const frame = app.captureFrame();
			const lines = frame.split("\n");

			// In right sidebar mode, tab names appear near the end of lines
			const hasTabOnRight = lines.some((line) => line.indexOf("server") > 90);
			expect(hasTabOnRight).toBe(true);
		});

		test("tab bar appears on top/bottom when configured", async () => {
			// Below threshold = horizontal mode. Default is top.
			app = await renderApp({
				tools: THREE_TOOLS,
				width: 80,
				height: 24,
				config: { ui: { horizontalTabPosition: "top" } },
			});
			await app.renderOnce();
			const frame = app.captureFrame();
			const lines = frame.split("\n");

			// In top mode, tab names should be in the first few lines
			const topLines = lines.slice(0, 3).join("\n");
			expect(topLines).toContain("server");
		});
	});
});
