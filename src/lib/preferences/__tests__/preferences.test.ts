import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	getPreferencesPath,
	loadPreferences,
	savePreferences,
	setPreferencesPathForTesting,
	updatePreference,
} from "../preferences";

/**
 * Runs a test with an isolated temp directory.
 * Sets the module-level path override so all preferences functions
 * use the temp file, then cleans up afterwards.
 */
function withTempPrefs(fn: (prefsPath: string) => void) {
	const dir = fs.mkdtempSync(path.join("/tmp", "corsa-prefs-test-"));
	const filePath = path.join(dir, "preferences.json");
	setPreferencesPathForTesting(filePath);
	try {
		fn(filePath);
	} finally {
		setPreferencesPathForTesting(undefined);
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

describe("getPreferencesPath", () => {
	test("uses XDG_CONFIG_HOME when set", () => {
		const originalXdg = process.env.XDG_CONFIG_HOME;
		const tempDir = fs.mkdtempSync(path.join("/tmp", "corsa-prefs-test-"));
		setPreferencesPathForTesting(undefined);
		try {
			process.env.XDG_CONFIG_HOME = tempDir;
			const p = getPreferencesPath();
			expect(p).toBe(path.join(tempDir, "corsa", "preferences.json"));
		} finally {
			if (originalXdg !== undefined) {
				process.env.XDG_CONFIG_HOME = originalXdg;
			} else {
				delete process.env.XDG_CONFIG_HOME;
			}
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test("falls back to ~/.config when XDG_CONFIG_HOME is not set", () => {
		const originalXdg = process.env.XDG_CONFIG_HOME;
		setPreferencesPathForTesting(undefined);
		try {
			delete process.env.XDG_CONFIG_HOME;
			const os = require("node:os");
			const p = getPreferencesPath();
			expect(p).toBe(
				path.join(os.homedir(), ".config", "corsa", "preferences.json"),
			);
		} finally {
			if (originalXdg !== undefined) {
				process.env.XDG_CONFIG_HOME = originalXdg;
			} else {
				delete process.env.XDG_CONFIG_HOME;
			}
		}
	});
});

describe("loadPreferences", () => {
	test("returns empty defaults when file does not exist", () => {
		withTempPrefs(() => {
			const prefs = loadPreferences();
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

			const prefs = loadPreferences();
			expect(prefs.theme).toBe("synthwave");
			expect(prefs.lineWrap).toBe(false);
			expect(prefs.latestKnownVersion).toBe("1.2.3");
			expect(prefs.lastUpdateCheck).toBe(1700000000000);
		});
	});

	test("returns defaults for invalid JSON", () => {
		withTempPrefs((prefsPath) => {
			fs.writeFileSync(prefsPath, "not json {{{");

			const prefs = loadPreferences();
			expect(prefs).toEqual({});
		});
	});

	test("returns defaults for JSON array", () => {
		withTempPrefs((prefsPath) => {
			fs.writeFileSync(prefsPath, "[1, 2, 3]");

			const prefs = loadPreferences();
			expect(prefs).toEqual({});
		});
	});

	test("returns defaults for JSON null", () => {
		withTempPrefs((prefsPath) => {
			fs.writeFileSync(prefsPath, "null");

			const prefs = loadPreferences();
			expect(prefs).toEqual({});
		});
	});

	test("returns defaults for JSON primitive", () => {
		withTempPrefs((prefsPath) => {
			fs.writeFileSync(prefsPath, '"just a string"');

			const prefs = loadPreferences();
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

			const prefs = loadPreferences();
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

			const prefs = loadPreferences();
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

			const prefs = loadPreferences();
			expect(prefs.theme).toBe("dark");
			expect(prefs.lineWrap).toBeUndefined();
			expect(prefs.latestKnownVersion).toBe("2.0.0");
		});
	});

	test("returns defaults for empty file", () => {
		withTempPrefs((prefsPath) => {
			fs.writeFileSync(prefsPath, "");

			const prefs = loadPreferences();
			expect(prefs).toEqual({});
		});
	});
});

describe("savePreferences", () => {
	test("creates directory and file when they do not exist", () => {
		const dir = fs.mkdtempSync(path.join("/tmp", "corsa-prefs-test-"));
		const nestedPath = path.join(dir, "nested", "sub", "preferences.json");
		setPreferencesPathForTesting(nestedPath);
		try {
			expect(fs.existsSync(nestedPath)).toBe(false);

			savePreferences({ theme: "ocean" });

			expect(fs.existsSync(nestedPath)).toBe(true);
			const content = fs.readFileSync(nestedPath, "utf-8");
			const parsed = JSON.parse(content);
			expect(parsed.theme).toBe("ocean");
		} finally {
			setPreferencesPathForTesting(undefined);
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("writes pretty-printed JSON", () => {
		withTempPrefs((prefsPath) => {
			savePreferences({ theme: "dark", lineWrap: true });

			const content = fs.readFileSync(prefsPath, "utf-8");
			expect(content).toBe(
				JSON.stringify({ theme: "dark", lineWrap: true }, null, 2),
			);
		});
	});

	test("overwrites existing preferences", () => {
		withTempPrefs(() => {
			savePreferences({ theme: "light" });
			savePreferences({ theme: "dark", lineWrap: false });

			const prefs = loadPreferences();
			expect(prefs.theme).toBe("dark");
			expect(prefs.lineWrap).toBe(false);
		});
	});

	test("can save empty preferences", () => {
		withTempPrefs(() => {
			savePreferences({});

			const prefs = loadPreferences();
			expect(prefs).toEqual({});
		});
	});

	test("round-trips all preference fields", () => {
		withTempPrefs(() => {
			const original = {
				theme: "synthwave",
				lineWrap: false,
				latestKnownVersion: "3.1.4",
				lastUpdateCheck: 1700000000000,
			};
			savePreferences(original);

			const loaded = loadPreferences();
			expect(loaded).toEqual(original);
		});
	});
});

describe("updatePreference", () => {
	test("sets a single preference on empty file", () => {
		withTempPrefs(() => {
			updatePreference("theme", "midnight");

			const prefs = loadPreferences();
			expect(prefs.theme).toBe("midnight");
		});
	});

	test("preserves existing preferences when updating one", () => {
		withTempPrefs(() => {
			savePreferences({
				theme: "default",
				lineWrap: true,
				latestKnownVersion: "1.0.0",
			});

			updatePreference("lineWrap", false);

			const prefs = loadPreferences();
			expect(prefs.theme).toBe("default");
			expect(prefs.lineWrap).toBe(false);
			expect(prefs.latestKnownVersion).toBe("1.0.0");
		});
	});

	test("overwrites an existing preference value", () => {
		withTempPrefs(() => {
			savePreferences({ theme: "light" });
			updatePreference("theme", "dark");

			const prefs = loadPreferences();
			expect(prefs.theme).toBe("dark");
		});
	});

	test("can set preference to undefined to clear it", () => {
		withTempPrefs(() => {
			savePreferences({ theme: "ocean", lineWrap: true });
			updatePreference("theme", undefined);

			const prefs = loadPreferences();
			expect(prefs.theme).toBeUndefined();
			expect(prefs.lineWrap).toBe(true);
		});
	});
});
