import {
	appendFileSync,
	existsSync,
	mkdirSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Default log file path */
export const DEFAULT_DEBUG_LOG_FILE = join(
	process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
	"corsa",
	"debug.log",
);

/** Whether debug logging is enabled */
let debugEnabled = false;

/** Current log file path */
let logFilePath = DEFAULT_DEBUG_LOG_FILE;

/** Whether the log file has been initialized this session */
let initialized = false;

/**
 * Enable debug logging. Clears any existing log file.
 * @param logFile - Optional custom log file path.
 */
export function enableDebugLogging(logFile = DEFAULT_DEBUG_LOG_FILE): void {
	debugEnabled = true;
	logFilePath = logFile;
	initialized = false;
	// Clear log file on enable
	clearDebugLog();
}

/**
 * Disable debug logging and reset to defaults.
 */
export function disableDebugLogging(): void {
	debugEnabled = false;
	logFilePath = DEFAULT_DEBUG_LOG_FILE;
	initialized = false;
}

/**
 * Check if debug logging is enabled.
 */
export function isDebugEnabled(): boolean {
	return debugEnabled;
}

/**
 * Get the current log file path.
 */
export function getDebugLogPath(): string {
	return logFilePath;
}

/**
 * Clear the debug log file.
 */
export function clearDebugLog(): void {
	try {
		if (existsSync(logFilePath)) {
			unlinkSync(logFilePath);
		}
		mkdirSync(dirname(logFilePath), { recursive: true });
		// Create empty file
		writeFileSync(logFilePath, "");
		initialized = true;
	} catch {
		// Ignore errors (e.g., permission issues)
	}
}

/**
 * Log a debug message with timestamp.
 * No-op if debug logging is disabled.
 *
 * @param category - Category/source of the log (e.g., "ProcessManager", "useToolsList")
 * @param message - The message to log
 * @param data - Optional additional data to include
 */
export function debugLog(
	category: string,
	message: string,
	data?: Record<string, unknown>,
): void {
	if (!debugEnabled) return;

	// Initialize on first log if not already done
	if (!initialized) {
		clearDebugLog();
	}

	const timestamp = Date.now();
	const dataStr = data ? ` ${JSON.stringify(data)}` : "";
	const line = `${timestamp} [${category}] ${message}${dataStr}\n`;

	try {
		appendFileSync(logFilePath, line);
	} catch {
		// Ignore write errors
	}
}

/**
 * Create a scoped logger for a specific category.
 * Returns a function that logs with the category pre-filled.
 *
 * @param category - The category for all logs from this logger
 * @returns A logging function
 *
 * @example
 * const log = createDebugLogger("ProcessManager");
 * log("stream read", { bytes: 37, waitMs: 101 });
 */
export function createDebugLogger(
	category: string,
): (message: string, data?: Record<string, unknown>) => void {
	return (message: string, data?: Record<string, unknown>) => {
		debugLog(category, message, data);
	};
}
