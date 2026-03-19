import { z } from "zod";

export const ASCII_FONT_NAMES = [
	"tiny",
	"block",
	"shade",
	"slick",
	"huge",
	"grid",
	"pallet",
] as const;

export const SIDEBAR_POSITIONS = ["left", "right"] as const;
export const HORIZONTAL_TAB_POSITIONS = ["top", "bottom"] as const;

const toolHealthCheckSchema = z
	.object({
		url: z.string(),
		interval: z.number().int().positive().optional(),
		retries: z.number().int().positive().optional(),
	})
	.strict();

const toolUiSchema = z
	.object({
		label: z.string(),
		url: z.string(),
	})
	.strict();

export const toolConfigSchema = z
	.object({
		name: z.string().min(1),
		command: z.string().min(1),
		args: z.array(z.string()).optional(),
		cwd: z.string().optional(),
		env: z.record(z.string(), z.string()).optional(),
		cleanup: z.array(z.string()).optional(),
		description: z.string().optional(),
		healthCheck: toolHealthCheckSchema.optional(),
		ui: toolUiSchema.optional(),
		dependsOn: z.array(z.string()).optional(),
		interactive: z.boolean().optional(),
	})
	.strict();

export const homeConfigSchema = z
	.object({
		enabled: z.boolean().optional(),
		title: z.string().optional(),
		titleFont: z.enum(ASCII_FONT_NAMES).optional(),
		titleAlign: z.enum(["left", "center"]).optional(),
	})
	.strict();

export const mcpConfigSchema = z
	.object({
		enabled: z.boolean().optional(),
		port: z.number().int().min(1).max(65535).optional(),
	})
	.strict();

export const processesConfigSchema = z
	.object({
		cleanupOrphans: z.boolean().optional(),
	})
	.strict();

export const uiConfigSchema = z
	.object({
		sidebarPosition: z.enum(SIDEBAR_POSITIONS).optional(),
		horizontalTabPosition: z.enum(HORIZONTAL_TAB_POSITIONS).optional(),
		widthThreshold: z.number().positive().optional(),
		theme: z.string().optional(),
		maxLogLines: z.number().int().positive().optional(),
		showTabNumbers: z.boolean().optional(),
		showLineNumbers: z.union([z.boolean(), z.literal("auto")]).optional(),
	})
	.strict();

export const corsaConfigSchema = z
	.object({
		tools: z.array(toolConfigSchema),
		home: homeConfigSchema.optional(),
		mcp: mcpConfigSchema.optional(),
		processes: processesConfigSchema.optional(),
		ui: uiConfigSchema.optional(),
	})
	.strict();

export function createCorsaConfigJsonSchema(): object {
	return {
		...z.toJSONSchema(corsaConfigSchema),
		title: "corsa config",
		description: "Configuration schema for corsa.config.toml",
	};
}
