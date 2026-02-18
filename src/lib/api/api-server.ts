import type { Server } from "bun";
import type { HealthStatus } from "../../types";
import type { Config } from "../config";
import type { ProcessManager } from "../processes";
import { keyNameToPty } from "../processes/key-to-pty";
import { fuzzyFindLines, substringFindLines } from "../search";

/** Default port for the MCP API server */
export const DEFAULT_MCP_PORT = 18765;

/** Callback for config reload events */
export type OnConfigReloadCallback = (config: Config) => void;

/** Callback to get health status for a tool */
export type GetHealthStatusCallback = (toolName: string) => HealthStatus | null;

/** API response wrapper for success */
interface ApiSuccessResponse<T> {
	ok: true;
	data: T;
}

/** API response wrapper for errors */
interface ApiErrorResponse {
	ok: false;
	error: string;
}

type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/** Number of recent log lines to include in process list */
const RECENT_LOGS_COUNT = 20;

/** Process summary returned by list endpoint */
interface ProcessSummary {
	name: string;
	description?: string;
	status: "running" | "stopped" | "error" | "shuttingDown" | "waiting";
	exitCode: number | null;
	logCount: number;
	pid?: number;
	uptime?: number; // milliseconds since start
	/** Health status if the tool has a health check configured */
	healthStatus?: HealthStatus;
	/** Last N log lines (plain text) */
	recentLogs?: string[];
}

/** Full process details */
interface ProcessDetails extends ProcessSummary {
	command: string;
	args?: string[];
	cwd?: string;
	// healthStatus is inherited from ProcessSummary
}

/** Name of the virtual tool used for MCP API logs */
const MCP_API_TOOL_NAME = "MCP API";

/**
 * HTTP API server for MCP integration.
 * Runs in-process and logs to a virtual tool tab.
 */
export class ApiServer {
	private server: Server | null = null;
	private processManager: ProcessManager;
	private port: number;
	private onConfigReload: OnConfigReloadCallback | null = null;
	private getHealthStatus: GetHealthStatusCallback | null = null;

	constructor(
		processManager: ProcessManager,
		port: number,
		_toolIndex: number,
	) {
		this.processManager = processManager;
		this.port = port;
		// Note: toolIndex parameter kept for backward compatibility but not used.
		// We look up the tool by name to handle index changes after config reload.
	}

	/**
	 * Set a callback to be called when config is reloaded.
	 * The callback receives the new config so UI can update accordingly.
	 */
	setOnConfigReload(callback: OnConfigReloadCallback): void {
		this.onConfigReload = callback;
	}

	/**
	 * Set a callback to get health status for a tool.
	 * Returns the health status (starting/healthy/unhealthy) or null if no health check configured.
	 */
	setGetHealthStatus(callback: GetHealthStatusCallback): void {
		this.getHealthStatus = callback;
	}

	/**
	 * Start the HTTP server.
	 */
	start(): void {
		this.server = Bun.serve({
			port: this.port,
			fetch: (req) => this.handleRequest(req),
		});
		this.log(`MCP API server listening on http://localhost:${this.port}`);
		this.log("Endpoints:");
		this.log("  GET  /api/health");
		this.log("  GET  /api/processes");
		this.log("  GET  /api/processes/:name");
		this.log("  GET  /api/processes/:name/logs");
		this.log("  POST /api/processes/:name/stop");
		this.log("  POST /api/processes/:name/restart");
		this.log("  POST /api/processes/:name/clear");
		this.log("  POST /api/processes/:name/input");
		this.log("  POST /api/reload");
	}

	/**
	 * Stop the HTTP server.
	 */
	stop(): void {
		if (this.server) {
			this.server.stop();
			this.server = null;
			this.log("MCP API server stopped");
		}
	}

	/**
	 * Log a message to the virtual tool tab.
	 * Looks up the tool by name to handle index changes after config reload.
	 */
	private log(message: string): void {
		const result = this.processManager.getToolByName(MCP_API_TOOL_NAME);
		if (!result) return; // Virtual tool not found (shouldn't happen)

		const timestamp = new Date().toISOString().slice(11, 19); // HH:MM:SS
		this.processManager.addLogToTool(result.index, `[${timestamp}] ${message}`);
	}

	/**
	 * Handle an incoming HTTP request.
	 */
	private async handleRequest(req: Request): Promise<Response> {
		const url = new URL(req.url);
		const path = url.pathname;
		const method = req.method;

		// Log the request
		this.log(`${method} ${path}`);

		try {
			// Health check
			if (path === "/api/health" && method === "GET") {
				return this.jsonResponse({ ok: true, data: { status: "healthy" } });
			}

			// Reload configuration
			if (path === "/api/reload" && method === "POST") {
				return await this.handleReload();
			}

			// List all processes
			if (path === "/api/processes" && method === "GET") {
				return this.handleListProcesses();
			}

			// Process-specific routes
			const processMatch = path.match(/^\/api\/processes\/([^/]+)(\/.*)?$/);
			if (processMatch) {
				const name = decodeURIComponent(processMatch[1] ?? "");
				const subPath = processMatch[2] ?? "";

				// Get process details
				if (subPath === "" && method === "GET") {
					return this.handleGetProcess(name);
				}

				// Get process logs
				if (subPath === "/logs" && method === "GET") {
					const lines = url.searchParams.get("lines");
					const search = url.searchParams.get("search");
					const searchType = url.searchParams.get("searchType") as
						| "substring"
						| "fuzzy"
						| null;
					return this.handleGetLogs(name, {
						lines: lines ? parseInt(lines, 10) : undefined,
						search: search ?? undefined,
						searchType: searchType ?? "substring",
					});
				}

				// Stop process
				if (subPath === "/stop" && method === "POST") {
					return this.handleStopProcess(name);
				}

				// Restart process
				if (subPath === "/restart" && method === "POST") {
					return this.handleRestartProcess(name);
				}

				// Clear logs
				if (subPath === "/clear" && method === "POST") {
					return this.handleClearLogs(name);
				}

				// Send input to interactive process
				if (subPath === "/input" && method === "POST") {
					return await this.handleSendInput(name, req);
				}
			}

			// Not found
			return this.jsonResponse({ ok: false, error: "Not found" }, 404);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.log(`Error: ${message}`);
			return this.jsonResponse({ ok: false, error: message }, 500);
		}
	}

	/**
	 * List all processes with summary information.
	 */
	private handleListProcesses(): Response {
		const tools = this.processManager.getTools();
		const processes: ProcessSummary[] = tools
			.filter((tool) => tool.config.name !== "MCP API") // Exclude self
			.map((tool) => {
				// Get recent logs as plain text
				const recentLogs = tool.logs
					.slice(-RECENT_LOGS_COUNT)
					.map((logLine) => logLine.segments.map((seg) => seg.text).join(""));

				const summary: ProcessSummary = {
					name: tool.config.name,
					description: tool.config.description,
					status: tool.status,
					exitCode: tool.exitCode,
					logCount: tool.logs.length,
					pid: tool.pid,
					uptime: tool.startTime ? Date.now() - tool.startTime : undefined,
					recentLogs,
				};

				// Include health status if available
				if (tool.config.healthCheck && this.getHealthStatus) {
					const healthStatus = this.getHealthStatus(tool.config.name);
					if (healthStatus) {
						summary.healthStatus = healthStatus;
					}
				}

				return summary;
			});

		return this.jsonResponse({ ok: true, data: processes });
	}

	/**
	 * Get details for a specific process.
	 */
	private handleGetProcess(name: string): Response {
		const result = this.processManager.getToolByName(name);
		if (!result) {
			return this.jsonResponse(
				{ ok: false, error: `Process not found: ${name}` },
				404,
			);
		}

		const { tool } = result;
		const details: ProcessDetails = {
			name: tool.config.name,
			status: tool.status,
			exitCode: tool.exitCode,
			logCount: tool.logs.length,
			pid: tool.pid,
			uptime: tool.startTime ? Date.now() - tool.startTime : undefined,
			command: tool.config.command,
			args: tool.config.args,
			cwd: tool.config.cwd,
		};

		// Include health status if available
		if (tool.config.healthCheck && this.getHealthStatus) {
			const healthStatus = this.getHealthStatus(tool.config.name);
			if (healthStatus) {
				details.healthStatus = healthStatus;
			}
		}

		return this.jsonResponse({ ok: true, data: details });
	}

	/**
	 * Get logs for a specific process with optional filtering.
	 */
	private handleGetLogs(
		name: string,
		options: {
			lines?: number;
			search?: string;
			searchType: "substring" | "fuzzy";
		},
	): Response {
		const result = this.processManager.getToolByName(name);
		if (!result) {
			return this.jsonResponse(
				{ ok: false, error: `Process not found: ${name}` },
				404,
			);
		}

		const { tool } = result;

		// Convert logs to plain text
		let logTexts = tool.logs.map((logLine) =>
			logLine.segments.map((seg) => seg.text).join(""),
		);

		// Apply search filter if provided
		if (options.search) {
			const matchingIndices =
				options.searchType === "fuzzy"
					? fuzzyFindLines(logTexts, options.search).map((m) => m.index)
					: substringFindLines(logTexts, options.search);

			logTexts = matchingIndices.map((i) => logTexts[i] ?? "");
		}

		// Apply line limit (from the end)
		if (options.lines && options.lines > 0) {
			logTexts = logTexts.slice(-options.lines);
		}

		return this.jsonResponse({
			ok: true,
			data: {
				name,
				totalLines: tool.logs.length,
				returnedLines: logTexts.length,
				logs: logTexts,
			},
		});
	}

	/**
	 * Stop a running process.
	 */
	private async handleStopProcess(name: string): Promise<Response> {
		const result = this.processManager.getToolByName(name);
		if (!result) {
			return this.jsonResponse(
				{ ok: false, error: `Process not found: ${name}` },
				404,
			);
		}

		const { index, tool } = result;

		if (tool.status !== "running") {
			return this.jsonResponse(
				{ ok: false, error: `Process is not running: ${name}` },
				400,
			);
		}

		this.log(`Stopping process: ${name}`);
		await this.processManager.stopTool(index);

		return this.jsonResponse({
			ok: true,
			data: { message: `Stopped: ${name}` },
		});
	}

	/**
	 * Restart a process.
	 */
	private async handleRestartProcess(name: string): Promise<Response> {
		const result = this.processManager.getToolByName(name);
		if (!result) {
			return this.jsonResponse(
				{ ok: false, error: `Process not found: ${name}` },
				404,
			);
		}

		const { index } = result;

		this.log(`Restarting process: ${name}`);
		await this.processManager.restartTool(index);

		return this.jsonResponse({
			ok: true,
			data: { message: `Restarted: ${name}` },
		});
	}

	/**
	 * Clear logs for a process.
	 */
	private handleClearLogs(name: string): Response {
		const result = this.processManager.getToolByName(name);
		if (!result) {
			return this.jsonResponse(
				{ ok: false, error: `Process not found: ${name}` },
				404,
			);
		}

		const { index } = result;

		this.log(`Clearing logs for: ${name}`);
		this.processManager.clearLogs(index);

		return this.jsonResponse({
			ok: true,
			data: { message: `Cleared logs: ${name}` },
		});
	}

	/**
	 * Send input (keypresses) to an interactive process's PTY.
	 */
	private async handleSendInput(name: string, req: Request): Promise<Response> {
		const result = this.processManager.getToolByName(name);
		if (!result) {
			return this.jsonResponse(
				{ ok: false, error: `Process not found: ${name}` },
				404,
			);
		}

		const { index, tool } = result;

		if (!tool.config.interactive) {
			return this.jsonResponse(
				{
					ok: false,
					error: `Process is not interactive: ${name}. Set interactive = true in the tool config to enable PTY input.`,
				},
				400,
			);
		}

		if (tool.status !== "running") {
			return this.jsonResponse(
				{ ok: false, error: `Process is not running: ${name}` },
				400,
			);
		}

		let body: { keys?: unknown };
		try {
			body = (await req.json()) as { keys?: unknown };
		} catch {
			return this.jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
		}

		if (!Array.isArray(body.keys) || body.keys.length === 0) {
			return this.jsonResponse(
				{
					ok: false,
					error:
						'Missing or empty "keys" array. Provide an array of key names or text strings.',
				},
				400,
			);
		}

		const keys = body.keys as string[];
		let sent = 0;
		for (const key of keys) {
			if (typeof key !== "string") continue;
			const ptyData = keyNameToPty(key);
			if (ptyData !== null) {
				const written = this.processManager.writeToProcess(index, ptyData);
				if (written) sent++;
			}
		}

		this.log(`Sent ${sent} key(s) to: ${name}`);

		return this.jsonResponse({
			ok: true,
			data: { message: `Sent ${sent} key(s) to ${name}`, sent },
		});
	}

	/**
	 * Reload the configuration and restart all processes.
	 */
	private async handleReload(): Promise<Response> {
		this.log("Reloading configuration...");

		try {
			const { tools, config, warnings } = await this.processManager.reload();

			// Log any config warnings
			for (const warning of warnings) {
				this.log(`Config warning: ${warning}`);
			}

			// Collect tool names for response (tools with commands)
			const toolNames: string[] = [];
			for (const tool of tools) {
				if (tool?.config.command) {
					toolNames.push(tool.config.name);
				}
			}

			// Notify the UI about the config change
			// The UI will handle starting tools with dependency awareness
			if (this.onConfigReload) {
				this.onConfigReload(config);
			}

			this.log(`Reloaded configuration with ${toolNames.length} tools`);

			return this.jsonResponse({
				ok: true,
				data: {
					message: `Reloaded configuration. ${toolNames.length} tools configured.`,
					tools: toolNames,
					warnings,
				},
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.log(`Reload failed: ${message}`);
			return this.jsonResponse({ ok: false, error: message }, 500);
		}
	}

	/**
	 * Create a JSON response.
	 */
	private jsonResponse<T>(data: ApiResponse<T>, status = 200): Response {
		return new Response(JSON.stringify(data), {
			status,
			headers: {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": "*",
			},
		});
	}
}
