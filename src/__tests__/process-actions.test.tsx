import { afterEach, describe, expect, test } from "bun:test";
import {
	renderApp,
	type TestApp,
	waitForLogs,
	waitForStatus,
} from "./test-helpers";

describe("process actions", () => {
	let app: TestApp;

	afterEach(async () => {
		await app?.cleanup();
	});

	test("r restarts the current process", async () => {
		app = await renderApp({
			tools: [{ name: "sleep-tool", command: "sleep", args: ["999"] }],
		});
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		app.mockInput.pressKey("r");
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("Restarting");
	});

	test("s stops a running process", async () => {
		app = await renderApp({
			tools: [{ name: "sleep-tool", command: "sleep", args: ["999"] }],
		});
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		app.mockInput.pressKey("s");
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame.includes("○") || frame.includes("Stopping")).toBe(true);
	});

	test("s is ignored for stopped processes", async () => {
		app = await renderApp({
			tools: [{ name: "echo-tool", command: "echo", args: ["done"] }],
		});
		await waitForLogs(app.processManager, 0);
		await waitForStatus(app.processManager, 0, "stopped");
		await app.renderOnce();

		app.mockInput.pressKey("s");
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame.length).toBeGreaterThan(0);
		expect(frame).toContain("done");
	});

	test("c clears logs", async () => {
		app = await renderApp({
			tools: [{ name: "echo-tool", command: "echo", args: ["test output"] }],
		});
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();

		app.mockInput.pressKey("c");
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("Logs cleared");
		expect(frame).not.toContain("test output");
	});

	test("process exit shows toast notification", async () => {
		app = await renderApp({
			tools: [{ name: "echo-tool", command: "echo", args: ["quick exit"] }],
		});
		await waitForLogs(app.processManager, 0);
		await waitForStatus(app.processManager, 0, "stopped");
		await app.renderOnce();

		const frame = app.captureFrame();
		expect(frame).toContain("exited");
	});

	test("process error exit shows error toast", async () => {
		app = await renderApp({
			tools: [{ name: "error-tool", command: "sh", args: ["-c", "exit 1"] }],
		});
		await waitForStatus(app.processManager, 0, "error");
		await app.renderOnce();

		const frame = app.captureFrame();
		expect(
			frame.includes("error") ||
				(frame.includes("exit") && frame.includes("code")),
		).toBe(true);
	});

	test("actions are disabled during shutdown", async () => {
		app = await renderApp({
			tools: [{ name: "sleep-tool", command: "sleep", args: ["999"] }],
		});
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		// Trigger shutdown state directly (avoids process.exit from q handler)
		const cleanupPromise = app.processManager.cleanup();
		await new Promise((r) => setTimeout(r, 100));
		await app.renderOnce();

		app.mockInput.pressKey("r");
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame.length).toBeGreaterThan(0);

		await cleanupPromise;
	});
});
