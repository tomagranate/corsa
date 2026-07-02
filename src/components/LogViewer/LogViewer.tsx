import {
	MacOSScrollAccel,
	type ScrollBoxRenderable,
	type Selection,
	TextAttributes,
} from "@opentui/core";
import {
	useKeyboard,
	useRenderer,
	useTerminalDimensions,
} from "@opentui/react";
import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { copyToClipboard } from "../../lib/clipboard";
import {
	type FuzzyMatch,
	fuzzyFindLines,
	substringFindLines,
} from "../../lib/search";
import type { AnsiPalette, Theme } from "../../lib/theme";
import type { ToolState } from "../../types";

/**
 * Resolves the foreground color for a segment using the theme's ANSI palette.
 * If colorIndex is set (0-15), looks up from palette; otherwise uses color directly.
 */
function resolveRawFgColor(
	segment: { color?: string; colorIndex?: number },
	palette: AnsiPalette,
	fallback: string,
): string {
	if (segment.colorIndex !== undefined) {
		if (segment.colorIndex < 8) {
			return palette.standard[segment.colorIndex] ?? fallback;
		}
		return palette.bright[segment.colorIndex - 8] ?? fallback;
	}
	return segment.color ?? fallback;
}

/**
 * Resolves the background color for a segment using the theme's ANSI palette.
 */
function resolveRawBgColor(
	segment: { bgColor?: string; bgColorIndex?: number },
	palette: AnsiPalette,
): string | undefined {
	if (segment.bgColorIndex !== undefined) {
		if (segment.bgColorIndex < 8) {
			return palette.standard[segment.bgColorIndex];
		}
		return palette.bright[segment.bgColorIndex - 8];
	}
	return segment.bgColor;
}

/**
 * Resolves foreground and background colors for a segment, handling INVERSE attribute.
 * When INVERSE is set, foreground and background are swapped.
 */
function resolveSegmentColors(
	segment: {
		color?: string;
		colorIndex?: number;
		bgColor?: string;
		bgColorIndex?: number;
		attributes?: number;
	},
	palette: AnsiPalette,
	defaultFg: string,
	defaultBg: string,
): { fg: string; bg: string | undefined } {
	const rawFg = resolveRawFgColor(segment, palette, defaultFg);
	const rawBg = resolveRawBgColor(segment, palette);

	// Check if INVERSE attribute is set
	const isInverse = (segment.attributes ?? 0) & TextAttributes.INVERSE;

	if (isInverse) {
		// Swap foreground and background
		// If no background was set, use the default background for the new foreground
		return {
			fg: rawBg ?? defaultBg,
			bg: rawFg,
		};
	}

	return { fg: rawFg, bg: rawBg };
}

import { TextInput } from "../TextInput";
import { toast } from "../Toast";
import { lineHeightCacheStore } from "./LineHeightCacheStore";
import {
	calculateContentWidth,
	calculateScrollInfo,
	calculateVisibleRange,
	charWrapSegments,
	clipSegments,
	getLineNumberWidth,
	highlightSegmentsWithFuzzyIndices,
	highlightSegmentsWithSearch,
	LINE_NUMBER_WIDTH_THRESHOLD,
	shouldVirtualize,
	truncateSegments,
	type VisibleRange,
} from "./log-viewer-utils";
import { useScrollInfo } from "./useScrollInfo";

interface LogViewerProps {
	tool: ToolState;
	theme: Theme;
	searchMode: boolean;
	searchQuery: string;
	filterMode: boolean;
	fuzzyMode: boolean;
	currentMatchIndex: number;
	onSearchModeChange: (active: boolean) => void;
	onSearchQueryChange: (query: string) => void;
	onFilterModeChange: (filter: boolean) => void;
	onFuzzyModeChange: (fuzzy: boolean) => void;
	onCurrentMatchIndexChange: (index: number) => void;
	/** Control line number visibility: true = always, false = never, "auto" = based on terminal width */
	showLineNumbers?: boolean | "auto";
	/** Whether to wrap long lines (true) or truncate them (false) */
	lineWrap?: boolean;
	/** Width of sidebar (when in vertical layout mode), used for truncation calculation */
	sidebarWidth?: number;
	/** Whether the TUI is in input mode (forwarding keystrokes to process PTY) */
	inputMode?: boolean;
	/** Called when the scrollbox viewport size changes (for dynamic PTY sizing) */
	onViewportSize?: (cols: number, rows: number) => void;
}

export const LogViewer = React.memo(function LogViewer({
	tool,
	theme,
	searchMode,
	searchQuery,
	filterMode,
	fuzzyMode,
	currentMatchIndex,
	onSearchModeChange,
	onSearchQueryChange,
	onFilterModeChange,
	onFuzzyModeChange,
	onCurrentMatchIndexChange,
	showLineNumbers = "auto",
	lineWrap = true,
	sidebarWidth = 0,
	inputMode = false,
	onViewportSize,
}: LogViewerProps) {
	const { colors, ansiPalette } = theme;
	const scrollboxRef = useRef<ScrollBoxRenderable>(null);
	const renderer = useRenderer();
	const { width: terminalWidth, height: terminalHeight } =
		useTerminalDimensions();

	// VT mode: interactive tools always render from the virtual terminal.
	// The LineParser can't handle cursor movement / screen redraws, so for
	// interactive tools the VT is the only source of truth.
	// Search and line numbers are disabled in this mode.
	const useVTRendering =
		!!tool.config.interactive &&
		tool.screenLines !== undefined &&
		tool.screenLines.length > 0;

	// For interactive tools, poll the actual scrollbox viewport size and
	// report it to the ProcessManager so the PTY dimensions stay in sync.
	// This is the sole source of PTY sizing — no competing estimate exists.
	// Including terminalWidth/terminalHeight as deps ensures an immediate
	// check after every terminal resize (the interval is a fallback for
	// viewport changes not caused by terminal resizes, e.g. scrollbar).
	const isInteractive = !!tool.config.interactive;
	// biome-ignore lint/correctness/useExhaustiveDependencies: terminalWidth/terminalHeight are intentional triggers — they force an immediate viewport check after every terminal resize rather than waiting for the 50ms poll.
	useEffect(() => {
		if (!isInteractive || !onViewportSize) return;

		let lastW = 0;
		let lastH = 0;
		const check = () => {
			const vp = scrollboxRef.current?.viewport;
			const w = vp?.width ?? 0;
			const h = vp?.height ?? 0;
			if (w > 0 && (w !== lastW || h !== lastH)) {
				lastW = w;
				lastH = h;
				onViewportSize(w, h);
			}
		};
		check();
		const id = setInterval(check, 50);
		return () => clearInterval(id);
	}, [isInteractive, onViewportSize, terminalWidth, terminalHeight]);

	// Use the scroll info hook - only re-renders when scroll data actually changes
	const scrollData = useScrollInfo(scrollboxRef, 100);

	// Virtualization: track visible range with ref for hysteresis
	// Using ref instead of state to avoid render loops from spacer height changes
	const visibleRangeRef = useRef<{
		range: VisibleRange;
		cacheContentWidth: number; // Track which cache width the range was calculated for
		cacheLength: number; // Track cache length to detect new logs
		isFiltering: boolean; // Track filtering state to detect mode changes
	}>({
		range: { start: 0, end: 50, topSpacerHeight: 0, bottomSpacerHeight: 0 },
		cacheContentWidth: 0,
		cacheLength: 0,
		isFiltering: false,
	});

	// Flash state for copy feedback
	const [flashingLine, setFlashingLine] = useState<number | null>(null);

	// Double-click detection - tracks the PREVIOUS completed click
	const lastClickRef = useRef<{ lineIndex: number; time: number } | null>(null);
	const isDoubleClickRef = useRef(false);
	const DOUBLE_CLICK_THRESHOLD = 400; // ms

	// macOS-style scroll acceleration for smooth scrolling
	const scrollAcceleration = useMemo(() => new MacOSScrollAccel(), []);

	// Determine if line numbers should be shown (disabled in VT rendering mode)
	const shouldShowLineNumbers =
		!useVTRendering &&
		(showLineNumbers === true ||
			(showLineNumbers === "auto" &&
				terminalWidth >= LINE_NUMBER_WIDTH_THRESHOLD));

	// Convert logs to plain text with stderr metadata
	// For interactive tools, use screenLines from the virtual terminal
	// Note: tool.logs.length is intentionally included to detect array mutations
	// since the logs array reference stays the same when items are pushed
	// logTrimCount forces recalculation when old logs are trimmed (which shifts indices)
	const displaySource = useVTRendering ? (tool.screenLines ?? []) : tool.logs;
	// biome-ignore lint/correctness/useExhaustiveDependencies: length and trimCount detect array mutations
	const logLines = useMemo(
		() =>
			displaySource.map((logLine) => ({
				text: logLine.segments.map((segment) => segment.text).join(""),
				isStderr: logLine.isStderr ?? false,
			})),
		[displaySource, displaySource.length, tool.logTrimCount],
	);

	const totalLines = logLines.length;
	const lineNumberWidth = getLineNumberWidth(totalLines);

	// Extract just the text for searching
	const logTexts = useMemo(() => logLines.map((line) => line.text), [logLines]);

	// Find matching lines for search (fuzzy or substring)
	const fuzzyResults = useMemo<FuzzyMatch[]>(() => {
		if (!fuzzyMode || !searchQuery) return [];
		return fuzzyFindLines(logTexts, searchQuery);
	}, [logTexts, searchQuery, fuzzyMode]);

	// Create a map of line index -> highlight indices for fuzzy mode
	const fuzzyHighlightsMap = useMemo(() => {
		const map = new Map<number, number[]>();
		for (const result of fuzzyResults) {
			map.set(result.index, result.highlights);
		}
		return map;
	}, [fuzzyResults]);

	// Get matching line indices (from fuzzy results or substring search)
	const matchingLines = useMemo(() => {
		if (fuzzyMode) {
			return fuzzyResults.map((r) => r.index);
		}
		return substringFindLines(logTexts, searchQuery);
	}, [fuzzyMode, fuzzyResults, logTexts, searchQuery]);

	// Calculate available width for line content (for truncation when lineWrap is off)
	const contentWidth = calculateContentWidth({
		terminalWidth,
		sidebarWidth,
		showLineNumbers: shouldShowLineNumbers,
		lineNumberWidth,
	});

	// Determine if virtualization is enabled for this render
	const virtualizationEnabled = shouldVirtualize(totalLines);

	// Get or build line height cache from the shared store
	// This persists across tab switches, so we don't rebuild from scratch each time
	const lineHeightCache = useMemo(
		() =>
			lineHeightCacheStore.getOrBuildCache(
				tool.config.name,
				logTexts,
				contentWidth,
				lineWrap,
			),
		[tool.config.name, logTexts, contentWidth, lineWrap],
	);

	// Calculate the effective display count (filtered or full)
	// Needed early for scrollInfo and visibleRange calculations
	const displayCount =
		filterMode && searchQuery ? matchingLines.length : totalLines;

	// Whether we're in active filter mode (showing filtered results)
	const isFiltering =
		filterMode && searchQuery.length > 0 && matchingLines.length > 0;

	// Build a derived line height cache for filtered results
	// Maps filtered indices to cumulative row heights by looking up each matching line's height
	const filteredLineHeightCache = useMemo(() => {
		if (!isFiltering || !lineHeightCache) return null;

		const cumulativeRows: number[] = [];
		let totalRows = 0;
		const cacheLength = lineHeightCache.cumulativeRows.length;

		for (const originalIndex of matchingLines) {
			// Get the height of this line from the original cache
			// If the index is beyond the cache (new logs not yet cached), default to 1 row
			let lineHeight = 1;

			if (originalIndex < cacheLength) {
				// Index is within cache bounds - calculate actual height
				if (originalIndex === 0) {
					lineHeight = lineHeightCache.cumulativeRows[0] ?? 1;
				} else {
					const current = lineHeightCache.cumulativeRows[originalIndex] ?? 0;
					const previous =
						lineHeightCache.cumulativeRows[originalIndex - 1] ?? 0;
					lineHeight = Math.max(1, current - previous);
				}
			}

			totalRows += lineHeight;
			cumulativeRows.push(totalRows);
		}

		return {
			cumulativeRows,
			contentWidth: lineHeightCache.contentWidth,
			lineWrap: lineHeightCache.lineWrap,
		};
	}, [isFiltering, lineHeightCache, matchingLines]);

	// Compute scroll info (linesAbove/linesBelow) directly from scrollData
	// Use displayCount when filtering to show correct "X more" counts
	const scrollInfo = useMemo(
		() =>
			calculateScrollInfo({
				scrollTop: scrollData.scrollTop,
				viewportHeight: scrollData.viewportHeight,
				contentHeight: scrollData.contentHeight,
				totalLines: displayCount,
			}),
		[scrollData, displayCount],
	);

	// Compute visible range synchronously during render (no state, no effect)
	// Uses ref for hysteresis to prevent recalculating when viewport is within rendered range
	const visibleRange = useMemo(() => {
		const { scrollTop, viewportHeight, contentHeight } = scrollData;
		const lastRangeData = visibleRangeRef.current;
		const lastRange = lastRangeData.range;
		const firstVisibleLine = Math.floor(scrollTop);
		const lastVisibleLine = Math.ceil(scrollTop + viewportHeight);

		// Use displayCount for calculations - this respects filtering
		const effectiveLineCount = displayCount;

		// Use the appropriate cache: filtered cache when filtering, otherwise the full cache
		const effectiveCache = isFiltering
			? filteredLineHeightCache
			: lineHeightCache;

		const currentCacheLength = effectiveCache?.cumulativeRows.length ?? 0;

		// Detect changes that require full recalculation
		const cacheWidthChanged =
			effectiveCache &&
			lastRangeData.cacheContentWidth !== effectiveCache.contentWidth;
		const cacheLengthChanged = lastRangeData.cacheLength !== currentCacheLength;
		const filteringModeChanged = lastRangeData.isFiltering !== isFiltering;

		// Helper to update ref with current state
		const updateRef = (range: VisibleRange) => {
			visibleRangeRef.current = {
				range,
				cacheContentWidth: effectiveCache?.contentWidth ?? 0,
				cacheLength: currentCacheLength,
				isFiltering,
			};
		};

		// STABILIZER: When at/near bottom, use a fixed calculation to prevent oscillation
		// At the bottom, render last (viewportHeight + overscan) lines with no bottom spacer
		const maxScroll = Math.max(0, contentHeight - viewportHeight);
		const isNearBottom = scrollTop >= maxScroll - 5; // Within 5 rows of bottom

		if (isNearBottom && effectiveLineCount > 0) {
			const overscan = 50;
			const start = Math.max(0, effectiveLineCount - viewportHeight - overscan);
			const end = effectiveLineCount;

			// Calculate topSpacerHeight using the cache (row count, not line count)
			// This ensures correct spacer height when lines wrap to multiple rows
			let topSpacerHeight = start;
			if (
				effectiveCache &&
				effectiveCache.cumulativeRows.length >= start &&
				start > 0
			) {
				topSpacerHeight = effectiveCache.cumulativeRows[start - 1] ?? start;
			}

			const stableRange: VisibleRange = {
				start,
				end,
				topSpacerHeight,
				bottomSpacerHeight: 0, // No bottom spacer when at bottom - prevents oscillation
			};
			updateRef(stableRange);
			return stableRange;
		}

		// Buffer: recalculate when viewport gets within 150 lines of rendered edge
		// Large buffer ensures spacer changes are rare, preventing oscillation
		// Must be less than OVERSCAN_COUNT (200) to ensure content is ready before needed
		const HYSTERESIS_BUFFER = 150;
		const needsRecalculation =
			cacheWidthChanged || // Cache width changed (resize)
			cacheLengthChanged || // Cache length changed (new logs)
			filteringModeChanged || // Switched between filtering and non-filtering
			lastRange.end === 0 || // Initial state
			lastRange.end > effectiveLineCount || // Range exceeds current line count
			firstVisibleLine < lastRange.start + HYSTERESIS_BUFFER ||
			lastVisibleLine > lastRange.end - HYSTERESIS_BUFFER;

		if (!needsRecalculation) {
			return lastRange;
		}

		// Recalculate and update ref for next render's hysteresis check
		const range = calculateVisibleRange({
			scrollTop,
			viewportHeight,
			totalLines: effectiveLineCount,
			cache: effectiveCache,
		});
		updateRef(range);
		return range;
	}, [
		scrollData,
		displayCount,
		isFiltering,
		lineHeightCache,
		filteredLineHeightCache,
	]);

	// Scroll to bottom when switching tabs (tool changes)
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally depends on tool.config.name to scroll on tab switch
	useEffect(() => {
		// Use setTimeout to ensure the scrollbox has rendered with new content
		const timeout = setTimeout(() => {
			const scrollbox = scrollboxRef.current;
			if (scrollbox) {
				scrollbox.scrollTo(scrollbox.scrollHeight);
			}
		}, 0);
		return () => clearTimeout(timeout);
	}, [tool.config.name]);

	// Clamp scroll position when entering filter mode while scrolled beyond filtered results
	// Only applies when actively filtering - don't interfere with normal scrolling
	useEffect(() => {
		if (!isFiltering) return;

		const scrollbox = scrollboxRef.current;
		if (!scrollbox || displayCount === 0) return;

		// If current scroll position is beyond the filtered content, scroll to top
		const currentScroll = scrollbox.scrollTop;
		if (currentScroll > displayCount) {
			scrollbox.scrollTo(0);
		}
	}, [isFiltering, displayCount]);

	// Scroll to a specific line
	const scrollToLine = useCallback((lineIndex: number) => {
		const scrollbox = scrollboxRef.current;
		if (scrollbox) {
			// Scroll so the line is in the middle of the viewport if possible
			const viewportHeight = scrollbox.viewport.height;
			const targetScroll = Math.max(
				0,
				lineIndex - Math.floor(viewportHeight / 2),
			);
			scrollbox.scrollTo(targetScroll);
			// The useScrollInfo hook will detect the position change within 100ms
		}
	}, []);

	const scrollToTop = useCallback(() => {
		scrollboxRef.current?.scrollTo(0);
	}, []);

	const scrollToBottom = useCallback(() => {
		const scrollbox = scrollboxRef.current;
		if (scrollbox) {
			scrollbox.scrollTo(scrollbox.scrollHeight);
		}
	}, []);

	// Navigate to a specific match index and flash the line
	const navigateToMatch = useCallback(
		(newIndex: number) => {
			if (matchingLines.length === 0) return;

			// Wrap around
			let index = newIndex;
			if (index < 0) index = matchingLines.length - 1;
			if (index >= matchingLines.length) index = 0;

			onCurrentMatchIndexChange(index);

			const lineIndex = matchingLines[index];
			if (lineIndex !== undefined) {
				const scrollbox = scrollboxRef.current;
				if (scrollbox) {
					// Calculate the scroll target based on whether filter mode is on
					// In filter mode, use the filtered cache with match index
					// In normal mode, use the full cache with original line index
					const isFilterActive = filterMode && searchQuery;
					const cache = isFilterActive
						? filteredLineHeightCache
						: lineHeightCache;
					const targetIndex = isFilterActive ? index : lineIndex;

					// Get the row position from cache (cumulative rows up to target line)
					// This accounts for wrapped lines taking multiple rows
					let targetRow = targetIndex;
					if (cache && targetIndex > 0) {
						targetRow = cache.cumulativeRows[targetIndex - 1] ?? targetIndex;
					} else if (cache && targetIndex === 0) {
						targetRow = 0;
					}

					const viewportHeight = scrollbox.viewport.height;
					const targetScroll = Math.max(
						0,
						targetRow - Math.floor(viewportHeight / 2),
					);
					scrollbox.scrollTo(targetScroll);
				}
				// Flash the line (using original index for the flash state)
				setFlashingLine(lineIndex);
				setTimeout(() => setFlashingLine(null), 150);
			}
		},
		[
			matchingLines,
			onCurrentMatchIndexChange,
			filterMode,
			searchQuery,
			lineHeightCache,
			filteredLineHeightCache,
		],
	);

	// Handle keyboard input
	useKeyboard((key) => {
		// In input mode, App.tsx handles all keys — don't process here
		if (inputMode) return;

		// Handle search mode input
		if (searchMode) {
			if (key.name === "escape") {
				onSearchModeChange(false);
				return;
			}
			// Toggle fuzzy mode with Ctrl+F
			if (key.ctrl && key.name === "f") {
				onFuzzyModeChange(!fuzzyMode);
				return;
			}
			// Toggle filter mode with Ctrl+H
			if (key.ctrl && key.name === "h") {
				onFilterModeChange(!filterMode);
				return;
			}
			// Navigate to next/previous match with up/down arrows
			if (key.name === "up") {
				navigateToMatch(currentMatchIndex - 1);
				return;
			}
			if (key.name === "down") {
				navigateToMatch(currentMatchIndex + 1);
				return;
			}
			// Let TextInput and the input component handle text editing
			return;
		}

		// Normal mode keyboard handling
		if (key.name === "/" && !useVTRendering) {
			// Enter search mode (disabled in VT rendering mode)
			onSearchModeChange(true);
			return;
		}

		if (key.name === "escape") {
			// Clear search
			onSearchQueryChange("");
			return;
		}
	});

	// Helper to copy text to clipboard using the renderer's real stdout
	const copyText = useCallback(
		(text: string) => {
			const realWrite = (
				renderer as unknown as {
					realStdoutWrite?: typeof process.stdout.write;
				}
			).realStdoutWrite;
			if (realWrite) {
				copyToClipboard(text, (data) => realWrite.call(process.stdout, data));
			} else {
				copyToClipboard(text);
			}
		},
		[renderer],
	);

	// Handle double-click to copy entire line
	const handleDoubleClick = useCallback(
		(lineIndex: number) => {
			const logLine = logLines[lineIndex];
			if (logLine !== undefined) {
				copyText(logLine.text);
				setFlashingLine(lineIndex);
				setTimeout(() => setFlashingLine(null), 150);
				toast.success("Copied line to clipboard");
			}
		},
		[logLines, copyText],
	);

	// Handle mouse down for double-click detection and setting active match
	const handleMouseDown = useCallback(
		(lineIndex: number) => {
			const now = Date.now();
			const lastClick = lastClickRef.current;
			const isDoubleClick =
				lastClick !== null &&
				lastClick.lineIndex === lineIndex &&
				now - lastClick.time < DOUBLE_CLICK_THRESHOLD;

			if (isDoubleClick) {
				handleDoubleClick(lineIndex);
				lastClickRef.current = null;
				isDoubleClickRef.current = false;
			} else {
				lastClickRef.current = { lineIndex, time: now };
				isDoubleClickRef.current = false;

				// If searching, set clicked line as the active match (for next/prev navigation)
				if (searchQuery && matchingLines.length > 0) {
					// Find the match index for this line
					const matchIndex = matchingLines.indexOf(lineIndex);
					if (matchIndex !== -1) {
						onCurrentMatchIndexChange(matchIndex);
					}
				}
			}
		},
		[handleDoubleClick, searchQuery, matchingLines, onCurrentMatchIndexChange],
	);

	// Listen for OpenTUI selection events to copy to clipboard
	useEffect(() => {
		const handleSelection = (selection: Selection | null) => {
			// When selection completes and there's selected text
			if (selection && !selection.isDragging) {
				const text = selection.getSelectedText();
				if (text) {
					copyText(text);
					const lineCount = text.split("\n").length;
					if (lineCount > 1) {
						toast.success(`Copied ${lineCount} lines to clipboard`);
					} else {
						toast.success("Copied to clipboard");
					}
				}
			}
		};
		renderer.on("selection", handleSelection);
		return () => {
			renderer.off("selection", handleSelection);
		};
	}, [renderer, copyText]);

	// Whether to add left margin (in vertical layout, creates gap between sidebar and content)
	const needsLeftMargin = sidebarWidth > 0;

	return (
		<box flexGrow={1} flexDirection="column" backgroundColor={colors.surface0}>
			{/* Search bar - hidden in VT rendering mode */}
			{!useVTRendering && (searchMode || searchQuery) && (
				<box
					height={3}
					width="100%"
					backgroundColor={colors.surface1}
					border
					borderStyle="single"
					borderColor={colors.textMuted}
					paddingLeft={1}
					paddingRight={1}
					flexDirection="row"
				>
					{searchMode ? (
						<TextInput
							value={searchQuery}
							onValueChange={onSearchQueryChange}
							onEmpty={() => onSearchModeChange(false)}
							onSubmit={() => {
								onSearchModeChange(false);
								if (matchingLines.length > 0) {
									const lineIndex = matchingLines[currentMatchIndex];
									if (lineIndex !== undefined) {
										scrollToLine(lineIndex);
									}
								}
							}}
							focused={searchMode}
							theme={theme}
							prefix="/"
							prefixBold
							prefixColor={colors.accent}
						/>
					) : (
						<>
							<text attributes={TextAttributes.BOLD} fg={colors.accent}>
								/
							</text>
							<text fg={colors.text} flexGrow={1}>
								{searchQuery}
							</text>
						</>
					)}
					<text fg={colors.textMuted}>
						{matchingLines.length > 0 && !searchMode && (
							<span>
								{" "}
								({currentMatchIndex + 1}/{matchingLines.length})
							</span>
						)}
						{searchQuery && matchingLines.length === 0 && (
							<span fg={colors.error}> (no matches)</span>
						)}
						<span>
							{" "}
							[{fuzzyMode ? "Fuzzy" : "Substring"}] [Filter:{" "}
							{filterMode ? "ON" : "OFF"}]
						</span>
					</text>
				</box>
			)}

			{/* Top scroll indicator */}
			{scrollInfo.linesAbove > 0 && (
				<box
					height={1}
					width="100%"
					justifyContent="center"
					alignItems="center"
					backgroundColor={colors.surface0}
					marginLeft={needsLeftMargin ? 1 : 0}
					onMouseUp={scrollToTop}
				>
					<text fg={colors.textMuted}>↑ {scrollInfo.linesAbove} more ↑</text>
				</box>
			)}

			<scrollbox
				marginLeft={needsLeftMargin ? 1 : 0}
				ref={scrollboxRef}
				flexGrow={1}
				backgroundColor={colors.surface0}
				stickyScroll
				stickyStart="bottom"
				scrollAcceleration={scrollAcceleration}
				scrollbarOptions={{
					paddingLeft: 1,
				}}
			>
				{displaySource.length === 0 ? (
					<box paddingLeft={1} paddingRight={1}>
						<text fg={colors.text}>
							{tool.status === "running"
								? "Waiting for output..."
								: tool.status === "waiting"
									? "Waiting for dependencies..."
									: tool.status === "shuttingDown"
										? "Shutting down gracefully..."
										: tool.status === "error"
											? `Process error (exit code: ${tool.exitCode ?? "unknown"})`
											: "Process not started"}
						</text>
					</box>
				) : (
					(() => {
						// Build display list: filter lines if filter mode is ON with active search
						const displayItems =
							filterMode && searchQuery
								? matchingLines.map((originalIndex) => ({
										originalIndex,
										text: logLines[originalIndex]?.text ?? "",
										isStderr: logLines[originalIndex]?.isStderr ?? false,
									}))
								: logLines.map((logLine, index) => ({
										originalIndex: index,
										text: logLine.text,
										isStderr: logLine.isStderr,
									}));

						const displayCount = displayItems.length;

						// Calculate visible range for the display items (may differ from logLines when filtering)
						// When filtering, we use a derived cache built from matching lines' heights
						const effectiveRange = virtualizationEnabled
							? {
									start: Math.min(visibleRange.start, displayCount),
									end: Math.min(visibleRange.end, displayCount),
									topSpacerHeight: visibleRange.topSpacerHeight,
									bottomSpacerHeight: visibleRange.bottomSpacerHeight,
								}
							: {
									start: 0,
									end: displayCount,
									topSpacerHeight: 0,
									bottomSpacerHeight: 0,
								};

						// Get the slice of items to render
						const visibleItems = displayItems.slice(
							effectiveRange.start,
							effectiveRange.end,
						);

						// Render a single log line
						const renderLogLine = (
							originalIndex: number,
							_text: string,
							displayIndex: number,
							isStderr: boolean,
						) => {
							const isFlashing = flashingLine === originalIndex;
							const isMatch =
								searchQuery && matchingLines.includes(originalIndex);
							const lineNumber = String(originalIndex + 1).padStart(
								lineNumberWidth,
								" ",
							);

							// Get the segments for this line (with ANSI colors)
							const logLine = displaySource[originalIndex];
							const segments = logLine?.segments ?? [];

							// VT content is clipped to the scrollbox width to
							// prevent wrapping during resize transitions (old
							// wider content briefly persists before the child
							// redraws). Non-VT content uses the standard
							// truncate/wrap logic.
							const displaySegments = useVTRendering
								? clipSegments(segments, terminalWidth - sidebarWidth)
								: truncateSegments(segments, contentWidth, lineWrap);

							// Helper: render an array of styled segments, inserting \n between
							// wrapped rows so we bypass OpenTUI's wrapMode="char" bug.
							const renderWrapped = <
								T extends {
									text: string;
									color?: string;
									bgColor?: string;
									colorIndex?: number;
									bgColorIndex?: number;
									attributes?: number;
								},
							>(
								segs: T[],
								renderSeg: (seg: T, key: string) => React.ReactNode,
							): React.ReactNode[] => {
								const shouldWrap = lineWrap && !useVTRendering;
								const rows = shouldWrap
									? charWrapSegments(segs, contentWidth)
									: [segs];
								const elements: React.ReactNode[] = [];
								let pos = 0;
								for (let r = 0; r < rows.length; r++) {
									if (r > 0) elements.push("\n");
									const row = rows[r];
									if (!row) continue;
									for (const seg of row) {
										elements.push(renderSeg(seg, `${pos}`));
										pos += seg.text.length;
									}
								}
								return elements;
							};

							// Render line content with ANSI colors and search match highlighting
							const renderLineContent = () => {
								// If flashing (double-click copy feedback), highlight entire line
								if (isFlashing) {
									const plainText = displaySegments.map((s) => s.text).join("");
									return (
										<span bg={colors.selectionBackground} fg={colors.text}>
											{plainText}
										</span>
									);
								}

								// Apply search highlighting on top of ANSI colors
								if (searchQuery && isMatch) {
									const highlighted = fuzzyMode
										? highlightSegmentsWithFuzzyIndices(
												displaySegments,
												fuzzyHighlightsMap.get(originalIndex) ?? [],
											)
										: highlightSegmentsWithSearch(displaySegments, searchQuery);
									return renderWrapped(highlighted, (seg, key) => {
										const resolved = resolveSegmentColors(
											seg,
											ansiPalette,
											colors.text,
											colors.surface0,
										);
										return (
											<span
												key={`${key}-${seg.isMatch ? "m" : "s"}`}
												fg={seg.isMatch ? colors.warning : resolved.fg}
												bg={resolved.bg}
												attributes={seg.attributes}
											>
												{seg.text}
											</span>
										);
									});
								}

								// Render segments with their ANSI colors
								return renderWrapped(displaySegments, (seg, key) => {
									const resolved = resolveSegmentColors(
										seg,
										ansiPalette,
										colors.text,
										colors.surface0,
									);
									return (
										<span
											key={`${key}-s`}
											fg={resolved.fg}
											bg={resolved.bg}
											attributes={seg.attributes}
										>
											{seg.text}
										</span>
									);
								});
							};

							// Calculate gutter width for proper column sizing
							const gutterColumnWidth = lineNumberWidth + 1; // line number + border

							return (
								<box
									key={`log-${tool.config.name}-${displayIndex}`}
									flexDirection="row"
									backgroundColor={colors.surface0}
									onMouseDown={() => handleMouseDown(originalIndex)}
								>
									{/* Line number gutter - muted text with right border, red for stderr */}
									{shouldShowLineNumbers && (
										<box
											width={gutterColumnWidth}
											flexShrink={0}
											backgroundColor={colors.surface0}
											border={["right"]}
											borderStyle="single"
											borderColor={colors.textMuted}
										>
											<text fg={isStderr ? colors.error : colors.textMuted}>
												{lineNumber}
											</text>
										</box>
									)}
									{/* Log content - flexible column with OpenTUI selection */}
									<box flexGrow={1} paddingLeft={shouldShowLineNumbers ? 1 : 0}>
										<text
											fg={colors.text}
											selectable
											selectionBg={colors.selectionBackground}
											selectionFg={colors.text}
											wrapMode="word"
										>
											{renderLineContent()}
										</text>
									</box>
								</box>
							);
						};

						return (
							<>
								{/* Top spacer - maintains scroll position for virtualized content */}
								{effectiveRange.topSpacerHeight > 0 && (
									<box
										key="virtualization-top-spacer"
										height={effectiveRange.topSpacerHeight}
										backgroundColor={colors.surface0}
									/>
								)}

								{/* Visible lines only */}
								{visibleItems.map(({ originalIndex, text, isStderr }, idx) =>
									renderLogLine(
										originalIndex,
										text,
										effectiveRange.start + idx,
										isStderr,
									),
								)}

								{/* Bottom spacer - maintains total scroll height */}
								{effectiveRange.bottomSpacerHeight > 0 && (
									<box
										key="virtualization-bottom-spacer"
										height={effectiveRange.bottomSpacerHeight}
										backgroundColor={colors.surface0}
									/>
								)}
							</>
						);
					})()
				)}
			</scrollbox>

			{/* Bottom scroll indicator or spacer (hidden for VT content to maximize viewport) */}
			{!useVTRendering &&
				(scrollInfo.linesBelow > 0 ? (
					<box
						height={1}
						width="100%"
						justifyContent="center"
						alignItems="center"
						backgroundColor={colors.surface0}
						marginLeft={needsLeftMargin ? 1 : 0}
						onMouseUp={scrollToBottom}
					>
						<text fg={colors.textMuted}>↓ {scrollInfo.linesBelow} more ↓</text>
					</box>
				) : (
					<box
						height={1}
						width="100%"
						backgroundColor={colors.surface0}
						marginLeft={needsLeftMargin ? 1 : 0}
					/>
				))}

			{/* Input mode indicator */}
			{inputMode && (
				<box
					height={1}
					width="100%"
					paddingLeft={1}
					paddingRight={1}
					backgroundColor={colors.accent}
				>
					<text fg={colors.surface0}>
						<span attributes={TextAttributes.BOLD}>INPUT MODE</span>
						{" — Type to send input, Esc to exit"}
					</text>
				</box>
			)}
		</box>
	);
});
