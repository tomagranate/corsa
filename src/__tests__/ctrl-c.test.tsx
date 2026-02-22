import { afterEach, describe, expect, test } from "bun:test";
import {
	renderApp,
	type TestApp,
	waitFor,
	waitForStatus,
} from "./test-helpers";

/**
 * Ctrl+C priority chain tests.
 *
 * Ctrl+C in corsa follows a priority chain:
 * 1. Cancel search mode
 * 2. Close command palette
 * 3. Close shortcuts modal
 * 4. Close theme picker / about modal
 * 5. Trigger graceful shutdown
 * 6. Force quit (during shutdown)
 *
 * Sending actual Ctrl+C (pressCtrlC) causes a Bun segfault in test mode,
 * so we verify the priority indirectly:
 * - Each modal/mode blocks the quit path (closing it via Esc keeps app alive)
 * - Shutdown path is tested in shutdown.test.tsx
 * - Force quit hint is tested in help-bar.test.tsx
 */

const SERVER_TOOL = { name: "server", command: "sleep", args: ["999"] };

describe("Ctrl+C priority chain", () => {
	let app: TestApp;

	afterEach(async () => {
		await app?.cleanup();
	});

	test("command palette blocks quit - closing it keeps app alive", async () => {
		app = await renderApp({ tools: [SERVER_TOOL] });
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

		const frame = app.captureFrame();
		expect(frame).toContain("server");
		expect(frame).not.toContain("shutting down");
	});

	test("shortcuts modal blocks quit - closing it keeps app alive", async () => {
		app = await renderApp({ tools: [SERVER_TOOL] });
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		app.mockInput.pressKey("?");
		await app.renderOnce();
		expect(app.captureFrame()).toContain("Ctrl+P");

		app.mockInput.pressEscape();
		await waitFor(async () => {
			await app.renderOnce();
			return !app.captureFrame().includes("Keyboard Shortcuts");
		}, 2000);

		const frame = app.captureFrame();
		expect(frame).toContain("server");
		expect(frame).not.toContain("shutting down");
	});

	test("search mode blocks quit - exiting it keeps app alive", async () => {
		app = await renderApp({
			tools: [
				{ name: "server", command: "printf", args: ["line1\\nline2\\n"] },
			],
		});
		await waitFor(
			() => (app.processManager.getTool(0)?.logs.length ?? 0) > 0,
			5000,
		);
		await app.renderOnce();

		app.mockInput.pressKey("/");
		await app.renderOnce();

		app.mockInput.pressEscape();
		await app.renderOnce();

		const frame = app.captureFrame();
		expect(frame).toContain("server");
		expect(frame).not.toContain("shutting down");
	});
});
