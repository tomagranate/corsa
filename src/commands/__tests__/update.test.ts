import { describe, expect, test } from "bun:test";
import { detectInstallMethodFromPath, type InstallMethod } from "../update";

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

	describe("bun global install", () => {
		test("detects ~/.bun/install/global path", () => {
			expect(
				detect(
					"/Users/tom/.bun/install/global/node_modules/@tomagranate/corsa/bin/corsa",
				),
			).toBe("bun");
		});

		test("detects any path containing /.bun/", () => {
			expect(detect("/home/user/.bun/bin/corsa")).toBe("bun");
		});
	});

	describe("pnpm global install", () => {
		test("detects ~/.local/share/pnpm path", () => {
			expect(
				detect(
					"/Users/tom/.local/share/pnpm/global/5/node_modules/@tomagranate/corsa/bin/corsa",
				),
			).toBe("pnpm");
		});

		test("detects any path containing /pnpm/", () => {
			expect(detect("/home/user/.pnpm/global/corsa")).toBe("pnpm");
		});
	});

	describe("yarn global install", () => {
		test("detects ~/.config/yarn/global path", () => {
			expect(
				detect(
					"/Users/tom/.config/yarn/global/node_modules/@tomagranate/corsa/bin/corsa",
				),
			).toBe("yarn");
		});

		test("detects ~/.yarn path", () => {
			expect(detect("/Users/tom/.yarn/bin/corsa")).toBe("yarn");
		});

		test("detects any path containing /yarn/", () => {
			expect(detect("/home/user/.yarn/global/corsa")).toBe("yarn");
		});
	});

	describe("npm global install", () => {
		test("detects /usr/local/lib/node_modules path", () => {
			expect(
				detect("/usr/local/lib/node_modules/@tomagranate/corsa/bin/corsa"),
			).toBe("npm");
		});

		test("detects any path containing /node_modules/", () => {
			expect(detect("/home/user/.npm/node_modules/corsa/bin/corsa")).toBe(
				"npm",
			);
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
				"bun",
			);
		});

		test("pnpm takes priority over node_modules", () => {
			expect(
				detect("/Users/tom/.local/share/pnpm/global/node_modules/corsa"),
			).toBe("pnpm");
		});

		test("yarn takes priority over node_modules", () => {
			expect(detect("/Users/tom/.yarn/global/node_modules/corsa")).toBe("yarn");
		});
	});
});
