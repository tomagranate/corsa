import type { ToolConfig, ToolState } from "../../types";
import { type Config, loadConfig } from "../config";
import { parseAnsiLine } from "../text";
import {
	getValidDependencies,
	resolveDependencies,
} from "./dependency-resolver";
import {
	deletePidFile,
	loadPidFile,
	type PidFileEntry,
	removePidFromFile,
	updatePidFile,
} from "./pid-file";
import { isProcessRunning, killProcessGracefully } from "./process-utils";

/** Callback to check if a tool is ready (for dependency waiting) */
export type IsToolReadyCallback = (toolName: string) => boolean;

/** Callback for change notifications */
export type ChangeCallback = () => void;

/** Subscriber key - either "all" for all tools or a tool index */
export type SubscriberKey = "all" | number;

/** Default timeout for waiting on dependencies (30 seconds) */
const DEFAULT_DEPENDENCY_TIMEOUT = 30000;

/** Timeout for graceful shutdown before force kill (10 seconds) */
const GRACEFUL_SHUTDOWN_TIMEOUT = 10000;

/** Polling interval for checking dependency readiness */
const DEPENDENCY_POLL_INTERVAL = 500;

/** Options for ProcessManager.initialize() */
export interface InitializeOptions {
	/**
	 * Whether to cleanup orphaned processes from previous sessions.
	 * Default: true
	 */
	cleanupOrphans?: boolean;
}

export class ProcessManager {
	private tools: ToolState[] = [];
	private maxLogLines: number;
	private isShuttingDown = false;
	private recentlyStopped = new Set<number>();
	private configPath: string | undefined;

	/** Virtual tool indices that should be preserved across reloads */
	private virtualToolIndices = new Set<number>();

	/** Subscribers for change notifications */
	private subscribers = new Map<SubscriberKey, Set<ChangeCallback>>();

	/**
	 * Optional callback fired when a tool is about to be restarted.
	 * Used to reset health state before the restart begins.
	 */
	onToolRestart?: (toolName: string) => void;

	constructor(maxLogLines: number = 100000) {
		this.maxLogLines = maxLogLines;
	}

	/**
	 * Set the config path for reload functionality.
	 */
	setConfigPath(path: string): void {
		this.configPath = path;
	}

	/**
	 * Get the current config path.
	 */
	getConfigPath(): string | undefined {
		return this.configPath;
	}

	/**
	 * Subscribe to changes for a specific tool or all tools.
	 * @param key - "all" to subscribe to any change, or tool index for specific tool
	 * @param callback - Function to call when changes occur
	 * @returns Unsubscribe function
	 */
	subscribe(key: SubscriberKey, callback: ChangeCallback): () => void {
		let callbacks = this.subscribers.get(key);
		if (!callbacks) {
			callbacks = new Set();
			this.subscribers.set(key, callbacks);
		}
		callbacks.add(callback);

		return () => {
			callbacks?.delete(callback);
			if (callbacks?.size === 0) {
				this.subscribers.delete(key);
			}
		};
	}

	/**
	 * Notify subscribers of a change to a specific tool.
	 * Notifies both tool-specific subscribers and "all" subscribers.
	 */
	private notifyChange(toolIndex: number): void {
		// Notify tool-specific subscribers
		const toolCallbacks = this.subscribers.get(toolIndex);
		if (toolCallbacks) {
			for (const callback of toolCallbacks) {
				callback();
			}
		}

		// Notify "all" subscribers
		const allCallbacks = this.subscribers.get("all");
		if (allCallbacks) {
			for (const callback of allCallbacks) {
				callback();
			}
		}
	}

	/**
	 * Initialize the ProcessManager with tool configurations.
	 *
	 * @param configs - Array of tool configurations
	 * @param options - Optional initialization options
	 * @returns Array of initialized tool states
	 */
	async initialize(
		configs: ToolConfig[],
		options: InitializeOptions = {},
	): Promise<ToolState[]> {
		const { cleanupOrphans = true } = options;

		// First, load and cleanup any orphaned processes from previous sessions
		// (if enabled and config path is set for instance-specific cleanup)
		if (cleanupOrphans) {
			await this.loadAndCleanupOrphanedProcesses();
		}

		this.tools = configs.map((config) => ({
			config,
			process: null,
			logs: [],
			status: "stopped",
			exitCode: null,
			logTrimCount: 0,
			logVersion: 0,
		}));
		return this.tools;
	}

	async startTool(index: number): Promise<void> {
		const tool = this.tools[index];
		if (!tool || tool.status === "running") {
			return;
		}

		try {
			const { command, args = [], cwd, env } = tool.config;

			const proc = Bun.spawn([command, ...args], {
				cwd: cwd || process.cwd(),
				env: { ...process.env, ...env },
				stdout: "pipe",
				stderr: "pipe",
			});

			tool.process = proc;
			tool.status = "running";
			tool.logs = [];
			tool.exitCode = null;
			tool.pid = proc.pid;
			tool.startTime = Date.now();
			tool.logVersion = 0;

			// Notify subscribers of status change
			this.notifyChange(index);

			// Save PID to file for persistence
			await this.savePidToFile(index);

			// Handle stdout
			if (proc.stdout) {
				const reader =
					proc.stdout.getReader() as ReadableStreamDefaultReader<Uint8Array>;
				this.readStream(reader, (line, isReplacement) => {
					this.addLog(index, line, false, isReplacement);
				});
			}

			// Handle stderr
			if (proc.stderr) {
				const reader =
					proc.stderr.getReader() as ReadableStreamDefaultReader<Uint8Array>;
				this.readStream(reader, (line, isReplacement) => {
					this.addLog(index, line, true, isReplacement);
				});
			}

			// Handle process exit
			proc.exited.then(async (exitCode) => {
				// Only update status if not already shutting down (to preserve shutdown state)
				if (tool.status !== "shuttingDown") {
					tool.status = exitCode === 0 ? "stopped" : "error";
				} else {
					// If shutting down, mark as stopped after exit and track it
					tool.status = exitCode === 0 ? "stopped" : "error";
					if (this.isShuttingDown) {
						this.recentlyStopped.add(index);
					}
				}
				tool.exitCode = exitCode;
				tool.process = null;
				tool.pid = undefined;
				tool.startTime = undefined;
				// Remove PID from file when process exits
				await removePidFromFile(index, this.configPath);

				// If a new process has been spawned (e.g., via restart), skip
				// the notification and exit log to avoid corrupting new process state
				if (tool.process !== null) {
					return;
				}

				// addLog will also notify, but notify here for immediate status update
				this.notifyChange(index);
				this.addLog(index, `\n[Process exited with code ${exitCode}]`);
			});
		} catch (error) {
			tool.status = "error";
			this.notifyChange(index);
			this.addLog(index, `[Error starting process: ${error}]`);
		}
	}

	/**
	 * Read a stream and emit lines, handling carriage returns for progress bars.
	 *
	 * Carriage return (`\r`) behavior:
	 * - `\r` within a complete line (ending with \n) means display content after last `\r`
	 * - `\r\n` is treated as a normal line ending (Windows style)
	 * - Incomplete lines with `\r` (real-time progress updates) trigger replacement
	 *
	 * Replacement logic:
	 * - Complete lines are always NEW lines (isReplacement = false)
	 * - Incomplete lines with `\r` are real-time updates (isReplacement = true)
	 */
	private async readStream(
		reader: ReadableStreamDefaultReader<Uint8Array>,
		onLine: (line: string, isReplacement: boolean) => void,
	): Promise<void> {
		const decoder = new TextDecoder();
		let buffer = "";
		// Track if the last emitted line was an incomplete replacement
		// so we know if we should continue replacing or start fresh
		let lastWasIncompleteReplacement = false;

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				// Process complete lines (ending with \n)
				let newlineIdx = buffer.indexOf("\n");
				while (newlineIdx !== -1) {
					let line = buffer.slice(0, newlineIdx);
					buffer = buffer.slice(newlineIdx + 1);

					// Handle \r\n (Windows line ending) - strip trailing \r
					if (line.endsWith("\r")) {
						line = line.slice(0, -1);
					}

					// Handle \r within the line - take last segment after any \r
					// This simulates terminal "carriage return" behavior where
					// \r moves cursor to start of line, overwriting previous content
					const crIdx = line.lastIndexOf("\r");
					if (crIdx >= 0) {
						line = line.slice(crIdx + 1);
					}

					// Complete lines are always emitted as NEW lines.
					// However, if the previous emission was an incomplete replacement,
					// this complete line should replace it (finalizing the progress bar).
					const isReplacement = lastWasIncompleteReplacement;
					lastWasIncompleteReplacement = false;

					onLine(line, isReplacement);

					// Check for more newlines in the remaining buffer
					newlineIdx = buffer.indexOf("\n");
				}

				// Handle incomplete lines with \r (real-time progress bar updates)
				// If buffer contains \r, the content after last \r is the "current" line
				// Emit it as a replacement so it updates the display in real-time
				const crIdx = buffer.lastIndexOf("\r");
				if (crIdx >= 0) {
					const currentLine = buffer.slice(crIdx + 1);
					buffer = currentLine; // Keep only content after \r
					if (currentLine.length > 0) {
						onLine(currentLine, true); // Emit as replacement
						lastWasIncompleteReplacement = true;
					}
				}
			}

			// Handle remaining buffer when stream ends
			if (buffer) {
				// Process any final \r in the remaining buffer
				const crIdx = buffer.lastIndexOf("\r");
				const finalLine = crIdx >= 0 ? buffer.slice(crIdx + 1) : buffer;
				if (finalLine.length > 0) {
					// If there's remaining content, it replaces the last incomplete line
					onLine(finalLine, lastWasIncompleteReplacement);
				}
			}
		} catch (_error) {
			// Stream closed or error
		}
	}

	/**
	 * Add a log line for a tool.
	 *
	 * @param index - Tool index
	 * @param line - Log line text
	 * @param isStderr - Whether this line came from stderr
	 * @param isReplacement - If true, replace the last log line instead of appending
	 *                        (used for progress bars and spinners that use \r)
	 */
	private addLog(
		index: number,
		line: string,
		isStderr = false,
		isReplacement = false,
	): void {
		const tool = this.tools[index];
		if (!tool) return;

		// Parse ANSI codes into segments
		const segments = parseAnsiLine(line);
		const logEntry = { segments, isStderr: isStderr || undefined };

		if (isReplacement && tool.logs.length > 0) {
			// Replace the last log line instead of appending
			// This handles progress bars and spinners that use \r to update in place
			tool.logs[tool.logs.length - 1] = logEntry;
		} else {
			tool.logs.push(logEntry);
		}

		// Increment version counter for change detection (works for both append and replace)
		tool.logVersion++;

		// Limit log size
		if (tool.logs.length > this.maxLogLines) {
			tool.logs.shift();
			tool.logTrimCount++; // Track that indices have shifted
		}

		// Notify subscribers of the change
		this.notifyChange(index);
	}

	getTools(): ToolState[] {
		return this.tools;
	}

	getTool(index: number): ToolState | undefined {
		return this.tools[index];
	}

	async stopTool(index: number): Promise<void> {
		const tool = this.tools[index];
		if (!tool || !tool.process) return;

		try {
			// Send SIGTERM for graceful shutdown
			tool.process.kill("SIGTERM");
			// Wait for process to exit gracefully
			const timeout = new Promise((resolve) =>
				setTimeout(resolve, GRACEFUL_SHUTDOWN_TIMEOUT),
			);
			const exitPromise = tool.process.exited;

			await Promise.race([exitPromise, timeout]);

			// Check if process exited
			if (tool.process && !tool.process.killed) {
				// Still running after timeout - will be force killed in cleanup
				return;
			} else {
				// Process exited
				tool.status = "stopped";
				tool.process = null;
				tool.pid = undefined;
				tool.startTime = undefined;
				await removePidFromFile(index, this.configPath);
				this.notifyChange(index);
			}
		} catch (_error) {
			// Ignore errors
			tool.status = "stopped";
			tool.process = null;
			tool.pid = undefined;
			tool.startTime = undefined;
			await removePidFromFile(index, this.configPath);
			this.notifyChange(index);
		}
	}

	async restartTool(index: number): Promise<void> {
		const tool = this.tools[index];
		if (!tool) return;

		// Notify listeners before restart (e.g., to reset health state to "starting"
		// before the old process is killed, so periodic health checks that fire during
		// the restart window see "starting" status and use retry logic)
		this.onToolRestart?.(tool.config.name);

		// If running, stop first (graceful with force kill on timeout)
		if (
			tool.process &&
			(tool.status === "running" || tool.status === "shuttingDown")
		) {
			try {
				tool.process.kill("SIGTERM");
				const timeout = new Promise((resolve) =>
					setTimeout(resolve, GRACEFUL_SHUTDOWN_TIMEOUT),
				);
				const exitPromise = tool.process.exited;

				await Promise.race([exitPromise, timeout]);

				// Force kill if still running after timeout
				if (tool.process && !tool.process.killed) {
					tool.process.kill("SIGKILL");
					await tool.process.exited;
				}
			} catch (_error) {
				// Ignore errors during stop
			}

			tool.process = null;
			tool.pid = undefined;
			tool.startTime = undefined;
			await removePidFromFile(index, this.configPath);
		}

		// Start fresh
		await this.startTool(index);
	}

	clearLogs(index: number): void {
		const tool = this.tools[index];
		if (tool) {
			tool.logs = [];
			tool.logVersion++;
			this.notifyChange(index);
		}
	}

	async cleanup(): Promise<void> {
		// Set shutdown state
		this.isShuttingDown = true;
		this.recentlyStopped.clear();

		// Mark all running processes as shutting down and send SIGTERM immediately
		const shutdownPromises: Promise<void>[] = [];

		for (let i = 0; i < this.tools.length; i++) {
			const tool = this.tools[i];
			if (tool?.process && tool.status === "running") {
				// Mark as shutting down immediately
				tool.status = "shuttingDown";
				this.addLog(i, "\n[SHUTDOWN] Initiating graceful shutdown...");

				// Start shutdown process (don't await yet)
				shutdownPromises.push(this.stopTool(i));
			}
		}

		// Wait for all processes to shutdown in parallel (with timeout)
		await Promise.allSettled(shutdownPromises);

		// Force kill any processes that are still running after timeout
		for (let i = 0; i < this.tools.length; i++) {
			const tool = this.tools[i];
			if (tool?.process && !tool.process.killed) {
				this.addLog(
					i,
					"[SHUTDOWN] Process did not exit gracefully, forcing termination...",
				);
				tool.process.kill("SIGKILL");
				tool.status = "stopped";
				if (this.isShuttingDown) {
					this.recentlyStopped.add(i);
				}
				tool.process = null;
				this.notifyChange(i);
			}
		}

		// Run cleanup commands in parallel
		const cleanupPromises: Promise<void>[] = [];
		for (const tool of this.tools) {
			if (!tool) continue;
			if (tool.config.cleanup && tool.config.cleanup.length > 0) {
				for (const cleanupCmd of tool.config.cleanup) {
					cleanupPromises.push(
						(async () => {
							try {
								const proc = Bun.spawn(["sh", "-c", cleanupCmd], {
									cwd: tool.config.cwd || process.cwd(),
								});
								await proc.exited;
							} catch (error) {
								// Log but don't fail on cleanup errors
								console.error(
									`Cleanup failed for ${tool.config.name}: ${error}`,
								);
							}
						})(),
					);
				}
			}
		}

		await Promise.allSettled(cleanupPromises);

		// Clear PID file after cleanup completes
		await deletePidFile(this.configPath);
	}

	getIsShuttingDown(): boolean {
		return this.isShuttingDown;
	}

	/**
	 * Synchronously kill all running processes.
	 * This is used in the process.on('exit') handler where async code can't run.
	 * Sends SIGTERM to all processes without waiting for them to exit.
	 */
	killAllSync(): void {
		for (const tool of this.tools) {
			if (tool?.process && !tool.process.killed) {
				try {
					tool.process.kill("SIGTERM");
				} catch {
					// Ignore errors - process may have already exited
				}
			}
		}
	}

	getRecentlyStopped(): Set<number> {
		return this.recentlyStopped;
	}

	resetShutdownState(): void {
		this.isShuttingDown = false;
		this.recentlyStopped.clear();
	}

	/**
	 * Reload the configuration file and restart all processes.
	 * Stops all running non-virtual processes, re-reads the config,
	 * and returns the new tools and full config for the caller to apply.
	 *
	 * @param configPath - Optional path to config file (uses stored path if not provided)
	 * @returns Object containing new tools, full config, and any config warnings
	 * @throws Error if config path is not set or config is invalid
	 */
	async reload(configPath?: string): Promise<{
		tools: ToolState[];
		config: Config;
		warnings: string[];
	}> {
		const path = configPath ?? this.configPath;
		if (!path) {
			throw new Error("Config path not set. Cannot reload.");
		}

		// Mark all running non-virtual processes as shuttingDown
		const runningIndices: number[] = [];
		for (let i = 0; i < this.tools.length; i++) {
			if (this.virtualToolIndices.has(i)) continue;

			const tool = this.tools[i];
			if (tool?.process && tool.status === "running") {
				tool.status = "shuttingDown";
				this.addLog(i, "\n[RELOAD] Stopping for config reload...");
				runningIndices.push(i);
			}
		}

		// Set shutdown state to trigger full shutdown UI (yellow bar, filtered tabs)
		if (runningIndices.length > 0) {
			this.isShuttingDown = true;

			// Notify all subscribers to trigger UI update with shutdown state
			const allCallbacks = this.subscribers.get("all");
			if (allCallbacks) {
				for (const callback of allCallbacks) {
					callback();
				}
			}

			// Allow UI to render shutdown state
			await new Promise((resolve) => setTimeout(resolve, 500));
		}

		// Stop all running non-virtual processes
		const stopPromises: Promise<void>[] = [];
		for (const i of runningIndices) {
			stopPromises.push(this.stopTool(i));
		}
		await Promise.allSettled(stopPromises);

		// Reset shutdown state before loading new config
		this.isShuttingDown = false;
		this.recentlyStopped.clear();

		// Force kill any processes still running
		for (let i = 0; i < this.tools.length; i++) {
			if (this.virtualToolIndices.has(i)) continue;

			const tool = this.tools[i];
			if (tool?.process && !tool.process.killed) {
				tool.process.kill("SIGKILL");
				tool.process = null;
				tool.status = "stopped";
			}
		}

		// Clear PID file
		await deletePidFile(this.configPath);

		// Re-read config
		const { config, warnings } = await loadConfig(path);

		if (config.tools.length === 0) {
			throw new Error("No tools configured in the config file.");
		}

		// Preserve virtual tools
		const virtualTools: ToolState[] = [];
		for (const idx of this.virtualToolIndices) {
			const tool = this.tools[idx];
			if (tool) {
				virtualTools.push(tool);
			}
		}

		// Create new tools from config
		const newTools: ToolState[] = config.tools.map((toolConfig) => ({
			config: toolConfig,
			process: null,
			logs: [],
			status: "stopped" as const,
			exitCode: null,
			logTrimCount: 0,
			logVersion: 0,
		}));

		// Update virtual tool indices for new positions
		this.virtualToolIndices.clear();
		const baseIndex = newTools.length;
		for (let i = 0; i < virtualTools.length; i++) {
			this.virtualToolIndices.add(baseIndex + i);
		}

		// Combine new tools with preserved virtual tools
		this.tools = [...newTools, ...virtualTools];

		// Clear tool-specific subscribers since indices have changed
		// Keep only "all" subscribers
		const allCallbacks = this.subscribers.get("all");
		this.subscribers.clear();
		if (allCallbacks) {
			this.subscribers.set("all", allCallbacks);
		}

		// Notify all subscribers of the change
		if (allCallbacks) {
			for (const callback of allCallbacks) {
				callback();
			}
		}

		return { tools: this.tools, config, warnings };
	}

	/**
	 * Find a tool by name.
	 * @returns The tool index and state, or undefined if not found
	 */
	getToolByName(name: string): { index: number; tool: ToolState } | undefined {
		const index = this.tools.findIndex((t) => t.config.name === name);
		if (index === -1) return undefined;
		const tool = this.tools[index];
		if (!tool) return undefined;
		return { index, tool };
	}

	/**
	 * Create a virtual tool (no spawned process) for internal use like MCP API.
	 * The tool starts in "running" status and can receive logs via addLogToTool().
	 * Virtual tools are preserved across config reloads.
	 * @returns The index of the created virtual tool
	 */
	createVirtualTool(name: string): number {
		const tool: ToolState = {
			config: { name, command: "" },
			process: null,
			logs: [],
			status: "running",
			exitCode: null,
			logTrimCount: 0,
			logVersion: 0,
		};
		this.tools.push(tool);
		const index = this.tools.length - 1;
		this.virtualToolIndices.add(index);
		return index;
	}

	/**
	 * Add a log line to a tool (public API for virtual tools).
	 * @param index - Tool index
	 * @param message - Plain text message to log
	 */
	addLogToTool(index: number, message: string): void {
		this.addLog(index, message);
	}

	/**
	 * Save PID to file for a specific tool.
	 */
	private async savePidToFile(index: number): Promise<void> {
		const tool = this.tools[index];
		if (!tool || !tool.process || !tool.pid) return;

		const entry: PidFileEntry = {
			toolIndex: index,
			toolName: tool.config.name,
			pid: tool.pid,
			startTime: tool.startTime || Date.now(),
			command: tool.config.command,
			args: tool.config.args || [],
			cwd: tool.config.cwd || process.cwd(),
		};

		await updatePidFile(entry, this.configPath);
	}

	/**
	 * Load PID file and cleanup any orphaned processes from previous sessions.
	 * Kills any processes that are still running and logs the cleanup.
	 */
	private async loadAndCleanupOrphanedProcesses(): Promise<void> {
		const pidData = await loadPidFile(this.configPath);
		if (!pidData || pidData.processes.length === 0) {
			return;
		}

		const cleanupLog: string[] = [];
		cleanupLog.push(
			`[PID Cleanup] Found ${pidData.processes.length} process(es) from previous session`,
		);

		for (const entry of pidData.processes) {
			const isRunning = await isProcessRunning(entry.pid);
			if (isRunning) {
				cleanupLog.push(
					`[PID Cleanup] Killing orphaned process: ${entry.toolName} (PID: ${entry.pid})`,
				);
				const killed = await killProcessGracefully(entry.pid, 3000);
				if (killed) {
					cleanupLog.push(
						`[PID Cleanup] Successfully killed process ${entry.pid}`,
					);
				} else {
					cleanupLog.push(`[PID Cleanup] Failed to kill process ${entry.pid}`);
				}
			} else {
				cleanupLog.push(
					`[PID Cleanup] Process ${entry.pid} (${entry.toolName}) is already dead`,
				);
			}
		}

		// Log cleanup actions (will be visible when tools start)
		console.log(cleanupLog.join("\n"));

		// Clear the PID file after cleanup - all entries are now stale
		await deletePidFile(this.configPath);
	}

	/**
	 * Start all tools respecting dependency order.
	 * Tools with no dependencies start immediately.
	 * Tools with dependencies wait for them to be ready before starting.
	 *
	 * @param isToolReady - Callback to check if a tool is ready (healthy or running)
	 * @param timeout - Maximum time to wait for dependencies (default: 30s)
	 */
	async startAllToolsWithDependencies(
		isToolReady: IsToolReadyCallback,
		timeout: number = DEFAULT_DEPENDENCY_TIMEOUT,
	): Promise<void> {
		const toolNames = new Set(this.tools.map((t) => t.config.name));
		const { levels } = resolveDependencies(this.tools.map((t) => t.config));

		// Mark all tools with dependencies as "waiting" before starting
		for (let i = 0; i < this.tools.length; i++) {
			const tool = this.tools[i];
			if (!tool) continue;
			const deps = getValidDependencies(tool.config, toolNames);
			if (deps.length > 0) {
				tool.status = "waiting";
				this.notifyChange(i);
			}
		}

		// Start tools level by level
		for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
			const level = levels[levelIdx];
			if (!level || level.length === 0) continue;

			// Start all tools in this level in parallel
			const startPromises = level.map(async (config) => {
				const index = this.tools.findIndex(
					(t) => t.config.name === config.name,
				);
				if (index === -1) return;

				const tool = this.tools[index];
				if (!tool) return;

				// Wait for dependencies to be ready
				const deps = getValidDependencies(config, toolNames);
				if (deps.length > 0) {
					this.addLog(
						index,
						`[DEPS] Waiting for dependencies: ${deps.join(", ")}`,
					);

					const ready = await this.waitForDependencies(
						deps,
						isToolReady,
						timeout,
					);

					if (!ready) {
						this.addLog(
							index,
							`[DEPS] Warning: Some dependencies not ready after ${timeout / 1000}s, starting anyway`,
						);
					} else {
						this.addLog(index, "[DEPS] All dependencies ready");
					}
				}

				// Start the tool
				await this.startTool(index);
			});

			// Wait for all tools in this level to start
			await Promise.all(startPromises);
		}
	}

	/**
	 * Wait for all dependencies to be ready.
	 * Returns true if all are ready, false if timeout.
	 */
	private async waitForDependencies(
		deps: string[],
		isToolReady: IsToolReadyCallback,
		timeout: number,
	): Promise<boolean> {
		const startTime = Date.now();

		while (Date.now() - startTime < timeout) {
			const allReady = deps.every((dep) => isToolReady(dep));
			if (allReady) return true;

			// Wait before checking again
			await new Promise((resolve) =>
				setTimeout(resolve, DEPENDENCY_POLL_INTERVAL),
			);
		}

		return false;
	}
}
