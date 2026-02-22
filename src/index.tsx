import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createElement } from "react";
import { App } from "./App";
import { getHelpText, getVersion, parseArgs } from "./cli";
import { runInit, runMcp, runUpdate } from "./commands";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { toast } from "./components/Toast";
import { ApiServer, DEFAULT_MCP_PORT } from "./lib/api";
import { copyToClipboard } from "./lib/clipboard";
import { type Config, loadConfig } from "./lib/config";
import { loadPreferences, updatePreference } from "./lib/preferences";
import { type OrphanCleanupResult, ProcessManager } from "./lib/processes";
import {
	getTerminalTheme,
	getTheme,
	type Theme,
	ThemeProvider,
} from "./lib/theme";

/** Duration for config warning toast (10 seconds) */
const CONFIG_WARNING_TOAST_DURATION = 10000;

/**
 * Fully resets terminal state by writing escape sequences directly to stdout.
 * This handles everything the renderer's native cleanup would do: disabling
 * mouse tracking, leaving alternate screen, restoring cursor, and disabling
 * raw mode. Safe to call multiple times or when the renderer is unavailable.
 */
function resetTerminal(): void {
	try {
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(false);
		}
	} catch {
		// stdin may already be destroyed
	}
	try {
		process.stdout.write(
			"\x1b[?1000l" + // Disable normal mouse tracking
				"\x1b[?1002l" + // Disable button-event mouse tracking
				"\x1b[?1003l" + // Disable all-motion mouse tracking
				"\x1b[?1006l" + // Disable SGR extended mouse mode
				"\x1b[?1049l" + // Leave alternate screen buffer
				"\x1b[?25h" + // Show cursor
				"\x1b[0m", // Reset all text attributes
		);
	} catch {
		// stdout may already be destroyed
	}
}

const ORPHAN_CLEANUP_TOAST_DURATION = 5000;

function showOrphanCleanupToasts(results: OrphanCleanupResult[]): void {
	const killed = results.filter((r) => r.status === "killed");
	const failed = results.filter((r) => r.status === "failed");

	if (killed.length > 0) {
		const names = killed.map((r) => r.toolName).join(", ");
		toast.info(
			`Killed ${killed.length} orphaned process${killed.length === 1 ? "" : "es"} from previous session: ${names}`,
			ORPHAN_CLEANUP_TOAST_DURATION,
		);
	}
	if (failed.length > 0) {
		const names = failed.map((r) => r.toolName).join(", ");
		toast.error(
			`Failed to kill ${failed.length} orphaned process${failed.length === 1 ? "" : "es"}: ${names}`,
			ORPHAN_CLEANUP_TOAST_DURATION,
		);
	}
}

async function main() {
	// Parse CLI arguments
	const args = parseArgs();

	// Handle --help
	if (args.showHelp) {
		console.log(getHelpText());
		process.exit(0);
	}

	// Handle --version
	if (args.showVersion) {
		console.log(`corsa v${getVersion()}`);
		process.exit(0);
	}

	// Handle init command
	if (args.command === "init") {
		await runInit();
		return;
	}

	// Handle mcp command
	if (args.command === "mcp") {
		await runMcp(args.configPath);
		return;
	}

	// Handle update command
	if (args.command === "update") {
		await runUpdate();
		return;
	}

	// Register SIGINT handler early - ensures Ctrl-C always works even if rendering fails
	// This is critical for exiting the app if it gets into an error state
	let sigintCount = 0;
	let cleanupFn: (() => Promise<void>) | null = null;
	process.on("SIGINT", async () => {
		sigintCount++;
		if (sigintCount === 1 && cleanupFn) {
			// First Ctrl-C: trigger graceful shutdown
			await cleanupFn();
		} else {
			// Second Ctrl-C or no cleanup function: force quit
			resetTerminal();
			process.exit(1);
		}
	});

	// Also handle SIGTERM early
	process.on("SIGTERM", async () => {
		if (cleanupFn) {
			await cleanupFn();
		} else {
			process.exit(0);
		}
	});

	// Handle SIGQUIT (Ctrl-\) as emergency exit
	// This bypasses graceful shutdown entirely for when the app is stuck.
	process.on("SIGQUIT", () => {
		resetTerminal();
		console.error("\n\nSIGQUIT received - forcing exit");
		process.exit(1);
	});

	// Handle uncaught exceptions - fully restore terminal and exit immediately.
	// Without process.exit() the process would stay alive in a broken state.
	process.on("uncaughtException", (err) => {
		resetTerminal();
		console.error("\n\nFatal error:", err.message);
		console.error(err.stack);
		process.exit(1);
	});

	// Same for unhandled promise rejections
	process.on("unhandledRejection", (reason) => {
		resetTerminal();
		console.error("\n\nUnhandled rejection:", reason);
		process.exit(1);
	});

	// Store config warnings to show after rendering starts
	let configWarnings: string[] = [];

	try {
		// Load configuration
		const configPath = args.configPath ?? "corsa.config.toml";
		const { config, warnings } = await loadConfig(configPath);
		configWarnings = warnings;

		if (config.tools.length === 0) {
			console.error(
				"No tools configured. Please add tools to your config file. Run `corsa init` to get started.",
			);
			process.exit(1);
		}

		// Load user preferences
		const preferences = loadPreferences();

		// Determine if theme is locked by config (config theme takes priority)
		const configLockedTheme = config.ui?.theme;

		// Load line wrap preference (default: true)
		const initialLineWrap = preferences.lineWrap ?? true;

		// Try to detect terminal theme early (OSC queries must happen before
		// renderer puts stdin in raw mode). Cache it for later use even if
		// user starts with a different theme.
		const detectedTerminalTheme = await getTerminalTheme();

		// Resolve theme with priority: config > preferences > default
		const resolveTheme = (themeName?: string): Theme => {
			if (themeName === "terminal") {
				if (detectedTerminalTheme) {
					return detectedTerminalTheme;
				}
				// Fall back to default theme if terminal detection fails
				console.error(
					"Warning: Could not detect terminal theme, falling back to default",
				);
				return getTheme("default");
			}
			return getTheme(themeName);
		};

		// Priority: config theme > saved preference > default
		const initialThemeKey = config.ui?.theme ?? preferences.theme ?? "default";
		const initialTheme = resolveTheme(initialThemeKey);

		// Initialize process manager
		const maxLogLines = config.ui?.maxLogLines ?? 10000;
		const processManager = new ProcessManager(maxLogLines);
		processManager.setConfigPath(configPath);
		const { tools: initialTools, orphanCleanup } =
			await processManager.initialize(config.tools, {
				cleanupOrphans: config.processes?.cleanupOrphans ?? true,
			});

		// Config update callback - will be set by App component
		let configUpdateCallback: ((newConfig: Config) => void) | null = null;
		const handleRegisterConfigUpdate = (
			callback: (newConfig: Config) => void,
		) => {
			configUpdateCallback = callback;
		};

		// Health status getter callback - will be set by App component
		let healthStatusGetterCallback:
			| ((toolName: string) => "starting" | "healthy" | "unhealthy" | null)
			| null = null;
		const handleRegisterGetHealthStatus = (
			callback: (
				toolName: string,
			) => "starting" | "healthy" | "unhealthy" | null,
		) => {
			healthStatusGetterCallback = callback;
		};

		// Start MCP API server if enabled
		let apiServer: ApiServer | null = null;
		if (config.mcp?.enabled) {
			const port = config.mcp.port ?? DEFAULT_MCP_PORT;
			const apiToolIndex = processManager.createVirtualTool("MCP API");
			apiServer = new ApiServer(processManager, port, apiToolIndex);

			// Set up config reload handler
			apiServer.setOnConfigReload((newConfig: Config) => {
				if (configUpdateCallback) {
					configUpdateCallback(newConfig);
				}
			});

			// Set up health status getter (proxies to the callback from App)
			apiServer.setGetHealthStatus((toolName: string) => {
				if (healthStatusGetterCallback) {
					return healthStatusGetterCallback(toolName);
				}
				return null;
			});

			try {
				apiServer.start();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				processManager.addLogToTool(
					apiToolIndex,
					`[ERROR] Failed to start MCP API server: ${message}`,
				);
			}
		}

		// Create renderer and render app
		// Use exitOnCtrlC: false so App.tsx can handle Ctrl-C for graceful shutdown
		// ErrorBoundary's ErrorPage uses useKeyboard to handle Ctrl-C in error state
		const renderer = await createCliRenderer({
			exitOnCtrlC: false, // Let App.tsx handle Ctrl-C for graceful shutdown
			exitSignals: [], // Don't register any signal handlers (we handle SIGTERM ourselves)
		});
		const root = createRoot(renderer);

		// Handle line wrap preference change
		const handleLineWrapChange = (lineWrap: boolean) => {
			updatePreference("lineWrap", lineWrap);
		};

		// Cleanup function for error boundary - properly stops renderer before exit
		const handleErrorExit = () => {
			renderer.stop();
			renderer.destroy();
		};

		// Copy function for error boundary - uses renderer's real stdout for OSC 52
		const handleErrorCopy = (text: string) => {
			const realWrite = (
				renderer as unknown as {
					realStdoutWrite?: typeof process.stdout.write;
				}
			).realStdoutWrite;
			if (realWrite) {
				copyToClipboard(text, (data) => realWrite.call(process.stdout, data));
			} else {
				copyToClipboard(text);
			}
		};

		// Render app wrapped in ErrorBoundary and ThemeProvider
		// Use createElement for ErrorBoundary to avoid JSX type issues with class components
		root.render(
			createElement(
				ErrorBoundary,
				{ onExit: handleErrorExit, onCopy: handleErrorCopy },
				<ThemeProvider
					initialTheme={initialTheme}
					initialThemeKey={initialThemeKey}
					configLockedTheme={configLockedTheme}
					terminalTheme={detectedTerminalTheme}
				>
					<App
						processManager={processManager}
						initialTools={initialTools}
						renderer={renderer}
						config={config}
						configPath={configPath}
						initialLineWrap={initialLineWrap}
						onLineWrapChange={handleLineWrapChange}
						onRegisterConfigUpdate={handleRegisterConfigUpdate}
						onRegisterGetHealthStatus={handleRegisterGetHealthStatus}
					/>
				</ThemeProvider>,
			),
		);

		// Set up cleanup on exit - wire this to the early SIGINT handler
		let isCleaningUp = false;
		const cleanup = async () => {
			if (isCleaningUp) return;
			isCleaningUp = true;

			try {
				// Stop MCP API server if running
				if (apiServer) {
					apiServer.stop();
				}
				// Trigger graceful shutdown through processManager
				// Don't stop renderer yet - let it show shutdown progress
				await processManager.cleanup();
				// Now stop and destroy the renderer
				renderer.stop();
				renderer.destroy();
			} catch {
				resetTerminal();
			}
			process.exit(0);
		};

		// Connect cleanup function to the early signal handlers
		cleanupFn = cleanup;

		// Last-resort fallback: runs synchronously on any exit path.
		// Ensures terminal state is always restored and child processes are killed
		// even if graceful cleanup was skipped (crash, SIGQUIT, etc.).
		process.on("exit", () => {
			resetTerminal();
			processManager.killAllSync();
		});

		// Start rendering
		await renderer.start();

		// Show config warnings as toast after rendering has started
		if (configWarnings.length > 0) {
			// Show each warning as a separate toast for better readability
			for (const warning of configWarnings) {
				toast.error(`Config: ${warning}`, CONFIG_WARNING_TOAST_DURATION);
			}
		}

		// Show orphan cleanup results as toasts
		showOrphanCleanupToasts(orphanCleanup);
	} catch (error) {
		// Print clean error message without stack trace for expected errors
		if (error instanceof Error) {
			console.error(`Error: ${error.message}`);
		} else {
			console.error("Error starting corsa:", error);
		}
		process.exit(1);
	}
}

main();
