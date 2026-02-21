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
 * Kill a process by PID.
 * On Unix, attempts to kill the entire process group first (negative PID),
 * which catches child processes spawned by the target. Falls back to killing
 * the individual PID if the process group kill fails (e.g. the process is
 * not a process group leader).
 */
export async function killProcess(
	pid: number,
	signal: "SIGTERM" | "SIGKILL" = "SIGTERM",
): Promise<boolean> {
	if (pid <= 0) return false;

	try {
		// Try process group kill first (negative PID signals all processes
		// in the group, catching child processes that would otherwise be orphaned)
		process.kill(-pid, signal);
		return true;
	} catch {
		try {
			// Fall back to individual PID kill
			process.kill(pid, signal);
			return true;
		} catch {
			return false;
		}
	}
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
