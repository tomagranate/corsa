import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useMemo, useState } from "react";
import { StatusIcons } from "../../constants";
import type { ASCIIFontName, HomeConfig } from "../../lib/config";
import type { HealthStateMap } from "../../lib/health";
import type { Theme } from "../../lib/theme";
import { formatUptime } from "../../lib/time";
import type { HealthStatus, ToolState } from "../../types";
import { Spinner } from "../Spinner";

// Minimum card width for responsive grid
const MIN_CARD_WIDTH = 45;
// Width threshold for 2 columns (accounting for padding, borders, gap)
const TWO_COLUMN_THRESHOLD = MIN_CARD_WIDTH * 2 + 5;
// Width threshold for 3 columns
const THREE_COLUMN_THRESHOLD = MIN_CARD_WIDTH * 3 + 8;

interface HomeTabProps {
	tools: ToolState[];
	healthStates: HealthStateMap;
	config: HomeConfig;
	theme: Theme;
	sidebarWidth?: number;
	onToolSelect?: (toolIndex: number) => void;
	onRestartTool?: (toolIndex: number) => void;
	onStopTool?: (toolIndex: number) => void;
}

export function HomeTab({
	tools,
	healthStates,
	config,
	theme,
	sidebarWidth = 0,
	onToolSelect,
	onRestartTool,
	onStopTool,
}: HomeTabProps) {
	const { colors } = theme;
	const { width: terminalWidth } = useTerminalDimensions();
	const title = config.title ?? "Home";
	const titleFont = config.titleFont ?? "tiny";
	const titleAlign = config.titleAlign ?? "left";

	// Filter to only show tools with healthCheck, ui, or description configured
	const servicesWithFeatures = tools
		.map((tool, index) => ({ tool, index }))
		.filter(
			({ tool }) =>
				tool.config.healthCheck || tool.config.ui || tool.config.description,
		);

	// Calculate status counts for summary
	// Note: "waiting" tools are excluded from health-based counts (starting/unhealthy)
	// since they haven't started yet and health checks don't apply
	const statusCounts = {
		running: servicesWithFeatures.filter(
			({ tool }) => tool.status === "running",
		).length,
		waiting: servicesWithFeatures.filter(
			({ tool }) => tool.status === "waiting",
		).length,
		starting: servicesWithFeatures.filter(
			({ tool }) =>
				tool.status !== "waiting" &&
				tool.status !== "stopped" &&
				healthStates.get(tool.config.name)?.status === "starting",
		).length,
		unhealthy: servicesWithFeatures.filter(
			({ tool }) =>
				tool.status !== "waiting" &&
				tool.status !== "stopped" &&
				healthStates.get(tool.config.name)?.status === "unhealthy",
		).length,
		stopped: servicesWithFeatures.filter(
			({ tool }) => tool.status === "stopped" || tool.status === "error",
		).length,
	};

	// Calculate number of columns based on terminal width
	// Account for scrollbox padding (1 on each side = 2 total) and sidebar
	const availableWidth = terminalWidth - sidebarWidth - 4;
	const columnCount =
		availableWidth >= THREE_COLUMN_THRESHOLD
			? 3
			: availableWidth >= TWO_COLUMN_THRESHOLD
				? 2
				: 1;

	// Calculate fixed card width based on column count
	// Account for gaps between cards (1 char per gap)
	const gapWidth = columnCount > 1 ? columnCount - 1 : 0;
	const cardWidth = Math.floor((availableWidth - gapWidth) / columnCount);

	// Group services into rows for grid layout
	const serviceRows = useMemo(() => {
		const rows: Array<typeof servicesWithFeatures> = [];
		for (let i = 0; i < servicesWithFeatures.length; i += columnCount) {
			rows.push(servicesWithFeatures.slice(i, i + columnCount));
		}
		return rows;
	}, [servicesWithFeatures, columnCount]);

	return (
		<scrollbox
			flexGrow={1}
			height="100%"
			padding={1}
			backgroundColor={colors.surface0}
		>
			{/* ASCII Font Title */}
			<box
				marginBottom={1}
				width="100%"
				flexDirection="row"
				justifyContent={titleAlign === "center" ? "center" : "flex-start"}
			>
				<box>
					<ascii-font
						text={title}
						font={titleFont as ASCIIFontName}
						color={colors.accent}
					/>
				</box>
			</box>

			{/* Status Summary Bar */}
			{servicesWithFeatures.length > 0 && (
				<StatusSummary
					counts={statusCounts}
					theme={theme}
					centered={titleAlign === "center"}
				/>
			)}

			{/* Services Grid */}
			<box flexDirection="column" marginTop={1}>
				{serviceRows.map((row) => {
					// Use the first tool's name as a stable key for the row
					const rowKey = row[0]?.tool.config.name ?? "empty";
					const placeholderCount =
						columnCount > 1 && row.length < columnCount
							? columnCount - row.length
							: 0;

					return (
						<box
							key={`row-${rowKey}`}
							flexDirection="row"
							gap={1}
							marginBottom={columnCount > 1 ? 0 : undefined}
						>
							{row.map(({ tool, index }) => (
								<ServiceCard
									key={tool.config.name}
									tool={tool}
									toolIndex={index}
									healthState={healthStates.get(tool.config.name)}
									theme={theme}
									onSelect={() => onToolSelect?.(index)}
									onRestart={() => onRestartTool?.(index)}
									onStop={() => onStopTool?.(index)}
									width={cardWidth}
								/>
							))}
							{/* Add empty placeholder boxes to maintain grid alignment */}
							{placeholderCount > 0 &&
								Array.from({ length: placeholderCount }).map((_, i) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: placeholder boxes have no identity
									<box key={`${rowKey}-placeholder-${i}`} width={cardWidth} />
								))}
						</box>
					);
				})}

				{servicesWithFeatures.length === 0 && (
					<text fg={colors.textMuted}>
						No services with health checks, UI links, or descriptions
						configured.
					</text>
				)}
			</box>
		</scrollbox>
	);
}

interface StatusSummaryProps {
	counts: {
		running: number;
		waiting: number;
		starting: number;
		unhealthy: number;
		stopped: number;
	};
	theme: Theme;
	centered?: boolean;
}

function StatusSummary({ counts, theme, centered }: StatusSummaryProps) {
	const { colors } = theme;

	const parts: Array<{ count: number; label: string; color: string }> = [];

	if (counts.running > 0) {
		parts.push({
			count: counts.running,
			label: "running",
			color: colors.success,
		});
	}
	if (counts.waiting > 0) {
		parts.push({
			count: counts.waiting,
			label: "waiting",
			color: colors.warning,
		});
	}
	if (counts.starting > 0) {
		parts.push({
			count: counts.starting,
			label: "starting",
			color: colors.warning,
		});
	}
	if (counts.unhealthy > 0) {
		parts.push({
			count: counts.unhealthy,
			label: "unhealthy",
			color: colors.error,
		});
	}
	if (counts.stopped > 0) {
		parts.push({
			count: counts.stopped,
			label: "stopped",
			color: colors.textMuted,
		});
	}

	if (parts.length === 0) {
		return null;
	}

	return (
		<box
			height={1}
			flexDirection="row"
			justifyContent={centered ? "center" : "flex-start"}
		>
			{parts.map((part, i) => (
				<text key={part.label} fg={part.color}>
					{part.count} {part.label}
					{i < parts.length - 1 ? <span fg={colors.textMuted}> · </span> : null}
				</text>
			))}
		</box>
	);
}

interface ServiceCardProps {
	tool: ToolState;
	toolIndex: number;
	healthState?: { status: HealthStatus; failureCount: number };
	theme: Theme;
	onSelect?: () => void;
	onRestart?: () => void;
	onStop?: () => void;
	width?: number;
}

function ServiceCard({
	tool,
	healthState,
	theme,
	onSelect,
	onRestart,
	onStop,
	width,
}: ServiceCardProps) {
	const { colors } = theme;
	const hasHealthCheck = !!tool.config.healthCheck;
	const hasUI = !!tool.config.ui;
	const hasDescription = !!tool.config.description;
	const isRunning = tool.status === "running";

	// Calculate uptime if running
	const uptimeText =
		isRunning && tool.startTime ? formatUptime(tool.startTime) : null;

	return (
		<box
			border
			borderStyle="single"
			borderColor={colors.textMuted}
			backgroundColor={colors.surface0}
			marginBottom={1}
			paddingLeft={1}
			paddingRight={1}
			flexDirection="column"
			width={width}
		>
			{/* Content area - grows to push buttons to bottom */}
			<box flexDirection="column" flexGrow={1}>
				{/* Header: Name + Status */}
				<box flexDirection="row" height={1} alignItems="center">
					<box
						flexDirection="row"
						flexGrow={1}
						{...({
							onMouseDown: onSelect,
						} as Record<string, unknown>)}
					>
						<ProcessStatusIcon status={tool.status} theme={theme} />
						<text fg={colors.text} attributes={TextAttributes.BOLD}>
							{" "}
							{tool.config.name}
						</text>
						{uptimeText && <text fg={colors.textDim}> · {uptimeText}</text>}
					</box>

					{/* Health indicator on the right - show "waiting" when waiting for deps */}
					{/* Hide health state when process exited cleanly (stopped) */}
					{tool.status === "waiting" ? (
						<box>
							<text fg={colors.warning}>{StatusIcons.WAITING} waiting</text>
						</box>
					) : (
						tool.status !== "stopped" &&
						hasHealthCheck &&
						healthState && (
							<box>
								<HealthStatusIndicator
									status={healthState.status}
									theme={theme}
								/>
							</box>
						)
					)}
				</box>

				{/* Description */}
				{hasDescription && (
					<box marginTop={1}>
						<text fg={colors.textDim}>{tool.config.description}</text>
					</box>
				)}
			</box>

			{/* Action Buttons - stays at bottom */}
			<box flexDirection="row" gap={1} marginTop={1} height={3}>
				{/* UI Button */}
				{hasUI && tool.config.ui && (
					<UIButton
						label={tool.config.ui.label}
						url={tool.config.ui.url}
						theme={theme}
					/>
				)}

				{/* Restart Button */}
				<ActionButton label="Restart" theme={theme} onPress={onRestart} />

				{/* Stop Button - only show when running */}
				{isRunning && (
					<ActionButton
						label="Stop"
						theme={theme}
						variant="danger"
						onPress={onStop}
					/>
				)}
			</box>
		</box>
	);
}

interface ProcessStatusIconProps {
	status: ToolState["status"];
	theme: Theme;
}

function ProcessStatusIcon({ status, theme }: ProcessStatusIconProps) {
	const { colors } = theme;

	const getIconAndColor = () => {
		switch (status) {
			case "running":
				return { icon: StatusIcons.RUNNING, color: colors.success };
			case "shuttingDown":
				return { icon: StatusIcons.WARNING, color: colors.warning };
			case "error":
				return { icon: StatusIcons.ERROR, color: colors.error };
			case "waiting":
				return { icon: StatusIcons.WAITING, color: colors.warning };
			default:
				return { icon: StatusIcons.STOPPED, color: colors.textMuted };
		}
	};

	const { icon, color } = getIconAndColor();

	return <text fg={color}>{icon}</text>;
}

interface HealthStatusIndicatorProps {
	status: HealthStatus;
	theme: Theme;
}

function HealthStatusIndicator({ status, theme }: HealthStatusIndicatorProps) {
	const { colors } = theme;

	// Show spinner for starting
	if (status === "starting") {
		return <Spinner color={colors.warning} label="starting" />;
	}

	// Show "unhealthy" text for unhealthy
	if (status === "unhealthy") {
		return <text fg={colors.error}>✗ unhealthy</text>;
	}

	// Show "healthy" indicator
	return <text fg={colors.success}>✓ healthy</text>;
}

interface UIButtonProps {
	label: string;
	url: string;
	theme: Theme;
}

function UIButton({ label, url, theme }: UIButtonProps) {
	const { colors } = theme;
	const [hovered, setHovered] = useState(false);

	const openUrl = () => {
		// Use 'open' command on macOS to open URL in default browser
		Bun.spawn(["open", url], { stdout: "ignore", stderr: "ignore" });
	};

	return (
		<box
			height={3}
			border
			borderStyle="single"
			borderColor={hovered ? colors.accent : colors.textMuted}
			backgroundColor={hovered ? colors.surface1 : colors.surface0}
			paddingLeft={1}
			paddingRight={1}
			{...({
				onMouseDown: openUrl,
				onMouseEnter: () => setHovered(true),
				onMouseLeave: () => setHovered(false),
			} as Record<string, unknown>)}
		>
			<text fg={hovered ? colors.accent : colors.text}>
				<a href={url}>{label} →</a>
			</text>
		</box>
	);
}

interface ActionButtonProps {
	label: string;
	theme: Theme;
	variant?: "default" | "danger";
	onPress?: () => void;
}

function ActionButton({
	label,
	theme,
	variant = "default",
	onPress,
}: ActionButtonProps) {
	const { colors } = theme;
	const [hovered, setHovered] = useState(false);

	const normalColor = variant === "danger" ? colors.error : colors.textDim;
	const hoverColor = variant === "danger" ? colors.error : colors.accent;

	return (
		<box
			height={3}
			border
			borderStyle="single"
			borderColor={hovered ? hoverColor : colors.textMuted}
			backgroundColor={hovered ? colors.surface1 : colors.surface0}
			paddingLeft={1}
			paddingRight={1}
			{...({
				onMouseDown: onPress,
				onMouseEnter: () => setHovered(true),
				onMouseLeave: () => setHovered(false),
			} as Record<string, unknown>)}
		>
			<text fg={hovered ? hoverColor : normalColor}>{label}</text>
		</box>
	);
}
