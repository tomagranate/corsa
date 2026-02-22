import { TextAttributes } from "@opentui/core";
import { useEffect, useRef, useState } from "react";
import { StatusIcons } from "../../constants";
import type { Theme } from "../../lib/theme";
import type { ToolState } from "../../types";
import {
	calculateMinOffsetForTab,
	calculateTabExtraPadding,
	calculateVisibleTabs,
	canFitAllTabs,
	INDICATOR_WIDTH,
	truncateName,
} from "./tab-utils";

/** Home icon for the home tab */
const HOME_ICON = "⌂";

/** Calculate home tab width: icon + space + "Home" + padding (2+2) */
const HOME_TAB_WIDTH_BASE = 10; // "⌂ Home" (6) + padding (4)
const HOME_TAB_WIDTH_WITH_NUMBERS = 12; // Add "`:" (2) for tab numbers

interface TabBarProps {
	tools: ToolState[];
	activeIndex: number;
	onSelect: (index: number) => void;
	vertical?: boolean;
	theme: Theme;
	width?: number; // Terminal width for horizontal tab calculations
	showTabNumbers?: boolean; // Show 1-9 shortcuts on first 9 tabs
	navigationKey?: number; // Increment this when keyboard/shortcut navigation happens to trigger auto-scroll
	homeEnabled?: boolean; // Whether home tab is shown as first tab
}

export function TabBar({
	tools,
	activeIndex,
	onSelect,
	vertical = false,
	theme,
	width = 80,
	showTabNumbers = false,
	navigationKey = 0,
	homeEnabled = false,
}: TabBarProps) {
	const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
	const [scrollOffset, setScrollOffset] = useState(0); // First visible tab index
	const { colors } = theme;

	// Track whether the next activeIndex change should trigger auto-scroll
	// Set to true when navigation happens (keyboard or click), false after manual scroll
	const pendingNavigationRef = useRef(true);
	const lastActiveIndexRef = useRef(activeIndex);
	const lastNavigationKeyRef = useRef(navigationKey);
	const isInitialRenderRef = useRef(true);

	// Check if we need scrolling (not all tabs fit)
	const needsScrolling = !canFitAllTabs(tools, width, showTabNumbers);

	// Clamp scroll offset when tabs are removed (e.g., during shutdown)
	useEffect(() => {
		if (tools.length === 0) {
			setScrollOffset(0);
			return;
		}
		// Calculate the maximum valid offset (shows last tab at rightmost position)
		const maxOffset = calculateMinOffsetForTab(
			tools,
			tools.length - 1,
			width,
			showTabNumbers,
		);
		// If scroll offset is beyond the valid range, clamp it
		if (scrollOffset > maxOffset) {
			setScrollOffset(maxOffset);
		}
	}, [tools, width, showTabNumbers, scrollOffset]);

	// Calculate if we have tabs before/after the visible range
	const hasMoreLeft = scrollOffset > 0;

	// Calculate home tab width when it's visible (scrollOffset === 0)
	const homeTabWidth =
		homeEnabled && scrollOffset === 0
			? showTabNumbers
				? HOME_TAB_WIDTH_WITH_NUMBERS
				: HOME_TAB_WIDTH_BASE
			: 0;

	// Effective width for tool tabs (subtract home tab width when visible)
	const effectiveWidth = width - homeTabWidth;

	// Calculate visible tabs
	const { visibleIndices, lastVisibleIndex } = calculateVisibleTabs(
		tools,
		effectiveWidth,
		scrollOffset,
		needsScrolling,
		showTabNumbers,
	);

	const hasMoreRight = lastVisibleIndex < tools.length - 1;

	// Calculate extra padding to distribute among tabs to fill available space
	// Aims for equal-width tabs: shorter tabs get more padding
	const tabExtraPadding = calculateTabExtraPadding(
		tools,
		visibleIndices,
		effectiveWidth,
		needsScrolling,
		showTabNumbers,
	);

	// Auto-scroll to keep active tab visible (only when navigation triggered it)
	// Navigation is signaled by navigationKey changing
	// biome-ignore lint/correctness/useExhaustiveDependencies: scrollOffset and lastVisibleIndex are read from current render but not in deps - we only trigger on navigation events
	useEffect(() => {
		// Convert display activeIndex to tool array index
		// When home is enabled, activeIndex 0 = home, 1+ = tools
		// scrollOffset and lastVisibleIndex are tool array indices
		const toolActiveIndex = homeEnabled ? activeIndex - 1 : activeIndex;

		// Skip for vertical mode
		if (vertical) {
			return;
		}

		// On first horizontal render (including after remount from layout switch),
		// always scroll to show the active tab
		const isInitialRender = isInitialRenderRef.current;
		isInitialRenderRef.current = false;

		// Check if this is a navigation event (navigationKey changed)
		const isNavigation = navigationKey !== lastNavigationKeyRef.current;
		lastNavigationKeyRef.current = navigationKey;

		// Check if activeIndex actually changed
		const activeIndexChanged = activeIndex !== lastActiveIndexRef.current;
		lastActiveIndexRef.current = activeIndex;

		const shouldAutoScroll =
			isInitialRender ||
			(activeIndexChanged && (isNavigation || pendingNavigationRef.current));

		if (!isInitialRender && isNavigation && !activeIndexChanged) {
			pendingNavigationRef.current = true;
			return;
		}

		if (!shouldAutoScroll) {
			return;
		}

		// Reset the pending flag
		pendingNavigationRef.current = false;

		// Handle home tab selection (toolActiveIndex === -1 when homeEnabled and activeIndex === 0)
		// Home tab is only visible when scrollOffset === 0, so scroll there if needed
		if (toolActiveIndex < 0) {
			if (homeEnabled && scrollOffset > 0) {
				setScrollOffset(0);
			}
			return;
		}

		// Skip invalid tool indices
		if (toolActiveIndex >= tools.length) {
			return;
		}

		// Check if active tab is in the visible range [scrollOffset, lastVisibleIndex]
		// Use toolActiveIndex (tool array index) for comparison with scrollOffset/lastVisibleIndex
		const isActiveVisible =
			toolActiveIndex >= scrollOffset && toolActiveIndex <= lastVisibleIndex;

		if (!isActiveVisible) {
			// If active tab is before the visible range, scroll left to show it
			if (toolActiveIndex < scrollOffset) {
				setScrollOffset(toolActiveIndex);
			}
			// If active tab is after the visible range, scroll right
			else {
				const newOffset = calculateMinOffsetForTab(
					tools,
					toolActiveIndex,
					effectiveWidth,
					showTabNumbers,
				);
				setScrollOffset(newOffset);
			}
		}
	}, [
		activeIndex,
		navigationKey,
		tools,
		vertical,
		width,
		showTabNumbers,
		homeEnabled,
	]);

	// Scroll handlers - mark as manual scroll
	// Single step scroll (for wheel)
	const scrollLeftOne = () => {
		pendingNavigationRef.current = false;
		setScrollOffset((prev) => Math.max(0, prev - 1));
	};

	const scrollRightOne = () => {
		pendingNavigationRef.current = false;
		// Calculate max offset that still shows a full page (last tab at rightmost)
		const maxOffset = calculateMinOffsetForTab(
			tools,
			tools.length - 1,
			width,
			showTabNumbers,
		);
		setScrollOffset((prev) => Math.min(maxOffset, prev + 1));
	};

	// Page scroll (for arrow buttons) - scroll by the number of visible tabs
	const pageLeft = () => {
		pendingNavigationRef.current = false;
		const pageSize = Math.max(1, visibleIndices.length);
		setScrollOffset((prev) => Math.max(0, prev - pageSize));
	};

	const pageRight = () => {
		pendingNavigationRef.current = false;
		const pageSize = Math.max(1, visibleIndices.length);
		// Calculate max offset that still shows a full page (last tab at rightmost)
		const maxOffset = calculateMinOffsetForTab(
			tools,
			tools.length - 1,
			width,
			showTabNumbers,
		);
		setScrollOffset((prev) => Math.min(maxOffset, prev + pageSize));
	};

	// Handle scroll events for scrolling (manual scroll) - single step
	const handleScroll = (direction: "up" | "down" | "left" | "right") => {
		pendingNavigationRef.current = false;
		// Treat down/right as scroll right, up/left as scroll left
		if (direction === "down" || direction === "right") {
			scrollRightOne();
		} else {
			scrollLeftOne();
		}
	};

	const getTabBackgroundColor = (index: number) => {
		if (index === activeIndex) {
			return colors.accent;
		}
		if (index === hoveredIndex) {
			return colors.accent; // Use same as active for hover
		}
		// Vertical sidebar uses surface1, horizontal uses surface0
		return vertical ? colors.surface1 : colors.surface0;
	};

	const getStatusIcon = (status: ToolState["status"]) => {
		switch (status) {
			case "running":
				return `${StatusIcons.RUNNING} `;
			case "shuttingDown":
				return `${StatusIcons.WARNING} `;
			case "error":
				return `${StatusIcons.ERROR} `;
			case "waiting":
				return `${StatusIcons.WAITING} `;
			default:
				return `${StatusIcons.STOPPED} `;
		}
	};

	const getTabTextColor = (tool: ToolState, index: number) => {
		if (index === activeIndex) {
			return colors.accentForeground;
		}
		switch (tool.status) {
			case "error":
				return colors.error;
			case "shuttingDown":
				return colors.warning;
			case "running":
				return colors.success;
			case "waiting":
				return colors.warning;
			default:
				return colors.text;
		}
	};

	if (vertical) {
		return (
			<scrollbox
				width={20}
				height="100%"
				paddingTop={1}
				paddingBottom={1}
				backgroundColor={colors.surface1}
			>
				{/* Home tab when enabled */}
				{homeEnabled && (
					<box
						key="home-tab"
						paddingLeft={2}
						paddingRight={2}
						paddingTop={0}
						paddingBottom={0}
						backgroundColor={
							activeIndex === 0
								? colors.accent
								: hoveredIndex === -10
									? colors.accent
									: colors.surface1
						}
						{...({
							onMouseDown: () => onSelect(0),
							onMouseEnter: () => setHoveredIndex(-10),
							onMouseLeave: () => setHoveredIndex(null),
						} as Record<string, unknown>)}
					>
						<text
							attributes={activeIndex === 0 ? TextAttributes.BOLD : 0}
							fg={activeIndex === 0 ? colors.accentForeground : colors.text}
						>
							{HOME_ICON} {showTabNumbers ? "`:" : ""}Home
						</text>
					</box>
				)}
				{/* Tool tabs */}
				{tools.map((tool, index) => {
					// When home is enabled, tool tabs start at index 1
					const tabIndex = homeEnabled ? index + 1 : index;
					return (
						<box
							key={`${tool.config.name}-${index}`}
							paddingLeft={2}
							paddingRight={2}
							paddingTop={0}
							paddingBottom={0}
							backgroundColor={getTabBackgroundColor(tabIndex)}
							{...({
								onMouseDown: () => onSelect(tabIndex),
								onMouseEnter: () => setHoveredIndex(tabIndex),
								onMouseLeave: () => setHoveredIndex(null),
							} as Record<string, unknown>)}
						>
							<text
								attributes={tabIndex === activeIndex ? TextAttributes.BOLD : 0}
								fg={getTabTextColor(tool, tabIndex)}
							>
								{getStatusIcon(tool.status)}
								{showTabNumbers && index < 9 ? `${index + 1}:` : ""}
								{tool.config.name}
							</text>
						</box>
					);
				})}
			</scrollbox>
		);
	}

	// Horizontal tab bar with custom scrolling
	return (
		<box
			height={3}
			width="100%"
			flexDirection="row"
			backgroundColor={colors.surface0}
			border
			borderStyle="single"
			borderColor={colors.textMuted}
			onMouseScroll={(event) => {
				if (event.scroll) {
					handleScroll(event.scroll.direction);
				}
			}}
		>
			{/* Left scroll indicator (or placeholder when at start but scrolling is needed) */}
			{needsScrolling && (
				<box
					width={INDICATOR_WIDTH}
					height={1}
					paddingLeft={1}
					paddingRight={1}
					backgroundColor={colors.surface0}
					{...({
						onMouseDown: hasMoreLeft ? pageLeft : undefined,
						onMouseEnter: hasMoreLeft ? () => setHoveredIndex(-1) : undefined,
						onMouseLeave: hasMoreLeft ? () => setHoveredIndex(null) : undefined,
					} as Record<string, unknown>)}
				>
					<text
						fg={
							hasMoreLeft
								? hoveredIndex === -1
									? colors.accentForeground
									: colors.text
								: colors.surface0
						}
					>
						{hasMoreLeft ? "◀" : " "}
					</text>
				</box>
			)}

			{/* Home tab when enabled (always visible, before tool tabs) */}
			{homeEnabled && scrollOffset === 0 && (
				<box
					key="home-tab"
					paddingLeft={2}
					paddingRight={2}
					paddingTop={0}
					paddingBottom={0}
					backgroundColor={
						activeIndex === 0
							? colors.accent
							: hoveredIndex === -10
								? colors.accent
								: colors.surface0
					}
					{...({
						onMouseDown: () => {
							pendingNavigationRef.current = true;
							onSelect(0);
						},
						onMouseEnter: () => setHoveredIndex(-10),
						onMouseLeave: () => setHoveredIndex(null),
					} as Record<string, unknown>)}
				>
					<text
						attributes={activeIndex === 0 ? TextAttributes.BOLD : 0}
						fg={activeIndex === 0 ? colors.accentForeground : colors.text}
					>
						{HOME_ICON} {showTabNumbers ? "`:" : ""}Home
					</text>
				</box>
			)}

			{/* Visible tool tabs */}
			{visibleIndices.map((index, i) => {
				const tool = tools[index];
				if (!tool) return null;
				const extraPadding = tabExtraPadding[i] ?? 0;
				// Split extra padding for center alignment
				const extraLeft = Math.floor(extraPadding / 2);
				const extraRight = extraPadding - extraLeft;
				// When home is enabled, tool tabs start at index 1
				const tabIndex = homeEnabled ? index + 1 : index;
				return (
					<box
						key={`${tool.config.name}-${index}`}
						paddingLeft={2 + extraLeft}
						paddingRight={2 + extraRight}
						paddingTop={0}
						paddingBottom={0}
						backgroundColor={getTabBackgroundColor(tabIndex)}
						{...({
							onMouseDown: () => {
								pendingNavigationRef.current = true;
								onSelect(tabIndex);
							},
							onMouseEnter: () => setHoveredIndex(tabIndex),
							onMouseLeave: () => setHoveredIndex(null),
						} as Record<string, unknown>)}
					>
						<text
							attributes={tabIndex === activeIndex ? TextAttributes.BOLD : 0}
							fg={getTabTextColor(tool, tabIndex)}
						>
							{getStatusIcon(tool.status)}
							{showTabNumbers && index < 9 ? `${index + 1}:` : ""}
							{truncateName(tool.config.name)}
						</text>
					</box>
				);
			})}

			{/* Right scroll indicator (or placeholder when at end but scrolling is needed) */}
			{needsScrolling && (
				<box
					width={INDICATOR_WIDTH}
					height={1}
					paddingLeft={1}
					paddingRight={1}
					backgroundColor={colors.surface0}
					{...({
						onMouseDown: hasMoreRight ? pageRight : undefined,
						onMouseEnter: hasMoreRight ? () => setHoveredIndex(-2) : undefined,
						onMouseLeave: hasMoreRight
							? () => setHoveredIndex(null)
							: undefined,
					} as Record<string, unknown>)}
				>
					<text
						fg={
							hasMoreRight
								? hoveredIndex === -2
									? colors.accentForeground
									: colors.text
								: colors.surface0
						}
					>
						{hasMoreRight ? "▶" : " "}
					</text>
				</box>
			)}
		</box>
	);
}
