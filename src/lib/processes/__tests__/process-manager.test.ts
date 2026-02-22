import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ToolConfig } from "../../../types";
import { deletePidFile, type PidFileData, savePidFile } from "../pid-file";
import { ProcessManager } from "../process-manager";

/**
 * Helper to wait for a process to exit by polling status.
 * More reliable than arbitrary setTimeout.
 */
async function waitForProcessExit(
	manager: ProcessManager,
	toolIndex: number,
	timeoutMs: number = 2000,
): Promise<void> {
	const startTime = Date.now();
	while (Date.now() - startTime < timeoutMs) {
		const tool = manager.getTool(toolIndex);
		if (
			!tool?.process ||
			tool.status === "stopped" ||
			tool.status === "error"
		) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

describe("ProcessManager", () => {
	let processManager: ProcessManager;

	beforeEach(async () => {
		processManager = new ProcessManager(100); // Small maxLogLines for testing
		await deletePidFile(); // Clean up PID file
	});

	afterEach(async () => {
		// Clean up any running processes
		try {
			await processManager.cleanup();
		} catch {
			// Ignore cleanup errors in tests
		}
		await deletePidFile(); // Clean up PID file
	});

	test("initialize - creates tool states", async () => {
		const configs: ToolConfig[] = [
			{
				name: "test1",
				command: "echo",
				args: ["hello"],
			},
			{
				name: "test2",
				command: "echo",
				args: ["world"],
			},
		];

		const { tools } = await processManager.initialize(configs);
		expect(tools).toHaveLength(2);
		expect(tools[0]?.config.name).toBe("test1");
		expect(tools[1]?.config.name).toBe("test2");
		expect(tools[0]?.status).toBe("stopped");
		expect(tools[1]?.status).toBe("stopped");
	});

	test("getTools - returns tool states", async () => {
		const configs: ToolConfig[] = [
			{
				name: "test",
				command: "echo",
			},
		];

		await processManager.initialize(configs);
		const tools = processManager.getTools();

		expect(tools).toHaveLength(1);
		expect(tools[0]?.config.name).toBe("test");
	});

	test("getTool - returns specific tool", async () => {
		const configs: ToolConfig[] = [
			{
				name: "test1",
				command: "echo",
			},
			{
				name: "test2",
				command: "ls",
			},
		];

		await processManager.initialize(configs);
		const tool = processManager.getTool(1);

		expect(tool).toBeDefined();
		expect(tool?.config.name).toBe("test2");
	});

	test("getTool - returns undefined for invalid index", async () => {
		const configs: ToolConfig[] = [
			{
				name: "test",
				command: "echo",
			},
		];

		await processManager.initialize(configs);
		expect(processManager.getTool(999)).toBeUndefined();
	});

	test("startTool - starts a process", async () => {
		const configs: ToolConfig[] = [
			{
				name: "test",
				command: "sleep",
				args: ["10"],
			},
		];

		await processManager.initialize(configs);
		await processManager.startTool(0);

		const tool = processManager.getTool(0);
		expect(tool?.status).toBe("running");
		expect(tool?.process).not.toBeNull();
		expect(tool?.pid).toBeDefined();
		if (tool?.pid) {
			expect(tool.pid).toBeGreaterThan(0);
		}
	});

	test("startTool - does not start if already running", async () => {
		const configs: ToolConfig[] = [
			{
				name: "test",
				command: "sleep",
				args: ["10"], // Long-running process
			},
		];

		await processManager.initialize(configs);
		await processManager.startTool(0);

		const firstPid = processManager.getTool(0)?.pid;
		expect(firstPid).toBeDefined();
		expect(firstPid).toBeGreaterThan(0);

		// Try to start again while already running
		await processManager.startTool(0);

		const tool = processManager.getTool(0);
		// Should be the same process (not restarted)
		expect(tool?.pid).toBeDefined();
		expect(tool?.pid).toBe(firstPid as number);
		expect(tool?.status).toBe("running");
	});

	test("startTool - handles invalid index", async () => {
		const configs: ToolConfig[] = [
			{
				name: "test",
				command: "echo",
			},
		];

		await processManager.initialize(configs);
		// Should not throw
		await expect(processManager.startTool(999)).resolves.toBeUndefined();
	});

	test("stopTool - stops a running process", async () => {
		const configs: ToolConfig[] = [
			{
				name: "test",
				command: "sleep",
				args: ["10"], // Long-running process we can stop
			},
		];

		await processManager.initialize(configs);
		await processManager.startTool(0);

		expect(processManager.getTool(0)?.status).toBe("running");

		await processManager.stopTool(0);

		// Process should be stopped
		const tool = processManager.getTool(0);
		expect(tool?.status).toBe("stopped");
	});

	test("stopTool - handles invalid index", async () => {
		const configs: ToolConfig[] = [
			{
				name: "test",
				command: "echo",
			},
		];

		await processManager.initialize(configs);
		// Should not throw
		await expect(processManager.stopTool(999)).resolves.toBeUndefined();
	});

	test("cleanup - stops all processes", async () => {
		const configs: ToolConfig[] = [
			{
				name: "test1",
				command: "sleep",
				args: ["10"],
			},
			{
				name: "test2",
				command: "sleep",
				args: ["10"],
			},
		];

		await processManager.initialize(configs);
		await processManager.startTool(0);
		await processManager.startTool(1);

		expect(processManager.getTool(0)?.status).toBe("running");
		expect(processManager.getTool(1)?.status).toBe("running");

		await processManager.cleanup();

		// All processes should be stopped
		expect(processManager.getTool(0)?.status).toBe("stopped");
		expect(processManager.getTool(1)?.status).toBe("stopped");
	});

	test("getIsShuttingDown - returns shutdown state", () => {
		expect(processManager.getIsShuttingDown()).toBe(false);

		// Note: We can't easily test the true state without triggering cleanup
		// which would stop processes. This is tested indirectly in cleanup tests.
	});

	test("logs are collected from process output", async () => {
		const configs: ToolConfig[] = [
			{
				name: "test",
				command: "echo",
				args: ["test output"],
			},
		];

		await processManager.initialize(configs);
		await processManager.startTool(0);

		// Wait for process to complete
		await waitForProcessExit(processManager, 0);

		const tool = processManager.getTool(0);
		expect(Array.isArray(tool?.logs)).toBe(true);
		// Should have captured the echo output (logs is LogLine[])
		const hasOutput = tool?.logs?.some((logLine) =>
			logLine.segments.some((segment) => segment.text.includes("test output")),
		);
		expect(hasOutput).toBe(true);
	});

	test("maxLogLines limits log size", async () => {
		const manager = new ProcessManager(5); // Very small limit
		const configs: ToolConfig[] = [
			{
				name: "test",
				command: "echo",
				args: ["line"],
			},
		];

		await manager.initialize(configs);
		await manager.startTool(0);

		// Wait for process to complete
		await waitForProcessExit(manager, 0);

		const tool = manager.getTool(0);
		// Logs should not exceed maxLogLines
		expect(tool?.logs).toBeDefined();
		expect(tool?.logs?.length).toBeLessThanOrEqual(5);

		await manager.cleanup();
	});

	test("restartTool - restarts a running process", async () => {
		const configs: ToolConfig[] = [
			{
				name: "test",
				command: "sleep",
				args: ["10"],
			},
		];

		await processManager.initialize(configs);
		await processManager.startTool(0);

		const firstPid = processManager.getTool(0)?.pid;
		expect(firstPid).toBeDefined();
		expect(processManager.getTool(0)?.status).toBe("running");

		await processManager.restartTool(0);

		const tool = processManager.getTool(0);
		expect(tool?.status).toBe("running");
		expect(tool?.pid).toBeDefined();
		// Should be a new process with different PID
		expect(tool?.pid).not.toBe(firstPid);
	});

	test("restartTool - starts a stopped process", async () => {
		const configs: ToolConfig[] = [
			{
				name: "test",
				command: "sleep",
				args: ["10"],
			},
		];

		await processManager.initialize(configs);
		// Don't start the process first - it should be stopped

		expect(processManager.getTool(0)?.status).toBe("stopped");

		await processManager.restartTool(0);

		const tool = processManager.getTool(0);
		expect(tool?.status).toBe("running");
		expect(tool?.pid).toBeDefined();
	});

	test("restartTool - handles invalid index", async () => {
		const configs: ToolConfig[] = [
			{
				name: "test",
				command: "echo",
			},
		];

		await processManager.initialize(configs);
		// Should not throw
		await expect(processManager.restartTool(999)).resolves.toBeUndefined();
	});

	test("restartTool - fires onToolRestart callback before restarting", async () => {
		const configs: ToolConfig[] = [
			{
				name: "my-server",
				command: "sleep",
				args: ["10"],
			},
		];

		await processManager.initialize(configs);
		await processManager.startTool(0);
		expect(processManager.getTool(0)?.status).toBe("running");

		// Track when onToolRestart is called relative to the restart
		const callLog: string[] = [];
		processManager.onToolRestart = (toolName: string) => {
			callLog.push(`restart:${toolName}`);
			// At this point, the old process should still be running
			// (callback fires before kill)
			expect(processManager.getTool(0)?.status).toBe("running");
		};

		await processManager.restartTool(0);

		// Callback should have been called with the tool name
		expect(callLog).toEqual(["restart:my-server"]);
		// Process should be running with a new PID
		expect(processManager.getTool(0)?.status).toBe("running");
	});

	test("restartTool - fires onToolRestart callback even for stopped processes", async () => {
		const configs: ToolConfig[] = [
			{
				name: "my-server",
				command: "sleep",
				args: ["10"],
			},
		];

		await processManager.initialize(configs);
		// Don't start - process is stopped

		const restartedTools: string[] = [];
		processManager.onToolRestart = (toolName: string) => {
			restartedTools.push(toolName);
		};

		await processManager.restartTool(0);

		expect(restartedTools).toEqual(["my-server"]);
		expect(processManager.getTool(0)?.status).toBe("running");
	});

	test("clearLogs - clears logs for a tool", async () => {
		const configs: ToolConfig[] = [
			{
				name: "test",
				command: "echo",
				args: ["test output"],
			},
		];

		await processManager.initialize(configs);
		await processManager.startTool(0);

		// Wait for process to complete and collect logs
		await waitForProcessExit(processManager, 0);

		const toolBefore = processManager.getTool(0);
		expect(toolBefore?.logs?.length).toBeGreaterThan(0);

		processManager.clearLogs(0);

		const toolAfter = processManager.getTool(0);
		expect(toolAfter?.logs).toEqual([]);
	});

	test("clearLogs - handles invalid index", async () => {
		const configs: ToolConfig[] = [
			{
				name: "test",
				command: "echo",
			},
		];

		await processManager.initialize(configs);
		// Should not throw
		expect(() => processManager.clearLogs(999)).not.toThrow();
	});

	// =========================================================================
	// Carriage Return Handling Tests
	// =========================================================================

	test("carriage return - progress bar updates replace previous line", async () => {
		// Simulate a progress bar: \rProgress 10%\rProgress 50%\rProgress 100%\n
		// Only the final state (Progress 100%) should be in logs
		const configs: ToolConfig[] = [
			{
				name: "test",
				command: "printf",
				args: ["\\rProgress 10%%\\rProgress 50%%\\rProgress 100%%\\n"],
			},
		];

		await processManager.initialize(configs);
		await processManager.startTool(0);
		await waitForProcessExit(processManager, 0);

		const tool = processManager.getTool(0);
		expect(tool?.logs).toBeDefined();

		// Find the progress line (not the exit message)
		const progressLogs = tool?.logs?.filter((log) =>
			log.segments.some((seg) => seg.text.includes("Progress")),
		);

		// Should only have one line with the final progress state
		expect(progressLogs?.length).toBe(1);
		const progressText = progressLogs?.[0]?.segments
			.map((s) => s.text)
			.join("");
		expect(progressText).toBe("Progress 100%");
	});

	test("carriage return - spinner updates replace previous line", async () => {
		// Simulate spinner frames: \r- Loading\r/ Loading\r| Loading\r\ Loading\n
		const configs: ToolConfig[] = [
			{
				name: "test",
				command: "printf",
				args: ["\\r- Loading\\r/ Loading\\r| Loading\\rDone!\\n"],
			},
		];

		await processManager.initialize(configs);
		await processManager.startTool(0);
		await waitForProcessExit(processManager, 0);

		const tool = processManager.getTool(0);

		// Find lines that aren't the exit message
		const contentLogs = tool?.logs?.filter(
			(log) =>
				!log.segments.some((seg) => seg.text.includes("[Process exited")),
		);

		// Should only have the final "Done!" line
		expect(contentLogs?.length).toBe(1);
		const finalText = contentLogs?.[0]?.segments.map((s) => s.text).join("");
		expect(finalText).toBe("Done!");
	});

	test("carriage return - Windows line endings (CRLF) handled correctly", async () => {
		// \r\n should be treated as a normal line break, not a replacement
		const configs: ToolConfig[] = [
			{
				name: "test",
				command: "printf",
				args: ["Line 1\\r\\nLine 2\\r\\nLine 3\\r\\n"],
			},
		];

		await processManager.initialize(configs);
		await processManager.startTool(0);
		await waitForProcessExit(processManager, 0);

		const tool = processManager.getTool(0);

		// Filter out exit message
		const contentLogs = tool?.logs?.filter(
			(log) =>
				!log.segments.some((seg) => seg.text.includes("[Process exited")),
		);

		// Should have all three lines (not replaced)
		expect(contentLogs?.length).toBe(3);
		expect(contentLogs?.[0]?.segments.map((s) => s.text).join("")).toBe(
			"Line 1",
		);
		expect(contentLogs?.[1]?.segments.map((s) => s.text).join("")).toBe(
			"Line 2",
		);
		expect(contentLogs?.[2]?.segments.map((s) => s.text).join("")).toBe(
			"Line 3",
		);
	});

	test("carriage return - mixed content with normal lines and progress", async () => {
		// Normal line, then progress updates, then another normal line
		const configs: ToolConfig[] = [
			{
				name: "test",
				command: "printf",
				args: ["Starting...\\n\\rStep 1\\rStep 2\\rStep 3 done\\nFinished!\\n"],
			},
		];

		await processManager.initialize(configs);
		await processManager.startTool(0);
		await waitForProcessExit(processManager, 0);

		const tool = processManager.getTool(0);

		// Filter out exit message
		const contentLogs = tool?.logs?.filter(
			(log) =>
				!log.segments.some((seg) => seg.text.includes("[Process exited")),
		);

		// Should have: "Starting...", "Step 3 done", "Finished!"
		expect(contentLogs?.length).toBe(3);
		expect(contentLogs?.[0]?.segments.map((s) => s.text).join("")).toBe(
			"Starting...",
		);
		expect(contentLogs?.[1]?.segments.map((s) => s.text).join("")).toBe(
			"Step 3 done",
		);
		expect(contentLogs?.[2]?.segments.map((s) => s.text).join("")).toBe(
			"Finished!",
		);
	});

	test("carriage return - multiple CR in one chunk takes last segment", async () => {
		// Multiple \r in a single line - should take content after last \r
		const configs: ToolConfig[] = [
			{
				name: "test",
				command: "printf",
				args: ["foo\\rbar\\rbaz\\n"],
			},
		];

		await processManager.initialize(configs);
		await processManager.startTool(0);
		await waitForProcessExit(processManager, 0);

		const tool = processManager.getTool(0);

		const contentLogs = tool?.logs?.filter(
			(log) =>
				!log.segments.some((seg) => seg.text.includes("[Process exited")),
		);

		// Should only have "baz" (content after last \r)
		expect(contentLogs?.length).toBe(1);
		expect(contentLogs?.[0]?.segments.map((s) => s.text).join("")).toBe("baz");
	});

	test("carriage return - no CR behaves normally", async () => {
		// Lines without \r should work as before
		const configs: ToolConfig[] = [
			{
				name: "test",
				command: "printf",
				args: ["Line 1\\nLine 2\\nLine 3\\n"],
			},
		];

		await processManager.initialize(configs);
		await processManager.startTool(0);
		await waitForProcessExit(processManager, 0);

		const tool = processManager.getTool(0);

		const contentLogs = tool?.logs?.filter(
			(log) =>
				!log.segments.some((seg) => seg.text.includes("[Process exited")),
		);

		// Should have all three lines
		expect(contentLogs?.length).toBe(3);
		expect(contentLogs?.[0]?.segments.map((s) => s.text).join("")).toBe(
			"Line 1",
		);
		expect(contentLogs?.[1]?.segments.map((s) => s.text).join("")).toBe(
			"Line 2",
		);
		expect(contentLogs?.[2]?.segments.map((s) => s.text).join("")).toBe(
			"Line 3",
		);
	});

	// =========================================================================
	// MCP API Helper Methods
	// =========================================================================

	test("getToolByName - finds existing tool by name", async () => {
		const configs: ToolConfig[] = [
			{ name: "first-tool", command: "echo", args: ["1"] },
			{ name: "second-tool", command: "echo", args: ["2"] },
			{ name: "third-tool", command: "echo", args: ["3"] },
		];

		await processManager.initialize(configs);

		const result = processManager.getToolByName("second-tool");
		expect(result).toBeDefined();
		expect(result?.index).toBe(1);
		expect(result?.tool.config.name).toBe("second-tool");
	});

	test("getToolByName - returns undefined for non-existent tool", async () => {
		const configs: ToolConfig[] = [{ name: "my-tool", command: "echo" }];

		await processManager.initialize(configs);

		const result = processManager.getToolByName("nonexistent");
		expect(result).toBeUndefined();
	});

	test("createVirtualTool - creates a virtual tool with running status", async () => {
		const configs: ToolConfig[] = [{ name: "real-tool", command: "echo" }];

		await processManager.initialize(configs);
		const initialCount = processManager.getTools().length;

		const index = processManager.createVirtualTool("Virtual API");

		const tools = processManager.getTools();
		expect(tools.length).toBe(initialCount + 1);

		const virtualTool = processManager.getTool(index);
		expect(virtualTool).toBeDefined();
		expect(virtualTool?.config.name).toBe("Virtual API");
		expect(virtualTool?.config.command).toBe("");
		expect(virtualTool?.status).toBe("running");
		expect(virtualTool?.process).toBeNull();
		expect(virtualTool?.logs).toEqual([]);
	});

	test("addLogToTool - adds log messages to a tool", async () => {
		const configs: ToolConfig[] = [{ name: "log-test", command: "echo" }];

		await processManager.initialize(configs);

		const result = processManager.getToolByName("log-test");
		if (!result) throw new Error("Expected log-test to exist");

		processManager.addLogToTool(result.index, "First log message");
		processManager.addLogToTool(result.index, "Second log message");

		const tool = processManager.getTool(result.index);
		expect(tool?.logs.length).toBe(2);
		expect(tool?.logs[0]?.segments[0]?.text).toBe("First log message");
		expect(tool?.logs[1]?.segments[0]?.text).toBe("Second log message");
	});

	test("addLogToTool - handles invalid index gracefully", async () => {
		const configs: ToolConfig[] = [{ name: "test", command: "echo" }];

		await processManager.initialize(configs);

		// Should not throw for invalid index
		expect(() => processManager.addLogToTool(999, "test")).not.toThrow();
	});

	test("createVirtualTool + addLogToTool work together", async () => {
		const configs: ToolConfig[] = [];
		await processManager.initialize(configs);

		const virtualIndex = processManager.createVirtualTool("MCP Server");

		processManager.addLogToTool(virtualIndex, "[12:00:00] Server started");
		processManager.addLogToTool(
			virtualIndex,
			"[12:00:01] Listening on port 8080",
		);

		const virtualTool = processManager.getTool(virtualIndex);
		expect(virtualTool?.logs.length).toBe(2);
		expect(virtualTool?.logs[0]?.segments[0]?.text).toContain("Server started");
		expect(virtualTool?.logs[1]?.segments[0]?.text).toContain("Listening");
	});

	test("getToolByName works after createVirtualTool", async () => {
		const configs: ToolConfig[] = [
			{ name: "app-server", command: "node", args: ["server.js"] },
		];

		await processManager.initialize(configs);
		processManager.createVirtualTool("API Logger");

		// Should still find the original tool
		const appResult = processManager.getToolByName("app-server");
		expect(appResult).toBeDefined();
		expect(appResult?.tool.config.name).toBe("app-server");

		// Should find the virtual tool
		const apiResult = processManager.getToolByName("API Logger");
		expect(apiResult).toBeDefined();
		expect(apiResult?.tool.config.name).toBe("API Logger");
	});

	// =========================================================================
	// Config Path and Reload Tests
	// =========================================================================

	test("setConfigPath/getConfigPath - stores and retrieves config path", async () => {
		const configs: ToolConfig[] = [{ name: "test", command: "echo" }];
		await processManager.initialize(configs);

		expect(processManager.getConfigPath()).toBeUndefined();

		processManager.setConfigPath("/path/to/config.toml");
		expect(processManager.getConfigPath()).toBe("/path/to/config.toml");
	});

	test("reload - throws error when config path not set", async () => {
		const configs: ToolConfig[] = [{ name: "test", command: "echo" }];
		await processManager.initialize(configs);

		// Config path not set
		expect(processManager.getConfigPath()).toBeUndefined();

		await expect(processManager.reload()).rejects.toThrow(
			"Config path not set",
		);
	});

	test("reload - throws error when config file not found", async () => {
		const configs: ToolConfig[] = [{ name: "test", command: "echo" }];
		await processManager.initialize(configs);
		processManager.setConfigPath("/nonexistent/path/config.toml");

		await expect(processManager.reload()).rejects.toThrow(
			"Config file not found",
		);
	});

	test("reload - preserves virtual tools across reload", async () => {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const os = await import("node:os");

		// Create a temp config file
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "corsa-test-"));
		const configPath = path.join(tempDir, "config.toml");
		await fs.writeFile(
			configPath,
			`
[[tools]]
name = "tool-a"
command = "echo"
args = ["a"]

[[tools]]
name = "tool-b"
command = "echo"
args = ["b"]
`,
		);

		try {
			// Initialize with different tools
			const initialConfigs: ToolConfig[] = [
				{ name: "old-tool", command: "echo", args: ["old"] },
			];
			await processManager.initialize(initialConfigs);
			processManager.setConfigPath(configPath);

			// Create a virtual tool
			const virtualIndex = processManager.createVirtualTool("MCP API");
			processManager.addLogToTool(virtualIndex, "Virtual tool log line");

			// Verify initial state
			expect(processManager.getTools().length).toBe(2); // old-tool + MCP API
			expect(processManager.getToolByName("old-tool")).toBeDefined();
			expect(processManager.getToolByName("MCP API")).toBeDefined();

			// Reload config
			const { tools, warnings } = await processManager.reload();

			// Should have new tools + virtual tool
			expect(tools.length).toBe(3); // tool-a + tool-b + MCP API
			expect(warnings.length).toBe(0);

			// Old tool should be gone
			expect(processManager.getToolByName("old-tool")).toBeUndefined();

			// New tools should exist
			expect(processManager.getToolByName("tool-a")).toBeDefined();
			expect(processManager.getToolByName("tool-b")).toBeDefined();

			// Virtual tool should still exist with its logs preserved
			const mcpResult = processManager.getToolByName("MCP API");
			expect(mcpResult).toBeDefined();
			expect(mcpResult?.tool.config.name).toBe("MCP API");
			expect(mcpResult?.tool.logs.length).toBeGreaterThan(0);
			expect(mcpResult?.tool.logs[0]?.segments[0]?.text).toBe(
				"Virtual tool log line",
			);
		} finally {
			// Cleanup
			await fs.rm(tempDir, { recursive: true });
		}
	});

	test("reload - stops running processes before reloading", async () => {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const os = await import("node:os");

		// Create a temp config file
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "corsa-test-"));
		const configPath = path.join(tempDir, "config.toml");
		await fs.writeFile(
			configPath,
			`
[[tools]]
name = "new-tool"
command = "echo"
args = ["new"]
`,
		);

		try {
			// Initialize with a running process
			const initialConfigs: ToolConfig[] = [
				{ name: "running-tool", command: "sleep", args: ["60"] },
			];
			await processManager.initialize(initialConfigs);
			processManager.setConfigPath(configPath);

			// Start the process
			await processManager.startTool(0);
			expect(processManager.getTool(0)?.status).toBe("running");
			const oldPid = processManager.getTool(0)?.pid;
			expect(oldPid).toBeDefined();

			// Reload config
			await processManager.reload();

			// Old process should be gone, new tool should exist
			expect(processManager.getToolByName("running-tool")).toBeUndefined();
			expect(processManager.getToolByName("new-tool")).toBeDefined();
		} finally {
			await fs.rm(tempDir, { recursive: true });
		}
	});

	test("reload - sets isShuttingDown during shutdown phase for UI feedback", async () => {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const os = await import("node:os");

		// Create a temp config file
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "corsa-test-"));
		const configPath = path.join(tempDir, "config.toml");
		await fs.writeFile(
			configPath,
			`
[[tools]]
name = "new-tool"
command = "echo"
args = ["new"]
`,
		);

		try {
			// Initialize with a running process
			const initialConfigs: ToolConfig[] = [
				{ name: "running-tool", command: "sleep", args: ["60"] },
			];
			await processManager.initialize(initialConfigs);
			processManager.setConfigPath(configPath);

			// Start the process
			await processManager.startTool(0);
			expect(processManager.getTool(0)?.status).toBe("running");

			// Track isShuttingDown state changes via subscriber
			let sawShuttingDownTrue = false;
			const unsubscribe = processManager.subscribe("all", () => {
				if (processManager.getIsShuttingDown()) {
					sawShuttingDownTrue = true;
				}
			});

			// Reload config - this should temporarily set isShuttingDown = true
			await processManager.reload();

			unsubscribe();

			// Should have seen isShuttingDown = true during reload
			expect(sawShuttingDownTrue).toBe(true);

			// After reload completes, isShuttingDown should be false
			expect(processManager.getIsShuttingDown()).toBe(false);
		} finally {
			await fs.rm(tempDir, { recursive: true });
		}
	});

	test("reload - marks processes as shuttingDown status before stopping", async () => {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const os = await import("node:os");

		// Create a temp config file
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "corsa-test-"));
		const configPath = path.join(tempDir, "config.toml");
		await fs.writeFile(
			configPath,
			`
[[tools]]
name = "new-tool"
command = "echo"
`,
		);

		try {
			const initialConfigs: ToolConfig[] = [
				{ name: "running-tool", command: "sleep", args: ["60"] },
			];
			await processManager.initialize(initialConfigs);
			processManager.setConfigPath(configPath);

			await processManager.startTool(0);
			expect(processManager.getTool(0)?.status).toBe("running");

			// Track status changes
			let sawShuttingDownStatus = false;
			const unsubscribe = processManager.subscribe(0, () => {
				const tool = processManager.getTool(0);
				if (tool?.status === "shuttingDown") {
					sawShuttingDownStatus = true;
				}
			});

			await processManager.reload();

			unsubscribe();

			// Should have seen the shuttingDown status during reload
			expect(sawShuttingDownStatus).toBe(true);
		} finally {
			await fs.rm(tempDir, { recursive: true });
		}
	});

	test("reload - uses provided config path over stored path", async () => {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const os = await import("node:os");

		// Create two temp config files
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "corsa-test-"));
		const configPath1 = path.join(tempDir, "config1.toml");
		const configPath2 = path.join(tempDir, "config2.toml");

		await fs.writeFile(
			configPath1,
			`
[[tools]]
name = "from-config-1"
command = "echo"
`,
		);
		await fs.writeFile(
			configPath2,
			`
[[tools]]
name = "from-config-2"
command = "echo"
`,
		);

		try {
			const configs: ToolConfig[] = [{ name: "initial", command: "echo" }];
			await processManager.initialize(configs);
			processManager.setConfigPath(configPath1);

			// Reload with explicit path (overrides stored path)
			await processManager.reload(configPath2);

			// Should have loaded from config2
			expect(processManager.getToolByName("from-config-2")).toBeDefined();
			expect(processManager.getToolByName("from-config-1")).toBeUndefined();
		} finally {
			await fs.rm(tempDir, { recursive: true });
		}
	});

	// =========================================================================
	// Orphan Cleanup Tests
	// =========================================================================

	test("initialize - cleanupOrphans defaults to true", async () => {
		// This test just verifies the option is accepted
		// Actual orphan cleanup is difficult to test without mocking
		const configs: ToolConfig[] = [{ name: "test", command: "echo" }];

		// Default behavior (cleanupOrphans = true)
		await processManager.initialize(configs);

		const tools = processManager.getTools();
		expect(tools).toHaveLength(1);
	});

	test("initialize - cleanupOrphans can be disabled", async () => {
		const configs: ToolConfig[] = [{ name: "test", command: "echo" }];

		// Explicitly disable orphan cleanup
		await processManager.initialize(configs, { cleanupOrphans: false });

		const tools = processManager.getTools();
		expect(tools).toHaveLength(1);
	});

	test("initialize - cleanupOrphans true is explicit option", async () => {
		const configs: ToolConfig[] = [{ name: "test", command: "echo" }];

		// Explicitly enable orphan cleanup
		await processManager.initialize(configs, { cleanupOrphans: true });

		const tools = processManager.getTools();
		expect(tools).toHaveLength(1);
	});

	test("initialize - returns already_dead orphan results for stale PIDs", async () => {
		// Write a PID file with a PID that doesn't exist (simulates a crashed session)
		const pidData: PidFileData = {
			version: 1,
			processes: [
				{
					toolIndex: 0,
					toolName: "my-server",
					pid: 999999,
					startTime: Date.now() - 60000,
					command: "node",
					args: ["server.js"],
					cwd: process.cwd(),
				},
			],
		};
		await savePidFile(pidData);

		const configs: ToolConfig[] = [
			{ name: "my-server", command: "echo", args: ["hi"] },
		];
		const { orphanCleanup } = await processManager.initialize(configs);

		expect(orphanCleanup).toHaveLength(1);
		expect(orphanCleanup[0]?.toolName).toBe("my-server");
		expect(orphanCleanup[0]?.pid).toBe(999999);
		expect(orphanCleanup[0]?.status).toBe("already_dead");
	});

	test("initialize - orphan cleanup injects pending log into tool on start", async () => {
		// Write a PID file referencing a real process we can kill
		const child = Bun.spawn(["sleep", "60"]);
		const childPid = child.pid;

		const pidData: PidFileData = {
			version: 1,
			processes: [
				{
					toolIndex: 0,
					toolName: "my-server",
					pid: childPid,
					startTime: Date.now(),
					command: "sleep",
					args: ["60"],
					cwd: process.cwd(),
				},
			],
		};
		await savePidFile(pidData);

		const configs: ToolConfig[] = [
			{ name: "my-server", command: "echo", args: ["hello"] },
		];
		const { orphanCleanup } = await processManager.initialize(configs);

		expect(orphanCleanup).toHaveLength(1);
		expect(orphanCleanup[0]?.status).toBe("killed");

		// Before starting, logs should be empty
		expect(processManager.getTool(0)?.logs).toEqual([]);

		// Start the tool — pending log should be injected after logs are cleared
		await processManager.startTool(0);
		await waitForProcessExit(processManager, 0);

		const tool = processManager.getTool(0);
		const hasCleanupLog = tool?.logs.some((log) =>
			log.segments.some((s) => s.text.includes("[PID Cleanup]")),
		);
		expect(hasCleanupLog).toBe(true);

		// Verify the cleanup log is the first entry
		expect(tool?.logs[0]?.segments[0]?.text).toContain("[PID Cleanup]");
		expect(tool?.logs[0]?.segments[0]?.text).toContain(String(childPid));
	});

	test("initialize - pending cleanup logs are only injected once", async () => {
		const pidData: PidFileData = {
			version: 1,
			processes: [
				{
					toolIndex: 0,
					toolName: "my-tool",
					pid: 999999,
					startTime: Date.now() - 60000,
					command: "echo",
					args: [],
					cwd: process.cwd(),
				},
			],
		};
		await savePidFile(pidData);

		// The PID is dead, so no cleanup log is injected (status: already_dead)
		// To test the "only once" behavior, we need a killed process.
		// Instead, test with a live process:
		const child = Bun.spawn(["sleep", "60"]);
		const pidData2: PidFileData = {
			version: 1,
			processes: [
				{
					toolIndex: 0,
					toolName: "my-tool",
					pid: child.pid,
					startTime: Date.now(),
					command: "sleep",
					args: ["60"],
					cwd: process.cwd(),
				},
			],
		};
		await savePidFile(pidData2);

		const configs: ToolConfig[] = [
			{ name: "my-tool", command: "echo", args: ["hi"] },
		];
		await processManager.initialize(configs);

		// First start: cleanup log should appear
		await processManager.startTool(0);
		await waitForProcessExit(processManager, 0);

		const logsAfterFirstStart = processManager.getTool(0)?.logs ?? [];
		const cleanupCount = logsAfterFirstStart.filter((log) =>
			log.segments.some((s) => s.text.includes("[PID Cleanup]")),
		).length;
		expect(cleanupCount).toBe(1);

		// Restart: cleanup log should NOT appear again
		await processManager.restartTool(0);
		await waitForProcessExit(processManager, 0);

		const logsAfterRestart = processManager.getTool(0)?.logs ?? [];
		const cleanupCountAfterRestart = logsAfterRestart.filter((log) =>
			log.segments.some((s) => s.text.includes("[PID Cleanup]")),
		).length;
		expect(cleanupCountAfterRestart).toBe(0);
	});

	test("initialize - no orphan cleanup when cleanupOrphans is disabled", async () => {
		const child = Bun.spawn(["sleep", "60"]);
		const pidData: PidFileData = {
			version: 1,
			processes: [
				{
					toolIndex: 0,
					toolName: "my-tool",
					pid: child.pid,
					startTime: Date.now(),
					command: "sleep",
					args: ["60"],
					cwd: process.cwd(),
				},
			],
		};
		await savePidFile(pidData);

		const configs: ToolConfig[] = [
			{ name: "my-tool", command: "echo", args: ["hi"] },
		];
		const { orphanCleanup } = await processManager.initialize(configs, {
			cleanupOrphans: false,
		});

		expect(orphanCleanup).toEqual([]);

		// Start the tool — no cleanup log should appear
		await processManager.startTool(0);
		await waitForProcessExit(processManager, 0);

		const tool = processManager.getTool(0);
		const hasCleanupLog = tool?.logs.some((log) =>
			log.segments.some((s) => s.text.includes("[PID Cleanup]")),
		);
		expect(hasCleanupLog).toBe(false);

		// Clean up the sleep process we spawned
		try {
			child.kill("SIGKILL");
		} catch {
			// already dead
		}
	});

	// =========================================================================
	// Interactive / PTY Tests
	// =========================================================================

	test("interactive tool - starts with PTY and captures output", async () => {
		// Use printf + sleep to ensure the process lives long enough for the PTY
		// to capture output (echo exits too fast for PTY to reliably report)
		const configs: ToolConfig[] = [
			{
				name: "interactive-echo",
				command: "bash",
				args: ["-c", "echo 'hello from pty'; sleep 1"],
				interactive: true,
			},
		];

		await processManager.initialize(configs);
		await processManager.startTool(0);

		const tool = processManager.getTool(0);
		expect(tool?.pid).toBeDefined();
		if (tool?.pid) {
			expect(tool.pid).toBeGreaterThan(0);
		}

		// Wait for process to complete
		await waitForProcessExit(processManager, 0, 5000);

		// Should have captured the output through the PTY
		const hasOutput = tool?.logs?.some((logLine) =>
			logLine.segments.some((segment) =>
				segment.text.includes("hello from pty"),
			),
		);
		expect(hasOutput).toBe(true);
	});

	test("interactive tool - writeToProcess sends data to PTY", async () => {
		// Use 'cat' which echoes stdin back to stdout via PTY
		const configs: ToolConfig[] = [
			{
				name: "interactive-cat",
				command: "cat",
				interactive: true,
			},
		];

		await processManager.initialize(configs);
		await processManager.startTool(0);
		expect(processManager.getTool(0)?.status).toBe("running");

		// Write data to the process
		const written = processManager.writeToProcess(0, "hello world\n");
		expect(written).toBe(true);

		// Give the PTY time to echo back the input
		await new Promise((resolve) => setTimeout(resolve, 500));

		const tool = processManager.getTool(0);
		// PTY should have echoed the input back via the VirtualTerminal
		const hasEcho = tool?.screenLines?.some((logLine) =>
			logLine.segments.some((segment) => segment.text.includes("hello world")),
		);
		expect(hasEcho).toBe(true);
	});

	test("interactive tool - writeToProcess returns false for non-interactive tool", async () => {
		const configs: ToolConfig[] = [
			{
				name: "non-interactive",
				command: "sleep",
				args: ["10"],
			},
		];

		await processManager.initialize(configs);
		await processManager.startTool(0);
		expect(processManager.getTool(0)?.status).toBe("running");

		// Should return false because tool has no PTY terminal
		const result = processManager.writeToProcess(0, "test");
		expect(result).toBe(false);
	});

	test("interactive tool - writeToProcess returns false for invalid index", async () => {
		const configs: ToolConfig[] = [
			{
				name: "test",
				command: "echo",
				interactive: true,
			},
		];

		await processManager.initialize(configs);

		// Tool not started yet
		const result = processManager.writeToProcess(0, "test");
		expect(result).toBe(false);

		// Invalid index
		const result2 = processManager.writeToProcess(999, "test");
		expect(result2).toBe(false);
	});

	test("interactive tool - stopTool stops PTY process", async () => {
		const configs: ToolConfig[] = [
			{
				name: "interactive-sleep",
				command: "sleep",
				args: ["60"],
				interactive: true,
			},
		];

		await processManager.initialize(configs);
		await processManager.startTool(0);
		expect(processManager.getTool(0)?.status).toBe("running");

		await processManager.stopTool(0);
		const tool = processManager.getTool(0);
		expect(tool?.status).toBe("stopped");
	});

	test("interactive tool - restartTool restarts PTY process", async () => {
		const configs: ToolConfig[] = [
			{
				name: "interactive-restart",
				command: "sleep",
				args: ["60"],
				interactive: true,
			},
		];

		await processManager.initialize(configs);
		await processManager.startTool(0);

		const firstPid = processManager.getTool(0)?.pid;
		expect(firstPid).toBeDefined();

		await processManager.restartTool(0);

		const tool = processManager.getTool(0);
		expect(tool?.status).toBe("running");
		expect(tool?.pid).toBeDefined();
		expect(tool?.pid).not.toBe(firstPid);
	});

	test("non-interactive tool - config.interactive defaults to undefined", async () => {
		const configs: ToolConfig[] = [
			{
				name: "normal-tool",
				command: "echo",
				args: ["hello"],
			},
		];

		await processManager.initialize(configs);
		const tool = processManager.getTool(0);
		expect(tool?.config.interactive).toBeUndefined();
	});

	test("interactive tool - config.interactive is true", async () => {
		const configs: ToolConfig[] = [
			{
				name: "pty-tool",
				command: "echo",
				args: ["hello"],
				interactive: true,
			},
		];

		await processManager.initialize(configs);
		const tool = processManager.getTool(0);
		expect(tool?.config.interactive).toBe(true);
	});
});
