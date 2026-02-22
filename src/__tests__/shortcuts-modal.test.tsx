import { afterEach, describe, expect, test } from "bun:test";
import {
	renderApp,
	type TestApp,
	waitFor,
	waitForStatus,
} from "./test-helpers";

const TEST_TOOL = { name: "test-tool", command: "sleep", args: ["999"] };

describe("shortcuts modal", () => {
	let app: TestApp;

	afterEach(async () => {
		await app?.cleanup();
	});

	test("? opens shortcuts modal", async () => {
		app = await renderApp({ tools: [TEST_TOOL] });
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		app.mockInput.pressKey("?");
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("Ctrl+P");
	});

	test("shortcuts modal lists key bindings", async () => {
		app = await renderApp({ tools: [TEST_TOOL] });
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		app.mockInput.pressKey("?");
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("Restart");
		expect(frame).toContain("Stop");
		expect(frame).toContain("Search");
	});

	test("Esc closes shortcuts modal", async () => {
		app = await renderApp({ tools: [TEST_TOOL] });
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
	});

	test("Enter closes shortcuts modal", async () => {
		app = await renderApp({ tools: [TEST_TOOL] });
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		app.mockInput.pressKey("?");
		await app.renderOnce();
		expect(app.captureFrame()).toContain("Ctrl+P");

		app.mockInput.pressEnter();
		await waitFor(async () => {
			await app.renderOnce();
			return !app.captureFrame().includes("Keyboard Shortcuts");
		}, 2000);
	});
});
