import { afterEach, describe, expect, test } from "bun:test";
import {
	renderApp,
	type TestApp,
	waitForLogs,
	waitForStatus,
} from "./test-helpers";

const TOOL = { name: "tool1", command: "echo", args: ["hello"] };

describe("toast", () => {
	let app: TestApp;

	afterEach(async () => {
		await app?.cleanup();
	});

	test("toast appears on process action", async () => {
		app = await renderApp({ tools: [TOOL] });
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();

		app.mockInput.pressKey("c");
		await app.renderOnce();

		const frame = app.captureFrame();
		expect(frame).toContain("Logs cleared");
	});

	test("toast appears on restart", async () => {
		app = await renderApp({ tools: [TOOL] });
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		app.mockInput.pressKey("r");
		await app.renderOnce();

		const frame = app.captureFrame();
		expect(frame).toContain("Restarting");
	});

	test("multiple toasts stack", async () => {
		app = await renderApp({ tools: [TOOL] });
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();

		app.mockInput.pressKey("c");
		app.mockInput.pressKey("r");
		await app.renderOnce();

		const frame = app.captureFrame();
		expect(frame).toContain("Logs cleared");
		expect(frame).toContain("Restarting");
	});

	test("clicking a toast dismisses it", async () => {
		app = await renderApp({ tools: [TOOL] });
		await waitForLogs(app.processManager, 0);
		await app.renderOnce();

		app.mockInput.pressKey("c");
		await app.renderOnce();

		let frame = app.captureFrame();
		expect(frame).toContain("Logs cleared");

		// Find toast text position (toasts appear near top-right)
		const lines = frame.split("\n");
		let toastRow = -1;
		let toastCol = -1;
		for (let y = 0; y < lines.length; y++) {
			const line = lines[y] ?? "";
			const idx = line.indexOf("Logs cleared");
			if (idx !== -1) {
				toastRow = y;
				toastCol = idx + 2; // Click near middle of text
				break;
			}
		}
		expect(toastRow).toBeGreaterThan(-1);
		expect(toastCol).toBeGreaterThan(-1);

		await app.mockMouse.click(toastCol, toastRow);
		await app.renderOnce();

		// Wait for toast to dismiss (may need a moment for React to process)
		await new Promise((r) => setTimeout(r, 100));
		await app.renderOnce();

		frame = app.captureFrame();
		expect(frame).not.toContain("Logs cleared");
	});
});
