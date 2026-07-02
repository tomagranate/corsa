import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	detectInstallMethod,
	detectInstallMethodFromPath,
	type InstallMethod,
	parseSha256Checksum,
	verifyFileSha256,
} from "../update";

/**
 * Reproduces the mis-detection users saw with `which corsa` → `/opt/homebrew/bin/corsa`
 * while the formula actually runs `bun <entrypoint>`: argv[0] is the runtime, argv[1] is
 * often the bin symlink (not a string containing "Cellar" until realpath).
 *
 * Before the Cellar/realpath argv scan, detectInstallMethod() returned "development" for any
 * bun/node argv[0], so `corsa update` showed "Running from source".
 */
const brewSymlinkTest = process.platform === "win32" ? test.skip : test;

describe("detectInstallMethodFromPath", () => {
	// Test with checkBrew: false to avoid actual brew checks during tests
	const detect = (path: string): InstallMethod =>
		detectInstallMethodFromPath(path, { checkBrew: false });

	describe("development mode", () => {
		test("detects bun runtime (Apple Silicon homebrew)", () => {
			expect(detect("/opt/homebrew/bin/bun")).toBe("development");
		});

		test("detects bun runtime (Intel homebrew)", () => {
			expect(detect("/usr/local/bin/bun")).toBe("development");
		});

		test("detects bun runtime (bun self-install)", () => {
			expect(detect("/Users/tom/.bun/bin/bun")).toBe("development");
		});

		test("detects node runtime", () => {
			expect(detect("/usr/local/bin/node")).toBe("development");
		});

		test("detects nodejs runtime", () => {
			expect(detect("/usr/bin/nodejs")).toBe("development");
		});

		test("detects deno runtime", () => {
			expect(detect("/usr/local/bin/deno")).toBe("development");
		});
	});

	describe("bun install", () => {
		test("detects ~/.bun/install/global path as global", () => {
			expect(
				detect(
					"/Users/tom/.bun/install/global/node_modules/@tomagranate/corsa/bin/corsa",
				),
			).toBe("bun-global");
		});

		test("detects ~/.bun/ path without /install/global/ as local", () => {
			expect(detect("/home/user/.bun/bin/corsa")).toBe("bun-local");
		});
	});

	describe("pnpm install", () => {
		test("detects ~/.local/share/pnpm/global path as global", () => {
			expect(
				detect(
					"/Users/tom/.local/share/pnpm/global/5/node_modules/@tomagranate/corsa/bin/corsa",
				),
			).toBe("pnpm-global");
		});

		test("detects /pnpm/ path with /global/ as global", () => {
			expect(detect("/home/user/.pnpm/global/corsa")).toBe("pnpm-global");
		});

		test("detects /pnpm/ path without /global/ as local", () => {
			expect(detect("/project/.pnpm/corsa")).toBe("pnpm-local");
		});
	});

	describe("yarn install", () => {
		test("detects ~/.config/yarn/global path as global", () => {
			expect(
				detect(
					"/Users/tom/.config/yarn/global/node_modules/@tomagranate/corsa/bin/corsa",
				),
			).toBe("yarn-global");
		});

		test("detects ~/.yarn path with /global/ as global", () => {
			expect(detect("/Users/tom/.yarn/global/bin/corsa")).toBe("yarn-global");
		});

		test("detects /yarn/ path without /global/ as local", () => {
			expect(detect("/project/.yarn/cache/corsa")).toBe("yarn-local");
		});
	});

	describe("npm install", () => {
		test("detects /usr/local/lib/node_modules path as global", () => {
			expect(
				detect("/usr/local/lib/node_modules/@tomagranate/corsa/bin/corsa"),
			).toBe("npm-global");
		});

		test("detects mise version manager path as global", () => {
			expect(
				detect(
					"/Users/tom/.local/share/mise/installs/node/23.7.0/lib/node_modules/@tomagranate/corsa/bin/corsa",
				),
			).toBe("npm-global");
		});

		test("detects nvm path as global", () => {
			expect(
				detect(
					"/Users/tom/.nvm/versions/node/v20.0.0/lib/node_modules/@tomagranate/corsa/bin/corsa",
				),
			).toBe("npm-global");
		});

		test("detects project node_modules as local", () => {
			expect(
				detect(
					"/Users/tom/myproject/node_modules/@tomagranate/corsa/bin/corsa",
				),
			).toBe("npm-local");
		});
	});

	describe("Homebrew install", () => {
		test("detects /opt/homebrew/Cellar path (Apple Silicon)", () => {
			expect(detect("/opt/homebrew/Cellar/corsa/1.0.0/bin/corsa")).toBe("brew");
		});

		test("detects /usr/local/Cellar path (Intel Mac)", () => {
			expect(detect("/usr/local/Cellar/corsa/1.0.0/bin/corsa")).toBe("brew");
		});

		test("detects path containing /homebrew/", () => {
			expect(detect("/opt/homebrew/bin/corsa")).toBe("brew");
		});
	});

	describe("direct binary install", () => {
		test("detects /usr/local/bin/corsa", () => {
			expect(detect("/usr/local/bin/corsa")).toBe("direct");
		});

		test("detects ~/.local/bin/corsa", () => {
			const homeDir = process.env.HOME || "/Users/test";
			expect(detect(`${homeDir}/.local/bin/corsa`)).toBe("direct");
		});

		test("detects standalone binary in custom location", () => {
			expect(detect("/opt/tools/corsa")).toBe("direct");
		});
	});

	describe("unknown install method", () => {
		test("returns unknown for empty path", () => {
			expect(detect("")).toBe("unknown");
		});
	});

	describe("detection priority", () => {
		// These tests verify that more specific paths are detected correctly
		// even if they might match multiple patterns

		test("bun takes priority over node_modules", () => {
			// bun uses node_modules internally but the .bun path should be detected first
			expect(detect("/Users/tom/.bun/install/global/node_modules/corsa")).toBe(
				"bun-global",
			);
		});

		test("pnpm takes priority over node_modules", () => {
			expect(
				detect("/Users/tom/.local/share/pnpm/global/node_modules/corsa"),
			).toBe("pnpm-global");
		});

		test("yarn takes priority over node_modules", () => {
			expect(detect("/Users/tom/.yarn/global/node_modules/corsa")).toBe(
				"yarn-global",
			);
		});
	});
});

describe("detectInstallMethod", () => {
	// Save original env vars
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		originalEnv = { ...process.env };
	});

	afterEach(() => {
		// Restore original env vars
		process.env = originalEnv;
	});

	describe("CORSA_INSTALL_METHOD env var", () => {
		test("uses env var when set to pnpm-global", () => {
			process.env.CORSA_INSTALL_METHOD = "pnpm-global";
			expect(detectInstallMethod()).toBe("pnpm-global");
		});

		test("uses env var for pnpm-local", () => {
			process.env.CORSA_INSTALL_METHOD = "pnpm-local";
			expect(detectInstallMethod()).toBe("pnpm-local");
		});

		test("uses env var for bun-global", () => {
			process.env.CORSA_INSTALL_METHOD = "bun-global";
			expect(detectInstallMethod()).toBe("bun-global");
		});

		test("uses env var for npm-global", () => {
			process.env.CORSA_INSTALL_METHOD = "npm-global";
			expect(detectInstallMethod()).toBe("npm-global");
		});

		test("uses env var for npm-local", () => {
			process.env.CORSA_INSTALL_METHOD = "npm-local";
			expect(detectInstallMethod()).toBe("npm-local");
		});

		test("uses env var for yarn-global", () => {
			process.env.CORSA_INSTALL_METHOD = "yarn-global";
			expect(detectInstallMethod()).toBe("yarn-global");
		});

		test("ignores invalid env var value", () => {
			process.env.CORSA_INSTALL_METHOD = "invalid-method";
			delete process.env.HOMEBREW_PREFIX;
			// Should fall through to development detection or direct
			const result = detectInstallMethod();
			expect(["development", "direct"]).toContain(result);
		});
	});

	describe("HOMEBREW_PREFIX fallback", () => {
		test("detects brew when HOMEBREW_PREFIX is set and argv0 is the corsa binary", () => {
			delete process.env.CORSA_INSTALL_METHOD;
			process.env.HOMEBREW_PREFIX = "/opt/homebrew";
			const saved = [...process.argv];
			process.argv = ["/opt/homebrew/bin/corsa", "update"];
			try {
				expect(detectInstallMethod()).toBe("brew");
			} finally {
				process.argv.length = 0;
				process.argv.push(...saved);
			}
		});
	});

	describe("Homebrew via runtime (argv[0] is bun/node)", () => {
		test("detects brew when script path is under Cellar/corsa", () => {
			delete process.env.CORSA_INSTALL_METHOD;
			delete process.env.HOMEBREW_PREFIX;
			const saved = [...process.argv];
			process.argv = [
				"/opt/homebrew/opt/bun/bin/bun",
				"/opt/homebrew/Cellar/corsa/1.0.0/libexec/cli.js",
				"update",
			];
			try {
				expect(detectInstallMethod()).toBe("brew");
			} finally {
				process.argv.length = 0;
				process.argv.push(...saved);
			}
		});

		test("detects brew for Intel Homebrew Cellar path", () => {
			delete process.env.CORSA_INSTALL_METHOD;
			delete process.env.HOMEBREW_PREFIX;
			const saved = [...process.argv];
			process.argv = [
				"/usr/local/bin/node",
				"/usr/local/Cellar/corsa/2.0.0/libexec/main.js",
			];
			try {
				expect(detectInstallMethod()).toBe("brew");
			} finally {
				process.argv.length = 0;
				process.argv.push(...saved);
			}
		});

		brewSymlinkTest(
			"detects brew when argv[1] is homebrew bin/corsa symlink into Cellar (real install layout)",
			() => {
				delete process.env.CORSA_INSTALL_METHOD;
				delete process.env.HOMEBREW_PREFIX;

				const root = mkdtempSync(join(tmpdir(), "corsa-hbrew-repro-"));
				const cellarMain = join(
					root,
					"opt",
					"homebrew",
					"Cellar",
					"corsa",
					"1.0.0",
					"libexec",
					"main.js",
				);
				mkdirSync(join(cellarMain, ".."), { recursive: true });
				writeFileSync(cellarMain, "");

				const binCorsa = join(root, "opt", "homebrew", "bin", "corsa");
				mkdirSync(join(binCorsa, ".."), { recursive: true });
				symlinkSync(
					join("..", "Cellar", "corsa", "1.0.0", "libexec", "main.js"),
					binCorsa,
				);

				const saved = [...process.argv];
				process.argv = ["/opt/homebrew/opt/bun/bin/bun", binCorsa, "update"];
				try {
					expect(detectInstallMethod()).toBe("brew");
				} finally {
					process.argv.length = 0;
					process.argv.push(...saved);
					rmSync(root, { recursive: true, force: true });
				}
			},
		);
	});

	describe("development mode detection", () => {
		test("detects development when running via bun from a repo path (not Cellar)", () => {
			delete process.env.CORSA_INSTALL_METHOD;
			delete process.env.HOMEBREW_PREFIX;
			const saved = [...process.argv];
			process.argv = ["/opt/homebrew/bin/bun", "/Users/dev/corsa/src/cli.ts"];
			try {
				expect(detectInstallMethod()).toBe("development");
			} finally {
				process.argv.length = 0;
				process.argv.push(...saved);
			}
		});
	});
});

describe("checksum verification", () => {
	test("parseSha256Checksum accepts release sidecar format", () => {
		const checksum =
			"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

		expect(parseSha256Checksum(`${checksum}  corsa-linux-x64.tar.gz\n`)).toBe(
			checksum,
		);
	});

	test("parseSha256Checksum rejects malformed checksum files", () => {
		expect(() => parseSha256Checksum("not-a-checksum archive.tar.gz")).toThrow(
			"Invalid SHA256 checksum file",
		);
	});

	test("verifyFileSha256 accepts matching file contents", () => {
		const root = mkdtempSync(join(tmpdir(), "corsa-checksum-"));
		const archivePath = join(root, "archive.tar.gz");
		writeFileSync(archivePath, "downloaded archive");
		const checksum = createHash("sha256")
			.update("downloaded archive")
			.digest("hex");

		try {
			expect(() => verifyFileSha256(archivePath, checksum)).not.toThrow();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("verifyFileSha256 rejects mismatched file contents", () => {
		const root = mkdtempSync(join(tmpdir(), "corsa-checksum-"));
		const archivePath = join(root, "archive.tar.gz");
		writeFileSync(archivePath, "tampered archive");
		const checksum = createHash("sha256")
			.update("expected archive")
			.digest("hex");

		try {
			expect(() => verifyFileSha256(archivePath, checksum)).toThrow(
				"Checksum mismatch",
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
