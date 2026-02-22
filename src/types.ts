/** Health check configuration for a tool */
export interface ToolHealthCheck {
	/** URL to ping for health status */
	url: string;
	/** Interval between checks in milliseconds. Default: 10000 */
	interval?: number;
	/** Number of retries before declaring unhealthy. Default: 3 */
	retries?: number;
}

/** UI link configuration for a tool */
export interface ToolUI {
	/** Display label for the UI button */
	label: string;
	/** URL to open */
	url: string;
}

export interface ToolConfig {
	name: string;
	command: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	cleanup?: string[];
	/** Optional description shown on the homepage */
	description?: string;
	/** Optional health check configuration */
	healthCheck?: ToolHealthCheck;
	/** Optional UI link configuration */
	ui?: ToolUI;
	/** Tool names that must be ready before this tool starts */
	dependsOn?: string[];
	/** Spawn with a PTY so the process sees a real terminal. Enables input mode. */
	interactive?: boolean;
}

export interface TextSegment {
	text: string;
	color?: string; // OpenTUI foreground color (hex) - for 256-color/RGB modes
	bgColor?: string; // OpenTUI background color (hex) - for 256-color/RGB modes
	/** ANSI color index (0-15) for theme-aware coloring. If set, use theme.ansiPalette */
	colorIndex?: number;
	/** ANSI background color index (0-15) for theme-aware coloring */
	bgColorIndex?: number;
	attributes?: number; // TextAttributes flags (bold, dim, etc.)
}

export interface LogLine {
	segments: TextSegment[];
	isStderr?: boolean; // Whether this line came from stderr
}

export interface ToolState {
	config: ToolConfig;
	process: ReturnType<typeof Bun.spawn> | null;
	logs: LogLine[]; // Array of log lines with metadata
	status: "running" | "stopped" | "error" | "shuttingDown" | "waiting";
	exitCode: number | null;
	pid?: number; // Process ID for persistence
	startTime?: number; // Unix timestamp when process started
	/** Counter incremented when logs are trimmed (shifts indices) */
	logTrimCount: number;
	/** Counter incremented on any log change (append or replace) for change detection */
	logVersion: number;
	/**
	 * For interactive (PTY) processes: the full screen state from the virtual
	 * terminal emulator, replacing the line-parser approach. When set, the
	 * LogViewer renders these lines instead of `logs`.
	 */
	screenLines?: LogLine[];
	/** The VirtualTerminal instance for interactive processes (not serializable) */
	virtualTerminal?: import("./lib/processes/virtual-terminal").VirtualTerminal;
}

/** Health check status for a tool */
export type HealthStatus = "starting" | "healthy" | "unhealthy";

/** Health state for a tool including retry tracking */
export interface ToolHealthState {
	status: HealthStatus;
	/** Number of consecutive failures (for retry logic) */
	failureCount: number;
	/** Timestamp of last check */
	lastCheck?: number;
}
