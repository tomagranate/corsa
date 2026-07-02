import { DEFAULT_MCP_HOSTNAME, DEFAULT_MCP_PORT } from "../api/api-server";
import { loadConfig } from "../config";
import { listLiveInstances } from "./instance-registry";

function formatInstanceList(
	instances: Awaited<ReturnType<typeof listLiveInstances>>,
): string {
	return instances
		.map((instance) => `- ${instance.id}: ${instance.projectDir}`)
		.join("\n");
}

export async function resolveApiUrl(
	configPath?: string,
	instanceId?: string,
): Promise<string> {
	const fromEnv = process.env.CORSA_API_URL;
	if (fromEnv) return fromEnv;

	const instances = await listLiveInstances();

	if (instanceId) {
		const match = instances.find((instance) => instance.id === instanceId);
		if (!match) {
			const suffix =
				instances.length > 0
					? `\n\nLive corsa instances:\n${formatInstanceList(instances)}`
					: "";
			throw new Error(
				`No live corsa instance found for id: ${instanceId}${suffix}`,
			);
		}
		return match.apiUrl;
	}

	if (instances.length === 1) {
		return instances[0]?.apiUrl ?? "";
	}

	if (instances.length > 1) {
		throw new Error(
			`Multiple live corsa instances found. Specify one with --id <id>.\n\n${formatInstanceList(instances)}`,
		);
	}

	try {
		const { config } = await loadConfig(configPath ?? "corsa.config.toml");
		const port = config.mcp?.port ?? DEFAULT_MCP_PORT;
		return `http://${DEFAULT_MCP_HOSTNAME}:${port}`;
	} catch {
		return `http://${DEFAULT_MCP_HOSTNAME}:${DEFAULT_MCP_PORT}`;
	}
}
