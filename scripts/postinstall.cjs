#!/usr/bin/env node

/**
 * Postinstall script for corsa NPM package.
 * Downloads the appropriate binary for the current platform.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

// Configuration
const REPO = "tomagranate/corsa";
const GITHUB_RELEASES = `https://github.com/${REPO}/releases`;

// Platform mappings
const PLATFORM_MAP = {
	darwin: "darwin",
	linux: "linux",
	win32: "windows",
};

const ARCH_MAP = {
	arm64: "arm64",
	x64: "x64",
};

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

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
};

/**
 * Print styled header
 */
function printHeader() {
	console.log();
	console.log(
		`${colors.cyan}${colors.bold}  ╭─────────────────────────────────╮${colors.reset}`,
	);
	console.log(
		`${colors.cyan}${colors.bold}  │        corsa postinstall        │${colors.reset}`,
	);
	console.log(
		`${colors.cyan}${colors.bold}  ╰─────────────────────────────────╯${colors.reset}`,
	);
	console.log();
}

/**
 * Print step message
 */
function step(msg) {
	console.log(`  ${colors.cyan}▸${colors.reset} ${msg}`);
}

/**
 * Print success message
 */
function success(msg) {
	console.log();
	console.log(
		`${colors.green}${colors.bold}  ╭─────────────────────────────────╮${colors.reset}`,
	);
	console.log(
		`${colors.green}${colors.bold}  │${colors.reset}   ${colors.green}✓${colors.reset} ${msg.padEnd(27)} ${colors.green}${colors.bold}│${colors.reset}`,
	);
	console.log(
		`${colors.green}${colors.bold}  ╰─────────────────────────────────╯${colors.reset}`,
	);
	console.log();
}

/**
 * Print error message
 */
function printError(msg) {
	console.error(`  ${colors.red}✗${colors.reset} ${msg}`);
}

/**
 * Format bytes as human-readable string
 */
function formatBytes(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Show download progress bar
 */
function showProgress(downloaded, total) {
	if (!process.stdout.isTTY) return;

	const width = 24;
	if (total) {
		const percent = Math.min(100, (downloaded / total) * 100);
		const filled = Math.floor((percent / 100) * width);
		const empty = width - filled;
		const bar = "█".repeat(filled) + "░".repeat(empty);
		const percentStr = percent.toFixed(0).padStart(3);
		process.stdout.write(
			`\r    ${colors.dim}${bar}${colors.reset} ${percentStr}% ${colors.dim}(${formatBytes(downloaded)})${colors.reset}`,
		);
	} else {
		process.stdout.write(
			`\r    ${colors.dim}Downloading: ${formatBytes(downloaded)}${colors.reset}`,
		);
	}
}

/**
 * Clear progress line
 */
function clearProgress() {
	if (!process.stdout.isTTY) return;
	process.stdout.write(`\r${" ".repeat(70)}\r`);
}

/**
 * Download file with streaming and progress
 */
async function downloadWithProgress(url) {
	const response = await fetch(url, {
		headers: { "User-Agent": "corsa-postinstall" },
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}

	const contentLength = response.headers.get("content-length");
	const total = contentLength ? parseInt(contentLength, 10) : null;
	let downloaded = 0;

	const chunks = [];
	const reader = response.body.getReader();

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		chunks.push(value);
		downloaded += value.length;
		showProgress(downloaded, total);
	}

	clearProgress();
	return Buffer.concat(chunks);
}

async function downloadText(url) {
	const response = await fetch(url, {
		headers: { "User-Agent": "corsa-postinstall" },
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}

	return await response.text();
}

function parseSha256Checksum(content) {
	const checksum = content.trim().split(/\s+/)[0]?.toLowerCase();
	if (!checksum || !SHA256_HEX_PATTERN.test(checksum)) {
		throw new Error("Invalid SHA256 checksum file");
	}
	return checksum;
}

function verifyBufferSha256(data, expectedSha256) {
	const actualSha256 = crypto.createHash("sha256").update(data).digest("hex");
	if (actualSha256 !== expectedSha256.toLowerCase()) {
		throw new Error(
			`Checksum mismatch for downloaded archive. Expected ${expectedSha256}, got ${actualSha256}`,
		);
	}
}

/**
 * Get the version from package.json
 */
function getVersion() {
	const packageJson = JSON.parse(
		fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
	);
	return packageJson.version;
}

/**
 * Extract tar.gz archive to get the binary
 */
function extractTarGz(data, destPath) {
	return new Promise((resolve, reject) => {
		const gunzip = zlib.createGunzip();
		const chunks = [];

		gunzip.on("data", (chunk) => chunks.push(chunk));
		gunzip.on("end", () => {
			const tarData = Buffer.concat(chunks);
			let offset = 0;
			while (offset < tarData.length) {
				const header = tarData.slice(offset, offset + 512);
				if (header[0] === 0) break;

				const filename = header
					.slice(0, 100)
					.toString("utf-8")
					.replace(/\0/g, "");

				const sizeStr = header
					.slice(124, 136)
					.toString("utf-8")
					.replace(/\0/g, "")
					.trim();
				const size = parseInt(sizeStr, 8) || 0;

				offset += 512;

				if (filename && size > 0 && filename.startsWith("corsa")) {
					const content = tarData.slice(offset, offset + size);
					fs.writeFileSync(destPath, content);
					fs.chmodSync(destPath, 0o755);
					resolve();
					return;
				}

				offset += Math.ceil(size / 512) * 512;
			}
			reject(new Error("Binary not found in archive"));
		});
		gunzip.on("error", reject);

		gunzip.end(data);
	});
}

/**
 * Download and extract Unix binary
 */
async function downloadBinary(data, destPath) {
	await extractTarGz(data, destPath);
}

/**
 * Download and extract Windows binary
 */
async function downloadWindowsBinary(data, destPath) {
	const zipPath = `${destPath}.zip`;
	fs.writeFileSync(zipPath, data);

	try {
		if (process.platform === "win32") {
			execSync(
				`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${path.dirname(destPath)}' -Force"`,
				{ stdio: "pipe" },
			);
		} else {
			execSync(`unzip -o "${zipPath}" -d "${path.dirname(destPath)}"`, {
				stdio: "pipe",
			});
		}
	} finally {
		fs.unlinkSync(zipPath);
	}
}

/**
 * Download binary from URL
 */
async function downloadFromUrl(url, destPath, isWindows) {
	const data = await downloadWithProgress(url);
	const expectedSha256 = parseSha256Checksum(
		await downloadText(`${url}.sha256`),
	);
	verifyBufferSha256(data, expectedSha256);

	if (isWindows) {
		await downloadWindowsBinary(data, destPath);
	} else {
		await downloadBinary(data, destPath);
	}
}

async function main() {
	const platform = PLATFORM_MAP[process.platform];
	const arch = ARCH_MAP[process.arch];

	if (!platform || !arch) {
		console.log();
		console.log(
			`  ${colors.yellow}!${colors.reset} Unsupported platform: ${process.platform}-${process.arch}`,
		);
		console.log(`    Build from source or download manually.`);
		console.log();
		process.exit(0);
	}

	const version = getVersion();
	const binaryName = `corsa-${platform}-${arch}`;
	const binDir = path.join(__dirname, "..", "bin");
	const destPath = path.join(
		binDir,
		binaryName + (platform === "windows" ? ".exe" : ""),
	);

	// Skip if binary already exists
	if (fs.existsSync(destPath)) {
		console.log();
		console.log(`  ${colors.dim}Binary already installed${colors.reset}`);
		console.log();
		return;
	}

	printHeader();

	step(`Platform: ${colors.bold}${platform}-${arch}${colors.reset}`);
	step(`Version: ${colors.bold}v${version}${colors.reset}`);
	console.log();

	// Ensure bin directory exists
	if (!fs.existsSync(binDir)) {
		fs.mkdirSync(binDir, { recursive: true });
	}

	const archiveExt = platform === "windows" ? "zip" : "tar.gz";
	const url = `${GITHUB_RELEASES}/download/v${version}/${binaryName}.${archiveExt}`;

	try {
		step("Downloading binary...");
		await downloadFromUrl(url, destPath, platform === "windows");

		step("Extracting...");
		success(`corsa v${version} ready`);

		console.log(`  ${colors.dim}Get started:${colors.reset}`);
		console.log(`  ${colors.cyan}$${colors.reset} corsa init`);
		console.log(`  ${colors.cyan}$${colors.reset} corsa`);
		console.log();
	} catch (error) {
		printError(`Download failed: ${error.message}`);
		console.log();
		console.log(`  ${colors.dim}Manual download:${colors.reset}`);
		console.log(`  ${GITHUB_RELEASES}/latest`);
		console.log();
		console.log(`  ${colors.dim}Or use install script:${colors.reset}`);
		console.log(
			`  curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | bash`,
		);
		console.log();
		process.exit(0);
	}
}

main();
