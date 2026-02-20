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
 */
export function loadPreferences(): Preferences {
	const prefsPath = getPreferencesPath();

	try {
		if (!fs.existsSync(prefsPath)) {
			return { ...DEFAULT_PREFERENCES };
		}

		const content = fs.readFileSync(prefsPath, "utf-8");
		const parsed = JSON.parse(content) as unknown;

		// Validate that parsed content is an object
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return { ...DEFAULT_PREFERENCES };
		}

		// Extract only known preference fields
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
	} catch {
		// Return defaults if file doesn't exist or is invalid JSON
		return { ...DEFAULT_PREFERENCES };
	}
}

/**
 * Saves user preferences to the preferences file.
 * Creates the config directory if it doesn't exist.
 */
export function savePreferences(preferences: Preferences): void {
	const prefsPath = getPreferencesPath();
	const prefsDir = path.dirname(prefsPath);

	try {
		// Create directory if it doesn't exist
		if (!fs.existsSync(prefsDir)) {
			fs.mkdirSync(prefsDir, { recursive: true });
		}

		// Write preferences with pretty formatting
		const content = JSON.stringify(preferences, null, 2);
		fs.writeFileSync(prefsPath, content, "utf-8");
	} catch (error) {
		// Silently fail - preferences are not critical
		// Could log to debug console if available
		console.error("Failed to save preferences:", error);
	}
}

/**
 * Updates a single preference value and saves.
 * Preserves other existing preferences.
 */
export function updatePreference<K extends keyof Preferences>(
	key: K,
	value: Preferences[K],
): void {
	const current = loadPreferences();
	current[key] = value;
	savePreferences(current);
}
