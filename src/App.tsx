import { type CliRenderer, TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { runUpdateInTui } from "./commands/update";
import { AboutModal } from "./components/AboutModal";
import { CommandPalette, commandPalette } from "./components/CommandPalette";
import { HelpBar, type HelpBarMode } from "./components/HelpBar";
import { HomeTab } from "./components/HomeTab";
import { LogViewer } from "./components/LogViewer";
import { TabBar } from "./components/TabBar";
import { ThemePicker } from "./components/ThemePicker";
import { ToastContainer, toast } from "./components/Toast";
import { StatusIcons } from "./constants";
import { useToolsList } from "./hooks";
import type { Config } from "./lib/config";
import { HealthChecker, type HealthStateMap } from "./lib/health";
import { keyToPty, type ProcessManager } from "./lib/processes";
import { useTheme } from "./lib/theme";
import { type UpdateState, updateChecker } from "./lib/update-checker";
import type { ToolState } from "./types";

/** Per-tab search state */
interface TabSearchState {
	searchMode: boolean;
	searchQuery: string;
	filterMode: boolean;
	fuzzyMode: boolean;
	currentMatchIndex: number;
}

const DEFAULT_SEARCH_STATE: TabSearchState = {
	searchMode: false,
	searchQuery: "",
	filterMode: true, // Default ON per requirements
	fuzzyMode: true, // Default ON - fuzzy search enabled
	currentMatchIndex: 0,
};

interface AppProps {
	processManager: ProcessManager;
	initialTools: ToolState[];
	renderer: CliRenderer;
	config: Config;
	/** Path to the loaded config file */
	configPath: string;
	/** Initial line wrap setting from preferences */
	initialLineWrap?: boolean;
	/** Callback when line wrap changes (to save preference) */
	onLineWrapChange?: (lineWrap: boolean) => void;
	/** Callback to register for config updates (called when reload happens) */
	onRegisterConfigUpdate?: (callback: (newConfig: Config) => void) => void;
	/** Callback to register health status getter (for MCP API) */
	onRegisterGetHealthStatus?: (
		callback: (toolName: string) => "starting" | "healthy" | "unhealthy" | null,
	) => void;
}

const DEFAULT_WIDTH_THRESHOLD = 100;

export function App({
	processManager,
	initialTools,
	renderer,
	config: initialConfig,
	configPath,
	initialLineWrap = true,
	onLineWrapChange,
	onRegisterConfigUpdate,
	onRegisterGetHealthStatus,
}: AppProps) {
	// Store config as state so it can be updated on reload
	const [config, setConfig] = useState<Config>(initialConfig);

	// Get theme from context (includes saveTheme for dynamic updates)
	const { theme, saveTheme, themeKey } = useTheme();

	// Track theme key ref for use in callbacks
	const themeKeyRef = useRef(themeKey);
	useEffect(() => {
		themeKeyRef.current = themeKey;
	}, [themeKey]);

	// Register config update callback on mount
	useEffect(() => {
		if (onRegisterConfigUpdate) {
			onRegisterConfigUpdate((newConfig: Config) => {
				setConfig(newConfig);

				// Reset to home tab (or first tab if home disabled)
				setActiveIndex(0);

				// Reset health states - they'll be repopulated as health checks run
				setHealthStates(new Map());

				// Update tool configs ref for health checker
				toolConfigsRef.current = newConfig.tools;

				// Reinitialize health checker with new tool configs if it exists
				if (healthCheckerRef.current) {
					healthCheckerRef.current.stop();
					healthCheckerRef.current.initialize(newConfig.tools);
					healthCheckerRef.current.start();
				}

				// Update theme if it changed in the new config
				const newThemeKey = newConfig.ui?.theme;
				if (newThemeKey && newThemeKey !== themeKeyRef.current) {
					saveTheme(newThemeKey);
					toast.info(`Theme changed to "${newThemeKey}"`);
				}

				// Start tools with dependency awareness (same logic as initial mount)
				const newHasDependencies = newConfig.tools.some(
					(t) => t.dependsOn && t.dependsOn.length > 0,
				);

				// Callback to check if a tool is ready for dependents
				const isToolReady = (toolName: string): boolean => {
					const currentTools = toolsRef.current;
					const currentHealthStates = healthStatesRef.current;

					const tool = currentTools.find((t) => t.config.name === toolName);
					if (!tool) return false;

					// If tool has health check, it's ready when healthy
					if (tool.config.healthCheck) {
						const healthState = currentHealthStates.get(toolName);
						return healthState?.status === "healthy";
					}

					// If no health check, it's ready when running
					return tool.status === "running";
				};

				if (newHasDependencies) {
					processManager.startAllToolsWithDependencies(isToolReady);
				} else {
					// No dependencies, start all tools immediately
					const allTools = processManager.getTools();
					for (let i = 0; i < allTools.length; i++) {
						const tool = allTools[i];
						// Only start non-virtual tools (those with commands)
						if (tool?.config.command) {
							processManager.startTool(i);
						}
					}
				}

				// Show toast for successful reload
				toast.info("Configuration reloaded");
			});
		}
	}, [onRegisterConfigUpdate, saveTheme, processManager]);

	// Use hook that only re-renders when tool status/logs actually change (event-driven)
	const tools = useToolsList(processManager);

	// Home tab configuration
	const homeEnabled = config.home?.enabled ?? false;
	const homeConfig = config.home ?? { enabled: false };

	// Check if any tool has dependencies (need health checks for dependency tracking)
	const hasDependencies = tools.some(
		(t) => t.config.dependsOn && t.config.dependsOn.length > 0,
	);

	// Health checker for home tab AND dependency tracking
	const healthCheckerRef = useRef<HealthChecker | null>(null);
	const [healthStates, setHealthStates] = useState<HealthStateMap>(new Map());

	// Stable reference to tool configs (only changes when config actually changes)
	const toolConfigsRef = useRef(tools.map((t) => t.config));

	// Track if tools have been started (for dependency-aware startup)
	const toolsStartedRef = useRef(false);

	// Refs for accessing latest state in async callbacks
	const healthStatesRef = useRef<HealthStateMap>(new Map());
	const toolsRef = useRef(tools);

	// Keep refs in sync with state
	useEffect(() => {
		healthStatesRef.current = healthStates;
	}, [healthStates]);
	useEffect(() => {
		toolsRef.current = tools;
	}, [tools]);

	// Initialize health checker - needed for home tab OR dependency tracking
	const needsHealthChecker = homeEnabled || hasDependencies;
	useEffect(() => {
		if (!needsHealthChecker) return;

		const checker = new HealthChecker();
		checker.initialize(toolConfigsRef.current);
		checker.onChange((toolName, state) => {
			setHealthStates((prev) => {
				const newMap = new Map(prev);
				newMap.set(toolName, state);
				return newMap;
			});
		});
		checker.start();
		healthCheckerRef.current = checker;

		// Initialize health states from checker
		setHealthStates(checker.getAllHealthStates());

		return () => {
			checker.stop();
			healthCheckerRef.current = null;
		};
	}, [needsHealthChecker]);

	// Register health status getter for MCP API
	// Read directly from HealthChecker instance (always up-to-date) instead of
	// from healthStatesRef which lags one render cycle behind
	useEffect(() => {
		if (onRegisterGetHealthStatus) {
			onRegisterGetHealthStatus((toolName: string) => {
				return (
					healthCheckerRef.current?.getHealthState(toolName)?.status ?? null
				);
			});
		}
	}, [onRegisterGetHealthStatus]);

	// Register restart callback to reset health state directly.
	// This avoids relying on React to detect the status transition (running → stopped → running),
	// which can be batched away, causing the health state to never be reset on restart.
	useEffect(() => {
		if (!needsHealthChecker) return;

		processManager.onToolRestart = (toolName: string) => {
			healthCheckerRef.current?.resetHealthState(toolName);
		};

		return () => {
			processManager.onToolRestart = undefined;
		};
	}, [needsHealthChecker, processManager]);

	// Background update checker - check on mount and subscribe to changes
	useEffect(() => {
		// Subscribe to update state changes
		const unsubscribe = updateChecker.subscribe((state) => {
			setUpdateState(state);
		});

		// Trigger update check (will only fetch if > 4 hours since last check)
		updateChecker.checkForUpdates();

		return unsubscribe;
	}, []);

	// Watch for process status changes and trigger immediate health checks
	const prevToolStatusesForHealthRef = useRef<Map<string, string>>(new Map());
	useEffect(() => {
		if (!needsHealthChecker || !healthCheckerRef.current) return;

		for (const tool of tools) {
			const toolName = tool.config.name;
			const prevStatus = prevToolStatusesForHealthRef.current.get(toolName);
			const currentStatus = tool.status;

			// If status changed to running, trigger health check
			if (prevStatus !== currentStatus && currentStatus === "running") {
				if (tool.config.healthCheck) {
					healthCheckerRef.current.resetHealthState(toolName);
					// Trigger immediate check after a short delay to let process initialize
					setTimeout(() => {
						healthCheckerRef.current?.checkNow(toolName);
					}, 1000);
				}
			}

			prevToolStatusesForHealthRef.current.set(toolName, currentStatus);
		}
	}, [needsHealthChecker, tools]);

	// Active index: 0 is home tab when enabled, tools start at 1
	const [activeIndex, setActiveIndex] = useState(homeEnabled ? 0 : 0);
	const [navigationKey, setNavigationKey] = useState(0);
	const [tabSearchStates, setTabSearchStates] = useState<
		Map<string, TabSearchState>
	>(new Map());
	const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
	const [shortcutsOpen, setShortcutsOpen] = useState(false);
	const [themePickerOpen, setThemePickerOpen] = useState(false);
	const [aboutModalOpen, setAboutModalOpen] = useState(false);
	const [lineWrap, setLineWrap] = useState(initialLineWrap);
	const [updateState, setUpdateState] = useState<UpdateState>(
		updateChecker.getState(),
	);
	const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false);
	const [inputMode, setInputMode] = useState(false);
	const { width: terminalWidth } = useTerminalDimensions();

	// Get search state for a specific tab (returns default if not set)
	const getTabSearchState = useCallback(
		(toolName: string): TabSearchState => {
			return tabSearchStates.get(toolName) ?? { ...DEFAULT_SEARCH_STATE };
		},
		[tabSearchStates],
	);

	// Update search state for a specific tab
	const updateTabSearchState = useCallback(
		(toolName: string, updates: Partial<TabSearchState>) => {
			setTabSearchStates((prev) => {
				const newMap = new Map(prev);
				const current = prev.get(toolName) ?? { ...DEFAULT_SEARCH_STATE };
				newMap.set(toolName, { ...current, ...updates });
				return newMap;
			});
		},
		[],
	);

	// Filter tabs based on shutdown state (needed early for calculations)
	const isShuttingDown = processManager.getIsShuttingDown();
	const activeTools = tools.filter((tool) => {
		if (isShuttingDown) {
			// During shutdown: only show processes that are gracefully shutting down
			return tool.status === "shuttingDown";
		}
		// Normal operation: show all tabs (running, stopped, error, shuttingDown)
		return true;
	});

	// During shutdown, home tab is disabled
	const effectiveHomeEnabled = homeEnabled && !isShuttingDown;

	// Total tabs for navigation - during shutdown, use activeTools (no home)
	const totalTabs = isShuttingDown
		? activeTools.length
		: effectiveHomeEnabled
			? tools.length + 1
			: tools.length;

	// Calculate tool index accounting for home tab offset
	// Use effectiveHomeEnabled (which is false during shutdown)
	const isHomeTabActive = effectiveHomeEnabled && activeIndex === 0;
	const toolIndex = effectiveHomeEnabled ? activeIndex - 1 : activeIndex;

	// Get current tab's search state
	const currentTool = toolIndex >= 0 ? tools[toolIndex] : undefined;
	const currentToolName = currentTool?.config.name ?? "";
	const currentSearchState = getTabSearchState(currentToolName);

	const widthThreshold = config.ui?.widthThreshold ?? DEFAULT_WIDTH_THRESHOLD;
	const sidebarPosition = config.ui?.sidebarPosition ?? "left";
	const horizontalTabPosition = config.ui?.horizontalTabPosition ?? "top";
	const showTabNumbers = config.ui?.showTabNumbers ?? false;
	const useVertical = terminalWidth >= widthThreshold;

	// Calculate sidebar width when in vertical mode (for LogViewer truncation calculation)
	// Vertical TabBar has width={20} + gap (1 char) = 21 chars
	const sidebarWidth = useVertical ? 21 : 0;

	// Line number display setting for LogViewer
	const showLineNumbers = config.ui?.showLineNumbers ?? "auto";

	// Whether the current tool is interactive and supports input mode
	const isCurrentToolInteractive =
		!!currentTool?.config.interactive && currentTool?.status === "running";

	// Reset input mode when switching tabs, or when the tool stops / is not interactive
	// biome-ignore lint/correctness/useExhaustiveDependencies: activeIndex triggers reset on tab switch even between interactive tools
	useEffect(() => {
		setInputMode(false);
	}, [activeIndex, isCurrentToolInteractive]);

	// Start all tools on mount (with dependency awareness if needed)
	useEffect(() => {
		if (toolsStartedRef.current) return;
		toolsStartedRef.current = true;

		// Callback to check if a tool is ready for dependents
		// Uses refs to access latest state since this is called asynchronously
		const isToolReady = (toolName: string): boolean => {
			const currentTools = toolsRef.current;
			const currentHealthStates = healthStatesRef.current;

			const tool = currentTools.find((t) => t.config.name === toolName);
			if (!tool) return false;

			// If tool has health check, it's ready when healthy
			if (tool.config.healthCheck) {
				const healthState = currentHealthStates.get(toolName);
				return healthState?.status === "healthy";
			}

			// If no health check, it's ready when running
			return tool.status === "running";
		};

		// Start tools with dependency awareness
		if (hasDependencies) {
			processManager.startAllToolsWithDependencies(isToolReady);
		} else {
			// No dependencies, start all tools immediately
			for (let i = 0; i < initialTools.length; i++) {
				processManager.startTool(i);
			}
		}
	}, [processManager, initialTools.length, hasDependencies]);

	// Track previous tool statuses for exit detection
	const prevToolStatusesRef = useRef<Map<string, string>>(new Map());

	// Detect process exits and show toast (unless shutting down)
	useEffect(() => {
		const isShuttingDown = processManager.getIsShuttingDown();
		if (isShuttingDown) return;

		for (const tool of tools) {
			const toolName = tool.config.name;
			const prevStatus = prevToolStatusesRef.current.get(toolName);
			const currentStatus = tool.status;

			// Detect transition from "running" to "stopped" or "error"
			if (prevStatus === "running" && currentStatus !== "running") {
				if (currentStatus === "stopped") {
					toast.info(`${toolName} exited`);
				} else if (currentStatus === "error") {
					toast.error(`${toolName} exited with error (code ${tool.exitCode})`);
				}
			}

			// Update tracked status
			prevToolStatusesRef.current.set(toolName, currentStatus);
		}
	}, [tools, processManager]);

	// Toggle line wrap function (used by both keyboard and command palette)
	const toggleLineWrap = useCallback(() => {
		setLineWrap((prev) => {
			const newValue = !prev;
			onLineWrapChange?.(newValue);
			return newValue;
		});
	}, [onLineWrapChange]);

	// Handle check for updates (shows loader in modal)
	const handleCheckForUpdates = useCallback(async () => {
		setIsCheckingForUpdates(true);
		try {
			await updateChecker.checkForUpdates(true); // Force check
		} finally {
			setIsCheckingForUpdates(false);
		}
	}, []);

	// Handle update click (runs the update)
	const handleUpdate = useCallback(async () => {
		toast.info("Updating corsa...");
		const result = await runUpdateInTui();
		if (result.success) {
			toast.info(`Updated corsa to v${result.version}. Restart to activate`);
		} else {
			toast.error(`Update failed - ${result.error}`);
		}
	}, []);

	// Handle HelpBar update click (opens About modal)
	const handleHelpBarUpdateClick = useCallback(() => {
		setAboutModalOpen(true);
	}, []);

	// Toggle debug console (OpenTUI built-in console)
	const toggleConsole = useCallback(() => {
		renderer.console.toggle();
	}, [renderer]);

	// Register commands for the command palette
	useEffect(() => {
		const commands = [
			{
				id: "search",
				label: "Search logs",
				shortcut: "/",
				category: "Navigation",
				action: () => {
					if (currentToolName) {
						updateTabSearchState(currentToolName, { searchMode: true });
					}
				},
			},
			// Only show fuzzy/filter commands when search is active on this tab
			...(currentSearchState.searchQuery.length > 0
				? [
						{
							id: "toggle-fuzzy-search",
							label: currentSearchState.fuzzyMode
								? "Switch to substring search"
								: "Switch to fuzzy search",
							shortcut: "Ctrl+F",
							category: "Search",
							action: () => {
								if (currentToolName) {
									updateTabSearchState(currentToolName, {
										fuzzyMode: !currentSearchState.fuzzyMode,
									});
								}
							},
						},
						{
							id: "toggle-filter-mode",
							label: currentSearchState.filterMode
								? "Disable filter mode"
								: "Enable filter mode",
							shortcut: "Ctrl+H",
							category: "Search",
							action: () => {
								if (currentToolName) {
									updateTabSearchState(currentToolName, {
										filterMode: !currentSearchState.filterMode,
									});
								}
							},
						},
					]
				: []),
			{
				id: "toggle-line-wrap",
				label: lineWrap ? "Disable line wrapping" : "Enable line wrapping",
				shortcut: "w",
				category: "View",
				action: toggleLineWrap,
			},
			{
				id: "restart-process",
				label: "Restart current process",
				shortcut: "r",
				category: "Process",
				action: () => {
					if (currentTool && toolIndex >= 0) {
						toast.info(`Restarting ${currentToolName}...`);
						// Update status tracking so we detect quick exits
						prevToolStatusesRef.current.set(currentToolName, "running");
						processManager.restartTool(toolIndex);
					}
				},
			},
			{
				id: "stop-process",
				label: "Stop current process",
				shortcut: "s",
				category: "Process",
				action: () => {
					if (
						currentTool &&
						currentTool.status === "running" &&
						toolIndex >= 0
					) {
						toast.info(`Stopping ${currentToolName}...`);
						processManager.stopTool(toolIndex);
					}
				},
			},
			{
				id: "clear-logs",
				label: "Clear logs",
				shortcut: "c",
				category: "View",
				action: () => {
					if (currentTool && toolIndex >= 0) {
						processManager.clearLogs(toolIndex);
						toast.info("Logs cleared");
					}
				},
			},
			{
				id: "toggle-console",
				label: "Toggle debug console",
				category: "View",
				action: toggleConsole,
			},
			{
				id: "quit",
				label: "Quit",
				shortcut: "q",
				category: "Application",
				action: async () => {
					await processManager.cleanup();
					renderer.stop();
					renderer.destroy();
					process.exit(0);
				},
			},
			{
				id: "shortcuts",
				label: "Show keyboard shortcuts",
				shortcut: "?",
				category: "Help",
				action: () => setShortcutsOpen(true),
			},
			{
				id: "about",
				label: "About corsa",
				category: "Help",
				action: () => setAboutModalOpen(true),
			},
		];

		// Add theme switching command (opens theme picker modal)
		commands.push({
			id: "switch-theme",
			label: "Switch theme",
			category: "Appearance",
			action: () => setThemePickerOpen(true),
		});

		// Add tab switching commands for all tabs (shortcuts only for first 9)
		// These go last so they appear at the bottom of the palette
		// When home is enabled (and not shutting down), home is at index 0, tools start at index 1
		if (effectiveHomeEnabled) {
			commands.push({
				id: "switch-tab-home",
				label: "Switch to Home",
				shortcut: "`",
				category: "Tabs",
				action: () => {
					setNavigationKey((k) => k + 1);
					setActiveIndex(0);
				},
			});
		}

		for (let i = 0; i < tools.length; i++) {
			const tool = tools[i];
			if (tool) {
				const tabIndex = effectiveHomeEnabled ? i + 1 : i;
				commands.push({
					id: `switch-tab-${i}`,
					label: `Switch to ${tool.config.name}`,
					shortcut: tabIndex < 9 ? `${tabIndex + 1}` : undefined,
					category: "Tabs",
					action: () => {
						setNavigationKey((k) => k + 1);
						setActiveIndex(tabIndex);
					},
				});
			}
		}

		commandPalette.register(commands);

		return () => {
			commandPalette.clear();
		};
	}, [
		tools,
		processManager,
		renderer,
		currentToolName,
		currentTool,
		toolIndex,
		effectiveHomeEnabled,
		updateTabSearchState,
		lineWrap,
		toggleLineWrap,
		toggleConsole,
		currentSearchState.searchQuery,
		currentSearchState.fuzzyMode,
		currentSearchState.filterMode,
	]);

	// Handle keyboard input
	useKeyboard(async (key) => {
		const isShuttingDown = processManager.getIsShuttingDown();

		if (key.ctrl && key.name === "c") {
			if (isShuttingDown) {
				// Already shutting down - force quit
				renderer.stop();
				renderer.destroy();
				process.exit(1);
				return;
			}

			// Priority 1: Close console if open
			if (renderer.console.visible) {
				renderer.console.hide();
				return;
			}

			// Priority 2: Close command palette if open
			if (commandPaletteOpen) {
				setCommandPaletteOpen(false);
				return;
			}

			// Priority 3: Close shortcuts modal if open
			if (shortcutsOpen) {
				setShortcutsOpen(false);
				return;
			}

			// Priority 4: Close theme picker if open (handled by picker itself)
			if (themePickerOpen) {
				return; // ThemePicker handles its own Ctrl+C
			}

			// Priority 5: Close about modal if open (handled by modal itself)
			if (aboutModalOpen) {
				return; // AboutModal handles its own Ctrl+C
			}

			// Priority 6: Exit the program
			await processManager.cleanup();
			renderer.stop();
			renderer.destroy();
			process.exit(0);
			return;
		}

		// Skip most key handling when modals are open (they handle their own input)
		if (
			commandPaletteOpen ||
			shortcutsOpen ||
			themePickerOpen ||
			aboutModalOpen
		) {
			return;
		}

		// Command palette shortcut: Ctrl+P or Ctrl+K (works even in search mode and input mode)
		if (key.ctrl && (key.name === "p" || key.name === "k")) {
			// Exit search mode to avoid focus issues when palette closes
			if (currentSearchState.searchMode && currentToolName) {
				updateTabSearchState(currentToolName, { searchMode: false });
			}
			if (inputMode) {
				setInputMode(false);
			}
			setCommandPaletteOpen(true);
			return;
		}

		// Input mode: forward keystrokes to the interactive process's PTY
		if (inputMode) {
			if (key.name === "escape") {
				setInputMode(false);
				toast.info("Input mode exited");
				return;
			}

			// Forward the key to the process PTY
			if (toolIndex >= 0) {
				const ptyData = keyToPty(key);
				if (ptyData !== null) {
					processManager.writeToProcess(toolIndex, ptyData);
				}
			}
			return;
		}

		// Skip most key handling when in search mode (LogViewer handles it)
		if (currentSearchState.searchMode) {
			return;
		}

		// Shortcuts modal: ?
		if (key.name === "?") {
			setShortcutsOpen(true);
			return;
		}

		// Toggle line wrapping: w
		if (key.name === "w") {
			toggleLineWrap();
			return;
		}

		// Restart current process: r
		if (key.name === "r") {
			if (currentTool && toolIndex >= 0) {
				toast.info(`Restarting ${currentToolName}...`);
				// Update status tracking so we detect quick exits
				prevToolStatusesRef.current.set(currentToolName, "running");
				processManager.restartTool(toolIndex);
			}
			return;
		}

		// Stop current process: s
		if (key.name === "s") {
			if (currentTool && currentTool.status === "running" && toolIndex >= 0) {
				toast.info(`Stopping ${currentToolName}...`);
				processManager.stopTool(toolIndex);
			}
			return;
		}

		// Clear logs: c
		if (key.name === "c") {
			if (currentTool && toolIndex >= 0) {
				processManager.clearLogs(toolIndex);
				toast.info("Logs cleared");
			}
			return;
		}

		// Enter input mode: i (only for interactive tools that are running)
		if (key.name === "i") {
			if (isCurrentToolInteractive && toolIndex >= 0) {
				setInputMode(true);
				toast.info("Input mode — type to send input, Esc to exit");
			}
			return;
		}

		if (key.name === "q") {
			if (isShuttingDown) {
				// Already shutting down - ignore 'q'
				return;
			}
			// Start graceful shutdown
			await processManager.cleanup();
			renderer.stop();
			renderer.destroy();
			process.exit(0);
			return;
		}

		// Tab navigation - increment navigationKey to signal auto-scroll should happen
		// During shutdown, navigate through activeTools indices, mapping to original tool indices
		const navigatePrev = () => {
			if (totalTabs === 0) return;
			setNavigationKey((k) => k + 1);

			if (isShuttingDown) {
				// Find current position in activeTools
				const currentActiveIdx = currentTool
					? activeTools.indexOf(currentTool)
					: 0;
				const nextActiveIdx =
					currentActiveIdx > 0 ? currentActiveIdx - 1 : activeTools.length - 1;
				const nextTool = activeTools[nextActiveIdx];
				if (nextTool) {
					const originalIdx = tools.indexOf(nextTool);
					setActiveIndex(effectiveHomeEnabled ? originalIdx + 1 : originalIdx);
				}
			} else {
				setActiveIndex((prev) => (prev > 0 ? prev - 1 : totalTabs - 1));
			}
		};

		const navigateNext = () => {
			if (totalTabs === 0) return;
			setNavigationKey((k) => k + 1);

			if (isShuttingDown) {
				// Find current position in activeTools
				const currentActiveIdx = currentTool
					? activeTools.indexOf(currentTool)
					: -1;
				const nextActiveIdx =
					currentActiveIdx < activeTools.length - 1 ? currentActiveIdx + 1 : 0;
				const nextTool = activeTools[nextActiveIdx];
				if (nextTool) {
					const originalIdx = tools.indexOf(nextTool);
					setActiveIndex(effectiveHomeEnabled ? originalIdx + 1 : originalIdx);
				}
			} else {
				setActiveIndex((prev) => (prev < totalTabs - 1 ? prev + 1 : 0));
			}
		};

		if (key.name === "h" || key.name === "left") {
			navigatePrev();
		}
		if (key.name === "l" || key.name === "right") {
			navigateNext();
		}
		if (key.name === "j" || key.name === "down") {
			if (useVertical) {
				navigateNext();
			}
		}
		if (key.name === "k" || key.name === "up") {
			if (useVertical) {
				navigatePrev();
			}
		}

		// Backtick to switch to home tab (only when not shutting down)
		if (key.name === "`" && effectiveHomeEnabled) {
			setNavigationKey((k) => k + 1);
			setActiveIndex(0);
		}

		// Number keys to switch tabs
		if (key.number && key.name) {
			const num = parseInt(key.name, 10);
			if (num >= 1 && num <= totalTabs) {
				setNavigationKey((k) => k + 1);
				setActiveIndex(num - 1);
			}
		}
	});

	// Find the active tool index in the filtered list
	// Account for home tab offset when calculating display index
	const activeToolIndex = currentTool ? activeTools.indexOf(currentTool) : -1;
	const displayActiveIndex = effectiveHomeEnabled
		? isHomeTabActive
			? 0
			: activeToolIndex + 1
		: activeToolIndex >= 0
			? activeToolIndex
			: 0;
	const activeTool = isHomeTabActive
		? undefined
		: activeTools[activeToolIndex >= 0 ? activeToolIndex : 0];

	// During shutdown, ensure active tab stays valid as tabs are removed
	useEffect(() => {
		if (!isShuttingDown || activeTools.length === 0) return;

		// If current tool is no longer in activeTools, switch to first available
		if (activeToolIndex < 0 && activeTools.length > 0) {
			const firstShuttingDown = activeTools[0];
			if (firstShuttingDown) {
				const originalIndex = tools.indexOf(firstShuttingDown);
				if (originalIndex >= 0) {
					setNavigationKey((k) => k + 1);
					setActiveIndex(originalIndex);
				}
			}
		}
	}, [isShuttingDown, activeToolIndex, activeTools, tools]);

	const shuttingDownCount = activeTools.length;
	const hasShuttingDown = isShuttingDown && shuttingDownCount > 0;

	const tabBarComponent = (
		<TabBar
			tools={activeTools}
			activeIndex={displayActiveIndex}
			onSelect={(idx) => {
				// When home is enabled (and not shutting down), index 0 is home tab
				if (effectiveHomeEnabled && idx === 0) {
					setActiveIndex(0);
					return;
				}
				// Adjust for home tab offset
				const toolIdx = effectiveHomeEnabled ? idx - 1 : idx;
				const tool = activeTools[toolIdx];
				if (tool) {
					const originalIndex = tools.indexOf(tool);
					if (originalIndex >= 0) {
						setActiveIndex(
							effectiveHomeEnabled ? originalIndex + 1 : originalIndex,
						);
					}
				}
			}}
			vertical={useVertical}
			theme={theme}
			width={terminalWidth}
			showTabNumbers={showTabNumbers}
			navigationKey={navigationKey}
			homeEnabled={effectiveHomeEnabled}
		/>
	);

	// Main content area - show HomeTab or LogViewer based on active tab
	const mainContentComponent = isHomeTabActive ? (
		<HomeTab
			tools={tools}
			healthStates={healthStates}
			config={homeConfig}
			theme={theme}
			sidebarWidth={sidebarWidth}
			onToolSelect={(idx) => {
				// Switch to the selected tool's tab
				setNavigationKey((k) => k + 1);
				setActiveIndex(effectiveHomeEnabled ? idx + 1 : idx);
			}}
			onRestartTool={(idx) => {
				const tool = tools[idx];
				if (tool) {
					toast.info(`Restarting ${tool.config.name}...`);
					prevToolStatusesRef.current.set(tool.config.name, "running");
					processManager.restartTool(idx);
				}
			}}
			onStopTool={(idx) => {
				const tool = tools[idx];
				if (tool && tool.status === "running") {
					toast.info(`Stopping ${tool.config.name}...`);
					processManager.stopTool(idx);
				}
			}}
		/>
	) : activeTool ? (
		<LogViewer
			tool={activeTool}
			theme={theme}
			searchMode={currentSearchState.searchMode}
			searchQuery={currentSearchState.searchQuery}
			filterMode={currentSearchState.filterMode}
			fuzzyMode={currentSearchState.fuzzyMode}
			currentMatchIndex={currentSearchState.currentMatchIndex}
			onSearchModeChange={(active) =>
				updateTabSearchState(activeTool.config.name, { searchMode: active })
			}
			onSearchQueryChange={(query) =>
				updateTabSearchState(activeTool.config.name, {
					searchQuery: query,
					currentMatchIndex: 0,
				})
			}
			onFilterModeChange={(filter) =>
				updateTabSearchState(activeTool.config.name, { filterMode: filter })
			}
			onFuzzyModeChange={(fuzzy) =>
				updateTabSearchState(activeTool.config.name, { fuzzyMode: fuzzy })
			}
			onCurrentMatchIndexChange={(index) =>
				updateTabSearchState(activeTool.config.name, {
					currentMatchIndex: index,
				})
			}
			showLineNumbers={showLineNumbers}
			lineWrap={lineWrap}
			sidebarWidth={sidebarWidth}
			inputMode={inputMode}
		/>
	) : (
		<scrollbox
			flexGrow={1}
			height="100%"
			padding={1}
			flexDirection="column"
			backgroundColor={theme.colors.surface0}
		>
			<text fg={theme.colors.text}>No active processes</text>
		</scrollbox>
	);

	// Calculate toast offset based on layout elements above the main content
	// Search bar visibility: shown when search mode is active OR there's a search query
	const isSearchBarVisible =
		currentSearchState.searchMode || currentSearchState.searchQuery.length > 0;

	const calculateToastOffset = useCallback(() => {
		let offset = 1; // Base offset
		if (hasShuttingDown) {
			offset += 1; // Shutdown warning bar
		}
		if (!useVertical && horizontalTabPosition === "top") {
			offset += 2; // Horizontal tab bar at top
		}
		if (isSearchBarVisible && !isHomeTabActive) {
			offset += 3; // Search bar height (3 lines with border)
		}
		return offset;
	}, [
		hasShuttingDown,
		useVertical,
		horizontalTabPosition,
		isSearchBarVisible,
		isHomeTabActive,
	]);

	return (
		<box
			flexDirection="column"
			width="100%"
			height="100%"
			backgroundColor={theme.colors.surface0}
		>
			{hasShuttingDown && (
				<box
					height={1}
					paddingLeft={1}
					paddingRight={1}
					backgroundColor={theme.colors.warning}
				>
					<text
						attributes={TextAttributes.BOLD}
						fg={theme.colors.warningForeground}
					>
						{terminalWidth < 50
							? `${StatusIcons.WARNING} Shutting down...`
							: terminalWidth < 70
								? `${StatusIcons.WARNING} Shutting down gracefully...`
								: `${StatusIcons.WARNING} WARNING: ${shuttingDownCount} process${shuttingDownCount > 1 ? "es" : ""} shutting down gracefully. Please wait...`}
					</text>
				</box>
			)}
			{useVertical ? (
				// Vertical layout: sidebar on left or right
				// No gap here - LogViewer handles its own left margin for content
				<box
					key="layout-vertical"
					flexDirection="row"
					flexGrow={1}
					flexShrink={1}
					flexBasis={0}
					width="100%"
				>
					{sidebarPosition === "left" && tabBarComponent}
					{mainContentComponent}
					{sidebarPosition === "right" && tabBarComponent}
				</box>
			) : (
				// Horizontal layout: tabs on top or bottom
				<box
					key="layout-horizontal"
					flexDirection="column"
					flexGrow={1}
					flexShrink={1}
					flexBasis={0}
					width="100%"
				>
					{horizontalTabPosition === "top" && tabBarComponent}
					{mainContentComponent}
					{horizontalTabPosition === "bottom" && tabBarComponent}
				</box>
			)}
			<HelpBar
				theme={theme}
				mode={getHelpBarMode()}
				width={terminalWidth}
				showVersion={useVertical}
				isUpdateAvailable={updateState.isUpdateAvailable}
				onUpdateClick={handleHelpBarUpdateClick}
			/>
			<ToastContainer theme={theme} topOffset={calculateToastOffset()} />
			<CommandPalette
				theme={theme}
				isOpen={commandPaletteOpen}
				onClose={() => setCommandPaletteOpen(false)}
			/>
			<CommandPalette
				theme={theme}
				isOpen={shortcutsOpen}
				onClose={() => setShortcutsOpen(false)}
				showShortcuts
			/>
			<ThemePicker
				isOpen={themePickerOpen}
				onClose={() => setThemePickerOpen(false)}
			/>
			<AboutModal
				isOpen={aboutModalOpen}
				onClose={() => setAboutModalOpen(false)}
				theme={theme}
				updateState={updateState}
				configPath={configPath}
				isCheckingForUpdates={isCheckingForUpdates}
				onCheckForUpdates={handleCheckForUpdates}
				onUpdate={handleUpdate}
			/>
		</box>
	);

	function getHelpBarMode(): HelpBarMode {
		if (hasShuttingDown) return "shuttingDown";
		if (commandPaletteOpen) return "commandPalette";
		if (shortcutsOpen) return "shortcuts";
		if (themePickerOpen) return "commandPalette"; // Use same hints as command palette
		if (aboutModalOpen) return "commandPalette"; // Use same hints as command palette
		if (inputMode) return "input";
		if (currentSearchState.searchMode) return "search";
		if (isCurrentToolInteractive) return "interactive";
		return "normal";
	}
}
