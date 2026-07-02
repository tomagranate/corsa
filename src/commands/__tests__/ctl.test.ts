import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../../cli";
import { ApiServer } from "../../lib/api";
import { deletePidFile } from "../../lib/processes/pid-file";
import { ProcessManager } from "../../lib/processes/process-manager";
import type { ToolConfig } from "../../types";
import { runCtl } from "../ctl";

const TEST_PORT = 19877;
const TEST_API_URL = `http://localhost:${TEST_PORT}`;

let processManager: ProcessManager;
let apiServer: ApiServer;
let originalApiUrl: string | undefined;
let reloadConfigPath: string;

let logOutput: string[] = [];
let errorOutput: string[] = [];
let originalLog: typeof console.log;
let originalError: typeof console.error;
let originalExit: typeof process.exit;

beforeAll(async () => {
	originalApiUrl = process.env.CORSA_API_URL;
	process.env.CORSA_API_URL = TEST_API_URL;

	processManager = new ProcessManager(500);
	await deletePidFile();

	const configs: ToolConfig[] = [
		{
			name: "test-process",
			command: "echo",
			args: ["hello world"],
			description: "A test process",
		},
		{
			name: "long-running",
			command: "sleep",
			args: ["60"],
			description: "A long-running process",
		},
		{
			name: "interactive-cat",
			command: "cat",
			interactive: true,
			description: "Interactive test process",
		},
	];
	await processManager.initialize(configs);
	processManager.setConfigPath("corsa.config.toml");

	const longRunning = processManager.getToolByName("long-running");
	if (!longRunning) throw new Error("Expected long-running tool");
	await processManager.startTool(longRunning.index);

	const interactiveCat = processManager.getToolByName("interactive-cat");
	if (!interactiveCat) throw new Error("Expected interactive-cat tool");
	await processManager.startTool(interactiveCat.index);

	reloadConfigPath = join(tmpdir(), `corsa-ctl-reload-${Date.now()}.toml`);
	const reloadConfig = `[[tools]]
name = "reloaded-tool"
command = "echo"
args = ["reloaded"]`;
	await Bun.write(reloadConfigPath, reloadConfig);
	processManager.setConfigPath(reloadConfigPath);

	const virtualToolIndex = processManager.createVirtualTool("MCP API");
	apiServer = new ApiServer(processManager, TEST_PORT, virtualToolIndex);
	apiServer.start();

	await new Promise((resolve) => setTimeout(resolve, 200));
});

afterAll(async () => {
	apiServer.stop();
	await processManager.cleanup();
	await deletePidFile();
	await unlink(reloadConfigPath);

	if (originalApiUrl === undefined) {
		delete process.env.CORSA_API_URL;
	} else {
		process.env.CORSA_API_URL = originalApiUrl;
	}
});

beforeEach(() => {
	logOutput = [];
	errorOutput = [];

	originalLog = console.log;
	originalError = console.error;
	originalExit = process.exit;

	console.log = (...args: unknown[]) => {
		logOutput.push(args.map(String).join(" "));
	};
	console.error = (...args: unknown[]) => {
		errorOutput.push(args.map(String).join(" "));
	};
	process.exit = ((code?: number) => {
		throw new Error(`EXIT:${code ?? 0}`);
	}) as typeof process.exit;
});

afterEach(() => {
	console.log = originalLog;
	console.error = originalError;
	process.exit = originalExit;
});

describe("parseArgs - ctl", () => {
	test("parses logs command options", () => {
		const args = parseArgs([
			"ctl",
			"logs",
			"api",
			"--lines",
			"200",
			"--search",
			"ERROR",
			"--search-type",
			"fuzzy",
			"--json",
		]);

		expect(args.command).toBe("ctl");
		expect(args.ctl).toEqual({
			subcommand: "logs",
			name: "api",
			lines: 200,
			search: "ERROR",
			searchType: "fuzzy",
			keys: [],
			json: true,
		});
	});

	test("parses send-keys with repeated --key options", () => {
		const args = parseArgs([
			"ctl",
			"send-keys",
			"repl",
			"--key",
			"help",
			"--key",
			"return",
		]);
		expect(args.command).toBe("ctl");
		expect(args.ctl).toEqual({
			subcommand: "send-keys",
			name: "repl",
			keys: ["help", "return"],
			json: false,
		});
	});

	test("maps ps and ls aliases to list", () => {
		const psArgs = parseArgs(["ctl", "ps"]);
		expect(psArgs.ctl?.subcommand).toBe("list");

		const lsArgs = parseArgs(["ctl", "ls"]);
		expect(lsArgs.ctl?.subcommand).toBe("list");
	});

	test("maps rm alias to stop", () => {
		const args = parseArgs(["ctl", "rm", "api"]);
		expect(args.ctl?.subcommand).toBe("stop");
		expect(args.ctl?.name).toBe("api");
	});

	test("parses global and ctl instance ids", () => {
		const globalArgs = parseArgs(["--id", "web", "ctl", "list"]);
		expect(globalArgs.instanceId).toBe("web");
		expect(globalArgs.ctl?.subcommand).toBe("list");

		const ctlArgs = parseArgs(["ctl", "--id", "api", "list"]);
		expect(ctlArgs.ctl?.instanceId).toBe("api");
		expect(ctlArgs.ctl?.subcommand).toBe("list");
	});

	test("parses list filters", () => {
		const args = parseArgs([
			"ctl",
			"list",
			"--name",
			"api",
			"--name",
			"worker",
			"--status",
			"running",
			"--fields",
			"name,status,healthStatus",
			"--logs",
			"2",
		]);

		expect(args.ctl).toEqual({
			subcommand: "list",
			names: ["api", "worker"],
			status: "running",
			fields: ["name", "status", "healthStatus"],
			logs: 2,
			keys: [],
			json: false,
		});
	});
});

describe("runCtl", () => {
	test("list prints process list in text mode", async () => {
		await runCtl({ subcommand: "list", keys: [], json: false });
		const text = logOutput.join("\n");
		expect(text).toContain("- test-process:");
		expect(text).toContain("- long-running:");
		expect(text).toContain("- interactive-cat:");
	});

	test("list prints JSON in --json mode", async () => {
		await runCtl({ subcommand: "list", keys: [], json: true });
		const json = JSON.parse(logOutput.join("\n")) as Array<{ name: string }>;
		const names = json.map((p) => p.name);
		expect(names).toContain("test-process");
		expect(names).toContain("long-running");
	});

	test("list omits logs by default and includes them with --logs", async () => {
		const result = processManager.getToolByName("test-process");
		if (!result) throw new Error("Expected test-process");
		processManager.clearLogs(result.index);
		processManager.addLogToTool(result.index, "ctl-list-log");

		await runCtl({ subcommand: "list", keys: [], json: false });
		expect(logOutput.join("\n")).not.toContain("ctl-list-log");

		logOutput = [];
		await runCtl({ subcommand: "list", logs: 1, keys: [], json: false });
		expect(logOutput.join("\n")).toContain("ctl-list-log");
	});

	test("logs returns formatted output", async () => {
		const result = processManager.getToolByName("test-process");
		if (!result) throw new Error("Expected test-process");
		processManager.clearLogs(result.index);
		processManager.addLogToTool(result.index, "ctl-log-marker-1");
		processManager.addLogToTool(result.index, "ctl-log-marker-2");

		await runCtl({
			subcommand: "logs",
			name: "test-process",
			lines: 50,
			keys: [],
			json: false,
		});

		const text = logOutput.join("\n");
		expect(text).toContain("=== Logs for test-process");
		expect(text).toContain("ctl-log-marker-1");
		expect(text).toContain("ctl-log-marker-2");
	});

	test("stop and restart manage process state", async () => {
		await runCtl({
			subcommand: "stop",
			name: "long-running",
			keys: [],
			json: false,
		});
		let result = processManager.getToolByName("long-running");
		if (!result) throw new Error("Expected long-running");
		expect(result.tool.status).not.toBe("running");

		await runCtl({
			subcommand: "restart",
			name: "long-running",
			keys: [],
			json: false,
		});
		result = processManager.getToolByName("long-running");
		if (!result) throw new Error("Expected long-running");
		expect(["running", "waiting"]).toContain(result.tool.status);
	});

	test("clear removes logs", async () => {
		const result = processManager.getToolByName("test-process");
		if (!result) throw new Error("Expected test-process");
		processManager.addLogToTool(result.index, "will-be-cleared");
		expect(result.tool.logs.length).toBeGreaterThan(0);

		await runCtl({
			subcommand: "clear",
			name: "test-process",
			keys: [],
			json: false,
		});

		expect(result.tool.logs.length).toBe(0);
	});

	test("send-keys sends input to interactive process", async () => {
		await runCtl({
			subcommand: "send-keys",
			name: "interactive-cat",
			keys: ["hello", "return"],
			json: false,
		});
		const text = logOutput.join("\n");
		expect(text).toContain("Sent");
		expect(text).toContain("interactive-cat");
	});

	test("reload reloads config and returns summary", async () => {
		await runCtl({
			subcommand: "reload",
			keys: [],
			json: false,
		});
		const text = logOutput.join("\n");
		expect(text).toContain("Reloaded configuration");
		expect(text).toContain("reloaded-tool");
	});
});
