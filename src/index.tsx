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
import { ProcessManager } from "./lib/processes";
import {
	getTerminalTheme,
	getTheme,
	type Theme,
	ThemeProvider,
} from "./lib/theme";

/** Duration for config warning toast (10 seconds) */
const CONFIG_WARNING_TOAST_DURATION = 10000;

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
	// This works even in raw mode when Ctrl-C doesn't, because SIGQUIT
	// is typically not disabled. Use this as escape hatch in error states.
	process.on("SIGQUIT", () => {
		// Restore terminal immediately
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(false);
		}
		console.error("\n\nSIGQUIT received - forcing exit");
		process.exit(1);
	});

	// Handle uncaught exceptions - restore terminal and exit
	// This ensures Ctrl-C works even if rendering crashes, because the terminal
	// is restored to normal mode where Ctrl-C generates SIGINT again
	process.on("uncaughtException", (err) => {
		// Restore terminal to normal mode so Ctrl-C works
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(false);
		}
		console.error("\n\nFatal error:", err.message);
		console.error(err.stack);
		console.error("\nPress Ctrl-C to exit.");
	});

	// Same for unhandled promise rejections
	process.on("unhandledRejection", (reason) => {
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(false);
		}
		console.error("\n\nUnhandled rejection:", reason);
		console.error("\nPress Ctrl-C to exit.");
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
		const initialTools = await processManager.initialize(config.tools, {
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
				// Ignore cleanup errors, but ensure we exit
			}
			process.exit(0);
		};

		// Connect cleanup function to the early signal handlers
		cleanupFn = cleanup;

		// Start rendering
		await renderer.start();

		// Show config warnings as toast after rendering has started
		if (configWarnings.length > 0) {
			// Show each warning as a separate toast for better readability
			for (const warning of configWarnings) {
				toast.error(`Config: ${warning}`, CONFIG_WARNING_TOAST_DURATION);
			}
		}
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
