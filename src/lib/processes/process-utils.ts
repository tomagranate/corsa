/**
 * Check if a process with the given PID is still running.
 * Cross-platform implementation.
 */
export async function isProcessRunning(pid: number): Promise<boolean> {
	if (pid <= 0) return false;

	try {
		if (process.platform === "win32") {
			const proc = Bun.spawn(
				["tasklist", "/FI", `PID eq ${pid}`, "/FO", "CSV"],
				{
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const output = await new Response(proc.stdout).text();
			const lines = output.trim().split("\n");
			return lines.length > 1;
		} else {
			// kill -0 checks existence without sending a real signal
			const proc = Bun.spawn(["kill", "-0", pid.toString()], {
				stdout: "pipe",
				stderr: "pipe",
			});
			await proc.exited;
			return proc.exitCode === 0;
		}
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
		if (process.platform === "win32") {
			// /T flag kills the process tree (parent + children)
			const args = ["taskkill", "/PID", pid.toString(), "/T"];
			if (signal === "SIGKILL") args.push("/F");
			const proc = Bun.spawn(args, {
				stdout: "pipe",
				stderr: "pipe",
			});
			await proc.exited;
			return proc.exitCode === 0;
		} else {
			const signalFlag = signal === "SIGKILL" ? "-9" : "-15";

			// Try process group kill first (negative PID signals all processes
			// in the group, catching child processes that would otherwise be orphaned)
			const pgProc = Bun.spawn(["kill", signalFlag, `-${pid}`], {
				stdout: "pipe",
				stderr: "pipe",
			});
			await pgProc.exited;
			if (pgProc.exitCode === 0) return true;

			// Fall back to individual PID kill
			const proc = Bun.spawn(["kill", signalFlag, pid.toString()], {
				stdout: "pipe",
				stderr: "pipe",
			});
			await proc.exited;
			return proc.exitCode === 0;
		}
	} catch {
		return false;
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
