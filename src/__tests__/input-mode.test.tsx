import { afterEach, describe, expect, test } from "bun:test";
import {
	renderApp,
	type TestApp,
	waitForLogs,
	waitForStatus,
} from "./test-helpers";

describe("input mode", () => {
	let app: TestApp;

	afterEach(async () => {
		await app?.cleanup();
	});

	test("i enters input mode for interactive tools", async () => {
		app = await renderApp({
			tools: [{ name: "cat-tool", command: "cat", interactive: true }],
		});
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		app.mockInput.pressKey("i");
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("INPUT MODE");
	});

	test("i is ignored for non-interactive tools", async () => {
		app = await renderApp({
			tools: [{ name: "echo-tool", command: "sleep", args: ["999"] }],
		});
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		app.mockInput.pressKey("i");
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).not.toContain("INPUT MODE");
	});

	test("i is ignored for stopped tools", async () => {
		app = await renderApp({
			tools: [
				{
					name: "stopped-tool",
					command: "echo",
					args: ["done"],
					interactive: true,
				},
			],
		});
		await waitForLogs(app.processManager, 0);
		await waitForStatus(app.processManager, 0, "stopped");
		await app.renderOnce();

		app.mockInput.pressKey("i");
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).not.toContain("INPUT MODE");
	});

	test("Esc exits input mode", async () => {
		app = await renderApp({
			tools: [{ name: "cat-tool", command: "cat", interactive: true }],
			kittyKeyboard: true,
		});
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		app.mockInput.pressKey("i");
		await app.renderOnce();
		expect(app.captureFrame()).toContain("INPUT MODE");

		app.mockInput.pressEscape();
		await app.renderOnce();
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("Input mode exited");
	});

	test("typed text is forwarded to process", async () => {
		app = await renderApp({
			tools: [{ name: "cat-tool", command: "cat", interactive: true }],
		});
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		app.mockInput.pressKey("i");
		await app.renderOnce();

		await app.mockInput.typeText("hello");
		app.mockInput.pressEnter();
		await app.renderOnce();
		await new Promise((r) => setTimeout(r, 100));
		await app.renderOnce();

		const frame = app.captureFrame();
		expect(frame).toContain("hello");
	});

	test("help bar shows input mode hints", async () => {
		app = await renderApp({
			tools: [{ name: "cat-tool", command: "cat", interactive: true }],
		});
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		app.mockInput.pressKey("i");
		await app.renderOnce();

		const frame = app.captureFrame();
		const lines = frame.split("\n");
		const lastLines = lines.slice(-3).join("\n");
		expect(lastLines.includes("exit input") || lastLines.includes("Esc")).toBe(
			true,
		);
	});
});
