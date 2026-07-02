import { createHash, randomUUID } from "node:crypto";
import { rename, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export interface PidFileEntry {
	toolIndex: number;
	toolName: string;
	pid: number;
	startTime: number; // Unix timestamp
	command: string;
	args: string[];
	cwd: string;
}

export interface PidFileData {
	version: number;
	processes: PidFileEntry[];
}

/**
 * Simple async mutex to serialize PID file read-modify-write operations.
 * Without this, concurrent startTool calls race on the file and overwrite
 * each other's entries, causing PIDs to be silently lost.
 */
class PidFileMutex {
	private queue: (() => void)[] = [];
	private locked = false;

	async acquire(): Promise<void> {
		if (!this.locked) {
			this.locked = true;
			return;
		}
		return new Promise<void>((resolve) => {
			this.queue.push(resolve);
		});
	}

	release(): void {
		const next = this.queue.shift();
		if (next) {
			next();
		} else {
			this.locked = false;
		}
	}
}

const pidFileMutex = new PidFileMutex();

/**
 * Generate a short hash from a string for use in filenames.
 * Uses first 12 characters of SHA-256 hash for uniqueness while keeping filename reasonable.
 */
function hashConfigPath(configPath: string): string {
	const absolutePath = resolve(configPath);
	const hash = createHash("sha256").update(absolutePath).digest("hex");
	return hash.substring(0, 12);
}

/**
 * Get the path to the PID file in the OS temp directory.
 * When configPath is provided, generates an instance-specific filename to allow
 * multiple corsa instances (in different projects) to run simultaneously.
 *
 * @param configPath - Optional path to the config file. When provided, creates an
 *                     instance-specific PID file based on the config path hash.
 */
export function getPidFilePath(configPath?: string): string {
	const tempDir = tmpdir();
	if (configPath) {
		const hash = hashConfigPath(configPath);
		return join(tempDir, `corsa-${hash}.json`);
	}
	// Fallback for backward compatibility (no config path provided)
	return join(tempDir, "corsa-pids.json");
}

/**
 * Load and parse the PID file.
 * Returns null if file doesn't exist or is invalid.
 *
 * @param configPath - Optional config path for instance-specific PID file
 */
export async function loadPidFile(
	configPath?: string,
): Promise<PidFileData | null> {
	const filePath = getPidFilePath(configPath);

	try {
		const file = Bun.file(filePath);
		if (!(await file.exists())) {
			return null;
		}

		const content = await file.text();
		const data = JSON.parse(content) as PidFileData;

		// Validate structure
		if (
			typeof data === "object" &&
			data !== null &&
			typeof data.version === "number" &&
			Array.isArray(data.processes)
		) {
			return data;
		}

		return null;
	} catch {
		// File doesn't exist, is corrupted, or invalid JSON
		return null;
	}
}

/**
 * Save PID data to file atomically (write to temp file, then rename).
 *
 * @param data - The PID file data to save
 * @param configPath - Optional config path for instance-specific PID file
 */
export async function savePidFile(
	data: PidFileData,
	configPath?: string,
): Promise<void> {
	const filePath = getPidFilePath(configPath);
	const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;

	try {
		// Write to temp file first
		await Bun.write(tempPath, JSON.stringify(data, null, 2));

		// Atomic rename within the same directory.
		await rename(tempPath, filePath);
	} catch (error) {
		try {
			await unlink(tempPath);
		} catch {
			// Ignore cleanup errors.
		}
		throw new Error(`Failed to save PID file: ${error}`);
	}
}

/**
 * Delete the PID file.
 *
 * @param configPath - Optional config path for instance-specific PID file
 */
export async function deletePidFile(configPath?: string): Promise<void> {
	const filePath = getPidFilePath(configPath);
	try {
		await unlink(filePath);
	} catch {
		// Ignore errors (file may not exist)
	}
}

/**
 * Update PID file by adding or updating a process entry.
 * Serialized with a mutex to prevent concurrent writes from losing entries.
 *
 * @param entry - The process entry to add or update
 * @param configPath - Optional config path for instance-specific PID file
 */
export async function updatePidFile(
	entry: PidFileEntry,
	configPath?: string,
): Promise<void> {
	await pidFileMutex.acquire();
	try {
		const data = (await loadPidFile(configPath)) || {
			version: 1,
			processes: [],
		};

		// Remove existing entry for this toolIndex if it exists
		data.processes = data.processes.filter(
			(p) => p.toolIndex !== entry.toolIndex,
		);

		// Add new entry
		data.processes.push(entry);

		await savePidFile(data, configPath);
	} finally {
		pidFileMutex.release();
	}
}

/**
 * Remove a process entry from the PID file by toolIndex.
 * Serialized with a mutex to prevent concurrent writes from losing entries.
 *
 * @param toolIndex - The tool index to remove
 * @param configPath - Optional config path for instance-specific PID file
 */
export async function removePidFromFile(
	toolIndex: number,
	configPath?: string,
): Promise<void> {
	await pidFileMutex.acquire();
	try {
		const data = await loadPidFile(configPath);
		if (!data) return;

		data.processes = data.processes.filter((p) => p.toolIndex !== toolIndex);

		if (data.processes.length === 0) {
			await deletePidFile(configPath);
		} else {
			await savePidFile(data, configPath);
		}
	} finally {
		pidFileMutex.release();
	}
}
