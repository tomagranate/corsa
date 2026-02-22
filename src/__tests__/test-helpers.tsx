import type { MockInput, MockMouse, TestRenderer } from "@opentui/core/testing";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import { act } from "react";
import { App } from "../App";
import type { Config } from "../lib/config";
import { ProcessManager } from "../lib/processes";
import { deletePidFile } from "../lib/processes/pid-file";
import { ThemeProvider } from "../lib/theme/ThemeContext";
import { getTheme } from "../lib/theme/themes";
import type { ToolConfig, ToolState } from "../types";

const DEFAULT_THEME_KEY = "default";

export interface RenderAppOptions {
	width?: number;
	height?: number;
	tools: ToolConfig[];
	config?: Partial<Config>;
	initialLineWrap?: boolean;
	kittyKeyboard?: boolean;
}

export interface TestApp {
	renderer: TestRenderer;
	mockInput: MockInput;
	mockMouse: MockMouse;
	renderOnce: () => Promise<void>;
	captureFrame: () => string;
	resize: (width: number, height: number) => void;
	processManager: ProcessManager;
	cleanup: () => Promise<void>;
}

function buildConfig(tools: ToolConfig[], overrides?: Partial<Config>): Config {
	return {
		tools,
		home: { enabled: false },
		processes: { cleanupOrphans: false },
		ui: {},
		...overrides,
	};
}

/**
 * Render the full App inside ThemeProvider using OpenTUI's test renderer.
 * Uses createTestRenderer + createRoot from the main @opentui/react package
 * so that React context (AppContext with renderer/keyHandler) is shared correctly.
 */
export async function renderApp(options: RenderAppOptions): Promise<TestApp> {
	const {
		width = 120,
		height = 40,
		tools: toolConfigs,
		config: configOverrides,
		initialLineWrap = true,
		kittyKeyboard = false,
	} = options;

	await deletePidFile();

	const processManager = new ProcessManager(1000);
	const { tools: initialTools } = await processManager.initialize(toolConfigs, {
		cleanupOrphans: false,
	});

	const config = buildConfig(toolConfigs, configOverrides);
	const theme = getTheme(DEFAULT_THEME_KEY);

	// @ts-expect-error - IS_REACT_ACT_ENVIRONMENT is a global test flag
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;

	const testSetup = await createTestRenderer({ width, height, kittyKeyboard });
	const root = createRoot(testSetup.renderer);

	act(() => {
		root.render(
			<ThemeProvider initialTheme={theme} initialThemeKey={DEFAULT_THEME_KEY}>
				<App
					processManager={processManager}
					initialTools={initialTools}
					renderer={testSetup.renderer}
					config={config}
					configPath="/tmp/test-corsa.config.toml"
					initialLineWrap={initialLineWrap}
				/>
			</ThemeProvider>,
		);
	});

	const cleanup = async () => {
		act(() => {
			root.unmount();
		});
		try {
			await processManager.cleanup();
		} catch {
			// Ignore cleanup errors in tests
		}
		testSetup.renderer.destroy();
		await deletePidFile();
		// @ts-expect-error - IS_REACT_ACT_ENVIRONMENT is a global test flag
		globalThis.IS_REACT_ACT_ENVIRONMENT = false;
	};

	// Wrap input methods in act() so React processes state updates
	const wrappedMockInput = {
		...testSetup.mockInput,
		pressKey: (...args: Parameters<typeof testSetup.mockInput.pressKey>) => {
			act(() => testSetup.mockInput.pressKey(...args));
		},
		pressArrow: (
			...args: Parameters<typeof testSetup.mockInput.pressArrow>
		) => {
			act(() => testSetup.mockInput.pressArrow(...args));
		},
		pressEnter: (
			...args: Parameters<typeof testSetup.mockInput.pressEnter>
		) => {
			act(() => testSetup.mockInput.pressEnter(...args));
		},
		pressEscape: (
			...args: Parameters<typeof testSetup.mockInput.pressEscape>
		) => {
			act(() => testSetup.mockInput.pressEscape(...args));
		},
		pressTab: (...args: Parameters<typeof testSetup.mockInput.pressTab>) => {
			act(() => testSetup.mockInput.pressTab(...args));
		},
		pressBackspace: (
			...args: Parameters<typeof testSetup.mockInput.pressBackspace>
		) => {
			act(() => testSetup.mockInput.pressBackspace(...args));
		},
		pressCtrlC: () => {
			act(() => testSetup.mockInput.pressCtrlC());
		},
		typeText: async (
			...args: Parameters<typeof testSetup.mockInput.typeText>
		) => {
			await act(() => testSetup.mockInput.typeText(...args));
		},
	};

	const wrappedRenderOnce = async () => {
		// Flush any pending React state updates (e.g., from processManager subscribers)
		await act(async () => {});
		await act(() => testSetup.renderOnce());
	};

	return {
		renderer: testSetup.renderer,
		mockInput: wrappedMockInput,
		mockMouse: testSetup.mockMouse,
		renderOnce: wrappedRenderOnce,
		captureFrame: testSetup.captureCharFrame,
		resize: testSetup.resize,
		processManager,
		cleanup,
	};
}

/**
 * Wait for a condition to become true, polling at intervals.
 */
export async function waitFor(
	predicate: () => boolean | Promise<boolean>,
	timeoutMs = 5000,
	intervalMs = 50,
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await predicate()) return;
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

/**
 * Wait for a process to reach a specific status.
 */
export async function waitForStatus(
	processManager: ProcessManager,
	toolIndex: number,
	status: ToolState["status"],
	timeoutMs = 5000,
): Promise<void> {
	await waitFor(() => {
		const tool = processManager.getTool(toolIndex);
		return tool?.status === status;
	}, timeoutMs);
}

/**
 * Wait for a process to have log output.
 */
export async function waitForLogs(
	processManager: ProcessManager,
	toolIndex: number,
	timeoutMs = 5000,
): Promise<void> {
	await waitFor(() => {
		const tool = processManager.getTool(toolIndex);
		return (tool?.logs.length ?? 0) > 0;
	}, timeoutMs);
}
