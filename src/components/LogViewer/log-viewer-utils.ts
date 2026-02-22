import { getVisibleWidth } from "../../lib/text/ansi";
import type { TextSegment } from "../../types";

/** Calculate the width needed for line numbers */
export function getLineNumberWidth(totalLines: number): number {
	return Math.max(3, String(totalLines).length);
}

/** Find all indices where the search query matches (case-insensitive) */
export function findMatchingLines(lines: string[], query: string): number[] {
	if (!query) return [];
	const lowerQuery = query.toLowerCase();
	const matches: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line?.toLowerCase().includes(lowerQuery)) {
			matches.push(i);
		}
	}
	return matches;
}

/** Minimum terminal width to show line numbers in "auto" mode */
export const LINE_NUMBER_WIDTH_THRESHOLD = 80;

/** Width of the line number gutter (number + separator) */
export const LINE_NUMBER_GUTTER_WIDTH = 6;

interface ContentWidthParams {
	terminalWidth: number;
	sidebarWidth: number;
	showLineNumbers: boolean;
	lineNumberWidth: number;
}

/**
 * Calculate the available width for line content.
 * Used for both truncation (lineWrap off) and line height cache (lineWrap on).
 * Accounts for all nested container widths:
 * - Sidebar (when in vertical layout): sidebarWidth (sidebar width + 1 margin gap)
 * - Line number gutter (when shown): lineNumberWidth + 2 (number + border)
 * - Content padding left (when line numbers shown): 1
 * - Scrollbar area: 2 (scrollbar + paddingLeft)
 */
export function calculateContentWidth({
	terminalWidth,
	sidebarWidth,
	showLineNumbers,
	lineNumberWidth,
}: ContentWidthParams): number {
	const gutterWidth = showLineNumbers ? lineNumberWidth + 2 : 0;
	const contentPadding = showLineNumbers ? 1 : 0;
	const scrollbarWidth = 2;

	return Math.max(
		20,
		terminalWidth -
			sidebarWidth -
			gutterWidth -
			contentPadding -
			scrollbarWidth,
	);
}

/**
 * Truncate a line to fit within the given width, adding ellipsis if needed.
 * Returns the original line if it fits or if lineWrap is enabled.
 */
export function truncateLine(
	line: string,
	contentWidth: number,
	lineWrap: boolean,
): string {
	if (lineWrap || line.length <= contentWidth) return line;
	return `${line.substring(0, contentWidth - 1)}…`;
}

interface ScrollInfoParams {
	scrollTop: number;
	viewportHeight: number;
	contentHeight: number;
	totalLines: number;
}

interface ScrollInfo {
	linesAbove: number;
	linesBelow: number;
}

/**
 * Calculate the number of lines above and below the viewport.
 * Uses scroll ratio to correctly handle wrapped lines.
 */
export function calculateScrollInfo({
	scrollTop,
	viewportHeight,
	contentHeight,
	totalLines,
}: ScrollInfoParams): ScrollInfo {
	// If content fits in viewport, no scroll indicators needed
	if (contentHeight <= viewportHeight) {
		return { linesAbove: 0, linesBelow: 0 };
	}

	// Calculate as percentage of total scrollable area, then apply to logical lines
	// This correctly handles wrapped lines by using scroll ratio instead of raw heights
	const maxScroll = contentHeight - viewportHeight;
	const scrollRatio = maxScroll > 0 ? scrollTop / maxScroll : 0;

	// Estimate visible lines (may be less than viewport if lines are wrapped)
	const estimatedVisibleLines = Math.min(viewportHeight, totalLines);
	const scrollableLines = Math.max(0, totalLines - estimatedVisibleLines);

	const linesAbove = Math.round(scrollRatio * scrollableLines);
	const linesBelow = Math.max(0, scrollableLines - linesAbove);

	return { linesAbove, linesBelow };
}

// ============================================================================
// Virtualization utilities
// ============================================================================

/** Number of lines to render above/below the viewport for smooth scrolling.
 * Set high to allow large hysteresis buffer and prevent oscillation from spacer changes. */
export const OVERSCAN_COUNT = 200;

/** Minimum number of lines before virtualization kicks in */
export const VIRTUALIZATION_THRESHOLD = 100;

export interface VisibleRange {
	/** First line index to render */
	start: number;
	/** Last line index to render (exclusive) */
	end: number;
	/** Height of spacer above visible content (in rows) */
	topSpacerHeight: number;
	/** Height of spacer below visible content (in rows) */
	bottomSpacerHeight: number;
}

/**
 * Determine if virtualization should be enabled.
 * Disabled only for small logs.
 */
export function shouldVirtualize(totalLines: number): boolean {
	return totalLines >= VIRTUALIZATION_THRESHOLD;
}

// ============================================================================
// Line Height Cache - Precise tracking of wrapped line heights
// ============================================================================

/**
 * Cache that tracks the cumulative row count for each line.
 * This allows O(1) lookup of line positions and O(log n) lookup of which line is at a row.
 */
export interface LineHeightCache {
	/** cumulativeRows[i] = total rows from line 0 through line i (inclusive) */
	cumulativeRows: number[];
	/** The content width used for this calculation */
	contentWidth: number;
	/** Whether lineWrap was enabled */
	lineWrap: boolean;
}

/**
 * Calculate how many terminal rows a single line occupies.
 * Uses getVisibleWidth to properly handle ANSI codes and wide characters.
 */
export function calculateLineRows(
	line: string,
	contentWidth: number,
	lineWrap: boolean,
): number {
	if (!lineWrap) return 1;
	if (line.length === 0) return 1;
	if (contentWidth <= 0) return 1;
	// Use visible width to properly handle ANSI codes and wide characters
	const visibleWidth = getVisibleWidth(line);
	// Ensure at least 1 row (handles lines with only ANSI codes / 0 visible width)
	return Math.max(1, Math.ceil(visibleWidth / contentWidth));
}

/**
 * Create an empty line height cache.
 */
export function createLineHeightCache(
	contentWidth: number,
	lineWrap: boolean,
): LineHeightCache {
	return {
		cumulativeRows: [],
		contentWidth,
		lineWrap,
	};
}

/**
 * Build a complete line height cache from all lines.
 */
export function buildLineHeightCache(
	lines: string[],
	contentWidth: number,
	lineWrap: boolean,
): LineHeightCache {
	const cumulativeRows: number[] = new Array(lines.length);
	let total = 0;

	for (let i = 0; i < lines.length; i++) {
		total += calculateLineRows(lines[i] ?? "", contentWidth, lineWrap);
		cumulativeRows[i] = total;
	}

	return { cumulativeRows, contentWidth, lineWrap };
}

/**
 * Extend an existing cache with new lines (for incremental updates).
 * Returns a new cache object (does not mutate the input).
 */
export function extendLineHeightCache(
	cache: LineHeightCache,
	newLines: string[],
): LineHeightCache {
	if (newLines.length === 0) return cache;

	const { cumulativeRows, contentWidth, lineWrap } = cache;
	const newCumulativeRows = [...cumulativeRows];
	let total =
		cumulativeRows.length > 0
			? (cumulativeRows[cumulativeRows.length - 1] ?? 0)
			: 0;

	for (const line of newLines) {
		total += calculateLineRows(line, contentWidth, lineWrap);
		newCumulativeRows.push(total);
	}

	return { cumulativeRows: newCumulativeRows, contentWidth, lineWrap };
}

/**
 * Get the total number of rows for all content.
 */
export function getTotalRows(cache: LineHeightCache): number {
	const { cumulativeRows } = cache;
	if (cumulativeRows.length === 0) return 0;
	return cumulativeRows[cumulativeRows.length - 1] ?? 0;
}

/**
 * Get the row offset where a specific line starts.
 */
export function getLineStartRow(
	cache: LineHeightCache,
	lineIndex: number,
): number {
	if (lineIndex <= 0) return 0;
	return cache.cumulativeRows[lineIndex - 1] ?? 0;
}

/**
 * Find which line index contains a given row using binary search.
 */
export function findLineAtRow(cache: LineHeightCache, row: number): number {
	const { cumulativeRows } = cache;
	if (cumulativeRows.length === 0) return 0;
	if (row <= 0) return 0;

	// Binary search for first cumulative value > row
	let lo = 0;
	let hi = cumulativeRows.length - 1;

	while (lo < hi) {
		const mid = Math.floor((lo + hi) / 2);
		if ((cumulativeRows[mid] ?? 0) <= row) {
			lo = mid + 1;
		} else {
			hi = mid;
		}
	}

	return Math.min(lo, cumulativeRows.length - 1);
}

interface CalculateVisibleRangeParams {
	scrollTop: number;
	viewportHeight: number;
	totalLines: number;
	cache: LineHeightCache | null;
	overscan?: number;
}

/**
 * Calculate which lines should be rendered based on scroll position.
 * Uses precise line height cache when available (populated via LineMeasurer
 * which uses OpenTUI's actual wrapping algorithm).
 *
 * When no cache is available, falls back to 1-row-per-line approximation.
 */
export function calculateVisibleRange({
	scrollTop,
	viewportHeight,
	totalLines,
	cache,
	overscan = OVERSCAN_COUNT,
}: CalculateVisibleRangeParams): VisibleRange {
	// If no lines or tiny viewport, show nothing
	if (totalLines === 0 || viewportHeight <= 0) {
		return { start: 0, end: 0, topSpacerHeight: 0, bottomSpacerHeight: 0 };
	}

	// Use precise calculation when we have a valid cache
	// The cache is now populated using LineMeasurer (OpenTUI's real wrapping)
	// so it's accurate for both lineWrap ON and OFF
	if (cache && cache.cumulativeRows.length === totalLines) {
		return calculateVisibleRangePrecise(
			cache,
			scrollTop,
			viewportHeight,
			totalLines,
			overscan,
		);
	}

	// Fallback: simple calculation assuming 1 row per line
	// This is only used when cache isn't ready yet
	const firstVisibleLine = Math.floor(scrollTop);
	const lastVisibleLine = Math.ceil(scrollTop + viewportHeight);

	const start = Math.max(0, firstVisibleLine - overscan);
	const end = Math.min(totalLines, lastVisibleLine + overscan);

	return {
		start,
		end,
		topSpacerHeight: start,
		bottomSpacerHeight: Math.max(0, totalLines - end),
	};
}

/**
 * Calculate visible range using precise line height information.
 */
function calculateVisibleRangePrecise(
	cache: LineHeightCache,
	scrollTop: number,
	viewportHeight: number,
	totalLines: number,
	overscan: number,
): VisibleRange {
	const totalRows = getTotalRows(cache);

	// Find first and last visible lines based on row position
	// firstVisibleRow: first row that overlaps the viewport
	// lastVisibleRow: last row that overlaps the viewport (not the first row after)
	const firstVisibleRow = Math.floor(scrollTop);
	const lastVisibleRow = Math.max(0, Math.ceil(scrollTop + viewportHeight) - 1);

	const firstVisibleLine = findLineAtRow(cache, firstVisibleRow);
	const lastVisibleLine = Math.min(
		totalLines - 1,
		findLineAtRow(cache, lastVisibleRow),
	);

	// Add overscan buffer (in lines)
	const start = Math.max(0, firstVisibleLine - overscan);
	const end = Math.min(totalLines, lastVisibleLine + 1 + overscan);

	// Calculate spacer heights in ROWS (for correct layout)
	const topSpacerHeight = getLineStartRow(cache, start);
	const endRow = end > 0 ? (cache.cumulativeRows[end - 1] ?? 0) : 0;
	const bottomSpacerHeight = Math.max(0, totalRows - endRow);

	return {
		start,
		end,
		topSpacerHeight,
		bottomSpacerHeight,
	};
}

// ============================================================================
// Highlight matching utilities
// ============================================================================

/** A segment of text with match information */
export interface HighlightSegment {
	text: string;
	isMatch: boolean;
}

/**
 * Calculate highlight segments for a line based on a search query.
 * Splits the line into segments marking which parts match the query (case-insensitive).
 * Returns a single segment with the full line if no query or no matches.
 */
export function calculateHighlightSegments(
	line: string,
	query: string,
): HighlightSegment[] {
	if (!query) {
		return [{ text: line, isMatch: false }];
	}

	const segments: HighlightSegment[] = [];
	const lowerLine = line.toLowerCase();
	const lowerQuery = query.toLowerCase();
	let lastIndex = 0;
	let matchIndex = lowerLine.indexOf(lowerQuery);

	// No matches found
	if (matchIndex === -1) {
		return [{ text: line, isMatch: false }];
	}

	while (matchIndex !== -1) {
		// Add text before match
		if (matchIndex > lastIndex) {
			segments.push({
				text: line.substring(lastIndex, matchIndex),
				isMatch: false,
			});
		}
		// Add highlighted match
		segments.push({
			text: line.substring(matchIndex, matchIndex + query.length),
			isMatch: true,
		});
		lastIndex = matchIndex + query.length;
		matchIndex = lowerLine.indexOf(lowerQuery, lastIndex);
	}

	// Add remaining text
	if (lastIndex < line.length) {
		segments.push({
			text: line.substring(lastIndex),
			isMatch: false,
		});
	}

	return segments;
}

// ============================================================================
// Segment-aware utilities for ANSI color support
// ============================================================================

/**
 * Calculate the total visible width of an array of text segments.
 * Uses getVisibleWidth which properly handles wide Unicode characters.
 */
export function getSegmentsVisibleWidth(segments: TextSegment[]): number {
	let width = 0;
	for (const segment of segments) {
		width += getVisibleWidth(segment.text);
	}
	return width;
}

/**
 * Split segments into wrapped rows at character boundaries.
 * Works with any segment type that has a `text` property (TextSegment,
 * StyledHighlightSegment, etc.), preserving all extra fields on each piece.
 *
 * Returns a single-element array when the content fits within maxWidth.
 * Used to work around an OpenTUI wrapMode="char" rendering bug where
 * the first character of each wrapped row is dropped.
 */
export function charWrapSegments<T extends { text: string }>(
	segments: T[],
	maxWidth: number,
): T[][] {
	if (segments.length === 0 || maxWidth <= 0) return [segments];

	const totalWidth = getSegmentsVisibleWidth(
		segments as unknown as TextSegment[],
	);
	if (totalWidth <= maxWidth) return [segments];

	const rows: T[][] = [];
	let currentRow: T[] = [];
	let rowWidth = 0;

	for (const segment of segments) {
		let remaining = segment.text;

		while (remaining.length > 0) {
			const availableWidth = maxWidth - rowWidth;

			let splitPos = 0;
			let splitWidth = 0;
			for (const char of remaining) {
				const cw = getVisibleWidth(char);
				if (splitWidth + cw > availableWidth && splitWidth > 0) break;
				splitPos += char.length;
				splitWidth += cw;
			}

			if (splitPos === 0) {
				rows.push(currentRow);
				currentRow = [];
				rowWidth = 0;
				continue;
			}

			currentRow.push({
				...segment,
				text: remaining.slice(0, splitPos),
			} as T);
			rowWidth += splitWidth;
			remaining = remaining.slice(splitPos);

			if (remaining.length > 0) {
				rows.push(currentRow);
				currentRow = [];
				rowWidth = 0;
			}
		}
	}

	if (currentRow.length > 0) {
		rows.push(currentRow);
	}

	return rows;
}

/**
 * Truncate segments to fit within the given width, adding ellipsis if needed.
 * Preserves color and attribute information for each segment.
 * Returns the original segments if they fit or if lineWrap is enabled.
 */
export function truncateSegments(
	segments: TextSegment[],
	maxWidth: number,
	lineWrap: boolean,
): TextSegment[] {
	if (lineWrap || segments.length === 0) return segments;

	const totalWidth = getSegmentsVisibleWidth(segments);
	if (totalWidth <= maxWidth) return segments;

	// Need to truncate - walk through segments and cut at maxWidth - 1 (for ellipsis)
	const targetWidth = maxWidth - 1;
	const result: TextSegment[] = [];
	let currentWidth = 0;

	for (const segment of segments) {
		const segmentWidth = getVisibleWidth(segment.text);

		if (currentWidth + segmentWidth <= targetWidth) {
			// Entire segment fits
			result.push(segment);
			currentWidth += segmentWidth;
		} else {
			// Need to truncate this segment
			const remainingWidth = targetWidth - currentWidth;
			if (remainingWidth > 0) {
				// Truncate the segment text character by character to handle wide chars
				let truncatedText = "";
				let truncatedWidth = 0;
				for (const char of segment.text) {
					const charWidth = getVisibleWidth(char);
					if (truncatedWidth + charWidth <= remainingWidth) {
						truncatedText += char;
						truncatedWidth += charWidth;
					} else {
						break;
					}
				}
				if (truncatedText.length > 0) {
					result.push({
						text: truncatedText,
						color: segment.color,
						bgColor: segment.bgColor,
						colorIndex: segment.colorIndex,
						bgColorIndex: segment.bgColorIndex,
						attributes: segment.attributes,
					});
				}
			}
			// Add ellipsis as a separate segment (inherits no color - uses default)
			result.push({ text: "…" });
			break;
		}
	}

	return result;
}

/**
 * Clip segments to a maximum width without adding an ellipsis.
 * Used for VT-rendered content to prevent OpenTUI from wrapping lines
 * during transient resize windows (before the child process redraws).
 */
export function clipSegments(
	segments: TextSegment[],
	maxWidth: number,
): TextSegment[] {
	if (segments.length === 0 || maxWidth <= 0) return segments;

	const totalWidth = getSegmentsVisibleWidth(segments);
	if (totalWidth <= maxWidth) return segments;

	const result: TextSegment[] = [];
	let currentWidth = 0;

	for (const segment of segments) {
		const segmentWidth = getVisibleWidth(segment.text);

		if (currentWidth + segmentWidth <= maxWidth) {
			result.push(segment);
			currentWidth += segmentWidth;
		} else {
			const remaining = maxWidth - currentWidth;
			if (remaining > 0) {
				let clipped = "";
				let clippedWidth = 0;
				for (const char of segment.text) {
					const cw = getVisibleWidth(char);
					if (clippedWidth + cw > remaining) break;
					clipped += char;
					clippedWidth += cw;
				}
				if (clipped.length > 0) {
					result.push({
						text: clipped,
						color: segment.color,
						bgColor: segment.bgColor,
						colorIndex: segment.colorIndex,
						bgColorIndex: segment.bgColorIndex,
						attributes: segment.attributes,
					});
				}
			}
			break;
		}
	}

	return result;
}

/** A segment with ANSI styling plus search match information */
export interface StyledHighlightSegment {
	text: string;
	color?: string;
	bgColor?: string;
	colorIndex?: number;
	bgColorIndex?: number;
	attributes?: number;
	isMatch: boolean;
}

/**
 * Overlay search highlighting on styled text segments.
 * Splits segments at match boundaries while preserving original colors.
 * Match portions get isMatch: true for special highlighting.
 */
export function highlightSegmentsWithSearch(
	segments: TextSegment[],
	query: string,
): StyledHighlightSegment[] {
	if (!query || segments.length === 0) {
		return segments.map((seg) => ({
			text: seg.text,
			color: seg.color,
			bgColor: seg.bgColor,
			colorIndex: seg.colorIndex,
			bgColorIndex: seg.bgColorIndex,
			attributes: seg.attributes,
			isMatch: false,
		}));
	}

	const lowerQuery = query.toLowerCase();
	const result: StyledHighlightSegment[] = [];

	// Build a flat representation of all text with segment boundaries
	// so we can find matches across segment boundaries
	const fullText = segments.map((s) => s.text).join("");
	const lowerFullText = fullText.toLowerCase();

	// Find all match positions in the full text
	const matchRanges: Array<{ start: number; end: number }> = [];
	let searchStart = 0;
	let matchIndex = lowerFullText.indexOf(lowerQuery, searchStart);
	while (matchIndex !== -1) {
		matchRanges.push({ start: matchIndex, end: matchIndex + query.length });
		searchStart = matchIndex + query.length;
		matchIndex = lowerFullText.indexOf(lowerQuery, searchStart);
	}

	// If no matches, return segments with isMatch: false
	if (matchRanges.length === 0) {
		return segments.map((seg) => ({
			text: seg.text,
			color: seg.color,
			bgColor: seg.bgColor,
			colorIndex: seg.colorIndex,
			bgColorIndex: seg.bgColorIndex,
			attributes: seg.attributes,
			isMatch: false,
		}));
	}

	// Walk through each segment and split at match boundaries
	let globalPos = 0;
	let matchIdx = 0;

	for (const segment of segments) {
		const segStart = globalPos;
		const segEnd = globalPos + segment.text.length;
		let localPos = 0;

		while (localPos < segment.text.length) {
			const absPos = segStart + localPos;

			// Skip past any matches that ended before current position
			while (matchIdx < matchRanges.length) {
				const range = matchRanges[matchIdx];
				if (range && range.end <= absPos) {
					matchIdx++;
				} else {
					break;
				}
			}

			const currentMatch = matchRanges[matchIdx];
			const inMatch =
				currentMatch &&
				absPos >= currentMatch.start &&
				absPos < currentMatch.end;

			if (inMatch && currentMatch) {
				// We're inside a match - output match portion
				const matchEndInSegment = Math.min(
					currentMatch.end - segStart,
					segment.text.length,
				);
				const matchText = segment.text.substring(localPos, matchEndInSegment);
				if (matchText.length > 0) {
					result.push({
						text: matchText,
						color: segment.color,
						bgColor: segment.bgColor,
						colorIndex: segment.colorIndex,
						bgColorIndex: segment.bgColorIndex,
						attributes: segment.attributes,
						isMatch: true,
					});
				}
				localPos = matchEndInSegment;
			} else {
				// Not in a match - output non-match portion until next match or segment end
				const nextMatchStart = currentMatch ? currentMatch.start : segEnd;
				const nonMatchEndInSegment = Math.min(
					nextMatchStart - segStart,
					segment.text.length,
				);
				const nonMatchText = segment.text.substring(
					localPos,
					nonMatchEndInSegment,
				);
				if (nonMatchText.length > 0) {
					result.push({
						text: nonMatchText,
						color: segment.color,
						bgColor: segment.bgColor,
						colorIndex: segment.colorIndex,
						bgColorIndex: segment.bgColorIndex,
						attributes: segment.attributes,
						isMatch: false,
					});
				}
				localPos = nonMatchEndInSegment;
			}
		}

		globalPos = segEnd;
	}

	return result;
}

/**
 * Overlay fuzzy search highlighting on styled text segments.
 * Uses character indices for highlighting (fuzzy matches individual chars, not substrings).
 * Match characters get isMatch: true for special highlighting.
 */
export function highlightSegmentsWithFuzzyIndices(
	segments: TextSegment[],
	highlightIndices: number[],
): StyledHighlightSegment[] {
	if (highlightIndices.length === 0 || segments.length === 0) {
		return segments.map((seg) => ({
			text: seg.text,
			color: seg.color,
			bgColor: seg.bgColor,
			colorIndex: seg.colorIndex,
			bgColorIndex: seg.bgColorIndex,
			attributes: seg.attributes,
			isMatch: false,
		}));
	}

	// Create a Set for O(1) lookup of highlighted positions
	const highlightSet = new Set(highlightIndices);
	const result: StyledHighlightSegment[] = [];

	// Walk through each segment character by character
	let globalPos = 0;

	for (const segment of segments) {
		let localStart = 0;
		let currentIsMatch = highlightSet.has(globalPos);

		for (let i = 0; i < segment.text.length; i++) {
			const absPos = globalPos + i;
			const isMatch = highlightSet.has(absPos);

			if (isMatch !== currentIsMatch) {
				// State changed, push current segment portion
				const text = segment.text.substring(localStart, i);
				if (text.length > 0) {
					result.push({
						text,
						color: segment.color,
						bgColor: segment.bgColor,
						colorIndex: segment.colorIndex,
						bgColorIndex: segment.bgColorIndex,
						attributes: segment.attributes,
						isMatch: currentIsMatch,
					});
				}
				localStart = i;
				currentIsMatch = isMatch;
			}
		}

		// Push remaining text in segment
		const remainingText = segment.text.substring(localStart);
		if (remainingText.length > 0) {
			result.push({
				text: remainingText,
				color: segment.color,
				bgColor: segment.bgColor,
				colorIndex: segment.colorIndex,
				bgColorIndex: segment.bgColorIndex,
				attributes: segment.attributes,
				isMatch: currentIsMatch,
			});
		}

		globalPos += segment.text.length;
	}

	return result;
}
