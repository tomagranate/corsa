/**
 * Update command - detects installation method and runs the appropriate update.
 */

import { execSync, spawnSync } from "node:child_process";
import { createWriteStream, realpathSync, unlinkSync } from "node:fs";
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
	| "npm"
	| "pnpm"
	| "bun"
	| "yarn"
	| "brew"
	| "direct"
	| "development"
	| "unknown";

/**
 * Detect installation method from a resolved binary path.
 * Exported for testing.
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

	// Check for bun global install (~/.bun/install/global/...)
	if (realPath.includes("/.bun/")) {
		return "bun";
	}

	// Check for pnpm global install (~/.local/share/pnpm/... or ~/.pnpm/...)
	if (realPath.includes("/pnpm/") || realPath.includes("/.pnpm/")) {
		return "pnpm";
	}

	// Check for yarn global install (~/.config/yarn/global/... or ~/.yarn/...)
	// Must check before npm because yarn paths may also contain node_modules
	if (realPath.includes("/yarn/") || realPath.includes("/.yarn/")) {
		return "yarn";
	}

	// Check for npm global install (contains node_modules but not yarn/pnpm/bun)
	if (realPath.includes("/node_modules/")) {
		return "npm";
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
 * Detect how corsa was installed by examining the current binary path.
 */
export function detectInstallMethod(): InstallMethod {
	try {
		// Get the path to this binary
		// In compiled Bun binaries, argv[0] is the binary path (C-style)
		// This differs from Node.js where argv[0] is node and argv[1] is the script
		const binaryPath = process.argv[0];
		if (!binaryPath) {
			return "unknown";
		}

		// Resolve symlinks to get the real path
		let realPath: string;
		try {
			realPath = realpathSync(binaryPath);
		} catch {
			realPath = binaryPath;
		}

		return detectInstallMethodFromPath(realPath);
	} catch {
		return "unknown";
	}
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

/**
 * Run the update command.
 */
export async function runUpdate(): Promise<void> {
	const method = detectInstallMethod();

	console.log(`Detected installation method: ${method}`);
	console.log("");

	const commands: Record<
		Exclude<InstallMethod, "direct" | "development" | "unknown">,
		string[]
	> = {
		npm: ["npm", "update", "-g", NPM_PACKAGE],
		pnpm: ["pnpm", "update", "-g", NPM_PACKAGE],
		bun: ["bun", "update", "-g", NPM_PACKAGE],
		yarn: ["yarn", "global", "upgrade", NPM_PACKAGE],
		brew: ["brew", "upgrade", "corsa"],
	};

	try {
		if (method === "development") {
			console.log("Running in development mode.");
			console.log("");
			console.log("To update, use git:");
			console.log("  git pull");
			process.exit(0);
		} else if (method === "direct") {
			await selfUpdate();
		} else if (method === "unknown") {
			console.log("Could not detect how corsa was installed.");
			console.log("");
			console.log("Try one of these commands manually:");
			console.log("  npm update -g @tomagranate/corsa");
			console.log("  pnpm update -g @tomagranate/corsa");
			console.log("  bun update -g @tomagranate/corsa");
			console.log("  yarn global upgrade @tomagranate/corsa");
			console.log("  brew upgrade corsa");
			console.log("");
			console.log("Or reinstall via the install script:");
			console.log(
				"  curl -fsSL https://raw.githubusercontent.com/tomagranate/corsa/main/install.sh | bash",
			);
			process.exit(1);
		} else {
			const cmd = commands[method];
			console.log(`Running: ${cmd.join(" ")}`);
			console.log("");
			execSync(cmd.join(" "), { stdio: "inherit" });
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`\nUpdate failed: ${message}`);
		process.exit(1);
	}
}
