import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	getPreferencesPath,
	loadPreferences,
	savePreferences,
	updatePreference,
} from "../preferences";

let tempDir: string;
let prefsPath: string;
let originalXdg: string | undefined;

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join("/tmp", "corsa-prefs-test-"));
	prefsPath = path.join(tempDir, "corsa", "preferences.json");
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

describe("getPreferencesPath", () => {
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
		const prefs = loadPreferences(prefsPath);
		expect(prefs).toEqual({});
	});

	test("loads valid preferences from file", () => {
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

	test("returns defaults for invalid JSON", () => {
		fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
		fs.writeFileSync(prefsPath, "not json {{{");

		const prefs = loadPreferences(prefsPath);
		expect(prefs).toEqual({});
	});

	test("returns defaults for JSON array", () => {
		fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
		fs.writeFileSync(prefsPath, "[1, 2, 3]");

		const prefs = loadPreferences(prefsPath);
		expect(prefs).toEqual({});
	});

	test("returns defaults for JSON null", () => {
		fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
		fs.writeFileSync(prefsPath, "null");

		const prefs = loadPreferences(prefsPath);
		expect(prefs).toEqual({});
	});

	test("returns defaults for JSON primitive", () => {
		fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
		fs.writeFileSync(prefsPath, '"just a string"');

		const prefs = loadPreferences(prefsPath);
		expect(prefs).toEqual({});
	});

	test("ignores unknown fields", () => {
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

	test("ignores fields with wrong types", () => {
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

	test("partially loads valid fields and ignores invalid ones", () => {
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

	test("returns defaults for empty file", () => {
		fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
		fs.writeFileSync(prefsPath, "");

		const prefs = loadPreferences(prefsPath);
		expect(prefs).toEqual({});
	});
});

describe("savePreferences", () => {
	test("creates directory and file when they do not exist", () => {
		expect(fs.existsSync(prefsPath)).toBe(false);

		savePreferences({ theme: "ocean" }, prefsPath);

		expect(fs.existsSync(prefsPath)).toBe(true);
		const content = fs.readFileSync(prefsPath, "utf-8");
		const parsed = JSON.parse(content);
		expect(parsed.theme).toBe("ocean");
	});

	test("writes pretty-printed JSON", () => {
		savePreferences({ theme: "dark", lineWrap: true }, prefsPath);

		const content = fs.readFileSync(prefsPath, "utf-8");
		expect(content).toBe(
			JSON.stringify({ theme: "dark", lineWrap: true }, null, 2),
		);
	});

	test("overwrites existing preferences", () => {
		savePreferences({ theme: "light" }, prefsPath);
		savePreferences({ theme: "dark", lineWrap: false }, prefsPath);

		const prefs = loadPreferences(prefsPath);
		expect(prefs.theme).toBe("dark");
		expect(prefs.lineWrap).toBe(false);
	});

	test("can save empty preferences", () => {
		savePreferences({}, prefsPath);

		const prefs = loadPreferences(prefsPath);
		expect(prefs).toEqual({});
	});

	test("round-trips all preference fields", () => {
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

describe("updatePreference", () => {
	test("sets a single preference on empty file", () => {
		updatePreference("theme", "midnight", prefsPath);

		const prefs = loadPreferences(prefsPath);
		expect(prefs.theme).toBe("midnight");
	});

	test("preserves existing preferences when updating one", () => {
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

	test("overwrites an existing preference value", () => {
		savePreferences({ theme: "light" }, prefsPath);
		updatePreference("theme", "dark", prefsPath);

		const prefs = loadPreferences(prefsPath);
		expect(prefs.theme).toBe("dark");
	});

	test("can set preference to undefined to clear it", () => {
		savePreferences({ theme: "ocean", lineWrap: true }, prefsPath);
		updatePreference("theme", undefined, prefsPath);

		const prefs = loadPreferences(prefsPath);
		expect(prefs.theme).toBeUndefined();
		expect(prefs.lineWrap).toBe(true);
	});
});
