import { readFile } from "node:fs/promises";
import { parse as parseToml } from "@iarna/toml";
import { z } from "zod";
import {
	ASCII_FONT_NAMES,
	homeConfigSchema,
	mcpConfigSchema,
	processesConfigSchema,
	toolConfigSchema,
	uiConfigSchema,
} from "./schema";
import type { Config, HomeConfig, McpConfig, ProcessConfig } from "./types";

const toolRequiredSchema = z
	.object({
		name: toolConfigSchema.shape.name,
		command: toolConfigSchema.shape.command,
	})
	.passthrough();

function warnUnknownOptions(
	section: string,
	raw: Record<string, unknown>,
	knownKeys: readonly string[],
	warnings: string[],
): void {
	for (const key of Object.keys(raw)) {
		if (!knownKeys.includes(key)) {
			warnings.push(`[${section}] Unknown option '${key}' - ignoring`);
		}
	}
}

function parseOptional<T>(
	value: unknown,
	schema: z.ZodType<T>,
	assign: (parsed: T) => void,
	warnings: string[],
	invalidMessage: string,
): void {
	if (value === undefined) return;
	const parsed = schema.safeParse(value);
	if (parsed.success) {
		assign(parsed.data);
		return;
	}
	warnings.push(invalidMessage);
}

function parseOptionalStringEnum<T extends string>(
	value: unknown,
	schema: z.ZodType<T>,
	assign: (parsed: T) => void,
	warnings: string[],
	nonStringMessage: string,
	invalidEnumMessage: string,
): void {
	if (value === undefined) return;
	const stringParsed = z.string().safeParse(value);
	if (!stringParsed.success) {
		warnings.push(nonStringMessage);
		return;
	}
	const enumParsed = schema.safeParse(value);
	if (enumParsed.success) {
		assign(enumParsed.data);
		return;
	}
	warnings.push(invalidEnumMessage);
}

function parseOptionalWithPrimaryAndConstraint<T>(
	value: unknown,
	primarySchema: z.ZodType<T>,
	constraintSchema: z.ZodType<T>,
	assign: (parsed: T) => void,
	warnings: string[],
	primaryInvalidMessage: string,
	constraintInvalidMessage: string,
): void {
	if (value === undefined) return;
	const primaryParsed = primarySchema.safeParse(value);
	if (!primaryParsed.success) {
		warnings.push(primaryInvalidMessage);
		return;
	}
	const constraintParsed = constraintSchema.safeParse(value);
	if (constraintParsed.success) {
		assign(constraintParsed.data);
		return;
	}
	warnings.push(constraintInvalidMessage);
}

/** Result of loading config - includes parsed config and any validation warnings */
export interface LoadConfigResult {
	config: Config;
	/** Validation warnings for invalid config values (non-fatal) */
	warnings: string[];
}

/**
 * Load and validate configuration from a TOML file.
 * Parses as much as possible, returning warnings for invalid values instead of throwing.
 * Only throws on fatal errors (file not found, invalid TOML syntax, missing required fields).
 */
export async function loadConfig(
	path: string = "toolui.config.toml",
): Promise<LoadConfigResult> {
	const warnings: string[] = [];

	try {
		const content = await readFile(path, "utf-8");
		const rawConfig = parseToml(content) as Record<string, unknown>;

		// Validate required fields - these are fatal errors
		if (!rawConfig.tools || !Array.isArray(rawConfig.tools)) {
			throw new Error("Config must have a 'tools' array");
		}

		const rawTools = rawConfig.tools as unknown[];
		for (let i = 0; i < rawTools.length; i++) {
			const tool = rawTools[i];
			if (!toolRequiredSchema.safeParse(tool).success) {
				throw new Error(
					`Tool at index ${i} must have 'name' and 'command' fields`,
				);
			}
		}

		// Validate and normalize home config
		const homeConfig = validateHomeConfig(
			rawConfig.home as Record<string, unknown> | undefined,
			warnings,
		);

		// Validate and normalize mcp config
		const mcpConfig = validateMcpConfig(
			rawConfig.mcp as Record<string, unknown> | undefined,
			warnings,
		);

		// Validate and normalize processes config
		const processesConfig = validateProcessConfig(
			rawConfig.processes as Record<string, unknown> | undefined,
			warnings,
		);

		// Validate and normalize ui config
		const uiConfig = validateUiConfig(
			rawConfig.ui as Record<string, unknown> | undefined,
			warnings,
		);

		// Build the validated config
		const config: Config = {
			tools: rawTools as Config["tools"],
			...(homeConfig && { home: homeConfig }),
			...(mcpConfig && { mcp: mcpConfig }),
			...(processesConfig && { processes: processesConfig }),
			...(uiConfig && { ui: uiConfig }),
		};

		// Validate depends_on references and check for circular dependencies
		validateDependsOn(config.tools, warnings);

		return { config, warnings };
	} catch (error) {
		if (error instanceof Error) {
			// Check for file not found error
			const nodeError = error as NodeJS.ErrnoException;
			if (nodeError.code === "ENOENT") {
				throw new Error(
					`Config file not found: ${path}\n` +
						`  Create a config file or specify a different path with -c <path>`,
				);
			}
			throw new Error(`Failed to load config: ${error.message}`);
		}
		throw error;
	}
}

/**
 * Validate home config section, collecting warnings for invalid values
 */
/** Known keys for home config section */
const HOME_CONFIG_KEYS: readonly string[] = homeConfigSchema.keyof().options;

function validateHomeConfig(
	raw: Record<string, unknown> | undefined,
	warnings: string[],
): HomeConfig | undefined {
	if (!raw) return undefined;

	warnUnknownOptions("home", raw, HOME_CONFIG_KEYS, warnings);

	const result: HomeConfig = {};

	parseOptional(
		raw.enabled,
		homeConfigSchema.shape.enabled,
		(value) => {
			result.enabled = value;
		},
		warnings,
		`[home] 'enabled' must be a boolean, got ${typeof raw.enabled}. Using default: false`,
	);

	parseOptional(
		raw.title,
		homeConfigSchema.shape.title,
		(value) => {
			result.title = value;
		},
		warnings,
		`[home] 'title' must be a string, got ${typeof raw.title}. Using default: "Home"`,
	);

	parseOptionalStringEnum(
		raw.titleFont,
		homeConfigSchema.shape.titleFont.unwrap(),
		(value) => {
			result.titleFont = value;
		},
		warnings,
		`[home] 'titleFont' must be a string, got ${typeof raw.titleFont}. Using default: "tiny"`,
		`[home] 'titleFont' must be one of: ${ASCII_FONT_NAMES.join(", ")}. Got "${raw.titleFont}". Using default: "tiny"`,
	);

	parseOptionalStringEnum(
		raw.titleAlign,
		homeConfigSchema.shape.titleAlign.unwrap(),
		(value) => {
			result.titleAlign = value;
		},
		warnings,
		`[home] 'titleAlign' must be a string, got ${typeof raw.titleAlign}. Using default: "left"`,
		`[home] 'titleAlign' must be "left" or "center". Got "${raw.titleAlign}". Using default: "left"`,
	);

	return result;
}

/** Known keys for mcp config section */
const MCP_CONFIG_KEYS: readonly string[] = mcpConfigSchema.keyof().options;

/**
 * Validate mcp config section, collecting warnings for invalid values
 */
function validateMcpConfig(
	raw: Record<string, unknown> | undefined,
	warnings: string[],
): McpConfig | undefined {
	if (!raw) return undefined;

	warnUnknownOptions("mcp", raw, MCP_CONFIG_KEYS, warnings);

	const result: McpConfig = {};

	parseOptional(
		raw.enabled,
		mcpConfigSchema.shape.enabled,
		(value) => {
			result.enabled = value;
		},
		warnings,
		`[mcp] 'enabled' must be a boolean, got ${typeof raw.enabled}. Using default: false`,
	);

	parseOptionalWithPrimaryAndConstraint(
		raw.port,
		z.number().int(),
		mcpConfigSchema.shape.port,
		(value) => {
			result.port = value;
		},
		warnings,
		`[mcp] 'port' must be an integer, got ${typeof raw.port}. Using default: 18765`,
		`[mcp] 'port' must be between 1 and 65535, got ${raw.port}. Using default: 18765`,
	);

	return result;
}

/** Known keys for processes config section */
const PROCESS_CONFIG_KEYS: readonly string[] =
	processesConfigSchema.keyof().options;

/**
 * Validate processes config section, collecting warnings for invalid values
 */
function validateProcessConfig(
	raw: Record<string, unknown> | undefined,
	warnings: string[],
): ProcessConfig | undefined {
	if (!raw) return undefined;

	warnUnknownOptions("processes", raw, PROCESS_CONFIG_KEYS, warnings);

	const result: ProcessConfig = {};

	parseOptional(
		raw.cleanupOrphans,
		processesConfigSchema.shape.cleanupOrphans,
		(value) => {
			result.cleanupOrphans = value;
		},
		warnings,
		`[processes] 'cleanupOrphans' must be a boolean, got ${typeof raw.cleanupOrphans}. Using default: true`,
	);

	return result;
}

/** Known keys for ui config section */
const UI_CONFIG_KEYS: readonly string[] = uiConfigSchema.keyof().options;

/**
 * Validate ui config section, collecting warnings for invalid values
 */
function validateUiConfig(
	raw: Record<string, unknown> | undefined,
	warnings: string[],
): Config["ui"] | undefined {
	if (!raw) return undefined;

	warnUnknownOptions("ui", raw, UI_CONFIG_KEYS, warnings);

	const result: NonNullable<Config["ui"]> = {};

	parseOptionalStringEnum(
		raw.sidebarPosition,
		uiConfigSchema.shape.sidebarPosition.unwrap(),
		(value) => {
			result.sidebarPosition = value;
		},
		warnings,
		`[ui] 'sidebarPosition' must be a string, got ${typeof raw.sidebarPosition}. Using default: "left"`,
		`[ui] 'sidebarPosition' must be "left" or "right", got "${raw.sidebarPosition}". Using default: "left"`,
	);

	parseOptionalStringEnum(
		raw.horizontalTabPosition,
		uiConfigSchema.shape.horizontalTabPosition.unwrap(),
		(value) => {
			result.horizontalTabPosition = value;
		},
		warnings,
		`[ui] 'horizontalTabPosition' must be a string, got ${typeof raw.horizontalTabPosition}. Using default: "top"`,
		`[ui] 'horizontalTabPosition' must be "top" or "bottom", got "${raw.horizontalTabPosition}". Using default: "top"`,
	);

	parseOptionalWithPrimaryAndConstraint(
		raw.widthThreshold,
		z.number(),
		uiConfigSchema.shape.widthThreshold,
		(value) => {
			result.widthThreshold = value;
		},
		warnings,
		`[ui] 'widthThreshold' must be a number, got ${typeof raw.widthThreshold}. Using default: 100`,
		`[ui] 'widthThreshold' must be positive, got ${raw.widthThreshold}. Using default: 100`,
	);

	// theme (string, any value accepted - validation happens at render time)
	parseOptional(
		raw.theme,
		uiConfigSchema.shape.theme,
		(value) => {
			result.theme = value;
		},
		warnings,
		`[ui] 'theme' must be a string, got ${typeof raw.theme}. Using default: "default"`,
	);

	parseOptionalWithPrimaryAndConstraint(
		raw.maxLogLines,
		z.number().int(),
		uiConfigSchema.shape.maxLogLines,
		(value) => {
			result.maxLogLines = value;
		},
		warnings,
		`[ui] 'maxLogLines' must be an integer, got ${typeof raw.maxLogLines}. Using default: 10000`,
		`[ui] 'maxLogLines' must be positive, got ${raw.maxLogLines}. Using default: 10000`,
	);

	parseOptional(
		raw.showTabNumbers,
		uiConfigSchema.shape.showTabNumbers,
		(value) => {
			result.showTabNumbers = value;
		},
		warnings,
		`[ui] 'showTabNumbers' must be a boolean, got ${typeof raw.showTabNumbers}. Using default: false`,
	);

	parseOptional(
		raw.showLineNumbers,
		uiConfigSchema.shape.showLineNumbers,
		(value) => {
			result.showLineNumbers = value;
		},
		warnings,
		`[ui] 'showLineNumbers' must be true, false, or "auto", got ${typeof raw.showLineNumbers === "string" ? `"${raw.showLineNumbers}"` : typeof raw.showLineNumbers}. Using default: "auto"`,
	);

	return result;
}

/**
 * Validate depends_on references and detect circular dependencies.
 * Adds warnings for invalid references, throws for circular dependencies.
 */
function validateDependsOn(tools: Config["tools"], warnings: string[]): void {
	const toolNames = new Set(tools.map((t) => t.name));

	// Check for invalid references
	for (const tool of tools) {
		if (!tool.dependsOn || tool.dependsOn.length === 0) continue;

		for (const dep of tool.dependsOn) {
			if (!toolNames.has(dep)) {
				warnings.push(
					`[tools.${tool.name}] dependsOn references unknown tool '${dep}' - ignoring`,
				);
			}
			if (dep === tool.name) {
				warnings.push(
					`[tools.${tool.name}] dependsOn references itself - ignoring`,
				);
			}
		}
	}

	// Check for circular dependencies
	const cycle = detectCircularDependencies(tools);
	if (cycle) {
		throw new Error(
			`Circular dependency detected: ${cycle.join(" -> ")} -> ${cycle[0]}`,
		);
	}
}

/**
 * Detect circular dependencies using DFS.
 * Returns the cycle path if found, null otherwise.
 */
export function detectCircularDependencies(
	tools: Config["tools"],
): string[] | null {
	const toolMap = new Map(tools.map((t) => [t.name, t]));
	const visited = new Set<string>();
	const recursionStack = new Set<string>();
	const path: string[] = [];

	function dfs(name: string): string[] | null {
		visited.add(name);
		recursionStack.add(name);
		path.push(name);

		const tool = toolMap.get(name);
		if (tool?.dependsOn) {
			for (const dep of tool.dependsOn) {
				// Skip invalid references (already warned about)
				if (!toolMap.has(dep)) continue;

				if (!visited.has(dep)) {
					const cycle = dfs(dep);
					if (cycle) return cycle;
				} else if (recursionStack.has(dep)) {
					// Found a cycle - return the cycle portion of the path
					const cycleStart = path.indexOf(dep);
					return path.slice(cycleStart);
				}
			}
		}

		path.pop();
		recursionStack.delete(name);
		return null;
	}

	for (const tool of tools) {
		if (!visited.has(tool.name)) {
			const cycle = dfs(tool.name);
			if (cycle) return cycle;
		}
	}

	return null;
}
