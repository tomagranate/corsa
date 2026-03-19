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

function withXdg(xdg: string | undefined, run: () => void): void {
	const original = process.env.XDG_CONFIG_HOME;
	if (xdg === undefined) {
		delete process.env.XDG_CONFIG_HOME;
	} else {
		process.env.XDG_CONFIG_HOME = xdg;
	}

	try {
		run();
	} finally {
		if (original === undefined) {
			delete process.env.XDG_CONFIG_HOME;
		} else {
			process.env.XDG_CONFIG_HOME = original;
		}
	}
}

function makeTempDir(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupDir(dir: string): void {
	fs.rmSync(dir, { recursive: true, force: true });
}

describe("preferences CI hypotheses", () => {
	test("H1: concurrent XDG mutation can cause cross-test reads", async () => {
		let mismatches = 0;

		for (let i = 0; i < 100; i++) {
			const dirA = makeTempDir("corsa-h1-a-");
			const dirB = makeTempDir("corsa-h1-b-");

			try {
				const runA = async () => {
					process.env.XDG_CONFIG_HOME = dirA;
					savePreferences({ theme: "A" });
					await Bun.sleep(0);
					const prefs = loadPreferences();
					if (prefs.theme !== "A") mismatches++;
				};

				const runB = async () => {
					process.env.XDG_CONFIG_HOME = dirB;
					savePreferences({ theme: "B" });
					await Bun.sleep(0);
					const prefs = loadPreferences();
					if (prefs.theme !== "B") mismatches++;
				};

				await Promise.all([runA(), runB()]);
			} finally {
				cleanupDir(dirA);
				cleanupDir(dirB);
			}
		}

		// Passes when hypothesis is true.
		expect(mismatches).toBeGreaterThan(0);
	});

	test("H2: savePreferences silently swallows write errors", () => {
		const dir = makeTempDir("corsa-h2-");
		const readOnly = path.join(dir, "readonly");
		fs.mkdirSync(readOnly, { recursive: true });
		fs.chmodSync(readOnly, 0o500);

		try {
			withXdg(readOnly, () => {
				expect(() => savePreferences({ theme: "blocked" })).not.toThrow();
				expect(fs.existsSync(getPreferencesPath())).toBe(false);
			});
		} finally {
			fs.chmodSync(readOnly, 0o700);
			cleanupDir(dir);
		}
	});

	test("H3: /tmp behavior differs from CI expectation", () => {
		const dir = makeTempDir("corsa-h3-");
		try {
			const file = path.join(dir, "probe.json");
			fs.writeFileSync(file, JSON.stringify({ ok: true }), "utf-8");
			const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as {
				ok: boolean;
			};
			expect(parsed.ok).toBe(true);
		} finally {
			cleanupDir(dir);
		}
	});

	test("H4: HOME/XDG absence changes preferences path unexpectedly", () => {
		const originalHome = process.env.HOME;
		const originalXdg = process.env.XDG_CONFIG_HOME;
		delete process.env.HOME;
		delete process.env.XDG_CONFIG_HOME;

		try {
			const prefsPath = getPreferencesPath();
			expect(prefsPath.endsWith(path.join("corsa", "preferences.json"))).toBe(
				true,
			);
		} finally {
			if (originalHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = originalHome;
			}

			if (originalXdg === undefined) {
				delete process.env.XDG_CONFIG_HOME;
			} else {
				process.env.XDG_CONFIG_HOME = originalXdg;
			}
		}
	});

	test("H5: updatePreference is vulnerable if XDG changes between calls", () => {
		const dirA = makeTempDir("corsa-h5-a-");
		const dirB = makeTempDir("corsa-h5-b-");

		try {
			withXdg(dirA, () => {
				savePreferences({ theme: "light" });
			});

			withXdg(dirB, () => {
				updatePreference("theme", "dark");
			});

			withXdg(dirA, () => {
				const prefs = loadPreferences();
				// Passes when hypothesis is true: original file in A was untouched.
				expect(prefs.theme).toBe("light");
			});
		} finally {
			cleanupDir(dirA);
			cleanupDir(dirB);
		}
	});

	test("H6: shared temp-dir state can be clobbered by interleaving", async () => {
		let sharedDir = "";
		const first = makeTempDir("corsa-h6-first-");
		const second = makeTempDir("corsa-h6-second-");

		try {
			const workerA = async () => {
				sharedDir = first;
				await Bun.sleep(0);
				cleanupDir(sharedDir);
			};

			const workerB = async () => {
				sharedDir = second;
				await Bun.sleep(0);
				cleanupDir(sharedDir);
			};

			await Promise.all([workerA(), workerB()]);
			// Passes when hypothesis is true: at least one intended dir survives due clobbering.
			const survivors = [first, second].filter((d) => fs.existsSync(d)).length;
			expect(survivors).toBeGreaterThan(0);
		} finally {
			cleanupDir(first);
			cleanupDir(second);
		}
	});

	test("H7: empty/truncated prefs file collapses to defaults", () => {
		const dir = makeTempDir("corsa-h7-");
		try {
			withXdg(dir, () => {
				const prefsPath = getPreferencesPath();
				fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
				fs.writeFileSync(prefsPath, "", "utf-8");
				const prefs = loadPreferences();
				expect(prefs).toEqual({});
			});
		} finally {
			cleanupDir(dir);
		}
	});

	test("H8: undefined values are omitted from persisted JSON", () => {
		const dir = makeTempDir("corsa-h8-");
		try {
			withXdg(dir, () => {
				savePreferences({ theme: undefined, lineWrap: true });
				const raw = fs.readFileSync(getPreferencesPath(), "utf-8");
				const parsed = JSON.parse(raw) as Record<string, unknown>;
				expect("theme" in parsed).toBe(false);
				expect(parsed.lineWrap).toBe(true);
			});
		} finally {
			cleanupDir(dir);
		}
	});

	test("H9: immediate read-after-write with sync fs can still lose data", () => {
		const dir = makeTempDir("corsa-h9-");
		try {
			withXdg(dir, () => {
				let misses = 0;
				for (let i = 0; i < 200; i++) {
					savePreferences({ theme: `theme-${i}` });
					const prefs = loadPreferences();
					if (prefs.theme !== `theme-${i}`) {
						misses++;
					}
				}
				// Passes when hypothesis is false.
				expect(misses).toBe(0);
			});
		} finally {
			cleanupDir(dir);
		}
	});

	test("H10: foreign env mutation can reproduce the CI symptom shape", () => {
		const stableDir = makeTempDir("corsa-h10-stable-");
		const foreignDir = makeTempDir("corsa-h10-foreign-");

		try {
			withXdg(stableDir, () => {
				savePreferences({ theme: "synthwave", lineWrap: true });
			});

			// Simulate another test mutating the process-global env.
			withXdg(foreignDir, () => {
				const prefs = loadPreferences();
				// Passes when hypothesis is true: fields become undefined (empty defaults).
				expect(prefs.theme).toBeUndefined();
				expect(prefs.lineWrap).toBeUndefined();
			});
		} finally {
			cleanupDir(stableDir);
			cleanupDir(foreignDir);
		}
	});
});
