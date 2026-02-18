import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { UpdateState } from "../update-checker";

// ---------------------------------------------------------------------------
// Mutable test state — changed between tests to control mock behaviour
// ---------------------------------------------------------------------------
let currentVersion = "1.0.0";
const mockGetLatestVersion = mock(() => Promise.resolve("2.0.0"));
let mockPrefsData: Record<string, unknown> = {};
const mockSavePreferences = mock((_prefs: Record<string, unknown>) => {});

// ---------------------------------------------------------------------------
// Module mocks — must appear before the import of the module under test.
// Bun hoists mock.module above imports so the singleton constructor
// sees the mocked dependencies.
// ---------------------------------------------------------------------------
mock.module("../../../cli", () => ({
	getVersion: () => currentVersion,
}));

mock.module("../../../commands/update", () => ({
	GITHUB_REPO: "tomagranate/corsa",
	getLatestVersion: mockGetLatestVersion,
}));

mock.module("../../preferences", () => ({
	loadPreferences: () => ({ ...mockPrefsData }),
	savePreferences: mockSavePreferences,
}));

// Import singleton AFTER mocks are in place
import { updateChecker } from "../update-checker";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
	currentVersion = "1.0.0";
	mockGetLatestVersion.mockReset();
	mockGetLatestVersion.mockImplementation(() => Promise.resolve("2.0.0"));
	mockSavePreferences.mockReset();
	mockPrefsData = {};
});

describe("UpdateChecker", () => {
	// =========================================================================
	// getState
	// =========================================================================
	describe("getState", () => {
		test("returns a state object with expected shape", () => {
			const state = updateChecker.getState();
			expect(state).toHaveProperty("latestVersion");
			expect(state).toHaveProperty("isUpdateAvailable");
			expect(state).toHaveProperty("lastChecked");
			expect(state).toHaveProperty("isChecking");
		});

		test("returns a copy, not the internal state", () => {
			const a = updateChecker.getState();
			const b = updateChecker.getState();
			expect(a).toEqual(b);
			expect(a).not.toBe(b);
		});
	});

	// =========================================================================
	// checkForUpdates — version comparison (tests compareVersions indirectly)
	// =========================================================================
	describe("checkForUpdates (version comparison)", () => {
		test("detects major version update", async () => {
			currentVersion = "1.0.0";
			mockGetLatestVersion.mockImplementation(() => Promise.resolve("2.0.0"));
			await updateChecker.checkForUpdates(true);

			const state = updateChecker.getState();
			expect(state.latestVersion).toBe("2.0.0");
			expect(state.isUpdateAvailable).toBe(true);
		});

		test("detects minor version update", async () => {
			currentVersion = "1.0.0";
			mockGetLatestVersion.mockImplementation(() => Promise.resolve("1.1.0"));
			await updateChecker.checkForUpdates(true);
			expect(updateChecker.getState().isUpdateAvailable).toBe(true);
		});

		test("detects patch version update", async () => {
			currentVersion = "1.0.0";
			mockGetLatestVersion.mockImplementation(() => Promise.resolve("1.0.1"));
			await updateChecker.checkForUpdates(true);
			expect(updateChecker.getState().isUpdateAvailable).toBe(true);
		});

		test("same version — no update", async () => {
			currentVersion = "1.2.3";
			mockGetLatestVersion.mockImplementation(() => Promise.resolve("1.2.3"));
			await updateChecker.checkForUpdates(true);

			const state = updateChecker.getState();
			expect(state.latestVersion).toBe("1.2.3");
			expect(state.isUpdateAvailable).toBe(false);
		});

		test("current version newer — no update", async () => {
			currentVersion = "3.0.0";
			mockGetLatestVersion.mockImplementation(() => Promise.resolve("2.9.9"));
			await updateChecker.checkForUpdates(true);
			expect(updateChecker.getState().isUpdateAvailable).toBe(false);
		});

		test("handles versions with different segment counts", async () => {
			currentVersion = "1.0.0";
			mockGetLatestVersion.mockImplementation(() => Promise.resolve("1.0.0"));
			await updateChecker.checkForUpdates(true);
			expect(updateChecker.getState().isUpdateAvailable).toBe(false);
		});
	});

	// =========================================================================
	// checkForUpdates — behaviour
	// =========================================================================
	describe("checkForUpdates (behaviour)", () => {
		test("sets isChecking=false after completion", async () => {
			await updateChecker.checkForUpdates(true);
			expect(updateChecker.getState().isChecking).toBe(false);
		});

		test("sets lastChecked after completion", async () => {
			const before = Date.now();
			await updateChecker.checkForUpdates(true);
			const state = updateChecker.getState();
			expect(state.lastChecked).not.toBeNull();
			expect(state.lastChecked?.getTime()).toBeGreaterThanOrEqual(before);
		});

		test("saves latest version to preferences", async () => {
			mockGetLatestVersion.mockImplementation(() => Promise.resolve("5.0.0"));
			await updateChecker.checkForUpdates(true);

			expect(mockSavePreferences).toHaveBeenCalled();
			const saved = mockSavePreferences.mock.calls[0]?.[0] as Record<
				string,
				unknown
			>;
			expect(saved?.latestKnownVersion).toBe("5.0.0");
			expect(typeof saved?.lastUpdateCheck).toBe("number");
		});

		test("handles network failure gracefully", async () => {
			mockGetLatestVersion.mockImplementation(() =>
				Promise.reject(new Error("Network error")),
			);

			// Should not throw
			await updateChecker.checkForUpdates(true);

			const state = updateChecker.getState();
			expect(state.isChecking).toBe(false);
		});

		test("does not save preferences on network failure", async () => {
			mockGetLatestVersion.mockImplementation(() =>
				Promise.reject(new Error("fail")),
			);
			await updateChecker.checkForUpdates(true);
			expect(mockSavePreferences).not.toHaveBeenCalled();
		});

		test("prevents concurrent checks", async () => {
			mockGetLatestVersion.mockImplementation(
				() => new Promise((resolve) => setTimeout(() => resolve("6.0.0"), 50)),
			);

			const first = updateChecker.checkForUpdates(true);
			expect(updateChecker.getState().isChecking).toBe(true);

			// Second call while first is in-flight — should return immediately
			await updateChecker.checkForUpdates(true);

			await first;
			// getLatestVersion should only have been called once
			expect(mockGetLatestVersion).toHaveBeenCalledTimes(1);
		});

		test("skips check when last check was recent (non-forced)", async () => {
			await updateChecker.checkForUpdates(true);
			const callsAfterFirst = mockGetLatestVersion.mock.calls.length;

			// Non-forced check immediately after — should be skipped
			await updateChecker.checkForUpdates(false);
			expect(mockGetLatestVersion.mock.calls.length).toBe(callsAfterFirst);
		});

		test("force=true bypasses time check", async () => {
			await updateChecker.checkForUpdates(true);
			const callsAfterFirst = mockGetLatestVersion.mock.calls.length;

			// Forced check immediately after — should proceed
			await updateChecker.checkForUpdates(true);
			expect(mockGetLatestVersion.mock.calls.length).toBe(callsAfterFirst + 1);
		});
	});

	// =========================================================================
	// subscribe / unsubscribe
	// =========================================================================
	describe("subscribe", () => {
		test("listener receives events during checkForUpdates", async () => {
			const events: UpdateState[] = [];
			const unsubscribe = updateChecker.subscribe((s) => events.push({ ...s }));

			await updateChecker.checkForUpdates(true);

			// Expect at least 2 events: isChecking=true then final state
			expect(events.length).toBeGreaterThanOrEqual(2);
			expect(events[0]?.isChecking).toBe(true);
			expect(events[events.length - 1]?.isChecking).toBe(false);

			unsubscribe();
		});

		test("unsubscribe stops notifications", async () => {
			const events: UpdateState[] = [];
			const unsubscribe = updateChecker.subscribe((s) => events.push({ ...s }));
			unsubscribe();

			await updateChecker.checkForUpdates(true);
			expect(events.length).toBe(0);
		});

		test("multiple subscribers each receive events", async () => {
			const eventsA: UpdateState[] = [];
			const eventsB: UpdateState[] = [];
			const unsubA = updateChecker.subscribe((s) => eventsA.push({ ...s }));
			const unsubB = updateChecker.subscribe((s) => eventsB.push({ ...s }));

			await updateChecker.checkForUpdates(true);

			expect(eventsA.length).toBeGreaterThanOrEqual(2);
			expect(eventsB.length).toBeGreaterThanOrEqual(2);
			expect(eventsA.length).toBe(eventsB.length);

			unsubA();
			unsubB();
		});
	});

	// =========================================================================
	// URL helpers
	// =========================================================================
	describe("getRepoUrl", () => {
		test("returns GitHub repo URL", () => {
			expect(updateChecker.getRepoUrl()).toBe(
				"https://github.com/tomagranate/corsa",
			);
		});
	});

	describe("getIssuesUrl", () => {
		test("returns GitHub issues URL", () => {
			expect(updateChecker.getIssuesUrl()).toBe(
				"https://github.com/tomagranate/corsa/issues",
			);
		});
	});
});
