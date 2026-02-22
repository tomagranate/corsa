import { afterEach, describe, expect, test } from "bun:test";
import {
	renderApp,
	type TestApp,
	waitFor,
	waitForStatus,
} from "./test-helpers";

const TEST_TOOL = { name: "tool", command: "sleep", args: ["999"] };

function openThemePicker(app: TestApp) {
	app.mockInput.pressKey("p", { ctrl: true });
}

describe("theme picker", () => {
	let app: TestApp;

	afterEach(async () => {
		await app?.cleanup();
	});

	test("theme picker opens from command palette", async () => {
		app = await renderApp({ tools: [TEST_TOOL] });
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		openThemePicker(app);
		await app.renderOnce();
		await app.mockInput.typeText("theme");
		await app.renderOnce();
		app.mockInput.pressEnter();
		await waitFor(async () => {
			await app.renderOnce();
			return app.captureFrame().includes("Switch Theme");
		}, 5000);

		const frame = app.captureFrame();
		expect(frame).toContain("Switch Theme");
	});

	test("theme list shows available themes", async () => {
		app = await renderApp({ tools: [TEST_TOOL] });
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		openThemePicker(app);
		await app.renderOnce();
		await app.mockInput.typeText("theme");
		await app.renderOnce();
		app.mockInput.pressEnter();
		await waitFor(async () => {
			await app.renderOnce();
			return app.captureFrame().includes("Switch Theme");
		}, 2000);

		const frame = app.captureFrame();
		expect(frame).toContain("Moss");
		expect(frame).toContain("Mist");
		expect(frame).toContain("Cappuccino");
	});

	test("up/down navigates themes", async () => {
		app = await renderApp({ tools: [TEST_TOOL] });
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		openThemePicker(app);
		await app.renderOnce();
		await app.mockInput.typeText("theme");
		await app.renderOnce();
		app.mockInput.pressEnter();
		await waitFor(async () => {
			await app.renderOnce();
			return app.captureFrame().includes("Switch Theme");
		}, 2000);

		app.mockInput.pressArrow("down");
		await app.renderOnce();

		const frame = app.captureFrame();
		expect(frame).toContain("Switch Theme");
	});

	test("navigating to a theme applies it as a live preview", async () => {
		app = await renderApp({ tools: [TEST_TOOL] });
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		openThemePicker(app);
		await app.renderOnce();
		await app.mockInput.typeText("theme");
		await app.renderOnce();
		app.mockInput.pressEnter();
		await waitFor(async () => {
			await app.renderOnce();
			return app.captureFrame().includes("Switch Theme");
		}, 2000);

		const frameBefore = app.captureFrame();
		app.mockInput.pressArrow("down");
		await app.renderOnce();
		const frameAfter = app.captureFrame();

		expect(frameBefore).not.toBe(frameAfter);
	});

	test("Esc cancels and reverts preview", async () => {
		app = await renderApp({ tools: [TEST_TOOL] });
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		openThemePicker(app);
		await app.renderOnce();
		await app.mockInput.typeText("theme");
		await app.renderOnce();
		app.mockInput.pressEnter();
		await waitFor(async () => {
			await app.renderOnce();
			return app.captureFrame().includes("Switch Theme");
		}, 2000);

		app.mockInput.pressArrow("down");
		await app.renderOnce();

		app.mockInput.pressEscape();
		await waitFor(async () => {
			await app.renderOnce();
			return !app.captureFrame().includes("Switch Theme");
		}, 2000);

		const frame = app.captureFrame();
		expect(frame).not.toContain("Switch Theme");
	});

	test("Enter saves selected theme", async () => {
		app = await renderApp({ tools: [TEST_TOOL] });
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();

		openThemePicker(app);
		await app.renderOnce();
		await app.mockInput.typeText("theme");
		await app.renderOnce();
		app.mockInput.pressEnter();
		await waitFor(async () => {
			await app.renderOnce();
			return app.captureFrame().includes("Switch Theme");
		}, 2000);

		app.mockInput.pressArrow("down");
		await app.renderOnce();

		app.mockInput.pressEnter();
		await app.renderOnce();

		const frame = app.captureFrame();
		expect(frame).not.toContain("Switch Theme");
	});
});
