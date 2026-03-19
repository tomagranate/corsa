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

let envLock: Promise<void> = Promise.resolve();

function runWithEnvLock(run: () => void | Promise<void>): Promise<void> {
	const previous = envLock;
	let release: () => void = () => {};
	envLock = new Promise<void>((resolve) => {
		release = resolve;
	});

	return previous.then(async () => {
		try {
			await run();
		} finally {
			release();
		}
	});
}

function testExclusive(name: string, run: () => void | Promise<void>): void {
	test(name, async () => {
		await runWithEnvLock(run);
	});
}

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

function prefsPathForDir(dir: string): string {
	return path.join(dir, "corsa", "preferences.json");
}

function cleanupDir(dir: string): void {
	fs.rmSync(dir, { recursive: true, force: true });
}

describe("preferences CI hypotheses", () => {
	testExclusive(
		"H1: concurrent XDG mutation can cause cross-test reads",
		async () => {
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
		},
	);

	testExclusive("H2: savePreferences silently swallows write errors", () => {
		const dir = makeTempDir("corsa-h2-");
		const readOnly = path.join(dir, "readonly");
		const prefsPath = prefsPathForDir(readOnly);
		fs.mkdirSync(readOnly, { recursive: true });
		fs.chmodSync(readOnly, 0o500);

		try {
			expect(() =>
				savePreferences({ theme: "blocked" }, prefsPath),
			).not.toThrow();
			expect(fs.existsSync(prefsPath)).toBe(false);
		} finally {
			fs.chmodSync(readOnly, 0o700);
			cleanupDir(dir);
		}
	});

	testExclusive("H3: /tmp behavior differs from CI expectation", () => {
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

	testExclusive(
		"H4: HOME/XDG absence changes preferences path unexpectedly",
		() => {
			const prefsPath = getPreferencesPath({
				homeDir: "/home/ci-user",
				ignoreEnvXdg: true,
			});
			expect(prefsPath).toBe(
				path.join("/home/ci-user", ".config", "corsa", "preferences.json"),
			);
		},
	);

	testExclusive(
		"H5: updatePreference is vulnerable if XDG changes between calls",
		() => {
			const dirA = makeTempDir("corsa-h5-a-");
			const dirB = makeTempDir("corsa-h5-b-");
			const prefsPathA = prefsPathForDir(dirA);
			const prefsPathB = prefsPathForDir(dirB);

			try {
				savePreferences({ theme: "light" }, prefsPathA);
				updatePreference("theme", "dark", prefsPathB);

				const prefs = loadPreferences(prefsPathA);
				// Passes when hypothesis is true: original file in A was untouched.
				expect(prefs.theme).toBe("light");
			} finally {
				cleanupDir(dirA);
				cleanupDir(dirB);
			}
		},
	);

	testExclusive(
		"H6: shared temp-dir state can be clobbered by interleaving",
		async () => {
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
				const survivors = [first, second].filter((d) =>
					fs.existsSync(d),
				).length;
				expect(survivors).toBeGreaterThan(0);
			} finally {
				cleanupDir(first);
				cleanupDir(second);
			}
		},
	);

	testExclusive("H7: empty/truncated prefs file collapses to defaults", () => {
		const dir = makeTempDir("corsa-h7-");
		const prefsPath = prefsPathForDir(dir);
		try {
			fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
			fs.writeFileSync(prefsPath, "", "utf-8");
			const prefs = loadPreferences(prefsPath);
			expect(prefs).toEqual({});
		} finally {
			cleanupDir(dir);
		}
	});

	testExclusive("H8: undefined values are omitted from persisted JSON", () => {
		const dir = makeTempDir("corsa-h8-");
		const prefsPath = prefsPathForDir(dir);
		try {
			savePreferences({ theme: undefined, lineWrap: true }, prefsPath);
			const raw = fs.readFileSync(prefsPath, "utf-8");
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			expect("theme" in parsed).toBe(false);
			expect(parsed.lineWrap).toBe(true);
		} finally {
			cleanupDir(dir);
		}
	});

	testExclusive(
		"H9: immediate read-after-write with sync fs can still lose data",
		() => {
			const dir = makeTempDir("corsa-h9-");
			const prefsPath = prefsPathForDir(dir);
			try {
				let misses = 0;
				for (let i = 0; i < 200; i++) {
					savePreferences({ theme: `theme-${i}` }, prefsPath);
					const prefs = loadPreferences(prefsPath);
					if (prefs.theme !== `theme-${i}`) {
						misses++;
					}
				}
				// Passes when hypothesis is false.
				expect(misses).toBe(0);
			} finally {
				cleanupDir(dir);
			}
		},
	);

	testExclusive(
		"H10: foreign env mutation can reproduce the CI symptom shape",
		() => {
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
		},
	);

	testExclusive("H11: path with spaces can read/write preferences", () => {
		const dir = makeTempDir("corsa h11 with spaces ");
		const prefsPath = prefsPathForDir(dir);
		try {
			savePreferences({ theme: "space-theme", lineWrap: true }, prefsPath);
			const prefs = loadPreferences(prefsPath);
			expect(prefs.theme).toBe("space-theme");
			expect(prefs.lineWrap).toBe(true);
		} finally {
			cleanupDir(dir);
		}
	});

	testExclusive("H12: symlinked config dir still works for prefs path", () => {
		const realDir = makeTempDir("corsa-h12-real-");
		const linkParent = makeTempDir("corsa-h12-link-parent-");
		const linkDir = path.join(linkParent, "link");
		const prefsPath = prefsPathForDir(linkDir);

		try {
			fs.symlinkSync(realDir, linkDir);
			savePreferences({ theme: "symlink" }, prefsPath);
			const prefs = loadPreferences(prefsPath);
			expect(prefs.theme).toBe("symlink");
		} finally {
			cleanupDir(linkParent);
			cleanupDir(realDir);
		}
	});

	testExclusive("H13: file path occupied by directory returns defaults", () => {
		const dir = makeTempDir("corsa-h13-");
		const prefsPath = prefsPathForDir(dir);
		try {
			fs.mkdirSync(prefsPath, { recursive: true });
			const prefs = loadPreferences(prefsPath);
			expect(prefs).toEqual({});
		} finally {
			cleanupDir(dir);
		}
	});

	testExclusive(
		"H14: read-only prefs file keeps previous value on write",
		() => {
			const dir = makeTempDir("corsa-h14-");
			const prefsPath = prefsPathForDir(dir);
			try {
				savePreferences({ theme: "before" }, prefsPath);
				fs.chmodSync(prefsPath, 0o400);
				savePreferences({ theme: "after" }, prefsPath);
				fs.chmodSync(prefsPath, 0o600);

				const prefs = loadPreferences(prefsPath);
				expect(prefs.theme).toBe("before");
			} finally {
				cleanupDir(dir);
			}
		},
	);

	testExclusive("H15: UTF-8 BOM in file causes safe fallback defaults", () => {
		const dir = makeTempDir("corsa-h15-");
		const prefsPath = prefsPathForDir(dir);
		try {
			fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
			fs.writeFileSync(prefsPath, `\uFEFF{"theme":"bom"}`, "utf-8");
			const prefs = loadPreferences(prefsPath);
			expect(prefs).toEqual({});
		} finally {
			cleanupDir(dir);
		}
	});

	testExclusive("H16: unknown nested objects are ignored safely", () => {
		const dir = makeTempDir("corsa-h16-");
		const prefsPath = prefsPathForDir(dir);
		try {
			fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
			fs.writeFileSync(
				prefsPath,
				JSON.stringify({
					theme: "known",
					experimental: { a: 1, b: true },
				}),
			);
			const prefs = loadPreferences(prefsPath) as Record<string, unknown>;
			expect(prefs.theme).toBe("known");
			expect(prefs.experimental).toBeUndefined();
		} finally {
			cleanupDir(dir);
		}
	});

	testExclusive("H17: NaN is accepted as number for lastUpdateCheck", () => {
		const dir = makeTempDir("corsa-h17-");
		const prefsPath = prefsPathForDir(dir);
		try {
			fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
			fs.writeFileSync(
				prefsPath,
				JSON.stringify({
					lastUpdateCheck: Number.NaN,
				}),
			);
			const prefs = loadPreferences(prefsPath);
			// JSON serializes NaN to null, so this should be dropped.
			expect(prefs.lastUpdateCheck).toBeUndefined();
		} finally {
			cleanupDir(dir);
		}
	});

	testExclusive(
		"H18: concurrent writes to same path do not corrupt JSON",
		async () => {
			const dir = makeTempDir("corsa-h18-");
			const prefsPath = prefsPathForDir(dir);
			try {
				await Promise.all([
					Promise.resolve().then(() =>
						savePreferences({ theme: "writer-a", lineWrap: true }, prefsPath),
					),
					Promise.resolve().then(() =>
						savePreferences({ theme: "writer-b", lineWrap: false }, prefsPath),
					),
				]);

				const raw = fs.readFileSync(prefsPath, "utf-8");
				expect(() => JSON.parse(raw)).not.toThrow();
			} finally {
				cleanupDir(dir);
			}
		},
	);

	testExclusive("H19: updatePreference creates file when missing", () => {
		const dir = makeTempDir("corsa-h19-");
		const prefsPath = prefsPathForDir(dir);
		try {
			expect(fs.existsSync(prefsPath)).toBe(false);
			updatePreference("lineWrap", true, prefsPath);
			const prefs = loadPreferences(prefsPath);
			expect(prefs.lineWrap).toBe(true);
		} finally {
			cleanupDir(dir);
		}
	});

	testExclusive("H20: explicit xdgConfigHome overrides env XDG path", () => {
		const envDir = makeTempDir("corsa-h20-env-");
		const explicitDir = makeTempDir("corsa-h20-explicit-");
		try {
			withXdg(envDir, () => {
				const fromOptions = getPreferencesPath({ xdgConfigHome: explicitDir });
				expect(fromOptions).toBe(
					path.join(explicitDir, "corsa", "preferences.json"),
				);
			});
		} finally {
			cleanupDir(envDir);
			cleanupDir(explicitDir);
		}
	});
});
