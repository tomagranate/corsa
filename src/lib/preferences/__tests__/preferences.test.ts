import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	getPreferencesPath,
	loadPreferences,
	savePreferences,
	updatePreference,
} from "../preferences";

function withTempPreferencesPath(run: (prefsPath: string) => void): void {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "corsa-prefs-test-"));
	const prefsPath = path.join(tempDir, "corsa", "preferences.json");
	try {
		run(prefsPath);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

describe("getPreferencesPath", () => {
	test("uses XDG_CONFIG_HOME when set", () => {
		withTempPreferencesPath((prefsPath) => {
			const tempDir = path.dirname(path.dirname(prefsPath));
			const p = getPreferencesPath({ xdgConfigHome: tempDir });
			expect(p).toBe(path.join(tempDir, "corsa", "preferences.json"));
		});
	});

	test("falls back to ~/.config when XDG_CONFIG_HOME is not set", () => {
		withTempPreferencesPath(() => {
			const p = getPreferencesPath({
				homeDir: "/home/test-user",
				ignoreEnvXdg: true,
			});
			expect(p).toBe(
				path.join("/home/test-user", ".config", "corsa", "preferences.json"),
			);
		});
	});
});

describe("loadPreferences", () => {
	test("returns empty defaults when file does not exist", () => {
		withTempPreferencesPath((prefsPath) => {
			const prefs = loadPreferences(prefsPath);
			expect(prefs).toEqual({});
		});
	});

	test("loads valid preferences from file", () => {
		withTempPreferencesPath((prefsPath) => {
			fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
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
		withTempPreferencesPath((prefsPath) => {
			fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
			fs.writeFileSync(prefsPath, "not json {{{");

			const prefs = loadPreferences(prefsPath);
			expect(prefs).toEqual({});
		});
	});

	test("returns defaults for JSON array", () => {
		withTempPreferencesPath((prefsPath) => {
			fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
			fs.writeFileSync(prefsPath, "[1, 2, 3]");

			const prefs = loadPreferences(prefsPath);
			expect(prefs).toEqual({});
		});
	});

	test("returns defaults for JSON null", () => {
		withTempPreferencesPath((prefsPath) => {
			fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
			fs.writeFileSync(prefsPath, "null");

			const prefs = loadPreferences(prefsPath);
			expect(prefs).toEqual({});
		});
	});

	test("returns defaults for JSON primitive", () => {
		withTempPreferencesPath((prefsPath) => {
			fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
			fs.writeFileSync(prefsPath, '"just a string"');

			const prefs = loadPreferences(prefsPath);
			expect(prefs).toEqual({});
		});
	});

	test("ignores unknown fields", () => {
		withTempPreferencesPath((prefsPath) => {
			fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
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
		withTempPreferencesPath((prefsPath) => {
			fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
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
		withTempPreferencesPath((prefsPath) => {
			fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
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
		withTempPreferencesPath((prefsPath) => {
			fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
			fs.writeFileSync(prefsPath, "");

			const prefs = loadPreferences(prefsPath);
			expect(prefs).toEqual({});
		});
	});
});

describe("savePreferences", () => {
	test("creates directory and file when they do not exist", () => {
		withTempPreferencesPath((prefsPath) => {
			expect(fs.existsSync(prefsPath)).toBe(false);

			savePreferences({ theme: "ocean" }, prefsPath);

			expect(fs.existsSync(prefsPath)).toBe(true);
			const content = fs.readFileSync(prefsPath, "utf-8");
			const parsed = JSON.parse(content);
			expect(parsed.theme).toBe("ocean");
		});
	});

	test("writes pretty-printed JSON", () => {
		withTempPreferencesPath((prefsPath) => {
			savePreferences({ theme: "dark", lineWrap: true }, prefsPath);
			const content = fs.readFileSync(prefsPath, "utf-8");
			expect(content).toBe(
				JSON.stringify({ theme: "dark", lineWrap: true }, null, 2),
			);
		});
	});

	test("overwrites existing preferences", () => {
		withTempPreferencesPath((prefsPath) => {
			savePreferences({ theme: "light" }, prefsPath);
			savePreferences({ theme: "dark", lineWrap: false }, prefsPath);

			const prefs = loadPreferences(prefsPath);
			expect(prefs.theme).toBe("dark");
			expect(prefs.lineWrap).toBe(false);
		});
	});

	test("can save empty preferences", () => {
		withTempPreferencesPath((prefsPath) => {
			savePreferences({}, prefsPath);

			const prefs = loadPreferences(prefsPath);
			expect(prefs).toEqual({});
		});
	});

	test("round-trips all preference fields", () => {
		withTempPreferencesPath((prefsPath) => {
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
		withTempPreferencesPath((prefsPath) => {
			updatePreference("theme", "midnight", prefsPath);

			const prefs = loadPreferences(prefsPath);
			expect(prefs.theme).toBe("midnight");
		});
	});

	test("preserves existing preferences when updating one", () => {
		withTempPreferencesPath((prefsPath) => {
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
		withTempPreferencesPath((prefsPath) => {
			savePreferences({ theme: "light" }, prefsPath);
			updatePreference("theme", "dark", prefsPath);

			const prefs = loadPreferences(prefsPath);
			expect(prefs.theme).toBe("dark");
		});
	});

	test("can set preference to undefined to clear it", () => {
		withTempPreferencesPath((prefsPath) => {
			savePreferences({ theme: "ocean", lineWrap: true }, prefsPath);
			updatePreference("theme", undefined, prefsPath);

			const prefs = loadPreferences(prefsPath);
			expect(prefs.theme).toBeUndefined();
			expect(prefs.lineWrap).toBe(true);
		});
	});
});
