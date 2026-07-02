import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "bun";
import { resolveApiUrl } from "../api-target";
import {
	createInstanceMetadata,
	deriveInstanceId,
	listLiveInstances,
	registerInstance,
	unregisterInstance,
	validateInstanceId,
} from "../instance-registry";

const registeredIds = new Set<string>();
const servers: Server<undefined>[] = [];
const registryPath = join(
	tmpdir(),
	`corsa-instance-registry-test-${process.pid}.json`,
);
process.env.CORSA_INSTANCE_REGISTRY_PATH = registryPath;

function startHealthServer(id: string): string {
	const server = Bun.serve({
		port: 0,
		fetch: (req) => {
			const url = new URL(req.url);
			if (url.pathname === "/api/health") {
				return Response.json({
					ok: true,
					data: {
						status: "healthy",
						instance: { id },
					},
				});
			}
			return Response.json({ ok: false, error: "Not found" }, { status: 404 });
		},
	});
	servers.push(server);
	return `http://localhost:${server.port}`;
}

function registerTestInstance(id: string): string {
	const apiUrl = startHealthServer(id);
	const instance = createInstanceMetadata({
		configPath: `/tmp/${id}/corsa.config.toml`,
		id,
		apiUrl,
	});
	registerInstance(instance);
	registeredIds.add(id);
	return apiUrl;
}

afterEach(() => {
	for (const id of registeredIds) {
		unregisterInstance(id);
	}
	registeredIds.clear();

	for (const server of servers.splice(0)) {
		server.stop();
	}
	rmSync(registryPath, { force: true });
});

describe("instance registry", () => {
	test("derives a stable project-directory id", () => {
		const id = deriveInstanceId("/tmp/project-a/corsa.config.toml");
		expect(id).toMatch(/^project-a-[a-f0-9]{8}$/);
		expect(id).toBe(deriveInstanceId("/tmp/project-a/other.toml"));
	});

	test("validates explicit ids", () => {
		expect(() => validateInstanceId("web-api_1")).not.toThrow();
		expect(() => validateInstanceId("-bad")).toThrow();
		expect(() => validateInstanceId("bad id")).toThrow();
	});

	test("lists live instances and prunes stale entries", async () => {
		registerTestInstance("corsa-test-live");
		registerInstance(
			createInstanceMetadata({
				configPath: "/tmp/corsa-test-stale/corsa.config.toml",
				id: "corsa-test-stale",
				apiUrl: "http://localhost:9",
				pid: 0,
			}),
		);
		registeredIds.add("corsa-test-stale");

		const instances = await listLiveInstances();
		expect(instances.map((instance) => instance.id)).toEqual([
			"corsa-test-live",
		]);
	});
});

describe("api target resolution", () => {
	test("uses CORSA_API_URL before registry lookup", async () => {
		const original = process.env.CORSA_API_URL;
		process.env.CORSA_API_URL = "http://localhost:12345";
		try {
			await expect(resolveApiUrl(undefined, "missing")).resolves.toBe(
				"http://localhost:12345",
			);
		} finally {
			if (original === undefined) {
				delete process.env.CORSA_API_URL;
			} else {
				process.env.CORSA_API_URL = original;
			}
		}
	});

	test("resolves a requested live instance id", async () => {
		const apiUrl = registerTestInstance("corsa-test-target");
		await expect(resolveApiUrl(undefined, "corsa-test-target")).resolves.toBe(
			apiUrl,
		);
	});

	test("requires an id when multiple live instances exist", async () => {
		registerTestInstance("corsa-test-a");
		registerTestInstance("corsa-test-b");

		await expect(resolveApiUrl()).rejects.toThrow(
			"Multiple live corsa instances found",
		);
	});
});
