import { createHash } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isProcessRunning } from "../processes/process-utils";

export interface CorsaInstance {
	id: string;
	projectDir: string;
	configPath: string;
	apiUrl: string;
	pid: number;
	startedAt: string;
}

interface RegistryData {
	version: number;
	instances: CorsaInstance[];
}

const DEFAULT_REGISTRY_PATH = join(tmpdir(), "corsa-instances.json");
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const HEALTH_CHECK_TIMEOUT_MS = 1000;

function getRegistryPath(): string {
	return process.env.CORSA_INSTANCE_REGISTRY_PATH ?? DEFAULT_REGISTRY_PATH;
}

function readRegistry(): RegistryData {
	const registryPath = getRegistryPath();
	if (!existsSync(registryPath)) {
		return { version: 1, instances: [] };
	}

	try {
		const data = JSON.parse(
			readFileSync(registryPath, "utf-8"),
		) as RegistryData;
		if (
			data &&
			typeof data.version === "number" &&
			Array.isArray(data.instances)
		) {
			return data;
		}
	} catch {
		// Corrupt registry files are treated as empty and overwritten on next save.
	}

	return { version: 1, instances: [] };
}

function writeRegistry(data: RegistryData): void {
	writeFileSync(getRegistryPath(), JSON.stringify(data, null, 2));
}

function shortHash(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function slug(value: string): string {
	const normalized = value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized || "project";
}

export function validateInstanceId(id: string): void {
	if (!ID_PATTERN.test(id)) {
		throw new Error(
			`Invalid corsa instance id "${id}". Use letters, numbers, dots, underscores, or hyphens, starting with a letter or number.`,
		);
	}
}

export function getProjectDirForConfig(configPath: string): string {
	return dirname(resolve(configPath));
}

export function deriveInstanceId(configPath: string): string {
	const projectDir = getProjectDirForConfig(configPath);
	return `${slug(projectDir.split(/[\\/]/).filter(Boolean).pop() ?? "project")}-${shortHash(projectDir)}`;
}

export function createInstanceMetadata(options: {
	configPath: string;
	id?: string;
	apiUrl: string;
	pid?: number;
	startedAt?: string;
}): CorsaInstance {
	const configPath = resolve(options.configPath);
	const id = options.id ?? deriveInstanceId(configPath);
	validateInstanceId(id);

	return {
		id,
		projectDir: getProjectDirForConfig(configPath),
		configPath,
		apiUrl: options.apiUrl,
		pid: options.pid ?? process.pid,
		startedAt: options.startedAt ?? new Date().toISOString(),
	};
}

export function registerInstance(instance: CorsaInstance): void {
	validateInstanceId(instance.id);
	const registry = readRegistry();
	registry.instances = registry.instances.filter(
		(existing) =>
			existing.id !== instance.id && existing.apiUrl !== instance.apiUrl,
	);
	registry.instances.push(instance);
	writeRegistry(registry);
}

export function unregisterInstance(id: string): void {
	const registry = readRegistry();
	const next = registry.instances.filter((instance) => instance.id !== id);
	if (next.length === 0) {
		try {
			unlinkSync(getRegistryPath());
		} catch {
			// Ignore missing registry files.
		}
		return;
	}

	writeRegistry({ ...registry, instances: next });
}

async function isInstanceHealthy(instance: CorsaInstance): Promise<boolean> {
	if (!(await isProcessRunning(instance.pid))) return false;

	try {
		const response = await fetch(`${instance.apiUrl}/api/health`, {
			signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
		});
		if (!response.ok) return false;
		const json = (await response.json()) as {
			ok?: boolean;
			data?: { instance?: { id?: string } };
		};
		return json.ok === true && json.data?.instance?.id === instance.id;
	} catch {
		return false;
	}
}

export async function listLiveInstances(): Promise<CorsaInstance[]> {
	const registry = readRegistry();
	const live: CorsaInstance[] = [];

	for (const instance of registry.instances) {
		if (await isInstanceHealthy(instance)) {
			live.push(instance);
		}
	}

	if (live.length !== registry.instances.length) {
		if (live.length === 0) {
			try {
				unlinkSync(getRegistryPath());
			} catch {
				// Ignore missing registry files.
			}
		} else {
			writeRegistry({ ...registry, instances: live });
		}
	}

	return live;
}
