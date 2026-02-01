import { spawnSync } from "node:child_process";
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useCallback } from "react";
import packageJson from "../../../package.json";
import { getVersion } from "../../cli";
import { detectInstallMethod } from "../../commands/update";
import type { Theme } from "../../lib/theme";
import { type UpdateState, updateChecker } from "../../lib/update-checker";

interface AboutModalProps {
	/** Whether the modal is open */
	isOpen: boolean;
	/** Called when modal should close */
	onClose: () => void;
	/** Theme for styling */
	theme: Theme;
	/** Update state from the update checker */
	updateState: UpdateState;
	/** Path to the loaded config file (if any) */
	configPath?: string;
}

/**
 * Open a URL in the default browser
 */
function openUrl(url: string): void {
	const command =
		process.platform === "darwin"
			? "open"
			: process.platform === "win32"
				? "start"
				: "xdg-open";

	try {
		spawnSync(command, [url], { stdio: "ignore" });
	} catch {
		// Silently fail if browser can't be opened
	}
}

/** Info row component for consistent formatting */
function InfoRow({
	label,
	value,
	theme,
	valueColor,
}: {
	label: string;
	value: string;
	theme: Theme;
	valueColor?: string;
}) {
	const { colors } = theme;
	return (
		<box height={1} paddingLeft={2} paddingRight={2} flexDirection="row">
			<text fg={colors.textDim}>{label.padEnd(10)}</text>
			<text fg={valueColor ?? colors.text}>{value}</text>
		</box>
	);
}

/** Clickable link row component */
function LinkRow({
	label,
	displayValue,
	url,
	theme,
}: {
	label: string;
	displayValue: string;
	url: string;
	theme: Theme;
}) {
	const { colors } = theme;
	return (
		<box height={1} paddingLeft={2} paddingRight={2} flexDirection="row">
			<text fg={colors.textDim}>{label.padEnd(10)}</text>
			<text
				fg={colors.accent}
				attributes={TextAttributes.UNDERLINE}
				{...({
					onMouseDown: () => openUrl(url),
				} as Record<string, unknown>)}
			>
				{displayValue}
			</text>
		</box>
	);
}

export function AboutModal({
	isOpen,
	onClose,
	theme,
	updateState,
	configPath,
}: AboutModalProps) {
	const { colors } = theme;
	const { width: terminalWidth, height: terminalHeight } =
		useTerminalDimensions();

	const handleClose = useCallback(() => {
		onClose();
	}, [onClose]);

	// Handle keyboard input
	useKeyboard((key) => {
		if (!isOpen) return;

		if (
			key.name === "escape" ||
			(key.ctrl && key.name === "c") ||
			key.name === "return" ||
			key.name === "q"
		) {
			key.preventDefault?.();
			key.stopPropagation?.();
			handleClose();
			return;
		}
	});

	if (!isOpen) {
		return null;
	}

	const currentVersion = getVersion();
	const repoUrl = updateChecker.getRepoUrl();
	const issuesUrl = updateChecker.getIssuesUrl();

	// Installation method - format nicely for display
	const installMethod = detectInstallMethod();
	const installMethodDisplay: Record<string, string> = {
		npm: "npm",
		pnpm: "pnpm",
		bun: "bun",
		yarn: "yarn",
		brew: "Homebrew",
		direct: "Binary",
		development: "Development",
		unknown: "Unknown",
	};
	const installedVia = installMethodDisplay[installMethod] ?? "Unknown";

	// Config path - resolve to absolute path, then show with ~ for home dir
	const homeDir = process.env.HOME || "";
	const absoluteConfigPath = configPath
		? configPath.startsWith("/")
			? configPath
			: `${process.cwd()}/${configPath}`
		: null;
	const displayConfigPath = absoluteConfigPath
		? absoluteConfigPath.startsWith(homeDir)
			? `~${absoluteConfigPath.slice(homeDir.length)}`
			: absoluteConfigPath
		: "default";

	// Calculate modal dimensions
	const modalWidth = Math.min(50, terminalWidth - 4);
	const modalHeight = Math.min(18, terminalHeight - 4);

	// Truncate URLs to fit modal width
	const maxUrlWidth = modalWidth - 14; // 10 for label + 4 for padding
	const truncateUrl = (url: string) => {
		// Remove https:// prefix for display
		const shortUrl = url.replace(/^https?:\/\//, "");
		if (shortUrl.length > maxUrlWidth) {
			return `${shortUrl.slice(0, maxUrlWidth - 1)}…`;
		}
		return shortUrl;
	};

	return (
		<box
			position="absolute"
			top={0}
			left={0}
			width="100%"
			height="100%"
			justifyContent="center"
			alignItems="center"
			zIndex={2000}
		>
			{/* Modal container */}
			<box
				width={modalWidth}
				height={modalHeight}
				flexDirection="column"
				backgroundColor={colors.surface2}
			>
				{/* Header */}
				<box
					paddingLeft={1}
					paddingRight={1}
					backgroundColor={colors.accent}
					flexDirection="row"
					justifyContent="space-between"
				>
					<text attributes={TextAttributes.BOLD} fg={colors.accentForeground}>
						About corsa
					</text>
					<text
						fg={colors.accentForeground}
						attributes={TextAttributes.BOLD}
						{...({
							onMouseDown: handleClose,
						} as Record<string, unknown>)}
					>
						x
					</text>
				</box>

				{/* Content */}
				<box
					flexGrow={1}
					flexDirection="column"
					backgroundColor={colors.surface2}
					paddingTop={1}
				>
					{/* Version */}
					<InfoRow label="Version" value={currentVersion} theme={theme} />

					{/* Update status */}
					{updateState.isUpdateAvailable && updateState.latestVersion && (
						<box
							height={1}
							paddingLeft={2}
							paddingRight={2}
							flexDirection="row"
						>
							<text fg={colors.textDim}>{"".padEnd(10)}</text>
							<text fg={colors.accent} attributes={TextAttributes.BOLD}>
								Update available: {updateState.latestVersion}
							</text>
						</box>
					)}

					{/* Spacer */}
					<box height={1} />

					{/* Description */}
					<box paddingLeft={2} paddingRight={2}>
						<text fg={colors.text}>{packageJson.description}</text>
					</box>

					{/* Spacer */}
					<box height={1} />

					{/* GitHub */}
					<LinkRow
						label="GitHub"
						displayValue={truncateUrl(repoUrl)}
						url={repoUrl}
						theme={theme}
					/>

					{/* Issues */}
					<LinkRow
						label="Issues"
						displayValue={truncateUrl(issuesUrl)}
						url={issuesUrl}
						theme={theme}
					/>

					{/* Spacer */}
					<box height={1} />

					{/* Installed via */}
					<InfoRow label="Via" value={installedVia} theme={theme} />

					{/* Config */}
					<InfoRow label="Config" value={displayConfigPath} theme={theme} />

					{/* License */}
					<InfoRow label="License" value="MIT" theme={theme} />
				</box>

				{/* Footer hint */}
				<box paddingLeft={1} paddingRight={1} backgroundColor={colors.surface1}>
					<text fg={colors.textDim}>Esc: close</text>
				</box>
			</box>
		</box>
	);
}
