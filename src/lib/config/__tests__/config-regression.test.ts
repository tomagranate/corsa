import { describe, expect, test } from "bun:test";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config";

const tempDir = tmpdir();

async function withTempConfig(
	configContent: string,
	assertion: (path: string) => Promise<void>,
): Promise<void> {
	const configPath = join(
		tempDir,
		`corsa-config-regression-${Date.now()}-${Math.random().toString(16).slice(2)}.toml`,
	);
	await writeFile(configPath, configContent.trim());
	try {
		await assertion(configPath);
	} finally {
		await unlink(configPath).catch(() => {});
	}
}

describe("Config loading regression behavior", () => {
	test("keeps valid optional fields without warnings", async () => {
		await withTempConfig(
			`
[home]
enabled = true
title = "Dashboard"
titleFont = "tiny"
titleAlign = "center"

[ui]
sidebarPosition = "right"
horizontalTabPosition = "bottom"
widthThreshold = 120
theme = "terminal"
maxLogLines = 20000
showTabNumbers = true
showLineNumbers = "auto"

[mcp]
enabled = true
port = 18765

[processes]
cleanupOrphans = false

[[tools]]
name = "api"
command = "bun"
args = ["run", "dev"]
cwd = "."
cleanup = ["echo cleanup"]
description = "API server"
dependsOn = ["db"]
interactive = true

[tools.env]
NODE_ENV = "development"

[tools.healthCheck]
url = "http://localhost:3000/health"
interval = 5000
retries = 3

[tools.ui]
label = "Open API"
url = "http://localhost:3000"

[[tools]]
name = "db"
command = "docker"
args = ["compose", "up", "postgres"]
`,
			async (configPath) => {
				const { config, warnings } = await loadConfig(configPath);
				expect(warnings).toEqual([]);
				expect(config.home?.titleAlign).toBe("center");
				expect(config.ui?.showLineNumbers).toBe("auto");
				expect(config.tools[0]?.interactive).toBe(true);
				expect(config.tools[0]?.dependsOn).toEqual(["db"]);
			},
		);
	});

	test("warns and ignores unknown keys in every optional section", async () => {
		await withTempConfig(
			`
[home]
enabled = true
extraKey = "x"

[mcp]
enabled = true
extraKey = "x"

[processes]
cleanupOrphans = true
extraKey = "x"

[ui]
theme = "default"
extraKey = "x"

[[tools]]
name = "app"
command = "bun"
`,
			async (configPath) => {
				const { warnings } = await loadConfig(configPath);
				expect(warnings).toEqual([
					"[home] Unknown option 'extraKey' - ignoring",
					"[mcp] Unknown option 'extraKey' - ignoring",
					"[processes] Unknown option 'extraKey' - ignoring",
					"[ui] Unknown option 'extraKey' - ignoring",
				]);
			},
		);
	});

	test("warns and drops invalid home values", async () => {
		await withTempConfig(
			`
[home]
enabled = "yes"
title = 123
titleFont = "comic"
titleAlign = "right"

[[tools]]
name = "app"
command = "bun"
`,
			async (configPath) => {
				const { config, warnings } = await loadConfig(configPath);
				expect(config.home).toEqual({});
				expect(warnings).toEqual([
					"[home] 'enabled' must be a boolean, got string. Using default: false",
					"[home] 'title' must be a string, got number. Using default: \"Home\"",
					'[home] \'titleFont\' must be one of: tiny, block, shade, slick, huge, grid, pallet. Got "comic". Using default: "tiny"',
					'[home] \'titleAlign\' must be "left" or "center". Got "right". Using default: "left"',
				]);
			},
		);
	});

	test("warns and drops invalid mcp/process/ui values", async () => {
		await withTempConfig(
			`
[mcp]
enabled = "on"
port = 65536

[processes]
cleanupOrphans = "no"

[ui]
sidebarPosition = "center"
horizontalTabPosition = "left"
widthThreshold = -1
theme = 42
maxLogLines = 0
showTabNumbers = "yes"
showLineNumbers = "always"

[[tools]]
name = "app"
command = "bun"
`,
			async (configPath) => {
				const { config, warnings } = await loadConfig(configPath);
				expect(config.mcp).toEqual({});
				expect(config.processes).toEqual({});
				expect(config.ui).toEqual({});
				expect(warnings).toEqual([
					"[mcp] 'enabled' must be a boolean, got string. Using default: false",
					"[mcp] 'port' must be between 1 and 65535, got 65536. Using default: 18765",
					"[processes] 'cleanupOrphans' must be a boolean, got string. Using default: true",
					'[ui] \'sidebarPosition\' must be "left" or "right", got "center". Using default: "left"',
					'[ui] \'horizontalTabPosition\' must be "top" or "bottom", got "left". Using default: "top"',
					"[ui] 'widthThreshold' must be positive, got -1. Using default: 100",
					"[ui] 'theme' must be a string, got number. Using default: \"default\"",
					"[ui] 'maxLogLines' must be positive, got 0. Using default: 10000",
					"[ui] 'showTabNumbers' must be a boolean, got string. Using default: false",
					'[ui] \'showLineNumbers\' must be true, false, or "auto", got "always". Using default: "auto"',
				]);
			},
		);
	});

	test("accepts showLineNumbers boolean values without warnings", async () => {
		await withTempConfig(
			`
[ui]
showLineNumbers = true

[[tools]]
name = "app"
command = "bun"
`,
			async (configPath) => {
				const { config, warnings } = await loadConfig(configPath);
				expect(warnings).toEqual([]);
				expect(config.ui?.showLineNumbers).toBe(true);
			},
		);
	});

	test("warns for unknown dependsOn refs", async () => {
		await withTempConfig(
			`
[[tools]]
name = "api"
command = "bun"
dependsOn = ["db"]

[[tools]]
name = "worker"
command = "bun"
dependsOn = ["api", "missing"]

[[tools]]
name = "db"
command = "bun"
`,
			async (configPath) => {
				const { warnings } = await loadConfig(configPath);
				expect(warnings).toEqual([
					"[tools.worker] dependsOn references unknown tool 'missing' - ignoring",
				]);
			},
		);
	});

	test("self-dependency is treated as a circular dependency error", async () => {
		await withTempConfig(
			`
[[tools]]
name = "api"
command = "bun"
dependsOn = ["api"]
`,
			async (configPath) => {
				await expect(loadConfig(configPath)).rejects.toThrow(
					"Circular dependency detected: api -> api",
				);
			},
		);
	});

	test("throws on circular dependencies", async () => {
		await withTempConfig(
			`
[[tools]]
name = "a"
command = "bun"
dependsOn = ["b"]

[[tools]]
name = "b"
command = "bun"
dependsOn = ["c"]

[[tools]]
name = "c"
command = "bun"
dependsOn = ["a"]
`,
			async (configPath) => {
				await expect(loadConfig(configPath)).rejects.toThrow(
					"Circular dependency detected: a -> b -> c -> a",
				);
			},
		);
	});

	test("throws fatal errors for malformed top-level tools", async () => {
		await withTempConfig(
			`
[home]
enabled = true
`,
			async (configPath) => {
				await expect(loadConfig(configPath)).rejects.toThrow(
					"Config must have a 'tools' array",
				);
			},
		);

		await withTempConfig(
			`
tools = [1, 2, 3]
`,
			async (configPath) => {
				await expect(loadConfig(configPath)).rejects.toThrow(
					"Tool at index 0 must have 'name' and 'command' fields",
				);
			},
		);
	});
});
