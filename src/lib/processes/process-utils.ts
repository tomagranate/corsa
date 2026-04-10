/**
 * Check if a process with the given PID is still running.
 * Uses signal 0 which checks existence without sending a real signal.
 */
export async function isProcessRunning(pid: number): Promise<boolean> {
	if (pid <= 0) return false;

	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Send a signal to a process group first (negative PID = PGID on Unix), then
 * fall back to the single process. This matches TTY job-control behaviour when
 * the child is its own process group leader: Ctrl-C targets the foreground
 * group, not only the parent wrapper (e.g. `zig build run` vs the game binary).
 *
 * On Windows, the group kill attempt fails and we only signal the direct PID.
 */
export function signalProcessGroupOrPid(
	pid: number,
	signal: NodeJS.Signals,
): boolean {
	if (pid <= 0) return false;

	try {
		process.kill(-pid, signal);
		return true;
	} catch {
		try {
			process.kill(pid, signal);
			return true;
		} catch {
			return false;
		}
	}
}

/**
 * Parse `ps` pid/ppid lines into an adjacency list (ppid -> child pids).
 * @internal Exported for unit tests.
 */
export function parsePsPpidAdjacency(lines: string[]): Map<number, number[]> {
	const childrenByPpid = new Map<number, number[]>();
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const parts = trimmed.split(/\s+/);
		if (parts.length < 2) continue;
		const pid = Number(parts[0]);
		const ppid = Number(parts[1]);
		if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
		const list = childrenByPpid.get(ppid) ?? [];
		list.push(pid);
		childrenByPpid.set(ppid, list);
	}
	return childrenByPpid;
}

/**
 * All descendant PIDs of `rootPid` (excluding `rootPid`), depth-first (leaves before ancestors).
 * Used when the supervised child is a wrapper (e.g. `zig build run`) and the real workload is
 * a child not in the same process group — `kill(-pid)` then only hits the wrapper.
 */
export function listDescendantPids(rootPid: number): number[] {
	if (rootPid <= 0) return [];
	if (process.platform === "win32") return [];

	const result = Bun.spawnSync(["ps", "-axo", "pid=,ppid="], {
		stdout: "pipe",
		stderr: "ignore",
	});
	if (result.exitCode !== 0) return [];

	const text = new TextDecoder().decode(result.stdout);
	const lines = text.split("\n");
	const childrenByPpid = parsePsPpidAdjacency(lines);

	const out: number[] = [];
	const seen = new Set<number>();
	const walk = (p: number) => {
		if (seen.has(p)) return;
		seen.add(p);
		for (const c of childrenByPpid.get(p) ?? []) {
			walk(c);
			out.push(c);
		}
	};
	walk(rootPid);
	return out;
}

/** Send `signal` to every descendant of `rootPid` (not including `rootPid`). No-op on Windows. */
export function signalDescendantProcesses(
	rootPid: number,
	signal: NodeJS.Signals,
): void {
	if (rootPid <= 0 || process.platform === "win32") return;
	for (const p of listDescendantPids(rootPid)) {
		try {
			process.kill(p, signal);
		} catch {
			// ignore
		}
	}
}

/**
 * Kill a process by PID (async wrapper for API compatibility).
 * @see {@link signalProcessGroupOrPid}
 */
export async function killProcess(
	pid: number,
	signal: "SIGTERM" | "SIGKILL" = "SIGTERM",
): Promise<boolean> {
	return signalProcessGroupOrPid(pid, signal);
}

/**
 * Kill a process gracefully, then force kill if it doesn't exit.
 * Returns true if process was killed (or already dead), false on error.
 */
export async function killProcessGracefully(
	pid: number,
	timeoutMs: number = 3000,
): Promise<boolean> {
	const isRunning = await isProcessRunning(pid);
	if (!isRunning) {
		return true;
	}

	const killed = await killProcess(pid, "SIGTERM");
	if (!killed) {
		return false;
	}

	const startTime = Date.now();
	while (Date.now() - startTime < timeoutMs) {
		const stillRunning = await isProcessRunning(pid);
		if (!stillRunning) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	return await killProcess(pid, "SIGKILL");
}
