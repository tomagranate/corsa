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
