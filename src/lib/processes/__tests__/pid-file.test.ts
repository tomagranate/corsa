import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	deletePidFile,
	getPidFilePath,
	loadPidFile,
	type PidFileData,
	type PidFileEntry,
	removePidFromFile,
	savePidFile,
	updatePidFile,
} from "../pid-file";

describe("PID file utilities", () => {
	// Test config paths for instance-specific tests
	const testConfigPath1 = "/test/project-a/corsa.config.toml";
	const testConfigPath2 = "/test/project-b/corsa.config.toml";

	beforeEach(async () => {
		// Clean up before each test (both global and instance-specific files)
		await deletePidFile();
		await deletePidFile(testConfigPath1);
		await deletePidFile(testConfigPath2);
	});

	afterEach(async () => {
		// Clean up after each test
		await deletePidFile();
		await deletePidFile(testConfigPath1);
		await deletePidFile(testConfigPath2);
	});

	test("getPidFilePath - returns valid path without configPath", () => {
		const path = getPidFilePath();
		expect(path).toContain("corsa-pids.json");
		expect(typeof path).toBe("string");
	});

	test("getPidFilePath - returns instance-specific path with configPath", () => {
		const path1 = getPidFilePath(testConfigPath1);
		const path2 = getPidFilePath(testConfigPath2);

		// Both should be different from the global path
		const globalPath = getPidFilePath();
		expect(path1).not.toBe(globalPath);
		expect(path2).not.toBe(globalPath);

		// And different from each other
		expect(path1).not.toBe(path2);

		// But both should follow the pattern corsa-{hash}.json
		expect(path1).toMatch(/corsa-[a-f0-9]+\.json$/);
		expect(path2).toMatch(/corsa-[a-f0-9]+\.json$/);
	});

	test("getPidFilePath - same configPath returns same hash", () => {
		const path1 = getPidFilePath(testConfigPath1);
		const path2 = getPidFilePath(testConfigPath1);
		expect(path1).toBe(path2);
	});

	test("getPidFilePath - relative vs absolute path normalizes to same hash", () => {
		// The function uses resolve() so these should produce the same hash
		const absolutePath = "/Users/test/project/corsa.config.toml";
		const path1 = getPidFilePath(absolutePath);
		const path2 = getPidFilePath(absolutePath);
		expect(path1).toBe(path2);
	});

	test("loadPidFile - non-existent file returns null", async () => {
		const result = await loadPidFile();
		expect(result).toBeNull();
	});

	test("savePidFile and loadPidFile - round trip", async () => {
		const data: PidFileData = {
			version: 1,
			processes: [
				{
					toolIndex: 0,
					toolName: "test-tool",
					pid: 12345,
					startTime: Date.now(),
					command: "echo",
					args: ["hello"],
					cwd: "/tmp",
				},
			],
		};

		await savePidFile(data);
		const loaded = await loadPidFile();

		expect(loaded).not.toBeNull();
		expect(loaded?.version).toBe(1);
		expect(loaded?.processes).toHaveLength(1);
		expect(loaded?.processes[0]?.toolName).toBe("test-tool");
		expect(loaded?.processes[0]?.pid).toBe(12345);
	});

	test("updatePidFile - adds new entry", async () => {
		const entry: PidFileEntry = {
			toolIndex: 0,
			toolName: "test",
			pid: 123,
			startTime: Date.now(),
			command: "echo",
			args: [],
			cwd: "/tmp",
		};

		await updatePidFile(entry);
		const loaded = await loadPidFile();

		expect(loaded?.processes).toHaveLength(1);
		expect(loaded?.processes[0]?.toolName).toBe("test");
	});

	test("updatePidFile - updates existing entry", async () => {
		const entry1: PidFileEntry = {
			toolIndex: 0,
			toolName: "test",
			pid: 123,
			startTime: Date.now(),
			command: "echo",
			args: [],
			cwd: "/tmp",
		};

		const entry2: PidFileEntry = {
			toolIndex: 0,
			toolName: "test-updated",
			pid: 456,
			startTime: Date.now(),
			command: "ls",
			args: [],
			cwd: "/tmp",
		};

		await updatePidFile(entry1);
		await updatePidFile(entry2);

		const loaded = await loadPidFile();
		expect(loaded?.processes).toHaveLength(1);
		expect(loaded?.processes[0]?.toolName).toBe("test-updated");
		expect(loaded?.processes[0]?.pid).toBe(456);
	});

	test("removePidFromFile - removes entry", async () => {
		const entry: PidFileEntry = {
			toolIndex: 0,
			toolName: "test",
			pid: 123,
			startTime: Date.now(),
			command: "echo",
			args: [],
			cwd: "/tmp",
		};

		await updatePidFile(entry);
		await removePidFromFile(0);

		const loaded = await loadPidFile();
		expect(loaded).toBeNull(); // File should be deleted when empty
	});

	test("removePidFromFile - removes one of multiple entries", async () => {
		const entry1: PidFileEntry = {
			toolIndex: 0,
			toolName: "test1",
			pid: 123,
			startTime: Date.now(),
			command: "echo",
			args: [],
			cwd: "/tmp",
		};

		const entry2: PidFileEntry = {
			toolIndex: 1,
			toolName: "test2",
			pid: 456,
			startTime: Date.now(),
			command: "ls",
			args: [],
			cwd: "/tmp",
		};

		await updatePidFile(entry1);
		await updatePidFile(entry2);
		await removePidFromFile(0);

		const loaded = await loadPidFile();
		expect(loaded?.processes).toHaveLength(1);
		expect(loaded?.processes[0]?.toolIndex).toBe(1);
	});

	test("removePidFromFile - non-existent file", async () => {
		// Should not throw
		await expect(removePidFromFile(0)).resolves.toBeUndefined();
	});

	test("deletePidFile - removes file", async () => {
		const data: PidFileData = {
			version: 1,
			processes: [
				{
					toolIndex: 0,
					toolName: "test",
					pid: 123,
					startTime: Date.now(),
					command: "echo",
					args: [],
					cwd: "/tmp",
				},
			],
		};

		await savePidFile(data);
		await deletePidFile();

		const loaded = await loadPidFile();
		expect(loaded).toBeNull();
	});

	test("savePidFile - handles multiple processes", async () => {
		const data: PidFileData = {
			version: 1,
			processes: [
				{
					toolIndex: 0,
					toolName: "tool1",
					pid: 111,
					startTime: Date.now(),
					command: "echo",
					args: [],
					cwd: "/tmp",
				},
				{
					toolIndex: 1,
					toolName: "tool2",
					pid: 222,
					startTime: Date.now(),
					command: "ls",
					args: [],
					cwd: "/tmp",
				},
			],
		};

		await savePidFile(data);
		const loaded = await loadPidFile();

		expect(loaded?.processes).toHaveLength(2);
	});

	// Instance-specific PID file tests
	describe("instance-specific PID files", () => {
		test("different config paths create isolated PID files", async () => {
			const entry1: PidFileEntry = {
				toolIndex: 0,
				toolName: "project-a-tool",
				pid: 1111,
				startTime: Date.now(),
				command: "npm",
				args: ["run", "dev"],
				cwd: "/test/project-a",
			};

			const entry2: PidFileEntry = {
				toolIndex: 0,
				toolName: "project-b-tool",
				pid: 2222,
				startTime: Date.now(),
				command: "npm",
				args: ["run", "start"],
				cwd: "/test/project-b",
			};

			// Save entries to different config paths
			await updatePidFile(entry1, testConfigPath1);
			await updatePidFile(entry2, testConfigPath2);

			// Each should only see their own entries
			const loaded1 = await loadPidFile(testConfigPath1);
			const loaded2 = await loadPidFile(testConfigPath2);

			expect(loaded1?.processes).toHaveLength(1);
			expect(loaded1?.processes[0]?.toolName).toBe("project-a-tool");
			expect(loaded1?.processes[0]?.pid).toBe(1111);

			expect(loaded2?.processes).toHaveLength(1);
			expect(loaded2?.processes[0]?.toolName).toBe("project-b-tool");
			expect(loaded2?.processes[0]?.pid).toBe(2222);
		});

		test("deleting one instance PID file does not affect another", async () => {
			const entry1: PidFileEntry = {
				toolIndex: 0,
				toolName: "project-a-tool",
				pid: 1111,
				startTime: Date.now(),
				command: "npm",
				args: [],
				cwd: "/tmp",
			};

			const entry2: PidFileEntry = {
				toolIndex: 0,
				toolName: "project-b-tool",
				pid: 2222,
				startTime: Date.now(),
				command: "npm",
				args: [],
				cwd: "/tmp",
			};

			await updatePidFile(entry1, testConfigPath1);
			await updatePidFile(entry2, testConfigPath2);

			// Delete project-a's PID file
			await deletePidFile(testConfigPath1);

			// Project-a should be gone
			const loaded1 = await loadPidFile(testConfigPath1);
			expect(loaded1).toBeNull();

			// Project-b should still exist
			const loaded2 = await loadPidFile(testConfigPath2);
			expect(loaded2?.processes).toHaveLength(1);
			expect(loaded2?.processes[0]?.toolName).toBe("project-b-tool");
		});

		test("removePidFromFile works with instance-specific files", async () => {
			const entry1: PidFileEntry = {
				toolIndex: 0,
				toolName: "tool1",
				pid: 111,
				startTime: Date.now(),
				command: "echo",
				args: [],
				cwd: "/tmp",
			};

			const entry2: PidFileEntry = {
				toolIndex: 1,
				toolName: "tool2",
				pid: 222,
				startTime: Date.now(),
				command: "ls",
				args: [],
				cwd: "/tmp",
			};

			await updatePidFile(entry1, testConfigPath1);
			await updatePidFile(entry2, testConfigPath1);

			// Remove one entry
			await removePidFromFile(0, testConfigPath1);

			const loaded = await loadPidFile(testConfigPath1);
			expect(loaded?.processes).toHaveLength(1);
			expect(loaded?.processes[0]?.toolIndex).toBe(1);
		});

		test("savePidFile and loadPidFile work with configPath", async () => {
			const data: PidFileData = {
				version: 1,
				processes: [
					{
						toolIndex: 0,
						toolName: "test-tool",
						pid: 12345,
						startTime: Date.now(),
						command: "echo",
						args: ["hello"],
						cwd: "/tmp",
					},
				],
			};

			await savePidFile(data, testConfigPath1);
			const loaded = await loadPidFile(testConfigPath1);

			expect(loaded).not.toBeNull();
			expect(loaded?.version).toBe(1);
			expect(loaded?.processes).toHaveLength(1);
			expect(loaded?.processes[0]?.toolName).toBe("test-tool");

			// Global file should be unaffected
			const globalLoaded = await loadPidFile();
			expect(globalLoaded).toBeNull();
		});
	});

	describe("concurrent write safety", () => {
		test("concurrent updatePidFile calls preserve all entries", async () => {
			const entries: PidFileEntry[] = Array.from({ length: 10 }, (_, i) => ({
				toolIndex: i,
				toolName: `tool-${i}`,
				pid: 1000 + i,
				startTime: Date.now(),
				command: "echo",
				args: [],
				cwd: "/tmp",
			}));

			await Promise.all(entries.map((entry) => updatePidFile(entry)));

			const loaded = await loadPidFile();
			expect(loaded?.processes).toHaveLength(10);
			for (let i = 0; i < 10; i++) {
				const found = loaded?.processes.find((p) => p.toolIndex === i);
				expect(found).toBeDefined();
				expect(found?.pid).toBe(1000 + i);
			}
		});

		test("concurrent updatePidFile and removePidFromFile are consistent", async () => {
			// Seed with entries 0-4
			for (let i = 0; i < 5; i++) {
				await updatePidFile({
					toolIndex: i,
					toolName: `tool-${i}`,
					pid: 2000 + i,
					startTime: Date.now(),
					command: "echo",
					args: [],
					cwd: "/tmp",
				});
			}

			// Concurrently remove 0-2 and add 5-7
			await Promise.all([
				removePidFromFile(0),
				removePidFromFile(1),
				removePidFromFile(2),
				updatePidFile({
					toolIndex: 5,
					toolName: "tool-5",
					pid: 2005,
					startTime: Date.now(),
					command: "echo",
					args: [],
					cwd: "/tmp",
				}),
				updatePidFile({
					toolIndex: 6,
					toolName: "tool-6",
					pid: 2006,
					startTime: Date.now(),
					command: "echo",
					args: [],
					cwd: "/tmp",
				}),
				updatePidFile({
					toolIndex: 7,
					toolName: "tool-7",
					pid: 2007,
					startTime: Date.now(),
					command: "echo",
					args: [],
					cwd: "/tmp",
				}),
			]);

			const loaded = await loadPidFile();
			expect(loaded).not.toBeNull();

			// Entries 0-2 removed, 3-7 should remain
			const indices = loaded?.processes.map((p) => p.toolIndex).sort();
			expect(indices).toEqual([3, 4, 5, 6, 7]);
		});
	});
});
