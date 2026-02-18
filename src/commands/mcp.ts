/**
 * MCP command - starts the MCP server for AI agent integration.
 *
 * This connects to corsa's HTTP API and exposes process management
 * capabilities to AI agents via the Model Context Protocol.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DEFAULT_MCP_PORT } from "../lib/api";
import { loadConfig } from "../lib/config";

// Types for API responses
interface ProcessSummary {
	name: string;
	description?: string;
	status: "running" | "stopped" | "error" | "shuttingDown" | "waiting";
	exitCode: number | null;
	logCount: number;
	pid?: number;
	uptime?: number;
	/** Health status if the tool has a health check configured */
	healthStatus?: "starting" | "healthy" | "unhealthy";
	/** Last 20 log lines (plain text) */
	recentLogs?: string[];
}

interface LogsResponse {
	name: string;
	totalLines: number;
	returnedLines: number;
	logs: string[];
}

interface ApiResponse<T> {
	ok: boolean;
	data?: T;
	error?: string;
}

/**
 * Make a request to the corsa HTTP API.
 */
async function apiRequest<T>(
	baseUrl: string,
	path: string,
	method: "GET" | "POST" = "GET",
	body?: unknown,
): Promise<T> {
	const url = `${baseUrl}${path}`;

	try {
		const init: RequestInit = { method };
		if (body !== undefined) {
			init.headers = { "Content-Type": "application/json" };
			init.body = JSON.stringify(body);
		}
		const response = await fetch(url, init);
		const json = (await response.json()) as ApiResponse<T>;

		if (!json.ok) {
			throw new Error(json.error ?? "Unknown API error");
		}

		return json.data as T;
	} catch (error) {
		if (error instanceof TypeError && error.message.includes("fetch")) {
			throw new Error(
				`Cannot connect to corsa API at ${baseUrl}. ` +
					"Make sure corsa is running with mcp.enabled = true in your config.",
			);
		}
		throw error;
	}
}

/**
 * Check if corsa API is reachable.
 */
async function checkHealth(baseUrl: string): Promise<boolean> {
	try {
		await apiRequest<{ status: string }>(baseUrl, "/api/health");
		return true;
	} catch {
		return false;
	}
}

/**
 * Run the MCP server.
 * @param configPath Optional path to config file to read MCP port from
 */
export async function runMcp(configPath?: string): Promise<void> {
	// Determine API URL from config or environment
	let apiUrl = process.env.CORSA_API_URL;

	if (!apiUrl) {
		// Try to read port from config
		try {
			const { config } = await loadConfig(configPath ?? "corsa.config.toml");
			const port = config.mcp?.port ?? DEFAULT_MCP_PORT;
			apiUrl = `http://localhost:${port}`;
		} catch {
			// Config not found, use default
			apiUrl = `http://localhost:${DEFAULT_MCP_PORT}`;
		}
	}

	// Create MCP server
	const server = new McpServer({
		name: "corsa",
		version: "1.0.0",
		description:
			"Interact with local development processes managed by corsa. " +
			"Use these tools to read logs, debug errors, and control running servers. " +
			"Helpful when: debugging build/runtime errors, checking if a server started correctly, " +
			"viewing application output, or restarting crashed processes.",
	});

	// Register tools

	// list_processes - List all processes with their status
	server.tool(
		"list_processes",
		"List all running development processes (servers, workers, etc.) with their status. " +
			"Use this to see what's running, check if processes crashed, or find the name of a process to get logs from.",
		{},
		async () => {
			const processes = await apiRequest<ProcessSummary[]>(
				apiUrl,
				"/api/processes",
			);

			const formatted = processes
				.map((p) => {
					const status = p.status.toUpperCase();
					const exitInfo = p.exitCode !== null ? ` (exit: ${p.exitCode})` : "";
					const pidInfo = p.pid ? ` [PID: ${p.pid}]` : "";
					const uptimeInfo = p.uptime
						? ` (up ${Math.round(p.uptime / 1000)}s)`
						: "";
					const healthInfo = p.healthStatus
						? ` [health: ${p.healthStatus}]`
						: "";
					const desc = p.description ? `\n  ${p.description}` : "";

					// Format recent logs with indentation
					let logsSection = "";
					if (p.recentLogs && p.recentLogs.length > 0) {
						const logsHeader =
							p.recentLogs.length < p.logCount
								? `\n  Recent logs (last ${p.recentLogs.length} of ${p.logCount}):`
								: `\n  Logs (${p.logCount} lines):`;
						const logsText = p.recentLogs
							.map((line) => `    ${line}`)
							.join("\n");
						logsSection = `${logsHeader}\n${logsText}`;
					}

					return `- ${p.name}: ${status}${exitInfo}${pidInfo}${uptimeInfo}${healthInfo} (${p.logCount} lines)${desc}${logsSection}`;
				})
				.join("\n\n");

			return {
				content: [
					{
						type: "text",
						text: processes.length > 0 ? formatted : "No processes found",
					},
				],
			};
		},
	);

	// get_logs - Get recent logs from a process
	server.tool(
		"get_logs",
		"Get recent log output from a development process. " +
			"Use this to debug errors, see stack traces, check server startup messages, or find specific log entries. " +
			"Supports search filtering with substring (exact) or fuzzy matching.",
		{
			name: z.string().describe("Name of the process to get logs from"),
			lines: z
				.number()
				.optional()
				.describe("Number of recent lines to return (default: 100)"),
			search: z.string().optional().describe("Search query to filter logs"),
			searchType: z
				.enum(["substring", "fuzzy"])
				.optional()
				.describe(
					"Search type: 'substring' for exact match, 'fuzzy' for fuzzy matching (default: substring)",
				),
		},
		async ({ name, lines = 100, search, searchType = "substring" }) => {
			const params = new URLSearchParams();
			params.set("lines", String(lines));
			if (search) {
				params.set("search", search);
				params.set("searchType", searchType);
			}

			const response = await apiRequest<LogsResponse>(
				apiUrl,
				`/api/processes/${encodeURIComponent(name)}/logs?${params}`,
			);

			const header = `=== Logs for ${name} (${response.returnedLines}/${response.totalLines} lines) ===`;
			const logs = response.logs.join("\n");

			return {
				content: [
					{
						type: "text",
						text: logs ? `${header}\n${logs}` : `${header}\n(no logs)`,
					},
				],
			};
		},
	);

	// stop_process - Stop a running process
	server.tool(
		"stop_process",
		"Stop a running process gracefully",
		{
			name: z.string().describe("Name of the process to stop"),
		},
		async ({ name }) => {
			const result = await apiRequest<{ message: string }>(
				apiUrl,
				`/api/processes/${encodeURIComponent(name)}/stop`,
				"POST",
			);

			return {
				content: [{ type: "text", text: result.message }],
			};
		},
	);

	// restart_process - Restart a process
	server.tool(
		"restart_process",
		"Restart a development process to apply code changes or recover from a crash. " +
			"Use after making changes that require a server restart, or to recover a crashed process.",
		{
			name: z.string().describe("Name of the process to restart"),
		},
		async ({ name }) => {
			const result = await apiRequest<{ message: string }>(
				apiUrl,
				`/api/processes/${encodeURIComponent(name)}/restart`,
				"POST",
			);

			return {
				content: [{ type: "text", text: result.message }],
			};
		},
	);

	// clear_logs - Clear logs for a process
	server.tool(
		"clear_logs",
		"Clear all logs for a process",
		{
			name: z.string().describe("Name of the process to clear logs for"),
		},
		async ({ name }) => {
			const result = await apiRequest<{ message: string }>(
				apiUrl,
				`/api/processes/${encodeURIComponent(name)}/clear`,
				"POST",
			);

			return {
				content: [{ type: "text", text: result.message }],
			};
		},
	);

	// send_keys - Send keypresses to an interactive process
	server.tool(
		"send_keys",
		"Send virtual keypresses to an interactive process's terminal (PTY). " +
			"Use this to interact with CLI prompts, respond to confirmation dialogs, navigate menus, or type commands. " +
			"Only works for processes configured with interactive = true. " +
			"Each element in the keys array is either a special key name or literal text to type.\n\n" +
			"Special key names: return, backspace, tab, up, down, left, right, " +
			"home, end, delete, pageup, pagedown, insert, escape, f1-f12.\n" +
			"Ctrl combinations: ctrl+c, ctrl+d, ctrl+z, ctrl+l, etc.\n" +
			"Literal text is sent as-is, e.g. 'npm test' types those characters.",
		{
			name: z
				.string()
				.describe("Name of the interactive process to send keys to"),
			keys: z
				.array(z.string())
				.describe(
					"Array of key names or literal text to send. " +
						'Examples: ["y", "return"] to type y and press enter, ' +
						'["npm test", "return"] to type a command and run it, ' +
						'["ctrl+c"] to send an interrupt signal',
				),
		},
		async ({ name, keys }) => {
			const result = await apiRequest<{ message: string; sent: number }>(
				apiUrl,
				`/api/processes/${encodeURIComponent(name)}/input`,
				"POST",
				{ keys },
			);

			return {
				content: [{ type: "text", text: result.message }],
			};
		},
	);

	// reload_config - Reload the configuration file and restart all processes
	server.tool(
		"reload_config",
		"Reload the corsa configuration file and restart all processes. " +
			"Use this after modifying corsa.config.toml to apply changes without restarting corsa. " +
			"All running processes will be stopped and restarted with the new configuration.",
		{},
		async () => {
			const result = await apiRequest<{
				message: string;
				tools: string[];
				warnings: string[];
			}>(apiUrl, "/api/reload", "POST");

			let text = result.message;

			if (result.tools.length > 0) {
				text += `\n\nStarted processes:\n${result.tools.map((t) => `- ${t}`).join("\n")}`;
			}

			if (result.warnings.length > 0) {
				text += `\n\nWarnings:\n${result.warnings.map((w) => `- ${w}`).join("\n")}`;
			}

			return {
				content: [{ type: "text", text }],
			};
		},
	);

	// Register resources

	// corsa://processes - List all processes
	server.resource(
		"corsa://processes",
		"List of all processes managed by corsa",
		async () => {
			const processes = await apiRequest<ProcessSummary[]>(
				apiUrl,
				"/api/processes",
			);

			return {
				contents: [
					{
						uri: "corsa://processes",
						mimeType: "application/json",
						text: JSON.stringify(processes, null, 2),
					},
				],
			};
		},
	);

	// Check if corsa is reachable
	const healthy = await checkHealth(apiUrl);
	if (!healthy) {
		console.error(`Warning: Cannot connect to corsa API at ${apiUrl}`);
		console.error(
			"Make sure corsa is running with mcp.enabled = true in your config.",
		);
		// Continue anyway - the API might become available later
	}

	// Connect to stdio transport
	const transport = new StdioServerTransport();
	await server.connect(transport);
}
