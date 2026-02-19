import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	getPreferencesPath,
	loadPreferences,
	savePreferences,
	updatePreference,
} from "../preferences";

/**
 * Runs a test with an isolated temp directory and preferences file path.
 * The temp directory is cleaned up after the callback completes.
 */
function withTempPrefs(fn: (prefsPath: string) => void) {
	const dir = fs.mkdtempSync(path.join("/tmp", "corsa-prefs-test-"));
	const filePath = path.join(dir, "preferences.json");
	try {
		fn(filePath);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

describe("getPreferencesPath", () => {
	let originalXdg: string | undefined;
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join("/tmp", "corsa-prefs-test-"));
		originalXdg = process.env.XDG_CONFIG_HOME;
		process.env.XDG_CONFIG_HOME = tempDir;
	});

	afterEach(() => {
		if (originalXdg !== undefined) {
			process.env.XDG_CONFIG_HOME = originalXdg;
		} else {
			delete process.env.XDG_CONFIG_HOME;
		}
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	test("uses XDG_CONFIG_HOME when set", () => {
		const p = getPreferencesPath();
		expect(p).toBe(path.join(tempDir, "corsa", "preferences.json"));
	});

	test("falls back to ~/.config when XDG_CONFIG_HOME is not set", () => {
		delete process.env.XDG_CONFIG_HOME;
		const os = require("node:os");
		const p = getPreferencesPath();
		expect(p).toBe(
			path.join(os.homedir(), ".config", "corsa", "preferences.json"),
		);
	});
});

describe("loadPreferences", () => {
	test("returns empty defaults when file does not exist", () => {
		withTempPrefs((prefsPath) => {
			const prefs = loadPreferences(prefsPath);
			expect(prefs).toEqual({});
		});
	});

	test("loads valid preferences from file", () => {
		withTempPrefs((prefsPath) => {
			fs.writeFileSync(
				prefsPath,
				JSON.stringify({
					theme: "synthwave",
					lineWrap: false,
					latestKnownVersion: "1.2.3",
					lastUpdateCheck: 1700000000000,
				}),
			);

			const prefs = loadPreferences(prefsPath);
			expect(prefs.theme).toBe("synthwave");
			expect(prefs.lineWrap).toBe(false);
			expect(prefs.latestKnownVersion).toBe("1.2.3");
			expect(prefs.lastUpdateCheck).toBe(1700000000000);
		});
	});

	test("returns defaults for invalid JSON", () => {
		withTempPrefs((prefsPath) => {
			fs.writeFileSync(prefsPath, "not json {{{");

			const prefs = loadPreferences(prefsPath);
			expect(prefs).toEqual({});
		});
	});

	test("returns defaults for JSON array", () => {
		withTempPrefs((prefsPath) => {
			fs.writeFileSync(prefsPath, "[1, 2, 3]");

			const prefs = loadPreferences(prefsPath);
			expect(prefs).toEqual({});
		});
	});

	test("returns defaults for JSON null", () => {
		withTempPrefs((prefsPath) => {
			fs.writeFileSync(prefsPath, "null");

			const prefs = loadPreferences(prefsPath);
			expect(prefs).toEqual({});
		});
	});

	test("returns defaults for JSON primitive", () => {
		withTempPrefs((prefsPath) => {
			fs.writeFileSync(prefsPath, '"just a string"');

			const prefs = loadPreferences(prefsPath);
			expect(prefs).toEqual({});
		});
	});

	test("ignores unknown fields", () => {
		withTempPrefs((prefsPath) => {
			fs.writeFileSync(
				prefsPath,
				JSON.stringify({
					theme: "default",
					unknownField: "should be ignored",
					anotherUnknown: 42,
				}),
			);

			const prefs = loadPreferences(prefsPath);
			expect(prefs.theme).toBe("default");
			expect((prefs as Record<string, unknown>).unknownField).toBeUndefined();
			expect((prefs as Record<string, unknown>).anotherUnknown).toBeUndefined();
		});
	});

	test("ignores fields with wrong types", () => {
		withTempPrefs((prefsPath) => {
			fs.writeFileSync(
				prefsPath,
				JSON.stringify({
					theme: 123,
					lineWrap: "not a boolean",
					latestKnownVersion: true,
					lastUpdateCheck: "not a number",
				}),
			);

			const prefs = loadPreferences(prefsPath);
			expect(prefs.theme).toBeUndefined();
			expect(prefs.lineWrap).toBeUndefined();
			expect(prefs.latestKnownVersion).toBeUndefined();
			expect(prefs.lastUpdateCheck).toBeUndefined();
		});
	});

	test("partially loads valid fields and ignores invalid ones", () => {
		withTempPrefs((prefsPath) => {
			fs.writeFileSync(
				prefsPath,
				JSON.stringify({
					theme: "dark",
					lineWrap: "invalid",
					latestKnownVersion: "2.0.0",
				}),
			);

			const prefs = loadPreferences(prefsPath);
			expect(prefs.theme).toBe("dark");
			expect(prefs.lineWrap).toBeUndefined();
			expect(prefs.latestKnownVersion).toBe("2.0.0");
		});
	});

	test("returns defaults for empty file", () => {
		withTempPrefs((prefsPath) => {
			fs.writeFileSync(prefsPath, "");

			const prefs = loadPreferences(prefsPath);
			expect(prefs).toEqual({});
		});
	});
});

describe("savePreferences", () => {
	test("creates directory and file when they do not exist", () => {
		const dir = fs.mkdtempSync(path.join("/tmp", "corsa-prefs-test-"));
		const nestedPath = path.join(dir, "nested", "sub", "preferences.json");
		try {
			expect(fs.existsSync(nestedPath)).toBe(false);

			savePreferences({ theme: "ocean" }, nestedPath);

			expect(fs.existsSync(nestedPath)).toBe(true);
			const content = fs.readFileSync(nestedPath, "utf-8");
			const parsed = JSON.parse(content);
			expect(parsed.theme).toBe("ocean");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("writes pretty-printed JSON", () => {
		withTempPrefs((prefsPath) => {
			savePreferences({ theme: "dark", lineWrap: true }, prefsPath);

			const content = fs.readFileSync(prefsPath, "utf-8");
			expect(content).toBe(
				JSON.stringify({ theme: "dark", lineWrap: true }, null, 2),
			);
		});
	});

	test("overwrites existing preferences", () => {
		withTempPrefs((prefsPath) => {
			savePreferences({ theme: "light" }, prefsPath);
			savePreferences({ theme: "dark", lineWrap: false }, prefsPath);

			const prefs = loadPreferences(prefsPath);
			expect(prefs.theme).toBe("dark");
			expect(prefs.lineWrap).toBe(false);
		});
	});

	test("can save empty preferences", () => {
		withTempPrefs((prefsPath) => {
			savePreferences({}, prefsPath);

			const prefs = loadPreferences(prefsPath);
			expect(prefs).toEqual({});
		});
	});

	test("round-trips all preference fields", () => {
		withTempPrefs((prefsPath) => {
			const original = {
				theme: "synthwave",
				lineWrap: false,
				latestKnownVersion: "3.1.4",
				lastUpdateCheck: 1700000000000,
			};
			savePreferences(original, prefsPath);

			const loaded = loadPreferences(prefsPath);
			expect(loaded).toEqual(original);
		});
	});
});

describe("updatePreference", () => {
	test("sets a single preference on empty file", () => {
		withTempPrefs((prefsPath) => {
			updatePreference("theme", "midnight", prefsPath);

			const prefs = loadPreferences(prefsPath);
			expect(prefs.theme).toBe("midnight");
		});
	});

	test("preserves existing preferences when updating one", () => {
		withTempPrefs((prefsPath) => {
			savePreferences(
				{
					theme: "default",
					lineWrap: true,
					latestKnownVersion: "1.0.0",
				},
				prefsPath,
			);

			updatePreference("lineWrap", false, prefsPath);

			const prefs = loadPreferences(prefsPath);
			expect(prefs.theme).toBe("default");
			expect(prefs.lineWrap).toBe(false);
			expect(prefs.latestKnownVersion).toBe("1.0.0");
		});
	});

	test("overwrites an existing preference value", () => {
		withTempPrefs((prefsPath) => {
			savePreferences({ theme: "light" }, prefsPath);
			updatePreference("theme", "dark", prefsPath);

			const prefs = loadPreferences(prefsPath);
			expect(prefs.theme).toBe("dark");
		});
	});

	test("can set preference to undefined to clear it", () => {
		withTempPrefs((prefsPath) => {
			savePreferences({ theme: "ocean", lineWrap: true }, prefsPath);
			updatePreference("theme", undefined, prefsPath);

			const prefs = loadPreferences(prefsPath);
			expect(prefs.theme).toBeUndefined();
			expect(prefs.lineWrap).toBe(true);
		});
	});
});
