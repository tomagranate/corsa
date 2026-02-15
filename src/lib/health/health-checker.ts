import type { HealthStatus, ToolConfig, ToolHealthState } from "../../types";

/** Default interval between health checks in milliseconds */
const DEFAULT_INTERVAL = 3000;

/** Default number of retries before declaring unhealthy */
const DEFAULT_RETRIES = 3;

/** Timeout for health check requests in milliseconds */
const FETCH_TIMEOUT = 3000;

export type HealthStateMap = Map<string, ToolHealthState>;

export type HealthChangeCallback = (
	toolName: string,
	state: ToolHealthState,
) => void;

/**
 * HealthChecker manages periodic health checks for tools with configured health endpoints.
 * It tracks health status and supports immediate checks when process status changes.
 */
export class HealthChecker {
	private healthStates: HealthStateMap = new Map();
	private intervals: Map<string, ReturnType<typeof setInterval>> = new Map();
	private tools: ToolConfig[] = [];
	private onChangeCallbacks: Set<HealthChangeCallback> = new Set();

	/**
	 * Initialize the health checker with a list of tools.
	 * Only tools with healthCheck configured will be tracked.
	 * Clears any existing health states when reinitializing.
	 */
	initialize(tools: ToolConfig[]): void {
		this.tools = tools;

		// Clear existing health states to avoid stale data on reload
		this.healthStates.clear();

		// Initialize health state for tools with health checks
		for (const tool of tools) {
			if (tool.healthCheck) {
				this.healthStates.set(tool.name, {
					status: "starting",
					failureCount: 0,
				});
			}
		}
	}

	/**
	 * Start health checks for all configured tools.
	 */
	start(): void {
		for (const tool of this.tools) {
			if (tool.healthCheck) {
				this.startToolHealthCheck(tool);
			}
		}
	}

	/**
	 * Stop all health checks and clean up intervals.
	 */
	stop(): void {
		for (const interval of this.intervals.values()) {
			clearInterval(interval);
		}
		this.intervals.clear();
	}

	/**
	 * Get the current health state for a tool.
	 */
	getHealthState(toolName: string): ToolHealthState | undefined {
		return this.healthStates.get(toolName);
	}

	/**
	 * Get all health states.
	 */
	getAllHealthStates(): HealthStateMap {
		return new Map(this.healthStates);
	}

	/**
	 * Register a callback to be notified when health state changes.
	 */
	onChange(callback: HealthChangeCallback): () => void {
		this.onChangeCallbacks.add(callback);
		return () => {
			this.onChangeCallbacks.delete(callback);
		};
	}

	/**
	 * Trigger an immediate health check for a specific tool.
	 * Useful when process status changes.
	 */
	async checkNow(toolName: string): Promise<void> {
		const tool = this.tools.find((t) => t.name === toolName);
		if (tool?.healthCheck) {
			await this.performHealthCheck(tool);
		}
	}

	/**
	 * Reset health state for a tool to "starting".
	 * Useful when a process restarts.
	 */
	resetHealthState(toolName: string): void {
		const currentState = this.healthStates.get(toolName);
		if (currentState) {
			const newState: ToolHealthState = {
				status: "starting",
				failureCount: 0,
			};
			this.healthStates.set(toolName, newState);
			this.notifyChange(toolName, newState);
		}
	}

	private startToolHealthCheck(tool: ToolConfig): void {
		if (!tool.healthCheck) return;

		const interval = tool.healthCheck.interval ?? DEFAULT_INTERVAL;

		// Perform initial check
		this.performHealthCheck(tool);

		// Set up periodic checks
		const intervalId = setInterval(() => {
			this.performHealthCheck(tool);
		}, interval);

		this.intervals.set(tool.name, intervalId);
	}

	private async performHealthCheck(tool: ToolConfig): Promise<void> {
		if (!tool.healthCheck) return;

		const { url, retries = DEFAULT_RETRIES } = tool.healthCheck;
		const currentState = this.healthStates.get(tool.name);

		if (!currentState) return;

		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

			const response = await fetch(url, {
				method: "GET",
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (response.ok) {
				// Success - mark as healthy
				const newState: ToolHealthState = {
					status: "healthy",
					failureCount: 0,
					lastCheck: Date.now(),
				};
				this.healthStates.set(tool.name, newState);

				if (currentState.status !== "healthy") {
					this.notifyChange(tool.name, newState);
				}
			} else {
				// Non-2xx response - count as failure
				this.handleFailure(tool.name, currentState, retries);
			}
		} catch {
			// Network error, timeout, etc. - count as failure
			this.handleFailure(tool.name, currentState, retries);
		}
	}

	private handleFailure(
		toolName: string,
		currentState: ToolHealthState,
		maxRetries: number,
	): void {
		const newFailureCount = currentState.failureCount + 1;

		let newStatus: HealthStatus;
		if (newFailureCount >= maxRetries) {
			// Exhausted retries - mark as unhealthy regardless of current state
			newStatus = "unhealthy";
		} else if (
			currentState.status === "starting" ||
			currentState.status === "healthy"
		) {
			// Still within retry window - keep current status.
			// For "starting": process hasn't come up yet, give it more time.
			// For "healthy": could be a transient failure (e.g., during restart),
			//   don't immediately mark unhealthy on a single failed check.
			newStatus = currentState.status;
		} else {
			// Already unhealthy, stay unhealthy
			newStatus = "unhealthy";
		}

		const newState: ToolHealthState = {
			status: newStatus,
			failureCount: newFailureCount,
			lastCheck: Date.now(),
		};

		this.healthStates.set(toolName, newState);

		if (currentState.status !== newStatus) {
			this.notifyChange(toolName, newState);
		}
	}

	private notifyChange(toolName: string, state: ToolHealthState): void {
		for (const callback of this.onChangeCallbacks) {
			callback(toolName, state);
		}
	}
}
