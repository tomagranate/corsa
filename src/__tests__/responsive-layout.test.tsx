import { afterEach, describe, expect, test } from "bun:test";
import { renderApp, type TestApp, waitForLogs } from "./test-helpers";

const TWO_TOOLS = [
	{ name: "server", command: "echo", args: ["running"] },
	{ name: "worker", command: "echo", args: ["running"] },
];

describe("responsive layout", () => {
	let app: TestApp;

	afterEach(async () => {
		await app?.cleanup();
	});

	test("wide terminal shows vertical sidebar", async () => {
		app = await renderApp({
			tools: TWO_TOOLS,
			width: 120,
			height: 40,
		});
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();

		const frame = app.captureFrame();
		const lines = frame.split("\n");
		// Tab names appear in a sidebar column (within first ~25 chars of lines)
		const hasTabOnLeft = lines.some(
			(line) =>
				(line.indexOf("server") >= 0 && line.indexOf("server") < 25) ||
				(line.indexOf("worker") >= 0 && line.indexOf("worker") < 25),
		);
		expect(hasTabOnLeft).toBe(true);
	});

	test("narrow terminal shows horizontal tabs", async () => {
		app = await renderApp({
			tools: TWO_TOOLS,
			width: 80,
			height: 40,
		});
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();

		const frame = app.captureFrame();
		const lines = frame.split("\n");
		// Tabs appear in a horizontal bar (within first 3 lines)
		const topLines = lines.slice(0, 3).join("\n");
		expect(topLines).toContain("server");
		expect(topLines).toContain("worker");
	});

	test("resizing switches layout", async () => {
		app = await renderApp({
			tools: TWO_TOOLS,
			width: 120,
			height: 40,
		});
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();

		let frame = app.captureFrame();
		let lines = frame.split("\n");
		const hasTabOnLeft = lines.some(
			(line) =>
				(line.indexOf("server") >= 0 && line.indexOf("server") < 25) ||
				(line.indexOf("worker") >= 0 && line.indexOf("worker") < 25),
		);
		expect(hasTabOnLeft).toBe(true);

		app.resize(80, 40);
		await app.renderOnce();

		frame = app.captureFrame();
		lines = frame.split("\n");
		const topLines = lines.slice(0, 3).join("\n");
		expect(topLines).toContain("server");
		expect(topLines).toContain("worker");
	});

	test("sidebar position respects config", async () => {
		app = await renderApp({
			tools: TWO_TOOLS,
			width: 120,
			height: 40,
			config: { ui: { sidebarPosition: "right" } },
		});
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();

		const frame = app.captureFrame();
		const lines = frame.split("\n");
		// In right sidebar mode, tab names appear past column 90
		const hasTabOnRight = lines.some(
			(line) => line.indexOf("server") > 90 || line.indexOf("worker") > 90,
		);
		expect(hasTabOnRight).toBe(true);
	});
});
