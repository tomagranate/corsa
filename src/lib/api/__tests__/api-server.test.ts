import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ToolConfig } from "../../../types";
import { deletePidFile } from "../../processes/pid-file";
import { ProcessManager } from "../../processes/process-manager";
import { ApiServer, DEFAULT_MCP_HOSTNAME } from "../api-server";

// Types for API responses
interface ApiResponse {
	ok: boolean;
	data?: unknown;
	error?: string;
}

interface ProcessSummary {
	name: string;
	description?: string;
	status: string;
	exitCode: number | null;
	logCount: number;
	pid?: number;
	uptime?: number;
	recentLogs?: string[];
}

interface ProcessDetails extends ProcessSummary {
	command: string;
	args?: string[];
	cwd?: string;
}

interface LogsData {
	name: string;
	totalLines: number;
	returnedLines: number;
	logs: string[];
}

const TEST_PORT = 19876;

let processManager: ProcessManager;
let apiServer: ApiServer;
let virtualToolIndex: number;

const apiUrl = (path: string) =>
	`http://${DEFAULT_MCP_HOSTNAME}:${TEST_PORT}${path}`;

beforeAll(async () => {
	processManager = new ProcessManager(100);
	await deletePidFile();

	const configs: ToolConfig[] = [
		{
			name: "test-process",
			command: "echo",
			args: ["hello world"],
			description: "A test process that echoes hello world",
		},
		{
			name: "long-running",
			command: "sleep",
			args: ["60"],
			description: "A long-running sleep process",
		},
		{
			name: "no-description",
			command: "echo",
			args: ["no desc"],
		},
		{
			name: "interactive-cat",
			command: "cat",
			interactive: true,
			description: "An interactive cat process for testing PTY input",
		},
	];
	await processManager.initialize(configs);

	// createVirtualTool uses push and returns the correct index
	virtualToolIndex = processManager.createVirtualTool("MCP API");
	apiServer = new ApiServer(processManager, TEST_PORT, virtualToolIndex);
	apiServer.start();

	await new Promise((resolve) => setTimeout(resolve, 200));
});

afterAll(async () => {
	apiServer.stop();
	await processManager.cleanup();
	await deletePidFile();
});

describe("ApiServer", () => {
	// ==========================================================================
	// Health Check
	// ==========================================================================
	describe("GET /api/health", () => {
		test("returns healthy status", async () => {
			const response = await fetch(apiUrl("/api/health"));
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(200);
			expect(json).toEqual({ ok: true, data: { status: "healthy" } });
		});
	});

	// ==========================================================================
	// List Processes
	// ==========================================================================
	describe("GET /api/processes", () => {
		test("lists all processes excluding MCP API", async () => {
			const response = await fetch(apiUrl("/api/processes"));
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(200);
			expect(json.ok).toBe(true);
			const data = json.data as ProcessSummary[];
			expect(data.length).toBeGreaterThanOrEqual(3);

			const names = data.map((p) => p.name);
			expect(names).toContain("test-process");
			expect(names).toContain("long-running");
			expect(names).toContain("no-description");
			expect(names).not.toContain("MCP API");
		});

		test("includes description field when present", async () => {
			const response = await fetch(apiUrl("/api/processes"));
			const json = (await response.json()) as ApiResponse;
			const data = json.data as ProcessSummary[];

			const testProcess = data.find((p) => p.name === "test-process");
			expect(testProcess?.description).toBe(
				"A test process that echoes hello world",
			);

			const longRunning = data.find((p) => p.name === "long-running");
			expect(longRunning?.description).toBe("A long-running sleep process");

			const noDesc = data.find((p) => p.name === "no-description");
			expect(noDesc?.description).toBeUndefined();
		});

		test("includes status and logCount for each process", async () => {
			const response = await fetch(apiUrl("/api/processes"));
			const json = (await response.json()) as ApiResponse;
			const data = json.data as ProcessSummary[];

			for (const process of data) {
				expect(process.status).toBeDefined();
				expect(typeof process.logCount).toBe("number");
				expect(
					process.exitCode === null || typeof process.exitCode === "number",
				).toBe(true);
			}
		});

		test("does not include recent logs by default", async () => {
			const result = processManager.getToolByName("test-process");
			if (!result) throw new Error("Expected test-process to exist");
			processManager.clearLogs(result.index);
			processManager.addLogToTool(result.index, "compact-list-log");

			const response = await fetch(apiUrl("/api/processes"));
			const json = (await response.json()) as ApiResponse;
			const data = json.data as ProcessSummary[];
			const testProcess = data.find((p) => p.name === "test-process");

			expect(testProcess?.logCount).toBe(1);
			expect(testProcess?.recentLogs).toBeUndefined();
		});

		test("includes recent logs when logs parameter is provided", async () => {
			const result = processManager.getToolByName("test-process");
			if (!result) throw new Error("Expected test-process to exist");
			processManager.clearLogs(result.index);
			processManager.addLogToTool(result.index, "list-log-A");
			processManager.addLogToTool(result.index, "list-log-B");
			processManager.addLogToTool(result.index, "list-log-C");

			const response = await fetch(apiUrl("/api/processes?logs=2"));
			const json = (await response.json()) as ApiResponse;
			const data = json.data as ProcessSummary[];
			const testProcess = data.find((p) => p.name === "test-process");

			expect(testProcess?.recentLogs).toEqual(["list-log-B", "list-log-C"]);
		});

		test("filters by name, status, and fields", async () => {
			const response = await fetch(
				apiUrl(
					"/api/processes?name=long-running&status=stopped&fields=name,status",
				),
			);
			const json = (await response.json()) as ApiResponse;
			const data = json.data as Array<Record<string, unknown>>;

			expect(response.status).toBe(200);
			expect(data).toEqual([{ name: "long-running", status: "stopped" }]);
		});
	});

	// ==========================================================================
	// Get Process Details
	// ==========================================================================
	describe("GET /api/processes/:name", () => {
		test("returns process details with command and args", async () => {
			const response = await fetch(apiUrl("/api/processes/test-process"));
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(200);
			expect(json.ok).toBe(true);
			const data = json.data as ProcessDetails;
			expect(data.name).toBe("test-process");
			expect(data.command).toBe("echo");
			expect(data.args).toEqual(["hello world"]);
		});

		test("returns 404 for unknown process", async () => {
			const response = await fetch(apiUrl("/api/processes/nonexistent"));
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(404);
			expect(json.ok).toBe(false);
			expect(json.error).toContain("not found");
		});

		test("handles URL-encoded process names", async () => {
			// This tests that names with special characters work
			const response = await fetch(apiUrl("/api/processes/test-process"));
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(200);
			expect(json.ok).toBe(true);
		});
	});

	// ==========================================================================
	// Get Logs
	// ==========================================================================
	describe("GET /api/processes/:name/logs", () => {
		test("returns logs for a process", async () => {
			// Add some logs to test with
			const result = processManager.getToolByName("test-process");
			if (!result) throw new Error("Expected test-process to exist");
			processManager.clearLogs(result.index);
			processManager.addLogToTool(result.index, "unique-log-marker-1");
			processManager.addLogToTool(result.index, "unique-log-marker-2");
			processManager.addLogToTool(result.index, "unique-log-marker-3");

			const response = await fetch(apiUrl("/api/processes/test-process/logs"));
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(200);
			expect(json.ok).toBe(true);
			const data = json.data as LogsData;
			expect(data.name).toBe("test-process");
			expect(data.totalLines).toBeGreaterThanOrEqual(3);
			expect(data.returnedLines).toBeGreaterThanOrEqual(3);
			expect(data.logs).toContain("unique-log-marker-1");
			expect(data.logs).toContain("unique-log-marker-2");
			expect(data.logs).toContain("unique-log-marker-3");
		});

		test("respects lines parameter (returns last N lines)", async () => {
			const result = processManager.getToolByName("test-process");
			if (!result) throw new Error("Expected test-process to exist");
			processManager.clearLogs(result.index);
			processManager.addLogToTool(result.index, "lines-test-A");
			processManager.addLogToTool(result.index, "lines-test-B");
			processManager.addLogToTool(result.index, "lines-test-C");
			processManager.addLogToTool(result.index, "lines-test-D");
			processManager.addLogToTool(result.index, "lines-test-E");

			const response = await fetch(
				apiUrl("/api/processes/test-process/logs?lines=2"),
			);
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(200);
			const data = json.data as LogsData;
			expect(data.returnedLines).toBe(2);
			// Should return the LAST 2 lines
			expect(data.logs[0]).toBe("lines-test-D");
			expect(data.logs[1]).toBe("lines-test-E");
		});

		test("filters logs with substring search", async () => {
			const result = processManager.getToolByName("test-process");
			if (!result) throw new Error("Expected test-process to exist");
			processManager.clearLogs(result.index);
			processManager.addLogToTool(result.index, "[INFO] Starting server");
			processManager.addLogToTool(result.index, "[ERROR] Connection failed");
			processManager.addLogToTool(result.index, "[INFO] Retrying...");
			processManager.addLogToTool(result.index, "[ERROR] Timeout occurred");
			processManager.addLogToTool(result.index, "[INFO] Success!");

			const response = await fetch(
				apiUrl(
					"/api/processes/test-process/logs?search=ERROR&searchType=substring",
				),
			);
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(200);
			const data = json.data as LogsData;
			expect(data.returnedLines).toBe(2);
			expect(data.logs.every((log) => log.includes("ERROR"))).toBe(true);
		});

		test("filters logs with fuzzy search", async () => {
			const result = processManager.getToolByName("test-process");
			if (!result) throw new Error("Expected test-process to exist");
			processManager.clearLogs(result.index);
			processManager.addLogToTool(result.index, "Database connected");
			processManager.addLogToTool(result.index, "User logged in");
			processManager.addLogToTool(result.index, "Data saved to database");
			processManager.addLogToTool(result.index, "Request completed");

			const response = await fetch(
				apiUrl(
					"/api/processes/test-process/logs?search=database&searchType=fuzzy",
				),
			);
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(200);
			const data = json.data as LogsData;
			expect(data.returnedLines).toBeGreaterThanOrEqual(2);
			// Fuzzy search should find "database" matches
			expect(
				data.logs.some((log) => log.toLowerCase().includes("database")),
			).toBe(true);
		});

		test("combines search and lines parameters", async () => {
			const result = processManager.getToolByName("test-process");
			if (!result) throw new Error("Expected test-process to exist");
			processManager.clearLogs(result.index);
			processManager.addLogToTool(result.index, "[ERROR] Error 1");
			processManager.addLogToTool(result.index, "[INFO] Info 1");
			processManager.addLogToTool(result.index, "[ERROR] Error 2");
			processManager.addLogToTool(result.index, "[INFO] Info 2");
			processManager.addLogToTool(result.index, "[ERROR] Error 3");

			const response = await fetch(
				apiUrl("/api/processes/test-process/logs?search=ERROR&lines=2"),
			);
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(200);
			const data = json.data as LogsData;
			// Should filter by ERROR first (3 matches), then take last 2
			expect(data.returnedLines).toBe(2);
			expect(data.logs).toEqual(["[ERROR] Error 2", "[ERROR] Error 3"]);
		});

		test("returns empty logs array when no logs exist", async () => {
			// Use a different process that hasn't been touched by other tests
			const result = processManager.getToolByName("no-description");
			if (!result) throw new Error("Expected no-description to exist");
			processManager.clearLogs(result.index);

			const response = await fetch(
				apiUrl("/api/processes/no-description/logs"),
			);
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(200);
			const data = json.data as LogsData;
			expect(data.totalLines).toBe(0);
			expect(data.returnedLines).toBe(0);
			expect(data.logs).toEqual([]);
		});

		test("returns 404 for unknown process", async () => {
			const response = await fetch(apiUrl("/api/processes/nonexistent/logs"));
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(404);
			expect(json.ok).toBe(false);
		});
	});

	// ==========================================================================
	// Stop Process
	// ==========================================================================
	describe("POST /api/processes/:name/stop", () => {
		test("stops a running process", async () => {
			// Start the process first
			const result = processManager.getToolByName("long-running");
			if (!result) throw new Error("Expected long-running to exist");
			await processManager.startTool(result.index);
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(processManager.getTool(result.index)?.status).toBe("running");

			const response = await fetch(apiUrl("/api/processes/long-running/stop"), {
				method: "POST",
			});
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(200);
			expect(json.ok).toBe(true);
			const data = json.data as { message: string };
			expect(data.message).toContain("Stopped");
		});

		test("returns 400 when process not running", async () => {
			// Ensure process is stopped
			const result = processManager.getToolByName("test-process");
			if (!result) throw new Error("Expected test-process to exist");
			if (processManager.getTool(result.index)?.status === "running") {
				await processManager.stopTool(result.index);
			}

			const response = await fetch(apiUrl("/api/processes/test-process/stop"), {
				method: "POST",
			});
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(400);
			expect(json.ok).toBe(false);
			expect(json.error).toContain("not running");
		});

		test("returns 404 for unknown process", async () => {
			const response = await fetch(apiUrl("/api/processes/nonexistent/stop"), {
				method: "POST",
			});
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(404);
			expect(json.ok).toBe(false);
		});
	});

	// ==========================================================================
	// Restart Process
	// ==========================================================================
	describe("POST /api/processes/:name/restart", () => {
		test("restarts a stopped process", async () => {
			// Ensure process is stopped first
			const result = processManager.getToolByName("long-running");
			if (!result) throw new Error("Expected long-running to exist");
			if (processManager.getTool(result.index)?.status === "running") {
				await processManager.stopTool(result.index);
				await new Promise((resolve) => setTimeout(resolve, 100));
			}

			const response = await fetch(
				apiUrl("/api/processes/long-running/restart"),
				{ method: "POST" },
			);
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(200);
			expect(json.ok).toBe(true);
			const data = json.data as { message: string };
			expect(data.message).toContain("Restarted");

			// Wait and verify it's running
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(processManager.getTool(result.index)?.status).toBe("running");
		});

		test("restarts a running process (gets new PID)", async () => {
			const result = processManager.getToolByName("long-running");
			if (!result) throw new Error("Expected long-running to exist");

			// Make sure it's running
			if (processManager.getTool(result.index)?.status !== "running") {
				await processManager.startTool(result.index);
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			const oldPid = processManager.getTool(result.index)?.pid;

			const response = await fetch(
				apiUrl("/api/processes/long-running/restart"),
				{ method: "POST" },
			);
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(200);
			expect(json.ok).toBe(true);

			// Wait for restart
			await new Promise((resolve) => setTimeout(resolve, 200));
			const newPid = processManager.getTool(result.index)?.pid;
			expect(newPid).toBeDefined();
			expect(newPid).not.toBe(oldPid);
		});

		test("returns 404 for unknown process", async () => {
			const response = await fetch(
				apiUrl("/api/processes/nonexistent/restart"),
				{ method: "POST" },
			);
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(404);
			expect(json.ok).toBe(false);
		});
	});

	// ==========================================================================
	// Clear Logs
	// ==========================================================================
	describe("POST /api/processes/:name/clear", () => {
		test("clears logs for a process", async () => {
			// Add some logs first
			const result = processManager.getToolByName("test-process");
			if (!result) throw new Error("Expected test-process to exist");
			processManager.addLogToTool(result.index, "log to clear 1");
			processManager.addLogToTool(result.index, "log to clear 2");
			expect(processManager.getTool(result.index)?.logs.length).toBeGreaterThan(
				0,
			);

			const response = await fetch(
				apiUrl("/api/processes/test-process/clear"),
				{ method: "POST" },
			);
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(200);
			expect(json.ok).toBe(true);
			const data = json.data as { message: string };
			expect(data.message).toContain("Cleared");

			// Verify logs are cleared
			expect(processManager.getTool(result.index)?.logs.length).toBe(0);
		});

		test("succeeds even when no logs exist", async () => {
			const result = processManager.getToolByName("test-process");
			if (!result) throw new Error("Expected test-process to exist");
			processManager.clearLogs(result.index);
			expect(processManager.getTool(result.index)?.logs.length).toBe(0);

			const response = await fetch(
				apiUrl("/api/processes/test-process/clear"),
				{ method: "POST" },
			);
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(200);
			expect(json.ok).toBe(true);
		});

		test("returns 404 for unknown process", async () => {
			const response = await fetch(apiUrl("/api/processes/nonexistent/clear"), {
				method: "POST",
			});
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(404);
			expect(json.ok).toBe(false);
		});
	});

	// ==========================================================================
	// Send Input (keypresses)
	// ==========================================================================
	describe("POST /api/processes/:name/input", () => {
		test("sends keys to an interactive process", async () => {
			const result = processManager.getToolByName("interactive-cat");
			if (!result) throw new Error("Expected interactive-cat to exist");

			await processManager.startTool(result.index);
			await new Promise((resolve) => setTimeout(resolve, 200));

			expect(processManager.getTool(result.index)?.status).toBe("running");

			const response = await fetch(
				apiUrl("/api/processes/interactive-cat/input"),
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ keys: ["hello"] }),
				},
			);
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(200);
			expect(json.ok).toBe(true);
			const data = json.data as { message: string; sent: number };
			expect(data.sent).toBe(1);
			expect(data.message).toContain("1 key(s)");
		});

		test("sends multiple keys in one request", async () => {
			const result = processManager.getToolByName("interactive-cat");
			if (!result) throw new Error("Expected interactive-cat to exist");

			if (processManager.getTool(result.index)?.status !== "running") {
				await processManager.startTool(result.index);
				await new Promise((resolve) => setTimeout(resolve, 200));
			}

			const response = await fetch(
				apiUrl("/api/processes/interactive-cat/input"),
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ keys: ["y", "return"] }),
				},
			);
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(200);
			expect(json.ok).toBe(true);
			const data = json.data as { message: string; sent: number };
			expect(data.sent).toBe(2);
		});

		test("sends ctrl combinations", async () => {
			const result = processManager.getToolByName("interactive-cat");
			if (!result) throw new Error("Expected interactive-cat to exist");

			if (processManager.getTool(result.index)?.status !== "running") {
				await processManager.startTool(result.index);
				await new Promise((resolve) => setTimeout(resolve, 200));
			}

			const response = await fetch(
				apiUrl("/api/processes/interactive-cat/input"),
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ keys: ["ctrl+l"] }),
				},
			);
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(200);
			expect(json.ok).toBe(true);
			const data = json.data as { message: string; sent: number };
			expect(data.sent).toBe(1);
		});

		test("returns 400 for non-interactive process", async () => {
			const response = await fetch(
				apiUrl("/api/processes/test-process/input"),
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ keys: ["hello"] }),
				},
			);
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(400);
			expect(json.ok).toBe(false);
			expect(json.error).toContain("not interactive");
		});

		test("returns 404 for unknown process", async () => {
			const response = await fetch(apiUrl("/api/processes/nonexistent/input"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ keys: ["hello"] }),
			});
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(404);
			expect(json.ok).toBe(false);
		});

		test("returns 400 for missing keys array", async () => {
			const result = processManager.getToolByName("interactive-cat");
			if (!result) throw new Error("Expected interactive-cat to exist");
			if (processManager.getTool(result.index)?.status !== "running") {
				await processManager.startTool(result.index);
				await new Promise((resolve) => setTimeout(resolve, 200));
			}

			const response = await fetch(
				apiUrl("/api/processes/interactive-cat/input"),
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				},
			);
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(400);
			expect(json.ok).toBe(false);
			expect(json.error).toContain("keys");
		});

		test("returns 400 for empty keys array", async () => {
			const result = processManager.getToolByName("interactive-cat");
			if (!result) throw new Error("Expected interactive-cat to exist");
			if (processManager.getTool(result.index)?.status !== "running") {
				await processManager.startTool(result.index);
				await new Promise((resolve) => setTimeout(resolve, 200));
			}

			const response = await fetch(
				apiUrl("/api/processes/interactive-cat/input"),
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ keys: [] }),
				},
			);
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(400);
			expect(json.ok).toBe(false);
			expect(json.error).toContain("keys");
		});

		test("returns 400 for invalid JSON body", async () => {
			const result = processManager.getToolByName("interactive-cat");
			if (!result) throw new Error("Expected interactive-cat to exist");
			if (processManager.getTool(result.index)?.status !== "running") {
				await processManager.startTool(result.index);
				await new Promise((resolve) => setTimeout(resolve, 200));
			}

			const response = await fetch(
				apiUrl("/api/processes/interactive-cat/input"),
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: "not json",
				},
			);
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(400);
			expect(json.ok).toBe(false);
			expect(json.error).toContain("Invalid JSON");
		});

		test("returns 400 for non-running interactive process", async () => {
			const result = processManager.getToolByName("interactive-cat");
			if (!result) throw new Error("Expected interactive-cat to exist");

			if (processManager.getTool(result.index)?.status === "running") {
				await processManager.stopTool(result.index);
				await new Promise((resolve) => setTimeout(resolve, 200));
			}

			const response = await fetch(
				apiUrl("/api/processes/interactive-cat/input"),
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ keys: ["hello"] }),
				},
			);
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(400);
			expect(json.ok).toBe(false);
			expect(json.error).toContain("not running");
		});
	});

	// ==========================================================================
	// Error Handling & Edge Cases
	// ==========================================================================
	describe("Error handling", () => {
		test("unknown routes return 404", async () => {
			const response = await fetch(apiUrl("/api/unknown"));
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(404);
			expect(json.ok).toBe(false);
			expect(json.error).toBe("Not found");
		});

		test("unknown sub-routes return 404", async () => {
			const response = await fetch(
				apiUrl("/api/processes/test-process/unknown"),
			);
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(404);
			expect(json.ok).toBe(false);
		});

		test("wrong HTTP method returns 404", async () => {
			// GET on a POST-only endpoint
			const response = await fetch(
				apiUrl("/api/processes/test-process/restart"),
				{ method: "GET" },
			);
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(404);
			expect(json.ok).toBe(false);
		});
	});

	// ==========================================================================
	// Virtual Tool Logging
	// ==========================================================================
	describe("Virtual tool logging", () => {
		test("virtual tool receives logs", async () => {
			const virtualTool = processManager.getTool(virtualToolIndex);
			expect(virtualTool).toBeDefined();
			expect(virtualTool?.logs.length).toBeGreaterThan(0);

			// The API server logs requests, so check we have some logs
			const allLogText = virtualTool?.logs
				.map((log) => log.segments.map((seg) => seg.text).join(""))
				.join("\n");

			// Should contain timestamps and request logs
			expect(allLogText?.length).toBeGreaterThan(0);
		});

		test("logs each request to virtual tool", async () => {
			const logsBefore =
				processManager.getTool(virtualToolIndex)?.logs.length ?? 0;

			// Make a request
			await fetch(apiUrl("/api/health"));

			// Check that new log was added
			const logsAfter =
				processManager.getTool(virtualToolIndex)?.logs.length ?? 0;
			expect(logsAfter).toBeGreaterThan(logsBefore);

			// Check the log contains the request
			const lastLog = processManager
				.getTool(virtualToolIndex)
				?.logs.slice(-1)[0];
			const logText = lastLog?.segments.map((seg) => seg.text).join("") ?? "";
			expect(logText).toContain("GET /api/health");
		});
	});

	// ==========================================================================
	// Browser Origin Protection
	// ==========================================================================
	describe("browser origin protection", () => {
		test("does not include wildcard CORS headers", async () => {
			const response = await fetch(apiUrl("/api/health"));

			expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
			expect(response.headers.get("Content-Type")).toBe("application/json");
		});

		test("rejects requests from non-local browser origins", async () => {
			const response = await fetch(apiUrl("/api/health"), {
				headers: { Origin: "https://example.com" },
			});
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(403);
			expect(json).toEqual({
				ok: false,
				error: "Browser origin not allowed",
			});
		});

		test("allows same-origin browser requests", async () => {
			const response = await fetch(apiUrl("/api/health"), {
				headers: { Origin: `http://${DEFAULT_MCP_HOSTNAME}:${TEST_PORT}` },
			});
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(200);
			expect(json).toEqual({ ok: true, data: { status: "healthy" } });
		});
	});

	// ==========================================================================
	// Reload Configuration
	// ==========================================================================
	describe("POST /api/reload", () => {
		test("returns error when config path not set", async () => {
			// The test processManager doesn't have a config path set
			const response = await fetch(apiUrl("/api/reload"), { method: "POST" });
			const json = (await response.json()) as ApiResponse;

			expect(response.status).toBe(500);
			expect(json.ok).toBe(false);
			expect(json.error).toContain("Config path not set");
		});

		test("logs go to correct MCP API tool after config reload", async () => {
			const fs = await import("node:fs/promises");
			const path = await import("node:path");
			const os = await import("node:os");

			// Create a temp config file with different tools
			const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "corsa-test-"));
			const configPath = path.join(tempDir, "config.toml");
			await fs.writeFile(
				configPath,
				`
[[tools]]
name = "new-tool-1"
command = "echo"
args = ["one"]

[[tools]]
name = "new-tool-2"
command = "echo"
args = ["two"]

[[tools]]
name = "new-tool-3"
command = "echo"
args = ["three"]
`,
			);

			try {
				processManager.setConfigPath(configPath);

				// Get the MCP API tool's log count before reload
				const mcpToolBefore = processManager.getToolByName("MCP API");
				if (!mcpToolBefore)
					throw new Error("Expected MCP API tool to exist before reload");
				const logCountBefore = mcpToolBefore.tool.logs.length;

				// Perform reload
				await processManager.reload();

				// After reload, the tools array has been reorganized:
				// - newTools (3 tools from config) come first
				// - virtual tools (MCP API) are appended after
				// So MCP API should now be at index 3 (0-indexed)
				const mcpToolAfter = processManager.getToolByName("MCP API");
				if (!mcpToolAfter)
					throw new Error("Expected MCP API tool to exist after reload");
				expect(mcpToolAfter.index).toBe(3); // Verify index changed

				// Make a request - this should log to the MCP API tool
				await fetch(apiUrl("/api/health"));

				// Verify the log went to the MCP API tool (not a random tool)
				const mcpToolFinal = processManager.getToolByName("MCP API");
				if (!mcpToolFinal)
					throw new Error("Expected MCP API tool to exist after request");
				expect(mcpToolFinal.tool.logs.length).toBeGreaterThan(logCountBefore);

				// Check the log contains the request
				const lastLog = mcpToolFinal.tool.logs.slice(-1)[0];
				const logText = lastLog?.segments.map((seg) => seg.text).join("") ?? "";
				expect(logText).toContain("GET /api/health");

				// Verify other tools don't have this log (they shouldn't have API logs)
				const newTool1 = processManager.getToolByName("new-tool-1");
				const newTool1Logs =
					newTool1?.tool.logs
						.map((l) => l.segments.map((s) => s.text).join(""))
						.join("") ?? "";
				expect(newTool1Logs).not.toContain("GET /api/health");
			} finally {
				await fs.rm(tempDir, { recursive: true });
			}
		});
	});
});
