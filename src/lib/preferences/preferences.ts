import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * User preferences that persist across sessions.
 */
export interface Preferences {
	/** Selected theme name (e.g., "default", "synthwave") */
	theme?: string;
	/** Whether to wrap long lines (default: true) */
	lineWrap?: boolean;
	/** Latest known version from update check */
	latestKnownVersion?: string;
	/** Unix timestamp (ms) of last update check */
	lastUpdateCheck?: number;
}

/**
 * Default preferences when no saved preferences exist.
 */
const DEFAULT_PREFERENCES: Preferences = {};

/**
 * Gets the path to the preferences file.
 * Uses ~/.config/corsa/preferences.json following XDG conventions.
 */
export function getPreferencesPath(): string {
	const configDir =
		process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
	return path.join(configDir, "corsa", "preferences.json");
}

/**
 * Loads user preferences from the preferences file.
 * Returns default preferences if the file doesn't exist or is invalid.
 * @param prefsPath - Optional explicit path; defaults to getPreferencesPath().
 */
export function loadPreferences(prefsPath?: string): Preferences {
	const filePath = prefsPath ?? getPreferencesPath();

	let content: string;
	try {
		content = fs.readFileSync(filePath, "utf-8");
	} catch (error: unknown) {
		// TODO: remove after CI debugging
		console.error(
			`[loadPreferences DEBUG] readFileSync failed | prefsPath=${prefsPath} | filePath=${filePath} | error=${error}`,
		);
		if (
			error instanceof Error &&
			"code" in error &&
			(error as NodeJS.ErrnoException).code === "ENOENT"
		) {
			return { ...DEFAULT_PREFERENCES };
		}
		throw error;
	}

	if (!content.trim()) {
		return { ...DEFAULT_PREFERENCES };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return { ...DEFAULT_PREFERENCES };
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return { ...DEFAULT_PREFERENCES };
	}

	const prefs: Preferences = {};
	const obj = parsed as Record<string, unknown>;

	if (typeof obj.theme === "string") {
		prefs.theme = obj.theme;
	}

	if (typeof obj.lineWrap === "boolean") {
		prefs.lineWrap = obj.lineWrap;
	}

	if (typeof obj.latestKnownVersion === "string") {
		prefs.latestKnownVersion = obj.latestKnownVersion;
	}

	if (typeof obj.lastUpdateCheck === "number") {
		prefs.lastUpdateCheck = obj.lastUpdateCheck;
	}

	return prefs;
}

/**
 * Saves user preferences to the preferences file.
 * Creates the config directory if it doesn't exist.
 * @param prefsPath - Optional explicit path; defaults to getPreferencesPath().
 */
export function savePreferences(
	preferences: Preferences,
	prefsPath?: string,
): void {
	const filePath = prefsPath ?? getPreferencesPath();
	const fileDir = path.dirname(filePath);

	fs.mkdirSync(fileDir, { recursive: true });
	const content = JSON.stringify(preferences, null, 2);
	fs.writeFileSync(filePath, content, "utf-8");
}

/**
 * Updates a single preference value and saves.
 * Preserves other existing preferences.
 * @param prefsPath - Optional explicit path; defaults to getPreferencesPath().
 */
export function updatePreference<K extends keyof Preferences>(
	key: K,
	value: Preferences[K],
	prefsPath?: string,
): void {
	// TODO: remove after CI debugging
	console.error(
		`[updatePreference DEBUG] key=${String(key)} | prefsPath=${prefsPath} | typeof prefsPath=${typeof prefsPath}`,
	);
	const current = loadPreferences(prefsPath);
	current[key] = value;
	savePreferences(current, prefsPath);
}
