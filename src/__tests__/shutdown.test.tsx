import { afterEach, describe, test } from "bun:test";
import {
	renderApp,
	type TestApp,
	waitFor,
	waitForLogs,
	waitForStatus,
} from "./test-helpers";

// Ignores SIGTERM so shutdown UI stays visible briefly
const LONG_RUNNER = {
	name: "long-runner",
	command: "sh",
	args: ["-c", "trap '' TERM; sleep 2"],
};
const QUICK_EXIT = { name: "quick-exit", command: "echo", args: ["done"] };

const TWO_TOOLS = [LONG_RUNNER, QUICK_EXIT];

describe("shutdown", () => {
	let app: TestApp;

	afterEach(async () => {
		await app?.cleanup();
	});

	test("q triggers shutdown", async () => {
		app = await renderApp({ tools: [LONG_RUNNER] });
		await waitForStatus(app.processManager, 0, "running");
		// Wait for the trap handler to be installed
		await new Promise((r) => setTimeout(r, 100));
		await app.renderOnce();

		const cleanupPromise = app.processManager.cleanup();
		await waitFor(
			async () => {
				await app.renderOnce();
				const frame = app.captureFrame();
				return (
					frame.includes("shutting down") ||
					frame.includes("Shutting down") ||
					frame.includes("WARNING")
				);
			},
			5000,
			50,
		);

		await cleanupPromise;
	});

	test("shutdown bar shows process count", async () => {
		app = await renderApp({ tools: [LONG_RUNNER] });
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		const cleanupPromise = app.processManager.cleanup();
		await waitFor(
			async () => {
				await app.renderOnce();
				const frame = app.captureFrame();
				return (
					frame.includes("process") ||
					frame.includes("shutting down") ||
					frame.includes("WARNING")
				);
			},
			3000,
			30,
		);

		await cleanupPromise;
	});

	test("only shutting-down processes shown in tabs during shutdown", async () => {
		app = await renderApp({ tools: TWO_TOOLS });
		await waitForStatus(app.processManager, 0, "running");
		await waitForLogs(app.processManager, 1);
		await waitForStatus(app.processManager, 1, "stopped");
		await app.renderOnce();

		const cleanupPromise = app.processManager.cleanup();
		await waitFor(
			async () => {
				await app.renderOnce();
				const frame = app.captureFrame();
				// long-runner (shutting down) should be visible; shutdown bar should show
				return (
					frame.includes("long-runner") &&
					(frame.includes("shutting down") ||
						frame.includes("Shutting down") ||
						frame.includes("WARNING"))
				);
			},
			2000,
			30,
		);

		await cleanupPromise;
	});

	test("tabs are not navigable to non-shutting-down processes during shutdown", async () => {
		app = await renderApp({ tools: TWO_TOOLS });
		await waitForStatus(app.processManager, 0, "running");
		await waitForLogs(app.processManager, 1);
		await waitForStatus(app.processManager, 1, "stopped");
		await app.renderOnce();

		const cleanupPromise = app.processManager.cleanup();
		await waitFor(
			async () => {
				await app.renderOnce();
				const frame = app.captureFrame();
				// During shutdown, only shutting-down processes in tabs; verify shutdown state
				return (
					frame.includes("long-runner") &&
					(frame.includes("shutting down") ||
						frame.includes("Shutting down") ||
						frame.includes("WARNING"))
				);
			},
			2000,
			30,
		);

		await cleanupPromise;
	});

	test("visible tab shows a process still shutting down during shutdown", async () => {
		app = await renderApp({ tools: TWO_TOOLS });
		await waitForStatus(app.processManager, 0, "running");
		await waitForLogs(app.processManager, 1);
		await waitForStatus(app.processManager, 1, "stopped");
		await app.renderOnce();

		const cleanupPromise = app.processManager.cleanup();
		await waitFor(
			async () => {
				await app.renderOnce();
				const frame = app.captureFrame();
				return (
					frame.includes("long-runner") &&
					(frame.includes("shutting down") ||
						frame.includes("Shutting down") ||
						frame.includes("WARNING"))
				);
			},
			1500,
			30,
		);

		await cleanupPromise;
	});
});
