import packageJson from "../../../package.json";
import type { Theme } from "../../lib/theme";

export type HelpBarMode =
	| "normal"
	| "search"
	| "commandPalette"
	| "shortcuts"
	| "shuttingDown"
	| "input"
	| "interactive";

interface HelpBarProps {
	theme: Theme;
	mode: HelpBarMode;
	/** Terminal width for responsive display */
	width: number;
	/** Whether to show the version branding (hidden in horizontal tab bar mode) */
	showVersion?: boolean;
	/** Whether an update is available */
	isUpdateAvailable?: boolean;
	/** Called when the update indicator is clicked */
	onUpdateClick?: () => void;
}

interface HintItem {
	/** Full key description */
	key: string;
	/** Compact key description */
	compactKey: string;
	/** Full action description */
	action: string;
	/** Compact action description */
	compactAction: string;
}

/**
 * Get hints based on current mode
 */
function getHintsForMode(mode: HelpBarMode): HintItem[] {
	switch (mode) {
		case "search":
			return [
				{
					key: "^F",
					compactKey: "^F",
					action: "fuzzy",
					compactAction: "fzy",
				},
				{
					key: "^H",
					compactKey: "^H",
					action: "filter",
					compactAction: "flt",
				},
				{
					key: "Enter",
					compactKey: "↵",
					action: "confirm",
					compactAction: "ok",
				},
				{ key: "Esc", compactKey: "⎋", action: "cancel", compactAction: "×" },
			];

		case "shuttingDown":
			return [
				{
					key: "Ctrl+C",
					compactKey: "^C",
					action: "force quit",
					compactAction: "quit",
				},
			];

		case "commandPalette":
		case "shortcuts":
			return [
				{
					key: "↑↓",
					compactKey: "↑↓",
					action: "navigate",
					compactAction: "nav",
				},
				{
					key: "Enter",
					compactKey: "↵",
					action: "select",
					compactAction: "sel",
				},
				{ key: "Esc", compactKey: "⎋", action: "close", compactAction: "×" },
			];

		case "input":
			return [
				{
					key: "Esc",
					compactKey: "⎋",
					action: "exit input",
					compactAction: "exit",
				},
				{
					key: "Enter",
					compactKey: "↵",
					action: "send newline",
					compactAction: "nl",
				},
			];

		case "interactive":
			return [
				{
					key: "i",
					compactKey: "i",
					action: "input",
					compactAction: "inp",
				},
				{
					key: "Ctrl+P",
					compactKey: "^P",
					action: "palette",
					compactAction: "cmd",
				},
				{
					key: "?",
					compactKey: "?",
					action: "shortcuts",
					compactAction: "keys",
				},
				{ key: "/", compactKey: "/", action: "search", compactAction: "find" },
			];

		default: {
			return [
				{
					key: "Ctrl+P",
					compactKey: "^P",
					action: "palette",
					compactAction: "cmd",
				},
				{
					key: "?",
					compactKey: "?",
					action: "shortcuts",
					compactAction: "keys",
				},
				{ key: "/", compactKey: "/", action: "search", compactAction: "find" },
			];
		}
	}
}

/**
 * Format hints into a display string based on available width
 */
export function formatHints(hints: HintItem[], availableWidth: number): string {
	// Try full format first: "key: action | key: action"
	const fullFormat = hints.map((h) => `${h.key}: ${h.action}`).join(" | ");
	if (fullFormat.length <= availableWidth) {
		return fullFormat;
	}

	// Try compact format: "key:action | key:action"
	const compactFormat = hints
		.map((h) => `${h.compactKey}:${h.compactAction}`)
		.join(" | ");
	if (compactFormat.length <= availableWidth) {
		return compactFormat;
	}

	// Ultra-compact: "key key key"
	const ultraCompact = hints.map((h) => h.compactKey).join(" ");
	if (ultraCompact.length <= availableWidth) {
		return ultraCompact;
	}

	// Truncate if still too long
	return `${ultraCompact.slice(0, availableWidth - 1)}…`;
}

export function HelpBar({
	theme,
	mode,
	width,
	showVersion = false,
	isUpdateAvailable = false,
	onUpdateClick,
}: HelpBarProps) {
	const { colors } = theme;

	const versionText = `corsa ${packageJson.version}`;
	const updateIndicator = isUpdateAvailable ? " (update!)" : "";
	const fullVersionText = versionText + updateIndicator;
	const versionWidth = showVersion ? fullVersionText.length + 2 : 0; // +2 for padding

	// Calculate available width for hints (accounting for version if shown)
	const hintsAvailableWidth = width - versionWidth;

	const hints = getHintsForMode(mode);
	const displayText = formatHints(hints, hintsAvailableWidth);

	// Calculate padding to center hints in the remaining space
	const hintsPadding = Math.max(
		0,
		Math.floor((hintsAvailableWidth - displayText.length) / 2),
	);
	const centeredHints = " ".repeat(hintsPadding) + displayText;

	return (
		<box
			height={1}
			width="100%"
			flexGrow={0}
			flexShrink={0}
			backgroundColor={colors.surface1}
			flexDirection="row"
			alignItems="center"
		>
			{showVersion && (
				<box flexDirection="row">
					<text fg={colors.textMuted}> {versionText}</text>
					{isUpdateAvailable && (
						<text
							fg={colors.accent}
							{...({
								onMouseDown: onUpdateClick,
							} as Record<string, unknown>)}
						>
							{updateIndicator}
						</text>
					)}
					<text fg={colors.textMuted}> </text>
				</box>
			)}
			<box flexGrow={1}>
				<text fg={colors.text}>{centeredHints}</text>
			</box>
		</box>
	);
}
