import type { CtlArgs } from "../cli";
import { listLiveInstances, resolveApiUrl } from "../lib/instances";

interface ProcessSummary {
	name: string;
	description?: string;
	status: "running" | "stopped" | "error" | "shuttingDown" | "waiting";
	exitCode: number | null;
	logCount: number;
	pid?: number;
	uptime?: number;
	healthStatus?: "starting" | "healthy" | "unhealthy";
	recentLogs?: string[];
}

interface LogsResponse {
	name: string;
	totalLines: number;
	returnedLines: number;
	logs: string[];
}

interface ApiResponse<T> {
	ok: boolean;
	data?: T;
	error?: string;
}

async function apiRequest<T>(
	baseUrl: string,
	path: string,
	method: "GET" | "POST" = "GET",
	body?: unknown,
): Promise<T> {
	const url = `${baseUrl}${path}`;

	try {
		const init: RequestInit = { method };
		if (body !== undefined) {
			init.headers = { "Content-Type": "application/json" };
			init.body = JSON.stringify(body);
		}

		const response = await fetch(url, init);
		const json = (await response.json()) as ApiResponse<T>;
		if (!json.ok) {
			throw new Error(json.error ?? "Unknown API error");
		}
		return json.data as T;
	} catch (error) {
		if (
			error instanceof TypeError &&
			error.message.toLowerCase().includes("fetch")
		) {
			throw new Error(
				`Cannot connect to corsa API at ${baseUrl}. ` +
					"Start corsa with mcp.enabled = true in your config before using `corsa ctl`.",
			);
		}
		throw error;
	}
}

function printJson(data: unknown): void {
	console.log(JSON.stringify(data, null, 2));
}

function formatProcessList(processes: ProcessSummary[]): string {
	if (processes.length === 0) {
		return "No processes found";
	}

	return processes
		.map((p) => {
			const status = p.status?.toUpperCase() ?? "UNKNOWN";
			const exitInfo =
				typeof p.exitCode === "number" ? ` (exit: ${p.exitCode})` : "";
			const pidInfo = p.pid ? ` [PID: ${p.pid}]` : "";
			const uptimeInfo = p.uptime
				? ` (up ${Math.round(p.uptime / 1000)}s)`
				: "";
			const healthInfo = p.healthStatus ? ` [health: ${p.healthStatus}]` : "";
			const desc = p.description ? `\n  ${p.description}` : "";

			let logsSection = "";
			if (p.recentLogs && p.recentLogs.length > 0) {
				const logsHeader =
					p.recentLogs.length < p.logCount
						? `\n  Recent logs (last ${p.recentLogs.length} of ${p.logCount}):`
						: `\n  Logs (${p.logCount} lines):`;
				const logsText = p.recentLogs.map((line) => `    ${line}`).join("\n");
				logsSection = `${logsHeader}\n${logsText}`;
			}

			const lineCount =
				typeof p.logCount === "number" ? ` (${p.logCount} lines)` : "";
			return `- ${p.name ?? "(unnamed)"}: ${status}${exitInfo}${pidInfo}${uptimeInfo}${healthInfo}${lineCount}${desc}${logsSection}`;
		})
		.join("\n\n");
}

async function runList(apiUrl: string, args: CtlArgs): Promise<void> {
	const params = new URLSearchParams();
	for (const name of args.names ?? []) {
		params.append("name", name);
	}
	if (args.status) {
		params.set("status", args.status);
	}
	if (args.fields && args.fields.length > 0) {
		params.set("fields", args.fields.join(","));
	}
	if (args.logs !== undefined) {
		params.set("logs", String(args.logs));
	}

	const query = params.toString();
	const processes = await apiRequest<ProcessSummary[]>(
		apiUrl,
		`/api/processes${query ? `?${query}` : ""}`,
	);
	if (args.json) {
		printJson(processes);
		return;
	}
	console.log(formatProcessList(processes));
}

async function runLogs(apiUrl: string, args: CtlArgs): Promise<void> {
	const name = args.name as string;
	const params = new URLSearchParams();
	params.set("lines", String(args.lines ?? 50));
	if (args.search) {
		params.set("search", args.search);
		params.set("searchType", args.searchType ?? "substring");
	}

	const response = await apiRequest<LogsResponse>(
		apiUrl,
		`/api/processes/${encodeURIComponent(name)}/logs?${params.toString()}`,
	);

	if (args.json) {
		printJson(response);
		return;
	}

	const header = `=== Logs for ${name} (${response.returnedLines}/${response.totalLines} lines) ===`;
	const logs = response.logs.join("\n");
	console.log(logs ? `${header}\n${logs}` : `${header}\n(no logs)`);
}

async function runStop(apiUrl: string, args: CtlArgs): Promise<void> {
	const name = args.name as string;
	const result = await apiRequest<{ message: string }>(
		apiUrl,
		`/api/processes/${encodeURIComponent(name)}/stop`,
		"POST",
	);
	if (args.json) {
		printJson(result);
		return;
	}
	console.log(result.message);
}

async function runRestart(apiUrl: string, args: CtlArgs): Promise<void> {
	const name = args.name as string;
	const result = await apiRequest<{ message: string }>(
		apiUrl,
		`/api/processes/${encodeURIComponent(name)}/restart`,
		"POST",
	);
	if (args.json) {
		printJson(result);
		return;
	}
	console.log(result.message);
}

async function runClear(apiUrl: string, args: CtlArgs): Promise<void> {
	const name = args.name as string;
	const result = await apiRequest<{ message: string }>(
		apiUrl,
		`/api/processes/${encodeURIComponent(name)}/clear`,
		"POST",
	);
	if (args.json) {
		printJson(result);
		return;
	}
	console.log(result.message);
}

async function runSendKeys(apiUrl: string, args: CtlArgs): Promise<void> {
	const name = args.name as string;
	const result = await apiRequest<{ message: string; sent: number }>(
		apiUrl,
		`/api/processes/${encodeURIComponent(name)}/input`,
		"POST",
		{ keys: args.keys },
	);
	if (args.json) {
		printJson(result);
		return;
	}
	console.log(result.message);
}

async function runReload(apiUrl: string, json: boolean): Promise<void> {
	const result = await apiRequest<{
		message: string;
		tools: string[];
		warnings: string[];
	}>(apiUrl, "/api/reload", "POST");

	if (json) {
		printJson(result);
		return;
	}

	let text = result.message;
	if (result.tools.length > 0) {
		text += `\n\nStarted processes:\n${result.tools.map((t) => `- ${t}`).join("\n")}`;
	}
	if (result.warnings.length > 0) {
		text += `\n\nWarnings:\n${result.warnings.map((w) => `- ${w}`).join("\n")}`;
	}
	console.log(text);
}

async function runInstances(json: boolean): Promise<void> {
	const instances = await listLiveInstances();
	if (json) {
		printJson(instances);
		return;
	}

	if (instances.length === 0) {
		console.log("No live corsa instances found");
		return;
	}

	console.log(
		instances
			.map(
				(instance) =>
					`- ${instance.id}: ${instance.projectDir} (${instance.apiUrl}, pid ${instance.pid}, started ${instance.startedAt})`,
			)
			.join("\n"),
	);
}

export async function runCtl(
	args: CtlArgs,
	configPath?: string,
	instanceId?: string,
): Promise<void> {
	try {
		if (args.subcommand === "instances") {
			await runInstances(args.json);
			return;
		}

		const apiUrl = await resolveApiUrl(
			configPath,
			args.instanceId ?? instanceId,
		);

		switch (args.subcommand) {
			case "list":
				await runList(apiUrl, args);
				return;
			case "logs":
				await runLogs(apiUrl, args);
				return;
			case "stop":
				await runStop(apiUrl, args);
				return;
			case "restart":
				await runRestart(apiUrl, args);
				return;
			case "clear":
				await runClear(apiUrl, args);
				return;
			case "send-keys":
				await runSendKeys(apiUrl, args);
				return;
			case "reload":
				await runReload(apiUrl, args.json);
				return;
			default:
				console.error(`Error: Unknown ctl command: ${args.subcommand}`);
				process.exit(1);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Error: ${message}`);
		process.exit(1);
	}
}
