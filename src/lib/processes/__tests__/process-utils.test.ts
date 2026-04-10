import { describe, expect, test } from "bun:test";
import {
	isProcessRunning,
	killProcess,
	killProcessGracefully,
	parsePsPpidAdjacency,
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

	test("parsePsPpidAdjacency - builds child map", () => {
		const adj = parsePsPpidAdjacency([" 10  1", " 20 10", " 30 10", " 40 20"]);
		expect(adj.get(1)).toEqual([10]);
		expect(adj.get(10)?.sort((a, b) => a - b)).toEqual([20, 30]);
		expect(adj.get(20)).toEqual([40]);
	});

	test("parsePsPpidAdjacency - skips bad lines", () => {
		const adj = parsePsPpidAdjacency(["", "not numbers", "  5  2"]);
		expect(adj.get(2)).toEqual([5]);
	});

	test("killProcess - invalid PID", async () => {
		expect(await killProcess(0)).toBe(false);
		expect(await killProcess(-1)).toBe(false);
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
