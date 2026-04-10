import { describe, expect, test } from "bun:test";
import {
	isProcessRunning,
	killProcess,
	killProcessGracefully,
	signalProcessGroupOrPid,
} from "../process-utils";

describe("Process utilities", () => {
	test("isProcessRunning - invalid PID", async () => {
		expect(await isProcessRunning(0)).toBe(false);
		expect(await isProcessRunning(-1)).toBe(false);
	});

	test("isProcessRunning - current process", async () => {
		// Current process should always be running
		const result = await isProcessRunning(process.pid);
		expect(result).toBe(true);
	});

	test("isProcessRunning - non-existent PID", async () => {
		// Use a very large PID that's unlikely to exist
		const result = await isProcessRunning(999999999);
		expect(result).toBe(false);
	});

	test("signalProcessGroupOrPid - invalid PID", () => {
		expect(signalProcessGroupOrPid(0, "SIGTERM")).toBe(false);
		expect(signalProcessGroupOrPid(-1, "SIGTERM")).toBe(false);
	});

	test("signalProcessGroupOrPid - non-existent PID", () => {
		expect(signalProcessGroupOrPid(999999999, "SIGTERM")).toBe(false);
	});

	test("signalProcessGroupOrPid - refuses supervisor PID (avoid group self-kill)", () => {
		expect(signalProcessGroupOrPid(process.pid, "SIGTERM")).toBe(false);
	});

	test("killProcess - invalid PID", async () => {
		expect(await killProcess(0)).toBe(false);
		expect(await killProcess(-1)).toBe(false);
		expect(await killProcess(process.pid, "SIGTERM")).toBe(false);
	});

	test("killProcess - non-existent PID", async () => {
		// Killing a non-existent process should fail (return false)
		const result = await killProcess(999999999, "SIGTERM");
		expect(result).toBe(false);
	});

	test("killProcessGracefully - invalid PID", async () => {
		expect(await killProcessGracefully(0)).toBe(true); // Already dead
		expect(await killProcessGracefully(-1)).toBe(true); // Already dead
	});

	test("killProcessGracefully - non-existent PID", async () => {
		// Non-existent process should return true (already dead)
		const result = await killProcessGracefully(999999999);
		expect(result).toBe(true);
	});

	// Note: We don't test killing the current process as it would terminate the test runner
});
