/**
 * Update command - detects installation method and runs the appropriate update.
 */

import { execSync, spawnSync } from "node:child_process";
import { createWriteStream, unlinkSync } from "node:fs";
import { chmod, rename } from "node:fs/promises";
import { get as httpsGet } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGunzip } from "node:zlib";
import { getVersion } from "../cli";

/** Package name on npm */
const NPM_PACKAGE = "@tomagranate/corsa";

/** GitHub repo for releases */
export const GITHUB_REPO = "tomagranate/corsa";

/** Installation method types */
export type InstallMethod =
	| "npm-global"
	| "npm-local"
	| "pnpm-global"
	| "pnpm-local"
	| "bun-global"
	| "bun-local"
	| "yarn-global"
	| "yarn-local"
	| "brew"
	| "direct"
	| "development"
	| "unknown";

/**
 * Detect installation method from a resolved binary path.
 * Exported for testing.
 *
 * Returns format: "package-manager-scope" (e.g., "npm-global", "pnpm-local")
 */
export function detectInstallMethodFromPath(
	realPath: string,
	options?: { checkBrew?: boolean },
): InstallMethod {
	if (!realPath) {
		return "unknown";
	}

	// Check if running via a runtime (bun dev, node, etc.) - development mode
	const basename = realPath.split("/").pop() ?? "";
	if (["bun", "node", "nodejs", "deno"].includes(basename)) {
		return "development";
	}

	// Check for bun install (~/.bun/...)
	if (realPath.includes("/.bun/")) {
		// Global installs are in ~/.bun/install/global/
		const isGlobal = realPath.includes("/install/global/");
		return isGlobal ? "bun-global" : "bun-local";
	}

	// Check for pnpm install
	if (realPath.includes("/pnpm/") || realPath.includes("/.pnpm/")) {
		// Global installs have /global/ in the path
		const isGlobal = realPath.includes("/global/");
		return isGlobal ? "pnpm-global" : "pnpm-local";
	}

	// Check for yarn install
	// Must check before npm because yarn paths may also contain node_modules
	if (realPath.includes("/yarn/") || realPath.includes("/.yarn/")) {
		// Global installs are in ~/.config/yarn/global/ or have /global/ in path
		const isGlobal =
			realPath.includes("/global/") || realPath.includes("/.config/yarn/");
		return isGlobal ? "yarn-global" : "yarn-local";
	}

	// Check for npm install (contains node_modules but not yarn/pnpm/bun)
	if (realPath.includes("/node_modules/")) {
		// Global installs are typically in system paths or version manager paths
		// Local installs are in project directories
		const isGlobal =
			realPath.includes("/lib/node_modules/") ||
			realPath.includes("/usr/local/") ||
			realPath.includes("/.nvm/") ||
			realPath.includes("/mise/") ||
			realPath.includes("/volta/") ||
			realPath.includes("/fnm/") ||
			realPath.includes("/asdf/");
		return isGlobal ? "npm-global" : "npm-local";
	}

	// Check for Homebrew install (contains Cellar or homebrew)
	if (realPath.includes("/Cellar/") || realPath.includes("/homebrew/")) {
		return "brew";
	}

	// Check for direct binary install
	// These are standalone binaries not in any package manager's directory
	const homeDir = process.env.HOME || "";
	const localBinPath = join(homeDir, ".local", "bin", "corsa");

	if (
		realPath === "/usr/local/bin/corsa" ||
		realPath === localBinPath ||
		// Standalone binaries have no node_modules in path and are not in Cellar
		(!realPath.includes("node_modules") && !realPath.includes("/Cellar/"))
	) {
		// Double-check it's not a brew symlink by checking if brew knows about it
		// Only do this check in production, not in tests (controlled by options)
		if (options?.checkBrew !== false && commandExists("brew")) {
			try {
				const result = spawnSync("brew", ["list", "--formula", "corsa"], {
					encoding: "utf-8",
					stdio: ["pipe", "pipe", "pipe"],
				});
				if (result.status === 0) {
					return "brew";
				}
			} catch {
				// Not a brew package
			}
		}
		return "direct";
	}

	return "unknown";
}

/**
 * Detect how corsa was installed.
 *
 * Detection strategy:
 * 1. Check CORSA_INSTALL_METHOD env var (set by wrapper script for npm/pnpm/bun/yarn)
 * 2. Check HOMEBREW_PREFIX env var (indicates homebrew environment)
 * 3. Fall back to "direct" (standalone binary install)
 *
 * Note: Bun-compiled binaries cannot determine their own filesystem path
 * (process.argv[0] returns "bun" and all import.meta paths return virtual /$bunfs/ paths).
 * The wrapper script detects the install method from its own path and passes it via env var.
 */
export function detectInstallMethod(): InstallMethod {
	// Check if wrapper script passed the install method
	const envMethod = process.env.CORSA_INSTALL_METHOD;
	if (envMethod) {
		// Validate it's a known method
		const validMethods: InstallMethod[] = [
			"npm-global",
			"npm-local",
			"pnpm-global",
			"pnpm-local",
			"bun-global",
			"bun-local",
			"yarn-global",
			"yarn-local",
			"brew",
			"direct",
			"development",
			"unknown",
		];
		if (validMethods.includes(envMethod as InstallMethod)) {
			return envMethod as InstallMethod;
		}
	}

	// Check for development mode (running via bun dev, node, etc.)
	// In dev mode, argv[0] is the runtime (bun, node) not corsa
	const argv0 = process.argv[0];
	if (argv0) {
		const basename = argv0.split("/").pop() ?? "";
		if (["bun", "node", "nodejs", "deno"].includes(basename)) {
			return "development";
		}
	}

	// Check for Homebrew install via environment variable
	// When running directly (no wrapper), this indicates brew install
	if (process.env.HOMEBREW_PREFIX) {
		return "brew";
	}

	// Default to direct install (standalone binary)
	return "direct";
}

/**
 * Check if a command exists in PATH.
 */
function commandExists(cmd: string): boolean {
	try {
		const result = spawnSync("which", [cmd], {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		return result.status === 0;
	} catch {
		return false;
	}
}

/**
 * Get the latest version from GitHub releases.
 */
export async function getLatestVersion(): Promise<string> {
	return new Promise((resolve, reject) => {
		const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

		httpsGet(
			url,
			{
				headers: {
					"User-Agent": "corsa-update",
					Accept: "application/vnd.github.v3+json",
				},
			},
			(res) => {
				if (res.statusCode === 302 || res.statusCode === 301) {
					// Handle redirect
					const location = res.headers.location;
					if (location) {
						httpsGet(
							location,
							{ headers: { "User-Agent": "corsa-update" } },
							(redirectRes) => {
								handleResponse(redirectRes, resolve, reject);
							},
						).on("error", reject);
						return;
					}
				}
				handleResponse(res, resolve, reject);
			},
		).on("error", reject);
	});
}

function handleResponse(
	res: ReturnType<typeof httpsGet> extends infer R
		? R extends { on(event: "response", cb: (res: infer Res) => void): unknown }
			? Res
			: never
		: never,
	resolve: (version: string) => void,
	reject: (error: Error) => void,
): void {
	if (res.statusCode !== 200) {
		reject(new Error(`GitHub API returned status ${res.statusCode}`));
		return;
	}

	const chunks: Buffer[] = [];
	res.on("data", (chunk: Buffer) => chunks.push(chunk));
	res.on("end", () => {
		try {
			const data = JSON.parse(Buffer.concat(chunks).toString());
			const version = data.tag_name?.replace(/^v/, "");
			if (!version) {
				reject(new Error("Could not parse version from GitHub response"));
				return;
			}
			resolve(version);
		} catch (e) {
			reject(new Error(`Failed to parse GitHub response: ${e}`));
		}
	});
	res.on("error", reject);
}

/**
 * Download a file from a URL, following redirects.
 */
function downloadFile(url: string, destPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const file = createWriteStream(destPath);

		const request = (downloadUrl: string) => {
			httpsGet(
				downloadUrl,
				{ headers: { "User-Agent": "corsa-update" } },
				(res) => {
					// Follow redirects
					if (
						(res.statusCode === 302 || res.statusCode === 301) &&
						res.headers.location
					) {
						request(res.headers.location);
						return;
					}

					if (res.statusCode !== 200) {
						file.close();
						unlinkSync(destPath);
						reject(new Error(`Download failed with status ${res.statusCode}`));
						return;
					}

					res.pipe(file);
					file.on("finish", () => {
						file.close();
						resolve();
					});
				},
			).on("error", (err) => {
				file.close();
				try {
					unlinkSync(destPath);
				} catch {
					// Ignore
				}
				reject(err);
			});
		};

		request(url);
	});
}

/**
 * Extract a tar.gz file and return the path to the binary inside.
 */
async function extractTarGz(
	archivePath: string,
	destDir: string,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const { createReadStream } = require("node:fs");
		const gunzip = createGunzip();
		const input = createReadStream(archivePath);

		const chunks: Buffer[] = [];
		gunzip.on("data", (chunk: Buffer) => chunks.push(chunk));
		gunzip.on("end", async () => {
			const tarData = Buffer.concat(chunks);

			// Simple tar extraction - find the binary
			let offset = 0;
			while (offset < tarData.length) {
				const header = tarData.subarray(offset, offset + 512);
				if (header[0] === 0) break;

				// Get filename (bytes 0-99)
				const filename = header
					.subarray(0, 100)
					.toString("utf-8")
					.replace(/\0/g, "");

				// Get file size (bytes 124-135, octal)
				const sizeStr = header
					.subarray(124, 136)
					.toString("utf-8")
					.replace(/\0/g, "")
					.trim();
				const size = parseInt(sizeStr, 8) || 0;

				offset += 512;

				if (filename && size > 0 && filename.startsWith("corsa")) {
					const content = tarData.subarray(offset, offset + size);
					const binaryPath = join(destDir, "corsa-new");
					const { writeFileSync } = require("node:fs");
					writeFileSync(binaryPath, content);
					await chmod(binaryPath, 0o755);
					resolve(binaryPath);
					return;
				}

				offset += Math.ceil(size / 512) * 512;
			}
			reject(new Error("Could not find corsa binary in archive"));
		});
		gunzip.on("error", reject);

		input.pipe(gunzip);
	});
}

/**
 * Self-update for direct binary installs.
 */
async function selfUpdate(): Promise<void> {
	const currentVersion = getVersion();
	console.log(`Current version: v${currentVersion}`);
	console.log("Checking for updates...");

	// Get latest version
	const latestVersion = await getLatestVersion();
	console.log(`Latest version: v${latestVersion}`);

	if (currentVersion === latestVersion) {
		console.log("\nYou're already on the latest version!");
		return;
	}

	console.log(`\nUpdating from v${currentVersion} to v${latestVersion}...`);

	// Determine platform and architecture
	const platform =
		process.platform === "darwin"
			? "darwin"
			: process.platform === "win32"
				? "windows"
				: "linux";
	const arch = process.arch === "arm64" ? "arm64" : "x64";

	// Build download URL
	const archiveExt = platform === "windows" ? "zip" : "tar.gz";
	const binaryName = `corsa-${platform}-${arch}`;
	const downloadUrl = `https://github.com/${GITHUB_REPO}/releases/download/v${latestVersion}/${binaryName}.${archiveExt}`;

	console.log(`Downloading ${binaryName}...`);

	// Download to temp directory
	const tempDir = tmpdir();
	const archivePath = join(tempDir, `corsa-update.${archiveExt}`);

	await downloadFile(downloadUrl, archivePath);

	// Extract the binary
	console.log("Extracting...");
	const newBinaryPath = await extractTarGz(archivePath, tempDir);

	// Get the current binary path (argv[0] in compiled Bun binaries)
	const currentBinaryPath = process.argv[0];
	if (!currentBinaryPath) {
		throw new Error("Could not determine current binary path");
	}

	// Check if we need sudo by trying to write a test file
	const binaryDir = currentBinaryPath.substring(
		0,
		currentBinaryPath.lastIndexOf("/"),
	);
	let needsSudo = false;
	try {
		const testFile = join(binaryDir, ".corsa-update-test");
		const { writeFileSync } = require("node:fs");
		writeFileSync(testFile, "");
		unlinkSync(testFile);
	} catch {
		needsSudo = true;
	}

	// Replace the binary
	console.log("Installing...");
	if (needsSudo) {
		console.log("(requires sudo)");
		execSync(`sudo mv "${newBinaryPath}" "${currentBinaryPath}"`, {
			stdio: "inherit",
		});
	} else {
		await rename(newBinaryPath, currentBinaryPath);
	}

	// Clean up
	try {
		unlinkSync(archivePath);
	} catch {
		// Ignore cleanup errors
	}

	console.log(`\nSuccessfully updated to v${latestVersion}!`);
}

/** Methods that can be auto-updated */
type AutoUpdateMethod =
	| "npm-global"
	| "npm-local"
	| "pnpm-global"
	| "pnpm-local"
	| "bun-global"
	| "bun-local"
	| "yarn-global"
	| "yarn-local"
	| "brew";

// Colors (respects NO_COLOR env var)
const useColor = !process.env.NO_COLOR && process.stdout.isTTY;
const colors = {
	reset: useColor ? "\x1b[0m" : "",
	bold: useColor ? "\x1b[1m" : "",
	dim: useColor ? "\x1b[2m" : "",
	cyan: useColor ? "\x1b[36m" : "",
	green: useColor ? "\x1b[32m" : "",
	yellow: useColor ? "\x1b[33m" : "",
	red: useColor ? "\x1b[31m" : "",
	blue: useColor ? "\x1b[34m" : "",
	magenta: useColor ? "\x1b[35m" : "",
};

// Spinner frames
const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Create a spinner that shows progress
 */
function createSpinner(message: string) {
	let frameIndex = 0;
	let interval: ReturnType<typeof setInterval> | null = null;

	const start = () => {
		if (!process.stdout.isTTY) {
			console.log(`  ${message}...`);
			return;
		}
		interval = setInterval(() => {
			process.stdout.write(
				`\r  ${colors.cyan}${spinnerFrames[frameIndex]}${colors.reset} ${message}`,
			);
			frameIndex = (frameIndex + 1) % spinnerFrames.length;
		}, 80);
	};

	const stop = (success: boolean, finalMessage?: string) => {
		if (interval) clearInterval(interval);
		if (process.stdout.isTTY) {
			const icon = success
				? `${colors.green}✓${colors.reset}`
				: `${colors.red}✗${colors.reset}`;
			process.stdout.write(`\r  ${icon} ${finalMessage ?? message}\n`);
		} else if (finalMessage) {
			console.log(`  ${success ? "✓" : "✗"} ${finalMessage}`);
		}
	};

	return { start, stop };
}

/**
 * Print a fancy header
 */
function printHeader() {
	console.log();
	console.log(
		`${colors.cyan}${colors.bold}  ╭─────────────────────────────────╮${colors.reset}`,
	);
	console.log(
		`${colors.cyan}${colors.bold}  │${colors.reset}        ${colors.bold}corsa update${colors.reset}             ${colors.cyan}${colors.bold}│${colors.reset}`,
	);
	console.log(
		`${colors.cyan}${colors.bold}  ╰─────────────────────────────────╯${colors.reset}`,
	);
	console.log();
}

/**
 * Print success box
 */
function printSuccess(message: string) {
	console.log();
	console.log(
		`${colors.green}${colors.bold}  ╭─────────────────────────────────╮${colors.reset}`,
	);
	console.log(
		`${colors.green}${colors.bold}  │${colors.reset}   ${colors.green}✓${colors.reset} ${message.padEnd(27)} ${colors.green}${colors.bold}│${colors.reset}`,
	);
	console.log(
		`${colors.green}${colors.bold}  ╰─────────────────────────────────╯${colors.reset}`,
	);
	console.log();
}

/**
 * Print info line
 */
function printInfo(label: string, value: string) {
	console.log(
		`  ${colors.dim}${label}:${colors.reset} ${colors.bold}${value}${colors.reset}`,
	);
}

/** Result of running update in TUI mode */
export type UpdateResult =
	| { success: true; version: string }
	| { success: false; error: string };

/**
 * Run the update in TUI mode (no console output, returns result).
 */
export async function runUpdateInTui(): Promise<UpdateResult> {
	const method = detectInstallMethod();
	const projectRoot = process.env.CORSA_PROJECT_ROOT;

	// Commands for updates
	const updateCommands: Record<AutoUpdateMethod, string[]> = {
		"npm-global": ["npm", "update", "-g", NPM_PACKAGE],
		"npm-local": ["npm", "update", NPM_PACKAGE],
		"pnpm-global": ["pnpm", "update", "-g", NPM_PACKAGE],
		"pnpm-local": ["pnpm", "update", NPM_PACKAGE],
		"bun-global": ["bun", "update", "-g", NPM_PACKAGE],
		"bun-local": ["bun", "update", NPM_PACKAGE],
		"yarn-global": ["yarn", "global", "upgrade", NPM_PACKAGE],
		"yarn-local": ["yarn", "upgrade", NPM_PACKAGE],
		brew: ["brew", "upgrade", "corsa"],
	};

	try {
		if (method === "development") {
			return { success: false, error: "Running from source (use git pull)" };
		}

		if (method === "direct") {
			// For direct installs, we need to do self-update
			// This is complex and not suitable for TUI mode
			return {
				success: false,
				error: "Direct binary update not supported in TUI. Run: corsa update",
			};
		}

		if (method === "unknown") {
			return { success: false, error: "Unknown installation method" };
		}

		if (!(method in updateCommands)) {
			return { success: false, error: `No update command for ${method}` };
		}

		// Check for updates first
		const currentVersion = getVersion();
		let latestVersion: string;
		try {
			latestVersion = await getLatestVersion();
		} catch {
			return { success: false, error: "Could not check for updates" };
		}

		if (currentVersion === latestVersion) {
			return { success: true, version: latestVersion };
		}

		// Run the update
		const cmd = updateCommands[method as AutoUpdateMethod];
		const isLocal = method.endsWith("-local");

		const execOptions: { stdio: "pipe"; cwd?: string } = {
			stdio: "pipe",
		};

		if (isLocal && projectRoot) {
			execOptions.cwd = projectRoot;
		}

		try {
			execSync(cmd.join(" "), execOptions);
		} catch {
			return {
				success: false,
				error: `Update command failed: ${cmd.join(" ")}`,
			};
		}

		return { success: true, version: latestVersion };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { success: false, error: message };
	}
}

/**
 * Run the update command.
 */
export async function runUpdate(): Promise<void> {
	const method = detectInstallMethod();
	const projectRoot = process.env.CORSA_PROJECT_ROOT;

	printHeader();
	printInfo("Install method", method);

	// Commands for updates
	const updateCommands: Record<AutoUpdateMethod, string[]> = {
		"npm-global": ["npm", "update", "-g", NPM_PACKAGE],
		"npm-local": ["npm", "update", NPM_PACKAGE],
		"pnpm-global": ["pnpm", "update", "-g", NPM_PACKAGE],
		"pnpm-local": ["pnpm", "update", NPM_PACKAGE],
		"bun-global": ["bun", "update", "-g", NPM_PACKAGE],
		"bun-local": ["bun", "update", NPM_PACKAGE],
		"yarn-global": ["yarn", "global", "upgrade", NPM_PACKAGE],
		"yarn-local": ["yarn", "upgrade", NPM_PACKAGE],
		brew: ["brew", "upgrade", "corsa"],
	};

	try {
		if (method === "development") {
			printInfo("Mode", "Development");
			console.log();
			console.log(`  ${colors.yellow}!${colors.reset} Running from source`);
			console.log();
			console.log(`  ${colors.dim}To update, use:${colors.reset}`);
			console.log(`  ${colors.cyan}$${colors.reset} git pull`);
			console.log();
			process.exit(0);
		} else if (method === "direct") {
			console.log();
			await selfUpdate();
		} else if (method in updateCommands) {
			const cmd = updateCommands[method as AutoUpdateMethod];
			const isLocal = method.endsWith("-local");

			if (isLocal && projectRoot) {
				printInfo("Project", projectRoot);
			}

			console.log();

			// Check for updates first
			const checkSpinner = createSpinner("Checking for updates");
			checkSpinner.start();

			const currentVersion = getVersion();
			let latestVersion: string;
			try {
				latestVersion = await getLatestVersion();
			} catch {
				checkSpinner.stop(false, "Failed to check for updates");
				throw new Error("Could not reach GitHub to check for updates");
			}
			checkSpinner.stop(
				true,
				`Current: v${currentVersion} → Latest: v${latestVersion}`,
			);

			if (currentVersion === latestVersion) {
				printSuccess("Already up to date!");
				process.exit(0);
			}

			// Run the update
			console.log();
			console.log(
				`  ${colors.dim}Running:${colors.reset} ${colors.cyan}${cmd.join(" ")}${colors.reset}`,
			);
			console.log();

			const execOptions: { stdio: "inherit"; cwd?: string } = {
				stdio: "inherit",
			};

			// For local installs, run in the project directory
			if (isLocal && projectRoot) {
				execOptions.cwd = projectRoot;
			}

			execSync(cmd.join(" "), execOptions);

			printSuccess(`Updated to v${latestVersion}!`);
		} else if (method === "unknown") {
			console.log();
			console.log(
				`  ${colors.yellow}!${colors.reset} Could not detect installation method`,
			);
			console.log();
			console.log(`  ${colors.dim}Try one of these commands:${colors.reset}`);
			console.log(
				`  ${colors.cyan}$${colors.reset} npm update -g ${NPM_PACKAGE}`,
			);
			console.log(
				`  ${colors.cyan}$${colors.reset} pnpm update -g ${NPM_PACKAGE}`,
			);
			console.log(
				`  ${colors.cyan}$${colors.reset} bun update -g ${NPM_PACKAGE}`,
			);
			console.log(
				`  ${colors.cyan}$${colors.reset} yarn global upgrade ${NPM_PACKAGE}`,
			);
			console.log(`  ${colors.cyan}$${colors.reset} brew upgrade corsa`);
			console.log();
			console.log(`  ${colors.dim}Or reinstall:${colors.reset}`);
			console.log(
				`  ${colors.cyan}$${colors.reset} curl -fsSL https://raw.githubusercontent.com/${GITHUB_REPO}/main/install.sh | bash`,
			);
			console.log();
			process.exit(1);
		} else {
			console.log();
			console.log(
				`  ${colors.red}✗${colors.reset} Unknown installation method: ${method}`,
			);
			console.log();
			process.exit(1);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.log();
		console.log(`  ${colors.red}✗${colors.reset} Update failed: ${message}`);
		console.log();
		process.exit(1);
	}
}
