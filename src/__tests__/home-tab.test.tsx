import { afterEach, describe, expect, test } from "bun:test";
import {
	renderApp,
	type TestApp,
	waitFor,
	waitForStatus,
} from "./test-helpers";

const tools = [
	{
		name: "api-server",
		command: "sleep",
		args: ["999"],
		description: "REST API",
	},
	{
		name: "frontend",
		command: "echo",
		args: ["ready"],
		description: "Frontend app",
	},
];

describe("home tab", () => {
	let app: TestApp;
	const originalFetch = global.fetch;

	afterEach(async () => {
		global.fetch = originalFetch;
		await app?.cleanup();
	});

	test("home tab renders when enabled", async () => {
		app = await renderApp({
			tools,
			config: { home: { enabled: true } },
		});
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("Home");
	});

	test("home tab shows service cards", async () => {
		app = await renderApp({
			tools,
			config: { home: { enabled: true } },
		});
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("api-server");
		expect(frame).toContain("frontend");
	});

	test("status summary shows counts", async () => {
		app = await renderApp({
			tools,
			config: { home: { enabled: true } },
		});
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toMatch(/\d+ running/);
	});

	test("home tab is hidden when disabled", async () => {
		app = await renderApp({
			tools,
			config: { home: { enabled: false } },
		});
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).not.toContain("⌂");
	});

	test("service card shows uptime for running process", async () => {
		app = await renderApp({
			tools,
			config: { home: { enabled: true } },
		});
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toMatch(/\d+s|0s/);
	});

	test("service card shows description", async () => {
		app = await renderApp({
			tools,
			config: { home: { enabled: true } },
		});
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("REST API");
	});

	test("clicking tool name navigates to its tab", async () => {
		app = await renderApp({
			tools,
			config: { home: { enabled: true } },
		});
		await app.renderOnce();
		const frame = app.captureFrame();
		const lines = frame.split("\n");
		let apiServerCol = -1;
		let apiServerRow = -1;
		for (let y = 0; y < lines.length; y++) {
			const idx = lines[y]?.indexOf("api-server") ?? -1;
			if (idx !== -1) {
				apiServerCol = idx;
				apiServerRow = y;
				break;
			}
		}
		expect(apiServerRow).toBeGreaterThan(-1);
		if (apiServerCol < 0 || apiServerRow < 0)
			throw new Error("api-server not found");

		await app.mockMouse.click(apiServerCol + 1, apiServerRow);
		await app.renderOnce();
		const frameAfter = app.captureFrame();
		expect(frameAfter).not.toContain("REST API");
	});

	test("process starts in starting state before health check resolves", async () => {
		// @ts-expect-error - mock fetch for test (never resolves)
		global.fetch = async () => new Promise(() => {});

		app = await renderApp({
			tools: [
				{
					name: "health-tool",
					command: "sleep",
					args: ["999"],
					healthCheck: { url: "http://localhost:99999" },
				},
			],
			config: { home: { enabled: true } },
		});
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("starting");
		expect(frame).not.toContain("unhealthy");
	});

	test("process with dependencies waits before startup", async () => {
		// @ts-expect-error - mock fetch for test (never resolves)
		global.fetch = async () => new Promise(() => {});

		app = await renderApp({
			tools: [
				{
					name: "A",
					command: "sleep",
					args: ["999"],
					healthCheck: { url: "http://localhost:99998" },
					description: "Service A",
				},
				{
					name: "B",
					command: "sleep",
					args: ["999"],
					dependsOn: ["A"],
					description: "Service B",
				},
			],
			config: { home: { enabled: true } },
		});
		await waitFor(async () => {
			await app.renderOnce();
			return app.captureFrame().includes("waiting");
		}, 3000);
	});

	test("after restart, process shows starting state again", async () => {
		// @ts-expect-error - mock fetch for test (never resolves)
		global.fetch = async () => new Promise(() => {});

		app = await renderApp({
			tools: [
				{
					name: "restart-tool",
					command: "sleep",
					args: ["999"],
					healthCheck: { url: "http://localhost:99997" },
					description: "Restart test",
				},
			],
			config: { home: { enabled: true } },
		});
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();
		app.mockInput.pressArrow("right");
		await app.renderOnce();
		app.mockInput.pressKey("r");
		await waitForStatus(app.processManager, 0, "running");
		await app.renderOnce();
		const frame = app.captureFrame();
		expect(frame).toContain("starting");
	});
});
