/**
 * CLI argument parser for corsa.
 *
 * Supports:
 *   --config <path>, -c <path>  Custom config file path
 *   --help, -h                  Show help text
 *   --version, -v               Show version
 *   init                        Initialize a new config file
 *   mcp                         Start the MCP server
 *   ctl                         Control processes via the MCP API
 *   update                      Update corsa to the latest version
 */

// Import version at build time so it gets bundled into the compiled binary
import packageJson from "../package.json";

export interface CliArgs {
	/** Subcommand to run (init, mcp, ctl, update) */
	command?: "init" | "mcp" | "ctl" | "update";
	/** Path to config file (--config/-c) */
	configPath?: string;
	/** Parsed args for `corsa ctl` */
	ctl?: CtlArgs;
	/** Whether to show help (--help/-h) */
	showHelp: boolean;
	/** Whether to show version (--version/-v) */
	showVersion: boolean;
}

export type CtlSubcommand =
	| "list"
	| "logs"
	| "stop"
	| "restart"
	| "clear"
	| "send-keys"
	| "reload";

export interface CtlArgs {
	subcommand: CtlSubcommand;
	name?: string;
	lines?: number;
	search?: string;
	searchType?: "substring" | "fuzzy";
	keys: string[];
	json: boolean;
}

/**
 * Parse command line arguments.
 */
export function parseArgs(argv: string[] = process.argv.slice(2)): CliArgs {
	const args: CliArgs = {
		showHelp: false,
		showVersion: false,
	};

	let i = 0;
	while (i < argv.length) {
		const arg = argv[i];

		if (arg === "--help" || arg === "-h") {
			args.showHelp = true;
			i++;
		} else if (arg === "--version" || arg === "-v") {
			args.showVersion = true;
			i++;
		} else if (arg === "--config" || arg === "-c") {
			const nextArg = argv[i + 1];
			if (!nextArg || nextArg.startsWith("-")) {
				console.error("Error: --config requires a path argument");
				process.exit(1);
			}
			args.configPath = nextArg;
			i += 2;
		} else if (arg === "init") {
			args.command = "init";
			i++;
		} else if (arg === "mcp") {
			args.command = "mcp";
			i++;
		} else if (arg === "ctl") {
			args.command = "ctl";
			const ctl = parseCtlArgs(argv.slice(i + 1));
			if (ctl) {
				args.ctl = ctl;
			} else {
				args.showHelp = true;
			}
			i = argv.length;
		} else if (arg === "update" || arg === "upgrade") {
			args.command = "update";
			i++;
		} else if (arg?.startsWith("-")) {
			console.error(`Error: Unknown option: ${arg}`);
			console.error("Run 'corsa --help' for usage information.");
			process.exit(1);
		} else {
			// Unknown positional argument
			console.error(`Error: Unknown command: ${arg}`);
			console.error("Run 'corsa --help' for usage information.");
			process.exit(1);
		}
	}

	return args;
}

function parseCtlArgs(argv: string[]): CtlArgs | undefined {
	const first = argv[0];
	if (!first || first === "--help" || first === "-h") {
		return undefined;
	}

	const validSubcommands: CtlSubcommand[] = [
		"list",
		"logs",
		"stop",
		"restart",
		"clear",
		"send-keys",
		"reload",
	];
	const aliases: Record<string, CtlSubcommand> = {
		ps: "list",
		ls: "list",
		rm: "stop",
	};
	const normalized = aliases[first] ?? first;
	if (!validSubcommands.includes(normalized as CtlSubcommand)) {
		console.error(`Error: Unknown ctl command: ${first}`);
		console.error("Run 'corsa --help' for usage information.");
		process.exit(1);
	}

	const ctl: CtlArgs = {
		subcommand: normalized as CtlSubcommand,
		keys: [],
		json: false,
	};

	let i = 1;

	// Commands that require a process name
	const needsName = new Set<CtlSubcommand>([
		"logs",
		"stop",
		"restart",
		"clear",
		"send-keys",
	]);
	if (needsName.has(ctl.subcommand)) {
		const maybeName = argv[i];
		if (!maybeName || maybeName.startsWith("-")) {
			console.error(
				`Error: corsa ctl ${ctl.subcommand} requires a process name`,
			);
			process.exit(1);
		}
		ctl.name = maybeName;
		i++;
	}

	while (i < argv.length) {
		const arg = argv[i];
		if (arg === "--json") {
			ctl.json = true;
			i++;
		} else if (arg === "--lines") {
			const value = argv[i + 1];
			if (!value || value.startsWith("-")) {
				console.error("Error: --lines requires a number");
				process.exit(1);
			}
			const parsed = Number.parseInt(value, 10);
			if (!Number.isFinite(parsed) || parsed <= 0) {
				console.error("Error: --lines must be a positive integer");
				process.exit(1);
			}
			ctl.lines = parsed;
			i += 2;
		} else if (arg === "--search") {
			const value = argv[i + 1];
			if (!value || value.startsWith("-")) {
				console.error("Error: --search requires a query string");
				process.exit(1);
			}
			ctl.search = value;
			i += 2;
		} else if (arg === "--search-type") {
			const value = argv[i + 1];
			if (!value || !["substring", "fuzzy"].includes(value)) {
				console.error("Error: --search-type must be 'substring' or 'fuzzy'");
				process.exit(1);
			}
			ctl.searchType = value as "substring" | "fuzzy";
			i += 2;
		} else if (arg === "--key") {
			const value = argv[i + 1];
			if (!value || value.startsWith("-")) {
				console.error("Error: --key requires a key or text value");
				process.exit(1);
			}
			ctl.keys.push(value);
			i += 2;
		} else if (arg === "--help" || arg === "-h") {
			return undefined;
		} else if (arg?.startsWith("-")) {
			console.error(`Error: Unknown option: ${arg}`);
			process.exit(1);
		} else {
			console.error(`Error: Unexpected argument: ${arg}`);
			process.exit(1);
		}
	}

	if (ctl.subcommand === "send-keys" && ctl.keys.length === 0) {
		console.error(
			"Error: corsa ctl send-keys requires at least one --key value",
		);
		process.exit(1);
	}

	return ctl;
}

/**
 * Get the help text for the CLI.
 */
export function getHelpText(): string {
	return `
corsa - Terminal UI for managing local development processes

Usage:
  corsa [options]              Start the TUI dashboard
  corsa init                   Create a sample config file in the current directory
  corsa mcp                    Start the MCP server for AI agent integration
  corsa ctl <command>          Control processes through the MCP API
  corsa update                 Update corsa to the latest version

Options:
  -c, --config <path>           Path to config file (default: corsa.config.toml)
  -h, --help                    Show this help message
  -v, --version                 Show version information

Examples:
  corsa                        Start with default config
  corsa -c myconfig.toml       Start with custom config file
  corsa init                   Create corsa.config.toml in current directory
  corsa mcp                    Start MCP server (configure in your IDE)
  corsa ctl list               List all managed processes
  corsa ctl ls                 Alias for list
  corsa ctl logs api --lines 200 --search error
  corsa ctl rm api             Alias for stop
  corsa ctl send-keys api --key "npm test" --key return
  corsa ctl list --json        Output process list as JSON
  corsa update                 Update to the latest version

ctl commands:
  list                         List all processes (aliases: ps, ls)
  logs <name>                  Get logs for a process
  stop <name>                  Stop a process (alias: rm)
  restart <name>               Restart a process
  clear <name>                 Clear process logs
  send-keys <name> --key <k>   Send keypresses/text to an interactive process
  reload                       Reload config and restart processes

ctl options:
  --json                       Output JSON response data
  --lines <n>                  Log line limit (logs command)
  --search <query>             Log search query (logs command)
  --search-type <mode>         Search mode: substring|fuzzy (logs command)
  --key <value>                Key/text input (repeatable, send-keys command)

Documentation: https://github.com/tomagranate/corsa
`.trim();
}

/**
 * Get the version string from package.json.
 * The version is embedded at build time via the import at the top of this file.
 */
export function getVersion(): string {
	return packageJson.version || "unknown";
}
