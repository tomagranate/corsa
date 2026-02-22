import { describe, expect, test } from "bun:test";
import type { TextSegment } from "../../../types";
import {
	buildLineHeightCache,
	calculateContentWidth,
	calculateHighlightSegments,
	calculateLineRows,
	calculateScrollInfo,
	calculateVisibleRange,
	charWrapSegments,
	extendLineHeightCache,
	findLineAtRow,
	findMatchingLines,
	getLineNumberWidth,
	getLineStartRow,
	getSegmentsVisibleWidth,
	getTotalRows,
	highlightSegmentsWithSearch,
	OVERSCAN_COUNT,
	shouldVirtualize,
	truncateLine,
	truncateSegments,
	VIRTUALIZATION_THRESHOLD,
} from "../log-viewer-utils";

describe("getLineNumberWidth", () => {
	test("returns minimum width of 3 for small line counts", () => {
		expect(getLineNumberWidth(0)).toBe(3);
		expect(getLineNumberWidth(1)).toBe(3);
		expect(getLineNumberWidth(9)).toBe(3);
		expect(getLineNumberWidth(99)).toBe(3);
		expect(getLineNumberWidth(999)).toBe(3);
	});

	test("returns 4 for 1000-9999 lines", () => {
		expect(getLineNumberWidth(1000)).toBe(4);
		expect(getLineNumberWidth(5000)).toBe(4);
		expect(getLineNumberWidth(9999)).toBe(4);
	});

	test("returns 5 for 10000-99999 lines", () => {
		expect(getLineNumberWidth(10000)).toBe(5);
		expect(getLineNumberWidth(50000)).toBe(5);
		expect(getLineNumberWidth(99999)).toBe(5);
	});

	test("returns 6 for 100000+ lines", () => {
		expect(getLineNumberWidth(100000)).toBe(6);
		expect(getLineNumberWidth(999999)).toBe(6);
	});

	test("returns 7 for 1000000+ lines", () => {
		expect(getLineNumberWidth(1000000)).toBe(7);
	});
});

describe("findMatchingLines", () => {
	const sampleLines = [
		"First line of log output",
		"Second line with ERROR message",
		"Third line is normal",
		"Fourth line has error too",
		"Fifth line with WARNING",
		"Sixth line mentions Error again",
	];

	test("returns empty array for empty query", () => {
		expect(findMatchingLines(sampleLines, "")).toEqual([]);
	});

	test("returns empty array for empty lines", () => {
		expect(findMatchingLines([], "error")).toEqual([]);
	});

	test("finds single match", () => {
		expect(findMatchingLines(sampleLines, "WARNING")).toEqual([4]);
	});

	test("finds multiple matches", () => {
		// "error" should match lines 1, 3, 5 (case-insensitive)
		expect(findMatchingLines(sampleLines, "error")).toEqual([1, 3, 5]);
	});

	test("is case-insensitive", () => {
		expect(findMatchingLines(sampleLines, "ERROR")).toEqual([1, 3, 5]);
		expect(findMatchingLines(sampleLines, "Error")).toEqual([1, 3, 5]);
		expect(findMatchingLines(sampleLines, "eRrOr")).toEqual([1, 3, 5]);
	});

	test("finds partial matches", () => {
		expect(findMatchingLines(sampleLines, "line")).toEqual([0, 1, 2, 3, 4, 5]);
	});

	test("returns empty array when no matches found", () => {
		expect(findMatchingLines(sampleLines, "CRITICAL")).toEqual([]);
	});

	test("handles special regex characters as literal text", () => {
		const linesWithSpecialChars = [
			"Error: [object Object]",
			"Warning: price is $100.00",
			"Path: /usr/bin/*",
		];
		expect(findMatchingLines(linesWithSpecialChars, "[object")).toEqual([0]);
		expect(findMatchingLines(linesWithSpecialChars, "$100")).toEqual([1]);
		expect(findMatchingLines(linesWithSpecialChars, "*")).toEqual([2]);
	});

	test("handles empty strings in lines array", () => {
		const linesWithEmpty = ["", "has content", "", "more content"];
		expect(findMatchingLines(linesWithEmpty, "content")).toEqual([1, 3]);
	});

	test("matches at start of line", () => {
		expect(findMatchingLines(sampleLines, "First")).toEqual([0]);
	});

	test("matches at end of line", () => {
		expect(findMatchingLines(sampleLines, "again")).toEqual([5]);
	});

	test("matches entire line", () => {
		expect(findMatchingLines(sampleLines, "Third line is normal")).toEqual([2]);
	});

	test("handles unicode search", () => {
		const unicodeLines = [
			"Normal ASCII text",
			"日本語のテキスト",
			"Mixed: Hello 世界",
		];
		expect(findMatchingLines(unicodeLines, "日本語")).toEqual([1]);
		expect(findMatchingLines(unicodeLines, "世界")).toEqual([2]);
	});

	test("preserves order of matches", () => {
		const lines = ["z match", "a match", "m match"];
		// Should return indices in order they appear, not alphabetically
		expect(findMatchingLines(lines, "match")).toEqual([0, 1, 2]);
	});
});

describe("truncateLine", () => {
	test("returns original line when lineWrap is true", () => {
		const longLine = "a".repeat(100);
		expect(truncateLine(longLine, 50, true)).toBe(longLine);
	});

	test("returns original line when line fits within width", () => {
		const line = "short line";
		expect(truncateLine(line, 50, false)).toBe(line);
	});

	test("returns original line when exactly at width", () => {
		const line = "exactly20characters!";
		expect(truncateLine(line, 20, false)).toBe(line);
	});

	test("truncates and adds ellipsis when line exceeds width", () => {
		const line = "this is a very long line that needs truncation";
		const result = truncateLine(line, 20, false);
		expect(result.length).toBe(20);
		expect(result.endsWith("…")).toBe(true);
		expect(result).toBe("this is a very long…");
	});

	test("handles empty string", () => {
		expect(truncateLine("", 50, false)).toBe("");
		expect(truncateLine("", 50, true)).toBe("");
	});

	test("handles single character line", () => {
		expect(truncateLine("x", 50, false)).toBe("x");
		expect(truncateLine("x", 1, false)).toBe("x");
	});

	test("handles width of 1 with longer line", () => {
		// Width 1 means we can fit 0 chars + ellipsis
		const result = truncateLine("hello", 1, false);
		expect(result).toBe("…");
	});

	test("handles width of 2", () => {
		const result = truncateLine("hello", 2, false);
		expect(result).toBe("h…");
	});

	test("preserves unicode characters", () => {
		const line = "Hello 世界 emoji 🎉 test";
		// Note: JS string length counts emoji as 2 chars
		expect(truncateLine(line, 100, false)).toBe(line);
	});

	test("truncates unicode line correctly", () => {
		const line = "Hello 世界!";
		const result = truncateLine(line, 8, false);
		expect(result.length).toBe(8);
		expect(result.endsWith("…")).toBe(true);
	});
});

describe("calculateContentWidth", () => {
	test("calculates width without sidebar or line numbers", () => {
		const result = calculateContentWidth({
			terminalWidth: 100,
			sidebarWidth: 0,
			showLineNumbers: false,
			lineNumberWidth: 3,
		});
		// terminalWidth (100) - scrollbarWidth (2) = 98
		expect(result).toBe(98);
	});

	test("accounts for sidebar when present", () => {
		const withoutSidebar = calculateContentWidth({
			terminalWidth: 100,
			sidebarWidth: 0,
			showLineNumbers: false,
			lineNumberWidth: 3,
		});
		const withSidebar = calculateContentWidth({
			terminalWidth: 100,
			sidebarWidth: 21, // Sidebar width (20) + margin gap (1)
			showLineNumbers: false,
			lineNumberWidth: 3,
		});
		// sidebarWidth is subtracted directly
		expect(withSidebar).toBe(withoutSidebar - 21);
	});

	test("accounts for line numbers when shown", () => {
		const withoutLineNumbers = calculateContentWidth({
			terminalWidth: 100,
			sidebarWidth: 0,
			showLineNumbers: false,
			lineNumberWidth: 3,
		});
		const withLineNumbers = calculateContentWidth({
			terminalWidth: 100,
			sidebarWidth: 0,
			showLineNumbers: true,
			lineNumberWidth: 3,
		});
		// gutterWidth = lineNumberWidth (3) + 2 = 5
		// contentPadding = 1
		// Total difference = 6
		expect(withLineNumbers).toBe(withoutLineNumbers - 6);
	});

	test("accounts for larger line number width", () => {
		const smallLineNumbers = calculateContentWidth({
			terminalWidth: 100,
			sidebarWidth: 0,
			showLineNumbers: true,
			lineNumberWidth: 3,
		});
		const largeLineNumbers = calculateContentWidth({
			terminalWidth: 100,
			sidebarWidth: 0,
			showLineNumbers: true,
			lineNumberWidth: 6,
		});
		// Difference should be 3 (6 - 3)
		expect(smallLineNumbers - largeLineNumbers).toBe(3);
	});

	test("accounts for both sidebar and line numbers", () => {
		const result = calculateContentWidth({
			terminalWidth: 100,
			sidebarWidth: 21,
			showLineNumbers: true,
			lineNumberWidth: 4,
		});
		// terminalWidth (100) - sidebarWidth (21)
		// - gutterWidth (4+2=6) - contentPadding (1) - scrollbarWidth (2) = 70
		expect(result).toBe(70);
	});

	test("enforces minimum width of 20", () => {
		const result = calculateContentWidth({
			terminalWidth: 30,
			sidebarWidth: 22,
			showLineNumbers: true,
			lineNumberWidth: 5,
		});
		expect(result).toBe(20);
	});

	test("handles very narrow terminal", () => {
		const result = calculateContentWidth({
			terminalWidth: 10,
			sidebarWidth: 0,
			showLineNumbers: false,
			lineNumberWidth: 3,
		});
		expect(result).toBe(20); // Floor of 20
	});

	test("handles zero sidebar width correctly", () => {
		const result = calculateContentWidth({
			terminalWidth: 80,
			sidebarWidth: 0,
			showLineNumbers: false,
			lineNumberWidth: 3,
		});
		// No sidebar adjustment when sidebarWidth is 0
		expect(result).toBe(78); // 80 - 2 (scrollbar)
	});
});

describe("calculateScrollInfo", () => {
	test("returns zeros when content fits in viewport", () => {
		const result = calculateScrollInfo({
			scrollTop: 0,
			viewportHeight: 100,
			contentHeight: 50,
			totalLines: 50,
		});
		expect(result).toEqual({ linesAbove: 0, linesBelow: 0 });
	});

	test("returns zeros when content equals viewport", () => {
		const result = calculateScrollInfo({
			scrollTop: 0,
			viewportHeight: 100,
			contentHeight: 100,
			totalLines: 100,
		});
		expect(result).toEqual({ linesAbove: 0, linesBelow: 0 });
	});

	test("shows linesBelow when scrolled to top", () => {
		const result = calculateScrollInfo({
			scrollTop: 0,
			viewportHeight: 50,
			contentHeight: 200,
			totalLines: 200,
		});
		expect(result.linesAbove).toBe(0);
		expect(result.linesBelow).toBeGreaterThan(0);
	});

	test("shows linesAbove when scrolled to bottom", () => {
		const result = calculateScrollInfo({
			scrollTop: 150, // maxScroll = 200 - 50 = 150
			viewportHeight: 50,
			contentHeight: 200,
			totalLines: 200,
		});
		expect(result.linesAbove).toBeGreaterThan(0);
		expect(result.linesBelow).toBe(0);
	});

	test("shows both when scrolled to middle", () => {
		const result = calculateScrollInfo({
			scrollTop: 75, // 50% of maxScroll (150)
			viewportHeight: 50,
			contentHeight: 200,
			totalLines: 200,
		});
		expect(result.linesAbove).toBeGreaterThan(0);
		expect(result.linesBelow).toBeGreaterThan(0);
	});

	test("handles wrapped lines via scroll ratio", () => {
		// When lines are wrapped, contentHeight > totalLines
		// 100 lines but each wraps to 2 rows = contentHeight of 200
		const result = calculateScrollInfo({
			scrollTop: 100, // 50% of maxScroll
			viewportHeight: 50,
			contentHeight: 200, // Wrapped content is taller
			totalLines: 100, // But only 100 logical lines
		});
		// Should distribute lines based on scroll ratio, not raw heights
		expect(result.linesAbove).toBeGreaterThan(0);
		expect(result.linesBelow).toBeGreaterThan(0);
		// Sum should equal scrollableLines (totalLines - visibleLines)
		const scrollableLines = 100 - 50;
		expect(result.linesAbove + result.linesBelow).toBe(scrollableLines);
	});

	test("linesAbove and linesBelow sum to scrollable lines", () => {
		const viewportHeight = 30;
		const totalLines = 100;
		const result = calculateScrollInfo({
			scrollTop: 50,
			viewportHeight,
			contentHeight: 200,
			totalLines,
		});
		const scrollableLines = totalLines - viewportHeight;
		expect(result.linesAbove + result.linesBelow).toBe(scrollableLines);
	});

	test("handles edge case of 0 maxScroll", () => {
		// When scrollTop is 0 and content equals viewport
		const result = calculateScrollInfo({
			scrollTop: 0,
			viewportHeight: 100,
			contentHeight: 100,
			totalLines: 100,
		});
		expect(result).toEqual({ linesAbove: 0, linesBelow: 0 });
	});

	test("handles small number of lines", () => {
		const result = calculateScrollInfo({
			scrollTop: 5,
			viewportHeight: 10,
			contentHeight: 20,
			totalLines: 20,
		});
		expect(result.linesAbove).toBeGreaterThanOrEqual(0);
		expect(result.linesBelow).toBeGreaterThanOrEqual(0);
	});

	test("handles totalLines less than viewportHeight", () => {
		// When we have fewer lines than viewport can display
		const result = calculateScrollInfo({
			scrollTop: 0,
			viewportHeight: 50,
			contentHeight: 100, // Content still taller due to wrapped lines
			totalLines: 30, // But only 30 logical lines
		});
		// estimatedVisibleLines = min(50, 30) = 30
		// scrollableLines = max(0, 30 - 30) = 0
		expect(result).toEqual({ linesAbove: 0, linesBelow: 0 });
	});
});

describe("calculateHighlightSegments", () => {
	test("returns single segment with full line when no query", () => {
		const line = "Hello world";
		expect(calculateHighlightSegments(line, "")).toEqual([
			{ text: "Hello world", isMatch: false },
		]);
	});

	test("returns single segment when no matches found", () => {
		const line = "Hello world";
		expect(calculateHighlightSegments(line, "xyz")).toEqual([
			{ text: "Hello world", isMatch: false },
		]);
	});

	test("highlights single match in middle", () => {
		const line = "Hello world test";
		expect(calculateHighlightSegments(line, "world")).toEqual([
			{ text: "Hello ", isMatch: false },
			{ text: "world", isMatch: true },
			{ text: " test", isMatch: false },
		]);
	});

	test("highlights match at start of line", () => {
		const line = "Hello world";
		expect(calculateHighlightSegments(line, "Hello")).toEqual([
			{ text: "Hello", isMatch: true },
			{ text: " world", isMatch: false },
		]);
	});

	test("highlights match at end of line", () => {
		const line = "Hello world";
		expect(calculateHighlightSegments(line, "world")).toEqual([
			{ text: "Hello ", isMatch: false },
			{ text: "world", isMatch: true },
		]);
	});

	test("highlights entire line when query matches full line", () => {
		const line = "test";
		expect(calculateHighlightSegments(line, "test")).toEqual([
			{ text: "test", isMatch: true },
		]);
	});

	test("highlights multiple matches", () => {
		const line = "error: something error again error";
		expect(calculateHighlightSegments(line, "error")).toEqual([
			{ text: "error", isMatch: true },
			{ text: ": something ", isMatch: false },
			{ text: "error", isMatch: true },
			{ text: " again ", isMatch: false },
			{ text: "error", isMatch: true },
		]);
	});

	test("is case-insensitive", () => {
		const line = "Hello HELLO hello HeLLo";
		expect(calculateHighlightSegments(line, "hello")).toEqual([
			{ text: "Hello", isMatch: true },
			{ text: " ", isMatch: false },
			{ text: "HELLO", isMatch: true },
			{ text: " ", isMatch: false },
			{ text: "hello", isMatch: true },
			{ text: " ", isMatch: false },
			{ text: "HeLLo", isMatch: true },
		]);
	});

	test("handles adjacent matches", () => {
		const line = "aaaaaa";
		expect(calculateHighlightSegments(line, "aa")).toEqual([
			{ text: "aa", isMatch: true },
			{ text: "aa", isMatch: true },
			{ text: "aa", isMatch: true },
		]);
	});

	test("handles empty line", () => {
		expect(calculateHighlightSegments("", "test")).toEqual([
			{ text: "", isMatch: false },
		]);
	});

	test("handles single character query", () => {
		const line = "a b a c a";
		expect(calculateHighlightSegments(line, "a")).toEqual([
			{ text: "a", isMatch: true },
			{ text: " b ", isMatch: false },
			{ text: "a", isMatch: true },
			{ text: " c ", isMatch: false },
			{ text: "a", isMatch: true },
		]);
	});

	test("handles special characters in query", () => {
		const line = "Error: [object Object]";
		expect(calculateHighlightSegments(line, "[object")).toEqual([
			{ text: "Error: ", isMatch: false },
			{ text: "[object", isMatch: true },
			{ text: " Object]", isMatch: false },
		]);
	});

	test("handles unicode characters", () => {
		const line = "Hello 世界 world 世界";
		expect(calculateHighlightSegments(line, "世界")).toEqual([
			{ text: "Hello ", isMatch: false },
			{ text: "世界", isMatch: true },
			{ text: " world ", isMatch: false },
			{ text: "世界", isMatch: true },
		]);
	});

	test("preserves original case in output", () => {
		const line = "ERROR warning Error WARNING";
		const result = calculateHighlightSegments(line, "error");
		// The matched text should preserve original casing
		expect(result[0]).toEqual({ text: "ERROR", isMatch: true });
		expect(result[2]).toEqual({ text: "Error", isMatch: true });
	});
});

describe("calculateVisibleRange", () => {
	test("returns empty range for zero lines", () => {
		const result = calculateVisibleRange({
			scrollTop: 0,
			viewportHeight: 50,
			totalLines: 0,
			cache: null,
		});
		expect(result).toEqual({
			start: 0,
			end: 0,
			topSpacerHeight: 0,
			bottomSpacerHeight: 0,
		});
	});

	test("returns empty range for zero viewport height", () => {
		const result = calculateVisibleRange({
			scrollTop: 0,
			viewportHeight: 0,
			totalLines: 100,
			cache: null,
		});
		expect(result).toEqual({
			start: 0,
			end: 0,
			topSpacerHeight: 0,
			bottomSpacerHeight: 0,
		});
	});

	test("calculates correct range at top of content (no cache)", () => {
		const result = calculateVisibleRange({
			scrollTop: 0,
			viewportHeight: 30,
			totalLines: 1000,
			cache: null,
		});
		// Should start at 0 (can't go negative with overscan)
		expect(result.start).toBe(0);
		// End should be viewportHeight + overscan
		expect(result.end).toBe(30 + OVERSCAN_COUNT);
		expect(result.topSpacerHeight).toBe(0);
		expect(result.bottomSpacerHeight).toBe(1000 - result.end);
	});

	test("calculates correct range in middle of content (no cache)", () => {
		const result = calculateVisibleRange({
			scrollTop: 500,
			viewportHeight: 30,
			totalLines: 1000,
			cache: null,
		});
		// Start should be scrollTop - overscan
		expect(result.start).toBe(500 - OVERSCAN_COUNT);
		// End should be scrollTop + viewportHeight + overscan
		expect(result.end).toBe(500 + 30 + OVERSCAN_COUNT);
		expect(result.topSpacerHeight).toBe(result.start);
		expect(result.bottomSpacerHeight).toBe(1000 - result.end);
	});

	test("calculates correct range at bottom of content (no cache)", () => {
		const result = calculateVisibleRange({
			scrollTop: 970,
			viewportHeight: 30,
			totalLines: 1000,
			cache: null,
		});
		// Start should be scrollTop - overscan
		expect(result.start).toBe(970 - OVERSCAN_COUNT);
		// End should be capped at totalLines
		expect(result.end).toBe(1000);
		expect(result.topSpacerHeight).toBe(result.start);
		expect(result.bottomSpacerHeight).toBe(0);
	});

	test("handles small content that fits in viewport", () => {
		const result = calculateVisibleRange({
			scrollTop: 0,
			viewportHeight: 100,
			totalLines: 50,
			cache: null,
		});
		// Should render all lines
		expect(result.start).toBe(0);
		expect(result.end).toBe(50);
		expect(result.topSpacerHeight).toBe(0);
		expect(result.bottomSpacerHeight).toBe(0);
	});

	test("respects custom overscan value", () => {
		const result = calculateVisibleRange({
			scrollTop: 500,
			viewportHeight: 30,
			totalLines: 1000,
			cache: null,
			overscan: 5,
		});
		expect(result.start).toBe(500 - 5);
		expect(result.end).toBe(500 + 30 + 5);
	});

	test("handles fractional scroll position", () => {
		const result = calculateVisibleRange({
			scrollTop: 500.5,
			viewportHeight: 30,
			totalLines: 1000,
			cache: null,
		});
		// firstVisibleLine = floor(500.5) = 500
		// lastVisibleLine = ceil(500.5 + 30) = 531
		expect(result.start).toBe(500 - OVERSCAN_COUNT);
		expect(result.end).toBe(531 + OVERSCAN_COUNT);
	});

	test("spacers plus visible range equals total lines (no cache)", () => {
		const result = calculateVisibleRange({
			scrollTop: 300,
			viewportHeight: 50,
			totalLines: 1000,
			cache: null,
		});
		const visibleCount = result.end - result.start;
		expect(
			result.topSpacerHeight + visibleCount + result.bottomSpacerHeight,
		).toBe(1000);
	});
});

describe("shouldVirtualize", () => {
	test("returns false for small number of lines", () => {
		expect(shouldVirtualize(50)).toBe(false);
		expect(shouldVirtualize(99)).toBe(false);
	});

	test("returns false at exactly the threshold", () => {
		expect(shouldVirtualize(VIRTUALIZATION_THRESHOLD - 1)).toBe(false);
	});

	test("returns true above threshold", () => {
		expect(shouldVirtualize(VIRTUALIZATION_THRESHOLD)).toBe(true);
		expect(shouldVirtualize(1000)).toBe(true);
		expect(shouldVirtualize(100000)).toBe(true);
	});

	test("returns false for zero lines", () => {
		expect(shouldVirtualize(0)).toBe(false);
	});
});

describe("Line Height Cache", () => {
	describe("calculateLineRows", () => {
		test("returns 1 for empty line", () => {
			expect(calculateLineRows("", 80, true)).toBe(1);
			expect(calculateLineRows("", 80, false)).toBe(1);
		});

		test("returns 1 when lineWrap is false", () => {
			expect(calculateLineRows("a".repeat(200), 80, false)).toBe(1);
		});

		test("returns 1 for line that fits in width", () => {
			expect(calculateLineRows("short line", 80, true)).toBe(1);
		});

		test("calculates wrapped rows correctly", () => {
			expect(calculateLineRows("a".repeat(80), 80, true)).toBe(1);
			expect(calculateLineRows("a".repeat(81), 80, true)).toBe(2);
			expect(calculateLineRows("a".repeat(160), 80, true)).toBe(2);
			expect(calculateLineRows("a".repeat(161), 80, true)).toBe(3);
		});

		test("handles zero/negative content width", () => {
			expect(calculateLineRows("test", 0, true)).toBe(1);
			expect(calculateLineRows("test", -10, true)).toBe(1);
		});
	});

	describe("buildLineHeightCache", () => {
		test("builds cache for empty lines array", () => {
			const cache = buildLineHeightCache([], 80, true);
			expect(cache.cumulativeRows).toEqual([]);
			expect(cache.contentWidth).toBe(80);
			expect(cache.lineWrap).toBe(true);
		});

		test("builds cache with uniform line heights", () => {
			const lines = ["short", "line", "here"];
			const cache = buildLineHeightCache(lines, 80, true);
			expect(cache.cumulativeRows).toEqual([1, 2, 3]);
		});

		test("builds cache with mixed line heights", () => {
			const lines = [
				"short",
				"a".repeat(100), // 2 rows at width 80
				"another short",
				"b".repeat(200), // 3 rows at width 80
			];
			const cache = buildLineHeightCache(lines, 80, true);
			expect(cache.cumulativeRows).toEqual([1, 3, 4, 7]);
		});

		test("builds cache without lineWrap", () => {
			const lines = ["a".repeat(200), "b".repeat(300)];
			const cache = buildLineHeightCache(lines, 80, false);
			// Without wrap, each line is 1 row regardless of length
			expect(cache.cumulativeRows).toEqual([1, 2]);
		});
	});

	describe("extendLineHeightCache", () => {
		test("extends cache with new lines", () => {
			const cache = buildLineHeightCache(["a", "b"], 80, true);
			const extended = extendLineHeightCache(cache, ["c", "d"]);
			expect(extended.cumulativeRows).toEqual([1, 2, 3, 4]);
		});

		test("handles extending with wrapped lines", () => {
			const cache = buildLineHeightCache(["short"], 80, true);
			const extended = extendLineHeightCache(cache, ["a".repeat(160)]);
			expect(extended.cumulativeRows).toEqual([1, 3]); // 1 + 2 rows
		});

		test("returns same cache when no new lines", () => {
			const cache = buildLineHeightCache(["a", "b"], 80, true);
			const extended = extendLineHeightCache(cache, []);
			expect(extended).toBe(cache);
		});
	});

	describe("getTotalRows", () => {
		test("returns 0 for empty cache", () => {
			const cache = buildLineHeightCache([], 80, true);
			expect(getTotalRows(cache)).toBe(0);
		});

		test("returns total rows for cache", () => {
			const cache = buildLineHeightCache(["a", "b", "c"], 80, true);
			expect(getTotalRows(cache)).toBe(3);
		});
	});

	describe("getLineStartRow", () => {
		test("returns 0 for first line", () => {
			const cache = buildLineHeightCache(["a", "b", "c"], 80, true);
			expect(getLineStartRow(cache, 0)).toBe(0);
		});

		test("returns correct start row", () => {
			const lines = ["short", "a".repeat(160), "another"];
			const cache = buildLineHeightCache(lines, 80, true);
			expect(getLineStartRow(cache, 0)).toBe(0);
			expect(getLineStartRow(cache, 1)).toBe(1);
			expect(getLineStartRow(cache, 2)).toBe(3); // After 2-row line
		});
	});

	describe("findLineAtRow", () => {
		test("returns 0 for empty cache", () => {
			const cache = buildLineHeightCache([], 80, true);
			expect(findLineAtRow(cache, 5)).toBe(0);
		});

		test("finds correct line for uniform heights", () => {
			const cache = buildLineHeightCache(["a", "b", "c", "d", "e"], 80, true);
			expect(findLineAtRow(cache, 0)).toBe(0);
			expect(findLineAtRow(cache, 1)).toBe(1);
			expect(findLineAtRow(cache, 2)).toBe(2);
			expect(findLineAtRow(cache, 4)).toBe(4);
		});

		test("finds correct line for mixed heights", () => {
			const lines = ["short", "a".repeat(160), "another", "b".repeat(240)];
			const cache = buildLineHeightCache(lines, 80, true);
			// cumulative: [1, 3, 4, 7]
			expect(findLineAtRow(cache, 0)).toBe(0); // row 0 -> line 0
			expect(findLineAtRow(cache, 1)).toBe(1); // row 1 -> line 1 (first row of wrapped)
			expect(findLineAtRow(cache, 2)).toBe(1); // row 2 -> still line 1
			expect(findLineAtRow(cache, 3)).toBe(2); // row 3 -> line 2
			expect(findLineAtRow(cache, 4)).toBe(3); // row 4 -> line 3
			expect(findLineAtRow(cache, 6)).toBe(3); // row 6 -> still line 3
		});
	});

	describe("calculateVisibleRange with cache", () => {
		test("uses precise calculation when lineWrap is false", () => {
			// With lineWrap=false, each line is exactly 1 row
			const lines = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
			const cache = buildLineHeightCache(lines, 80, false);
			// cumulative: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

			const result = calculateVisibleRange({
				scrollTop: 3,
				viewportHeight: 4, // See rows 3-6
				totalLines: 10,
				cache,
				overscan: 1,
			});

			// firstVisibleLine = 3, lastVisibleLine = 6
			// With overscan of 1: lines 2-7 (end exclusive = 8)
			expect(result.start).toBe(2);
			expect(result.end).toBe(8);
			expect(result.topSpacerHeight).toBe(2); // Lines 0-1
			expect(result.bottomSpacerHeight).toBe(2); // Lines 8-9
		});

		test("uses precise calculation when lineWrap is true with valid cache", () => {
			// Now we use precise calculation for both lineWrap ON and OFF
			// since LineMeasurer provides accurate row counts from OpenTUI
			const lines = [
				"a".repeat(160), // 2 rows when wrapped at width 80
				"b".repeat(160), // 2 rows when wrapped at width 80
				"short", // 1 row
			];
			// Total: 5 rows, cumulativeRows = [2, 4, 5]
			const cache = buildLineHeightCache(lines, 80, true);

			const result = calculateVisibleRange({
				scrollTop: 0,
				viewportHeight: 2,
				totalLines: 3,
				cache,
				overscan: 0,
			});

			// Precise calculation:
			// - Rows 0-1 visible (scrollTop=0, viewportHeight=2)
			// - Line 0 covers rows 0-1 (cumulative[0]=2)
			// - Only line 0 is visible
			expect(result.start).toBe(0);
			expect(result.end).toBe(1);
			// Precise spacer heights (row-based)
			expect(result.topSpacerHeight).toBe(0);
			expect(result.bottomSpacerHeight).toBe(3); // Total 5 rows - 2 rendered = 3
		});
	});
});

describe("Segment utilities", () => {
	describe("getSegmentsVisibleWidth", () => {
		test("returns 0 for empty segments", () => {
			expect(getSegmentsVisibleWidth([])).toBe(0);
		});

		test("calculates width of single segment", () => {
			const segments: TextSegment[] = [{ text: "Hello" }];
			expect(getSegmentsVisibleWidth(segments)).toBe(5);
		});

		test("calculates width of multiple segments", () => {
			const segments: TextSegment[] = [{ text: "Hello " }, { text: "World" }];
			expect(getSegmentsVisibleWidth(segments)).toBe(11);
		});

		test("handles segments with colors (width unchanged)", () => {
			const segments: TextSegment[] = [
				{ text: "Red", color: "#ff0000" },
				{ text: "Blue", color: "#0000ff", bgColor: "#ffffff" },
			];
			expect(getSegmentsVisibleWidth(segments)).toBe(7);
		});

		test("handles wide unicode characters", () => {
			const segments: TextSegment[] = [
				{ text: "Hello" },
				{ text: "世界" }, // 4 columns (2 wide chars)
			];
			expect(getSegmentsVisibleWidth(segments)).toBe(9);
		});
	});

	describe("truncateSegments", () => {
		test("returns original segments when lineWrap is true", () => {
			const segments: TextSegment[] = [
				{ text: "This is a long line", color: "#ff0000" },
			];
			const result = truncateSegments(segments, 10, true);
			expect(result).toBe(segments);
		});

		test("returns original segments when width is sufficient", () => {
			const segments: TextSegment[] = [{ text: "Short" }];
			const result = truncateSegments(segments, 10, false);
			expect(result).toEqual(segments);
		});

		test("truncates and adds ellipsis when exceeding width", () => {
			const segments: TextSegment[] = [{ text: "Hello World" }];
			const result = truncateSegments(segments, 8, false);
			const allText = result.map((s) => s.text).join("");
			expect(allText).toBe("Hello W…");
			expect(result.length).toBe(2); // truncated segment + ellipsis
		});

		test("preserves color when truncating", () => {
			const segments: TextSegment[] = [
				{ text: "Hello World", color: "#ff0000" },
			];
			const result = truncateSegments(segments, 8, false);
			expect(result[0]?.color).toBe("#ff0000");
		});

		test("preserves bgColor when truncating", () => {
			const segments: TextSegment[] = [
				{ text: "Hello World", bgColor: "#0000ff" },
			];
			const result = truncateSegments(segments, 8, false);
			expect(result[0]?.bgColor).toBe("#0000ff");
		});

		test("preserves attributes when truncating", () => {
			const segments: TextSegment[] = [{ text: "Hello World", attributes: 1 }];
			const result = truncateSegments(segments, 8, false);
			expect(result[0]?.attributes).toBe(1);
		});

		test("preserves all styling properties together", () => {
			const segments: TextSegment[] = [
				{
					text: "Styled text here",
					color: "#ff0000",
					bgColor: "#0000ff",
					attributes: 5,
				},
			];
			const result = truncateSegments(segments, 10, false);
			expect(result[0]?.color).toBe("#ff0000");
			expect(result[0]?.bgColor).toBe("#0000ff");
			expect(result[0]?.attributes).toBe(5);
		});

		test("handles multiple segments with truncation in middle segment", () => {
			const segments: TextSegment[] = [
				{ text: "First ", color: "#ff0000" },
				{ text: "Second", color: "#00ff00", bgColor: "#333333" },
			];
			const result = truncateSegments(segments, 10, false);
			const allText = result.map((s) => s.text).join("");
			expect(allText).toBe("First Sec…");
			// First segment should be preserved fully
			expect(result[0]?.text).toBe("First ");
			expect(result[0]?.color).toBe("#ff0000");
			// Second segment truncated with its styling
			expect(result[1]?.color).toBe("#00ff00");
			expect(result[1]?.bgColor).toBe("#333333");
		});

		test("returns empty segments unchanged", () => {
			const result = truncateSegments([], 10, false);
			expect(result).toEqual([]);
		});

		test("handles exact width match without truncation", () => {
			const segments: TextSegment[] = [{ text: "Exact" }];
			const result = truncateSegments(segments, 5, false);
			expect(result).toEqual(segments);
		});
	});

	describe("highlightSegmentsWithSearch", () => {
		test("returns segments with isMatch false when query is empty", () => {
			const segments: TextSegment[] = [{ text: "Hello World" }];
			const result = highlightSegmentsWithSearch(segments, "");
			expect(result).toHaveLength(1);
			expect(result[0]?.isMatch).toBe(false);
			expect(result[0]?.text).toBe("Hello World");
		});

		test("returns segments with isMatch false when no matches", () => {
			const segments: TextSegment[] = [{ text: "Hello World" }];
			const result = highlightSegmentsWithSearch(segments, "xyz");
			expect(result).toHaveLength(1);
			expect(result[0]?.isMatch).toBe(false);
		});

		test("highlights matching text", () => {
			const segments: TextSegment[] = [{ text: "Hello World" }];
			const result = highlightSegmentsWithSearch(segments, "World");
			expect(result.length).toBeGreaterThan(1);

			const matchSeg = result.find((s) => s.isMatch);
			expect(matchSeg?.text).toBe("World");

			const nonMatchSeg = result.find((s) => !s.isMatch);
			expect(nonMatchSeg?.text).toBe("Hello ");
		});

		test("preserves color in highlighted segments", () => {
			const segments: TextSegment[] = [
				{ text: "Hello World", color: "#ff0000" },
			];
			const result = highlightSegmentsWithSearch(segments, "World");

			for (const seg of result) {
				expect(seg.color).toBe("#ff0000");
			}
		});

		test("preserves bgColor in highlighted segments", () => {
			const segments: TextSegment[] = [
				{ text: "Hello World", bgColor: "#0000ff" },
			];
			const result = highlightSegmentsWithSearch(segments, "World");

			for (const seg of result) {
				expect(seg.bgColor).toBe("#0000ff");
			}
		});

		test("preserves attributes in highlighted segments", () => {
			const segments: TextSegment[] = [{ text: "Hello World", attributes: 3 }];
			const result = highlightSegmentsWithSearch(segments, "World");

			for (const seg of result) {
				expect(seg.attributes).toBe(3);
			}
		});

		test("preserves all styling in highlighted segments", () => {
			const segments: TextSegment[] = [
				{
					text: "Hello World",
					color: "#ff0000",
					bgColor: "#0000ff",
					attributes: 5,
				},
			];
			const result = highlightSegmentsWithSearch(segments, "World");

			for (const seg of result) {
				expect(seg.color).toBe("#ff0000");
				expect(seg.bgColor).toBe("#0000ff");
				expect(seg.attributes).toBe(5);
			}
		});

		test("handles multiple segments with match spanning segments", () => {
			const segments: TextSegment[] = [
				{ text: "Hel", color: "#ff0000" },
				{ text: "lo World", color: "#00ff00", bgColor: "#333333" },
			];
			const result = highlightSegmentsWithSearch(segments, "Hello");

			// "Hello" spans both segments
			const matchSegs = result.filter((s) => s.isMatch);
			expect(matchSegs.length).toBeGreaterThan(0);

			// Colors should be preserved from original segments
			const redMatch = matchSegs.find((s) => s.color === "#ff0000");
			const greenMatch = matchSegs.find((s) => s.color === "#00ff00");
			expect(redMatch).toBeDefined();
			expect(greenMatch).toBeDefined();
		});

		test("handles case-insensitive matching", () => {
			const segments: TextSegment[] = [{ text: "Hello WORLD" }];
			const result = highlightSegmentsWithSearch(segments, "world");

			const matchSeg = result.find((s) => s.isMatch);
			expect(matchSeg?.text).toBe("WORLD");
		});

		test("handles multiple matches", () => {
			const segments: TextSegment[] = [{ text: "foo bar foo baz foo" }];
			const result = highlightSegmentsWithSearch(segments, "foo");

			const matches = result.filter((s) => s.isMatch);
			expect(matches.length).toBe(3);
			for (const match of matches) {
				expect(match.text).toBe("foo");
			}
		});

		test("handles empty segments array", () => {
			const result = highlightSegmentsWithSearch([], "test");
			expect(result).toEqual([]);
		});

		test("handles segment with only match text", () => {
			const segments: TextSegment[] = [
				{ text: "exact", color: "#ff0000", bgColor: "#0000ff" },
			];
			const result = highlightSegmentsWithSearch(segments, "exact");
			expect(result).toHaveLength(1);
			expect(result[0]?.isMatch).toBe(true);
			expect(result[0]?.text).toBe("exact");
			expect(result[0]?.color).toBe("#ff0000");
			expect(result[0]?.bgColor).toBe("#0000ff");
		});
	});

	describe("charWrapSegments", () => {
		test("returns single row when content fits", () => {
			const segments: TextSegment[] = [{ text: "Hello" }];
			const rows = charWrapSegments(segments, 10);
			expect(rows).toEqual([[{ text: "Hello" }]]);
		});

		test("returns single row when content exactly fills width", () => {
			const segments: TextSegment[] = [{ text: "12345" }];
			const rows = charWrapSegments(segments, 5);
			expect(rows).toEqual([[{ text: "12345" }]]);
		});

		test("wraps when 1 char overflows", () => {
			const segments: TextSegment[] = [{ text: "123456" }];
			const rows = charWrapSegments(segments, 5);
			expect(rows).toHaveLength(2);
			expect(rows[0]?.map((s) => s.text).join("")).toBe("12345");
			expect(rows[1]?.map((s) => s.text).join("")).toBe("6");
		});

		test("wraps evenly into multiple rows", () => {
			const segments: TextSegment[] = [{ text: "aabbccdd" }];
			const rows = charWrapSegments(segments, 4);
			expect(rows).toHaveLength(2);
			expect(rows[0]?.map((s) => s.text).join("")).toBe("aabb");
			expect(rows[1]?.map((s) => s.text).join("")).toBe("ccdd");
		});

		test("wraps into three rows", () => {
			const segments: TextSegment[] = [{ text: "a".repeat(11) }];
			const rows = charWrapSegments(segments, 5);
			expect(rows).toHaveLength(3);
			expect(rows[0]?.map((s) => s.text).join("")).toBe("aaaaa");
			expect(rows[1]?.map((s) => s.text).join("")).toBe("aaaaa");
			expect(rows[2]?.map((s) => s.text).join("")).toBe("a");
		});

		test("preserves segment styling through wrap", () => {
			const segments: TextSegment[] = [
				{ text: "123456", color: "#ff0000", bgColor: "#000", attributes: 1 },
			];
			const rows = charWrapSegments(segments, 4);
			expect(rows).toHaveLength(2);
			expect(rows[0]?.[0]).toEqual({
				text: "1234",
				color: "#ff0000",
				bgColor: "#000",
				attributes: 1,
			});
			expect(rows[1]?.[0]).toEqual({
				text: "56",
				color: "#ff0000",
				bgColor: "#000",
				attributes: 1,
			});
		});

		test("splits across segment boundaries", () => {
			const segments: TextSegment[] = [
				{ text: "AAA", color: "#f00" },
				{ text: "BBB", color: "#0f0" },
			];
			const rows = charWrapSegments(segments, 4);
			expect(rows).toHaveLength(2);
			// Row 1: "AAA" + first char of "BBB"
			expect(rows[0]).toEqual([
				{ text: "AAA", color: "#f00" },
				{ text: "B", color: "#0f0" },
			]);
			// Row 2: remaining "BB"
			expect(rows[1]).toEqual([{ text: "BB", color: "#0f0" }]);
		});

		test("handles wide unicode characters", () => {
			// "中" is 2 columns wide
			const segments: TextSegment[] = [{ text: "AB中CD" }];
			// A(1) B(1) 中(2) C(1) D(1) = 6 columns
			const rows = charWrapSegments(segments, 4);
			expect(rows).toHaveLength(2);
			// "AB中" = 4 columns, "CD" = 2 columns
			expect(rows[0]?.map((s) => s.text).join("")).toBe("AB中");
			expect(rows[1]?.map((s) => s.text).join("")).toBe("CD");
		});

		test("does not split wide char that would straddle boundary", () => {
			// If only 1 column remains but next char needs 2, wrap before it
			const segments: TextSegment[] = [{ text: "ABC中D" }];
			// A(1) B(1) C(1) 中(2) D(1) = 6 columns
			const rows = charWrapSegments(segments, 4);
			expect(rows).toHaveLength(2);
			// "ABC" fits in 3, "中" needs 2 and would exceed 4 → wraps
			expect(rows[0]?.map((s) => s.text).join("")).toBe("ABC");
			expect(rows[1]?.map((s) => s.text).join("")).toBe("中D");
		});

		test("returns original for empty segments", () => {
			const rows = charWrapSegments([], 10);
			expect(rows).toEqual([[]]);
		});

		test("handles empty text segment", () => {
			const segments: TextSegment[] = [{ text: "" }];
			const rows = charWrapSegments(segments, 10);
			expect(rows).toEqual([[{ text: "" }]]);
		});

		test("works with generic types preserving extra fields", () => {
			type HighlightSeg = TextSegment & { isMatch: boolean };
			const segments: HighlightSeg[] = [
				{ text: "AABBB", color: "#f00", isMatch: true },
			];
			const rows = charWrapSegments(segments, 3);
			expect(rows).toHaveLength(2);
			expect(rows[0]?.[0]).toEqual({
				text: "AAB",
				color: "#f00",
				isMatch: true,
			});
			expect(rows[1]?.[0]).toEqual({
				text: "BB",
				color: "#f00",
				isMatch: true,
			});
		});

		test("row count matches calculateLineRows", () => {
			const text = "a".repeat(81);
			const segments: TextSegment[] = [{ text }];
			const rows = charWrapSegments(segments, 80);
			const expectedRows = calculateLineRows(text, 80, true);
			expect(rows).toHaveLength(expectedRows);
		});
	});
});
