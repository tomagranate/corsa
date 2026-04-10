#!/usr/bin/env bun

/**
 * Build corsa binaries for all supported platforms.
 *
 * Usage:
 *   bun run scripts/build-all.ts
 *   bun run scripts/build-all.ts --version 0.1.0
 */

import { mkdir, readFile } from "node:fs/promises";
import { platform } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

interface BuildTarget {
	target: string;
	os: string;
	arch: string;
	extension: string;
}

const TARGETS: BuildTarget[] = [
	{ target: "bun-darwin-arm64", os: "darwin", arch: "arm64", extension: "" },
	{ target: "bun-darwin-x64", os: "darwin", arch: "x64", extension: "" },
	{ target: "bun-linux-x64", os: "linux", arch: "x64", extension: "" },
	{ target: "bun-linux-arm64", os: "linux", arch: "arm64", extension: "" },
	{
		target: "bun-windows-x64",
		os: "windows",
		arch: "x64",
		extension: ".exe",
	},
];

async function getVersion(): Promise<string> {
	// Check for --version flag
	const versionIndex = process.argv.indexOf("--version");
	const versionArg = process.argv[versionIndex + 1];
	if (versionIndex !== -1 && versionArg) {
		return versionArg;
	}

	// Read from package.json
	const packageJson = JSON.parse(
		await readFile(join(import.meta.dir, "..", "package.json"), "utf-8"),
	) as { version: string };
	return packageJson.version;
}

/** Bun --compile can embed a signature blob macOS rejects; fix only when host is macOS. */
async function adHocSignDarwinBinary(binaryPath: string): Promise<void> {
	if (platform() !== "darwin") return;
	await $`/usr/bin/codesign --remove-signature ${binaryPath}`.quiet().nothrow();
	await $`/usr/bin/codesign -s - --force --timestamp=none ${binaryPath}`;
	await $`/usr/bin/codesign -vvv ${binaryPath}`.quiet();
}

async function buildTarget(target: BuildTarget, outDir: string): Promise<void> {
	const outputName = `corsa-${target.os}-${target.arch}${target.extension}`;
	const outputPath = join(outDir, outputName);

	console.log(`Building ${outputName}...`);

	await $`bun build src/index.tsx --compile --minify --target=${target.target} --outfile=${outputPath}`;

	if (target.os === "darwin") {
		await adHocSignDarwinBinary(outputPath);
	}

	console.log(`  ✓ ${outputName}`);
}

async function main() {
	const version = await getVersion();
	const outDir = join(import.meta.dir, "..", "dist");

	console.log(`\nBuilding corsa v${version} for all platforms\n`);

	// Create output directory
	await mkdir(outDir, { recursive: true });

	// Build all targets
	for (const target of TARGETS) {
		await buildTarget(target, outDir);
	}

	console.log(`\n✓ All binaries built in ${outDir}\n`);
}

main().catch((error) => {
	console.error("Build failed:", error);
	process.exit(1);
});
