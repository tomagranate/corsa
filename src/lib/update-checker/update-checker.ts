/**
 * Background update checker that caches results in preferences.
 * Checks at most once every 4 hours.
 */

import { EventEmitter } from "node:events";
import { getVersion } from "../../cli";
import { GITHUB_REPO, getLatestVersion } from "../../commands/update";
import { loadPreferences, savePreferences } from "../preferences";

/** 4 hours in milliseconds */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export interface UpdateState {
	/** The latest version available (null if not yet checked or error) */
	latestVersion: string | null;
	/** Whether an update is available */
	isUpdateAvailable: boolean;
	/** When the last check occurred (null if never) */
	lastChecked: Date | null;
	/** Whether a check is currently in progress */
	isChecking: boolean;
}

type UpdateListener = (state: UpdateState) => void;

class UpdateChecker extends EventEmitter {
	private state: UpdateState = {
		latestVersion: null,
		isUpdateAvailable: false,
		lastChecked: null,
		isChecking: false,
	};

	constructor() {
		super();
		// Load cached state from preferences
		this.loadCachedState();
	}

	/**
	 * Load cached update state from preferences
	 */
	private loadCachedState(): void {
		const prefs = loadPreferences();
		if (prefs.latestKnownVersion && prefs.lastUpdateCheck) {
			const currentVersion = getVersion();
			this.state = {
				latestVersion: prefs.latestKnownVersion,
				isUpdateAvailable: this.compareVersions(
					prefs.latestKnownVersion,
					currentVersion,
				),
				lastChecked: new Date(prefs.lastUpdateCheck),
				isChecking: false,
			};
		}
	}

	/**
	 * Compare two semver versions. Returns true if latest > current.
	 */
	private compareVersions(latest: string, current: string): boolean {
		const latestParts = latest.split(".").map(Number);
		const currentParts = current.split(".").map(Number);

		for (let i = 0; i < 3; i++) {
			const latestPart = latestParts[i] ?? 0;
			const currentPart = currentParts[i] ?? 0;
			if (latestPart > currentPart) return true;
			if (latestPart < currentPart) return false;
		}
		return false;
	}

	/**
	 * Get the current update state
	 */
	getState(): UpdateState {
		return { ...this.state };
	}

	/**
	 * Check if enough time has passed since the last check
	 */
	private shouldCheck(): boolean {
		if (!this.state.lastChecked) return true;
		const elapsed = Date.now() - this.state.lastChecked.getTime();
		return elapsed >= CHECK_INTERVAL_MS;
	}

	/**
	 * Check for updates. Only fetches from GitHub if:
	 * - Never checked before, or
	 * - Last check was more than 4 hours ago
	 *
	 * @param force - If true, check regardless of time elapsed
	 */
	async checkForUpdates(force = false): Promise<void> {
		// Don't check if already checking
		if (this.state.isChecking) return;

		// Don't check if we checked recently (unless forced)
		if (!force && !this.shouldCheck()) return;

		this.state.isChecking = true;
		this.emit("change", this.getState());

		try {
			const latestVersion = await getLatestVersion();
			const currentVersion = getVersion();
			const isUpdateAvailable = this.compareVersions(
				latestVersion,
				currentVersion,
			);

			this.state = {
				latestVersion,
				isUpdateAvailable,
				lastChecked: new Date(),
				isChecking: false,
			};

			// Save to preferences for persistence
			const prefs = loadPreferences();
			prefs.latestKnownVersion = latestVersion;
			prefs.lastUpdateCheck = Date.now();
			savePreferences(prefs);
		} catch {
			// Silently fail - update checking is not critical
			this.state.isChecking = false;
		}

		this.emit("change", this.getState());
	}

	/**
	 * Subscribe to state changes
	 */
	subscribe(listener: UpdateListener): () => void {
		this.on("change", listener);
		return () => this.off("change", listener);
	}

	/**
	 * Get the GitHub repo URL
	 */
	getRepoUrl(): string {
		return `https://github.com/${GITHUB_REPO}`;
	}

	/**
	 * Get the issues URL
	 */
	getIssuesUrl(): string {
		return `https://github.com/${GITHUB_REPO}/issues`;
	}
}

// Global singleton instance
export const updateChecker = new UpdateChecker();
