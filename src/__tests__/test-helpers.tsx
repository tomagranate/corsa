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

function setActEnvironment(enabled: boolean): void {
	// @ts-expect-error - IS_REACT_ACT_ENVIRONMENT is a global test flag
	globalThis.IS_REACT_ACT_ENVIRONMENT = enabled;
}

function withActEnvironmentSync<T>(fn: () => T): T {
	// @ts-expect-error - IS_REACT_ACT_ENVIRONMENT is a global test flag
	const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
	setActEnvironment(true);
	try {
		return fn();
	} finally {
		setActEnvironment(Boolean(previous));
	}
}

async function withActEnvironment<T>(fn: () => Promise<T> | T): Promise<T> {
	// @ts-expect-error - IS_REACT_ACT_ENVIRONMENT is a global test flag
	const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
	setActEnvironment(true);
	try {
		return await fn();
	} finally {
		setActEnvironment(Boolean(previous));
	}
}

async function sleepWithAct(ms: number): Promise<void> {
	await withActEnvironment(async () => {
		await act(async () => {
			await new Promise<void>((resolve) => setTimeout(resolve, ms));
		});
	});
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

	const testSetup = await createTestRenderer({ width, height, kittyKeyboard });
	const root = createRoot(testSetup.renderer);

	await withActEnvironment(async () => {
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
	});

	const cleanup = async () => {
		await withActEnvironment(async () => {
			act(() => {
				root.unmount();
			});
			// Flush any async state updates queued by unmount effects.
			await act(async () => {});
		});
		try {
			await processManager.cleanup();
		} catch {
			// Ignore cleanup errors in tests
		}
		testSetup.renderer.destroy();
		await deletePidFile();
	};

	// Wrap input methods in act() so React processes state updates
	const wrappedMockInput = {
		...testSetup.mockInput,
		pressKey: (...args: Parameters<typeof testSetup.mockInput.pressKey>) => {
			withActEnvironmentSync(() => {
				act(() => testSetup.mockInput.pressKey(...args));
			});
		},
		pressArrow: (
			...args: Parameters<typeof testSetup.mockInput.pressArrow>
		) => {
			withActEnvironmentSync(() => {
				act(() => testSetup.mockInput.pressArrow(...args));
			});
		},
		pressEnter: (
			...args: Parameters<typeof testSetup.mockInput.pressEnter>
		) => {
			withActEnvironmentSync(() => {
				act(() => testSetup.mockInput.pressEnter(...args));
			});
		},
		pressEscape: (
			...args: Parameters<typeof testSetup.mockInput.pressEscape>
		) => {
			withActEnvironmentSync(() => {
				act(() => testSetup.mockInput.pressEscape(...args));
			});
		},
		pressTab: (...args: Parameters<typeof testSetup.mockInput.pressTab>) => {
			withActEnvironmentSync(() => {
				act(() => testSetup.mockInput.pressTab(...args));
			});
		},
		pressBackspace: (
			...args: Parameters<typeof testSetup.mockInput.pressBackspace>
		) => {
			withActEnvironmentSync(() => {
				act(() => testSetup.mockInput.pressBackspace(...args));
			});
		},
		pressCtrlC: () => {
			withActEnvironmentSync(() => {
				act(() => testSetup.mockInput.pressCtrlC());
			});
		},
		typeText: async (
			...args: Parameters<typeof testSetup.mockInput.typeText>
		) => {
			await withActEnvironment(async () => {
				await act(() => testSetup.mockInput.typeText(...args));
			});
		},
	};

	const wrappedMockMouse: MockMouse = {
		...testSetup.mockMouse,
		click: async (...args: Parameters<typeof testSetup.mockMouse.click>) => {
			await withActEnvironment(async () => {
				await act(async () => {
					await testSetup.mockMouse.click(...args);
				});
			});
		},
		scroll: async (...args: Parameters<typeof testSetup.mockMouse.scroll>) => {
			await withActEnvironment(async () => {
				await act(async () => {
					await testSetup.mockMouse.scroll(...args);
				});
			});
		},
		moveTo: async (...args: Parameters<typeof testSetup.mockMouse.moveTo>) => {
			await withActEnvironment(async () => {
				await act(async () => {
					await testSetup.mockMouse.moveTo(...args);
				});
			});
		},
	};

	const wrappedRenderOnce = async () => {
		await withActEnvironment(async () => {
			// Flush any pending React state updates (e.g., from processManager subscribers)
			await act(async () => {});
			await act(async () => {
				await testSetup.renderOnce();
			});
			await act(async () => {});
		});
	};

	return {
		renderer: testSetup.renderer,
		mockInput: wrappedMockInput,
		mockMouse: wrappedMockMouse,
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
		const satisfied = await withActEnvironment(
			async () => await act(async () => await predicate()),
		);
		if (satisfied) return;
		await sleepWithAct(intervalMs);
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
