import { describe, expect, test } from "bun:test";
import { TextAttributes } from "@opentui/core";
import type { TextSegment } from "../../../types";
import { getVisibleWidth, parseAnsiLine, wrapSegments } from "../ansi";

// biome-ignore lint/suspicious/noControlCharactersInRegex: verifies terminal controls never reach rendered segments
const UNSAFE_CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x9b]/;

function expectSanitized(input: string, visibleText: string): TextSegment[] {
	const segments = parseAnsiLine(input);
	for (const segment of segments) {
		expect(segment.text).not.toMatch(UNSAFE_CONTROL_RE);
	}
	expect(segments.map((segment) => segment.text).join("")).toBe(visibleText);
	return segments;
}

describe("ANSI parsing", () => {
	test("parseAnsiLine - plain text", () => {
		const result = parseAnsiLine("Hello, world!");
		expect(result).toHaveLength(1);
		expect(result[0]?.text).toBe("Hello, world!");
		expect(result[0]?.color).toBeUndefined();
	});

	test("parseAnsiLine - with color codes", () => {
		const result = parseAnsiLine("\x1b[31mRed text\x1b[0m");
		expect(result.length).toBeGreaterThan(0);
		expect(result.some((seg) => seg.text.includes("Red text"))).toBe(true);
	});

	test("parseAnsiLine - with bold", () => {
		const result = parseAnsiLine("\x1b[1mBold text\x1b[0m");
		expect(result.length).toBeGreaterThan(0);
		const boldSegment = result.find((seg) => seg.text.includes("Bold text"));
		expect(boldSegment).toBeDefined();
		expect(boldSegment?.attributes).toBeDefined();
	});

	test("parseAnsiLine - multiple colors", () => {
		const result = parseAnsiLine("\x1b[31mRed\x1b[32mGreen\x1b[0m");
		// Should have at least one segment (may combine or separate based on implementation)
		expect(result.length).toBeGreaterThanOrEqual(1);
		// Should contain both "Red" and "Green" text
		const allText = result.map((seg) => seg.text).join("");
		expect(allText).toContain("Red");
		expect(allText).toContain("Green");
	});

	test("parseAnsiLine - empty string", () => {
		const result = parseAnsiLine("");
		expect(result).toHaveLength(0);
	});

	test("parseAnsiLine - only ANSI codes returns no segments", () => {
		const result = parseAnsiLine("\x1b[31m\x1b[0m");
		expect(result).toHaveLength(0);
	});

	test("parseAnsiLine - standard vs bright foreground colors have different indices", () => {
		// Standard colors use indices 0-7, bright colors use indices 8-15
		// Standard red (31) = index 1, bright red (91) = index 9
		const standardRed = parseAnsiLine("\x1b[31mRed\x1b[0m");
		const brightRed = parseAnsiLine("\x1b[91mBright Red\x1b[0m");
		const stdRedSeg = standardRed.find((s) => s.text === "Red");
		const brightRedSeg = brightRed.find((s) => s.text === "Bright Red");
		expect(stdRedSeg?.colorIndex).toBe(1); // Red
		expect(brightRedSeg?.colorIndex).toBe(9); // Bright Red
		expect(stdRedSeg?.colorIndex).not.toBe(brightRedSeg?.colorIndex);

		// Standard green (32) = index 2, bright green (92) = index 10
		const standardGreen = parseAnsiLine("\x1b[32mGreen\x1b[0m");
		const brightGreen = parseAnsiLine("\x1b[92mBright Green\x1b[0m");
		const stdGreenSeg = standardGreen.find((s) => s.text === "Green");
		const brightGreenSeg = brightGreen.find((s) => s.text === "Bright Green");
		expect(stdGreenSeg?.colorIndex).toBe(2); // Green
		expect(brightGreenSeg?.colorIndex).toBe(10); // Bright Green
		expect(stdGreenSeg?.colorIndex).not.toBe(brightGreenSeg?.colorIndex);

		// Standard blue (34) = index 4, bright blue (94) = index 12
		const standardBlue = parseAnsiLine("\x1b[34mBlue\x1b[0m");
		const brightBlue = parseAnsiLine("\x1b[94mBright Blue\x1b[0m");
		const stdBlueSeg = standardBlue.find((s) => s.text === "Blue");
		const brightBlueSeg = brightBlue.find((s) => s.text === "Bright Blue");
		expect(stdBlueSeg?.colorIndex).toBe(4); // Blue
		expect(brightBlueSeg?.colorIndex).toBe(12); // Bright Blue
		expect(stdBlueSeg?.colorIndex).not.toBe(brightBlueSeg?.colorIndex);

		// Standard white (37) = index 7, bright white (97) = index 15
		const standardWhite = parseAnsiLine("\x1b[37mWhite\x1b[0m");
		const brightWhite = parseAnsiLine("\x1b[97mBright White\x1b[0m");
		const stdWhiteSeg = standardWhite.find((s) => s.text === "White");
		const brightWhiteSeg = brightWhite.find((s) => s.text === "Bright White");
		expect(stdWhiteSeg?.colorIndex).toBe(7); // White
		expect(brightWhiteSeg?.colorIndex).toBe(15); // Bright White
		expect(stdWhiteSeg?.colorIndex).not.toBe(brightWhiteSeg?.colorIndex);
	});
});

describe("ANSI hostile control sanitization", () => {
	test.each([
		["RIS", "before\x1bcafter", "beforeafter"],
		["save/restore cursor", "a\x1b7b\x1b8c", "abc"],
		["reverse index and keypad modes", "a\x1bMb\x1b=c\x1b>d", "abcd"],
		["charset selection", "a\x1b(Bb\x1b)0c\x1b*Ad\x1b+0e", "abcde"],
		["private CSI", "a\x1b[?25lb\x1b[?25hc\x1b[?1049hd\x1b[?2004le", "abcde"],
		["prefixed CSI", "before\x1b[>4;2mafter", "beforeafter"],
		["CSI intermediates", "a\x1b[ qb\x1b[?25$pc", "abc"],
		["OSC title", "\x1b]0;title\x07hello", "hello"],
		["OSC hyperlink", "\x1b]8;;https://x\x1b\\link\x1b]8;;\x1b\\", "link"],
		["unterminated OSC", "hello\x1b]0;unfinished", "hello"],
		["DCS", "a\x1bPpayload\x1b\\b", "ab"],
		["SOS", "a\x1bXpayload\x1b\\b", "ab"],
		["PM", "a\x1b^payload\x1b\\b", "ab"],
		["APC unterminated", "a\x1b_payload", "a"],
		["C1 CSI", "a\x9b31mb", "ab"],
		["lone ESC", "hello\x1b", "hello"],
		["stray BEL", "be\x07ll", "bell"],
	] as const)("drops %s", (_name, input, visibleText) => {
		expectSanitized(input, visibleText);
	});

	test("a line containing only hostile escapes has zero segments", () => {
		const segments = expectSanitized("\x1bc\x1b[?25l\x1b]title\x07", "");
		expect(segments).toHaveLength(0);
	});

	test("preserves SGR styling around hostile controls", () => {
		const segments = expectSanitized(
			"\x1b[31mred\x1bc\x1b[32mgreen",
			"redgreen",
		);
		expect(
			segments.map(({ text, colorIndex }) => ({ text, colorIndex })),
		).toEqual([
			{ text: "red", colorIndex: 1 },
			{ text: "green", colorIndex: 2 },
		]);
	});

	test("prefixed m CSI does not alter style state", () => {
		const segments = expectSanitized(
			"\x1b[31mred\x1b[>4;2mstill red",
			"redstill red",
		);
		expect(segments).toHaveLength(1);
		expect(segments[0]?.colorIndex).toBe(1);
	});

	test("getVisibleWidth uses the same comprehensive sanitization", () => {
		expect(getVisibleWidth("a\x1bc\x1b]title\x07b\x07中")).toBe(4);
	});
});

describe("exhaustive escape sequence coverage", () => {
	const csiFinals = Array.from({ length: 0x7e - 0x40 + 1 }, (_, index) =>
		String.fromCharCode(0x40 + index),
	);

	test.each(csiFinals)("drops CSI with params and final %s", (final) => {
		expectSanitized(`a\x1b[1;2${final}b`, "ab");
	});

	test.each(csiFinals)("drops CSI with empty params and final %s", (final) => {
		expectSanitized(`a\x1b[${final}b`, "ab");
	});

	test("standard m remains SGR", () => {
		const segments = expectSanitized("a\x1b[31mb", "ab");
		expect(segments.find((segment) => segment.text === "b")?.colorIndex).toBe(
			1,
		);
	});

	test.each(
		["<", "=", ">", "?"].flatMap((prefix) =>
			["m", "h", "l"].map((final) => [prefix, final] as const),
		),
	)("drops private CSI prefix %s with final %s", (prefix, final) => {
		const segments = expectSanitized(
			`a\x1b[31mred\x1b[${prefix}4;2${final}b`,
			"aredb",
		);
		expect(
			segments.find((segment) => segment.text.includes("redb"))?.colorIndex,
		).toBe(1);
	});

	test.each([
		" ",
		"!",
		'"',
		"#",
		"$",
		"%",
		"&",
		"'",
		"(",
		")",
		"*",
		"+",
		",",
		"-",
		".",
		"/",
	])("drops CSI intermediate %s", (intermediate) => {
		expectSanitized(`a\x1b[1${intermediate}pb`, "ab");
	});

	const excludedEscFinals = new Set([
		"[",
		"]",
		"P",
		"X",
		"^",
		"_",
		"(",
		")",
		"*",
		"+",
	]);
	const escFinals = Array.from({ length: 0x7e - 0x30 + 1 }, (_, index) =>
		String.fromCharCode(0x30 + index),
	).filter((final) => !excludedEscFinals.has(final));

	test.each(escFinals)("drops ESC single-byte final %s", (final) => {
		expectSanitized(`a\x1b${final}b`, "ab");
	});

	test.each(
		["(", ")", "*", "+"].flatMap((introducer) =>
			["B", "0", "A"].map((final) => [introducer, final] as const),
		),
	)("drops charset designator ESC %s %s", (introducer, final) => {
		expectSanitized(`a\x1b${introducer}${final}b`, "ab");
	});

	test.each([
		["OSC BEL", "a\x1b]payload\x07b", "ab"],
		["OSC ST", "a\x1b]payload\x1b\\b", "ab"],
		["OSC unterminated", "a\x1b]payload", "a"],
		["DCS ST", "a\x1bPpayload\x1b\\b", "ab"],
		["DCS unterminated", "a\x1bPpayload", "a"],
		["SOS ST", "a\x1bXpayload\x1b\\b", "ab"],
		["SOS unterminated", "a\x1bXpayload", "a"],
		["PM ST", "a\x1b^payload\x1b\\b", "ab"],
		["PM unterminated", "a\x1b^payload", "a"],
		["APC ST", "a\x1b_payload\x1b\\b", "ab"],
		["APC unterminated", "a\x1b_payload", "a"],
	] as const)("handles %s string termination", (_name, input, visible) => {
		expectSanitized(input, visible);
	});

	test.each([
		...Array.from({ length: 0x20 }, (_, code) => code),
		0x7f,
	])("handles embedded C0/DEL byte 0x%s", (code) => {
		const input = `a${String.fromCharCode(code)}b`;
		if (code === 0x09 || code === 0x0a || code === 0x0d) {
			// Tabs, LF, and CR are intentionally preserved by the current parser.
			expectSanitized(input, input);
		} else if (code === 0x1b) {
			// ESC consumes the following byte as its single-byte escape sequence.
			expectSanitized(input, "a");
		} else {
			expectSanitized(input, "ab");
		}
	});
});

describe("ANSI background colors", () => {
	test("parseAnsiLine - standard background colors (40-47) use bgColorIndex", () => {
		// Standard background colors use indices 0-7
		const blackBg = parseAnsiLine("\x1b[40mBlack bg\x1b[0m");
		const blackSeg = blackBg.find((seg) => seg.text === "Black bg");
		expect(blackSeg?.bgColorIndex).toBe(0);

		const redBg = parseAnsiLine("\x1b[41mRed bg\x1b[0m");
		const redSeg = redBg.find((seg) => seg.text === "Red bg");
		expect(redSeg?.bgColorIndex).toBe(1);

		const greenBg = parseAnsiLine("\x1b[42mGreen bg\x1b[0m");
		const greenSeg = greenBg.find((seg) => seg.text === "Green bg");
		expect(greenSeg?.bgColorIndex).toBe(2);

		const yellowBg = parseAnsiLine("\x1b[43mYellow bg\x1b[0m");
		const yellowSeg = yellowBg.find((seg) => seg.text === "Yellow bg");
		expect(yellowSeg?.bgColorIndex).toBe(3);

		const blueBg = parseAnsiLine("\x1b[44mBlue bg\x1b[0m");
		const blueSeg = blueBg.find((seg) => seg.text === "Blue bg");
		expect(blueSeg?.bgColorIndex).toBe(4);

		const magentaBg = parseAnsiLine("\x1b[45mMagenta bg\x1b[0m");
		const magentaSeg = magentaBg.find((seg) => seg.text === "Magenta bg");
		expect(magentaSeg?.bgColorIndex).toBe(5);

		const cyanBg = parseAnsiLine("\x1b[46mCyan bg\x1b[0m");
		const cyanSeg = cyanBg.find((seg) => seg.text === "Cyan bg");
		expect(cyanSeg?.bgColorIndex).toBe(6);

		const whiteBg = parseAnsiLine("\x1b[47mWhite bg\x1b[0m");
		const whiteSeg = whiteBg.find((seg) => seg.text === "White bg");
		expect(whiteSeg?.bgColorIndex).toBe(7);
	});

	test("parseAnsiLine - bright background colors (100-107) use bgColorIndex", () => {
		// Bright background colors use indices 8-15
		const grayBg = parseAnsiLine("\x1b[100mGray bg\x1b[0m");
		const graySeg = grayBg.find((seg) => seg.text === "Gray bg");
		expect(graySeg?.bgColorIndex).toBe(8);

		const brightRedBg = parseAnsiLine("\x1b[101mBright red bg\x1b[0m");
		const brightRedSeg = brightRedBg.find(
			(seg) => seg.text === "Bright red bg",
		);
		expect(brightRedSeg?.bgColorIndex).toBe(9);

		const brightGreenBg = parseAnsiLine("\x1b[102mBright green bg\x1b[0m");
		const brightGreenSeg = brightGreenBg.find(
			(seg) => seg.text === "Bright green bg",
		);
		expect(brightGreenSeg?.bgColorIndex).toBe(10);

		const brightYellowBg = parseAnsiLine("\x1b[103mBright yellow bg\x1b[0m");
		const brightYellowSeg = brightYellowBg.find(
			(seg) => seg.text === "Bright yellow bg",
		);
		expect(brightYellowSeg?.bgColorIndex).toBe(11);

		const brightBlueBg = parseAnsiLine("\x1b[104mBright blue bg\x1b[0m");
		const brightBlueSeg = brightBlueBg.find(
			(seg) => seg.text === "Bright blue bg",
		);
		expect(brightBlueSeg?.bgColorIndex).toBe(12);

		const brightMagentaBg = parseAnsiLine("\x1b[105mBright magenta bg\x1b[0m");
		const brightMagentaSeg = brightMagentaBg.find(
			(seg) => seg.text === "Bright magenta bg",
		);
		expect(brightMagentaSeg?.bgColorIndex).toBe(13);

		const brightCyanBg = parseAnsiLine("\x1b[106mBright cyan bg\x1b[0m");
		const brightCyanSeg = brightCyanBg.find(
			(seg) => seg.text === "Bright cyan bg",
		);
		expect(brightCyanSeg?.bgColorIndex).toBe(14);

		const brightWhiteBg = parseAnsiLine("\x1b[107mBright white bg\x1b[0m");
		const brightWhiteSeg = brightWhiteBg.find(
			(seg) => seg.text === "Bright white bg",
		);
		expect(brightWhiteSeg?.bgColorIndex).toBe(15);
	});

	test("parseAnsiLine - combined foreground and background", () => {
		const result = parseAnsiLine("\x1b[31;44mRed on blue\x1b[0m");
		const segment = result.find((seg) => seg.text === "Red on blue");
		expect(segment?.colorIndex).toBe(1); // Red foreground (index 1)
		expect(segment?.bgColorIndex).toBe(4); // Blue background (index 4)
	});

	test("parseAnsiLine - background reset with code 49", () => {
		const result = parseAnsiLine("\x1b[44mBlue bg\x1b[49mNo bg\x1b[0m");
		const blueSeg = result.find((seg) => seg.text === "Blue bg");
		const noBgSeg = result.find((seg) => seg.text === "No bg");
		expect(blueSeg?.bgColorIndex).toBe(4);
		expect(noBgSeg?.bgColorIndex).toBeUndefined();
		expect(noBgSeg?.bgColor).toBeUndefined();
	});
});

describe("ANSI 256-color mode", () => {
	test("parseAnsiLine - 256-color foreground standard colors (0-7) use colorIndex", () => {
		// Colors 0-7 via 256-color mode still use colorIndex for theme-awareness
		const black = parseAnsiLine("\x1b[38;5;0mBlack\x1b[0m");
		const blackSeg = black.find((seg) => seg.text === "Black");
		expect(blackSeg?.colorIndex).toBe(0);

		const red = parseAnsiLine("\x1b[38;5;1mRed\x1b[0m");
		const redSeg = red.find((seg) => seg.text === "Red");
		expect(redSeg?.colorIndex).toBe(1);

		const white = parseAnsiLine("\x1b[38;5;7mWhite\x1b[0m");
		const whiteSeg = white.find((seg) => seg.text === "White");
		expect(whiteSeg?.colorIndex).toBe(7);
	});

	test("parseAnsiLine - 256-color foreground bright colors (8-15) use colorIndex", () => {
		// Colors 8-15 via 256-color mode still use colorIndex for theme-awareness
		const gray = parseAnsiLine("\x1b[38;5;8mGray\x1b[0m");
		const graySeg = gray.find((seg) => seg.text === "Gray");
		expect(graySeg?.colorIndex).toBe(8);

		const brightRed = parseAnsiLine("\x1b[38;5;9mBright Red\x1b[0m");
		const brightRedSeg = brightRed.find((seg) => seg.text === "Bright Red");
		expect(brightRedSeg?.colorIndex).toBe(9);

		const brightWhite = parseAnsiLine("\x1b[38;5;15mBright White\x1b[0m");
		const brightWhiteSeg = brightWhite.find(
			(seg) => seg.text === "Bright White",
		);
		expect(brightWhiteSeg?.colorIndex).toBe(15);
	});

	test("parseAnsiLine - 256-color cube (16-231)", () => {
		// Color 16 = rgb(0,0,0) - start of color cube
		const color16 = parseAnsiLine("\x1b[38;5;16mColor 16\x1b[0m");
		const seg16 = color16.find((seg) => seg.text === "Color 16");
		expect(seg16?.color).toBe("#000000");

		// Color 21 = rgb(0,0,255) - pure blue in cube
		const color21 = parseAnsiLine("\x1b[38;5;21mColor 21\x1b[0m");
		const seg21 = color21.find((seg) => seg.text === "Color 21");
		expect(seg21?.color).toBe("#0000ff");

		// Color 196 = rgb(255,0,0) - pure red in cube
		const color196 = parseAnsiLine("\x1b[38;5;196mColor 196\x1b[0m");
		const seg196 = color196.find((seg) => seg.text === "Color 196");
		expect(seg196?.color).toBe("#ff0000");

		// Color 46 = rgb(0,255,0) - pure green in cube
		const color46 = parseAnsiLine("\x1b[38;5;46mColor 46\x1b[0m");
		const seg46 = color46.find((seg) => seg.text === "Color 46");
		expect(seg46?.color).toBe("#00ff00");

		// Color 231 = rgb(255,255,255) - end of color cube
		const color231 = parseAnsiLine("\x1b[38;5;231mColor 231\x1b[0m");
		const seg231 = color231.find((seg) => seg.text === "Color 231");
		expect(seg231?.color).toBe("#ffffff");

		// Color 82 = some mid-range color (green-ish)
		const color82 = parseAnsiLine("\x1b[38;5;82mColor 82\x1b[0m");
		const seg82 = color82.find((seg) => seg.text === "Color 82");
		expect(seg82?.color).toMatch(/^#[0-9a-f]{6}$/i);
	});

	test("parseAnsiLine - 256-color grayscale ramp (232-255)", () => {
		// Color 232 = darkest gray
		const dark = parseAnsiLine("\x1b[38;5;232mDark gray\x1b[0m");
		const darkSeg = dark.find((seg) => seg.text === "Dark gray");
		expect(darkSeg?.color).toBe("#080808");

		// Color 255 = lightest gray
		const light = parseAnsiLine("\x1b[38;5;255mLight gray\x1b[0m");
		const lightSeg = light.find((seg) => seg.text === "Light gray");
		expect(lightSeg?.color).toBe("#eeeeee");

		// Color 244 = mid gray
		const mid = parseAnsiLine("\x1b[38;5;244mMid gray\x1b[0m");
		const midSeg = mid.find((seg) => seg.text === "Mid gray");
		expect(midSeg?.color).toMatch(/^#[0-9a-f]{6}$/i);
	});

	test("parseAnsiLine - 256-color background (48;5;X)", () => {
		// Background color 196 = red
		const redBg = parseAnsiLine("\x1b[48;5;196mRed bg\x1b[0m");
		const redSeg = redBg.find((seg) => seg.text === "Red bg");
		expect(redSeg?.bgColor).toBe("#ff0000");

		// Background color 46 = green
		const greenBg = parseAnsiLine("\x1b[48;5;46mGreen bg\x1b[0m");
		const greenSeg = greenBg.find((seg) => seg.text === "Green bg");
		expect(greenSeg?.bgColor).toBe("#00ff00");

		// Background grayscale
		const grayBg = parseAnsiLine("\x1b[48;5;240mGray bg\x1b[0m");
		const graySeg = grayBg.find((seg) => seg.text === "Gray bg");
		expect(graySeg?.bgColor).toMatch(/^#[0-9a-f]{6}$/i);
	});
});

describe("ANSI RGB colors (24-bit)", () => {
	test("parseAnsiLine - RGB foreground (38;2;R;G;B)", () => {
		// Pure red
		const red = parseAnsiLine("\x1b[38;2;255;0;0mRed\x1b[0m");
		const redSeg = red.find((seg) => seg.text === "Red");
		expect(redSeg?.color).toBe("#ff0000");

		// Pure green
		const green = parseAnsiLine("\x1b[38;2;0;255;0mGreen\x1b[0m");
		const greenSeg = green.find((seg) => seg.text === "Green");
		expect(greenSeg?.color).toBe("#00ff00");

		// Pure blue
		const blue = parseAnsiLine("\x1b[38;2;0;0;255mBlue\x1b[0m");
		const blueSeg = blue.find((seg) => seg.text === "Blue");
		expect(blueSeg?.color).toBe("#0000ff");

		// Custom color
		const custom = parseAnsiLine("\x1b[38;2;128;64;192mCustom\x1b[0m");
		const customSeg = custom.find((seg) => seg.text === "Custom");
		expect(customSeg?.color).toBe("#8040c0");

		// Black
		const black = parseAnsiLine("\x1b[38;2;0;0;0mBlack\x1b[0m");
		const blackSeg = black.find((seg) => seg.text === "Black");
		expect(blackSeg?.color).toBe("#000000");

		// White
		const white = parseAnsiLine("\x1b[38;2;255;255;255mWhite\x1b[0m");
		const whiteSeg = white.find((seg) => seg.text === "White");
		expect(whiteSeg?.color).toBe("#ffffff");
	});

	test("parseAnsiLine - RGB background (48;2;R;G;B)", () => {
		// Purple background
		const purple = parseAnsiLine("\x1b[48;2;128;0;128mPurple bg\x1b[0m");
		const purpleSeg = purple.find((seg) => seg.text === "Purple bg");
		expect(purpleSeg?.bgColor).toBe("#800080");

		// Orange background
		const orange = parseAnsiLine("\x1b[48;2;255;165;0mOrange bg\x1b[0m");
		const orangeSeg = orange.find((seg) => seg.text === "Orange bg");
		expect(orangeSeg?.bgColor).toBe("#ffa500");

		// Pink background
		const pink = parseAnsiLine("\x1b[48;2;255;192;203mPink bg\x1b[0m");
		const pinkSeg = pink.find((seg) => seg.text === "Pink bg");
		expect(pinkSeg?.bgColor).toBe("#ffc0cb");
	});

	test("parseAnsiLine - combined RGB foreground and background", () => {
		const result = parseAnsiLine(
			"\x1b[38;2;255;255;0;48;2;0;0;128mYellow on navy\x1b[0m",
		);
		const segment = result.find((seg) => seg.text === "Yellow on navy");
		expect(segment?.color).toBe("#ffff00");
		expect(segment?.bgColor).toBe("#000080");
	});
});

describe("ANSI text attributes", () => {
	test("parseAnsiLine - bold (code 1)", () => {
		const result = parseAnsiLine("\x1b[1mBold\x1b[0m");
		const segment = result.find((seg) => seg.text === "Bold");
		expect(segment?.attributes).toBe(TextAttributes.BOLD);
	});

	test("parseAnsiLine - dim (code 2)", () => {
		const result = parseAnsiLine("\x1b[2mDim\x1b[0m");
		const segment = result.find((seg) => seg.text === "Dim");
		expect(segment?.attributes).toBe(TextAttributes.DIM);
	});

	test("parseAnsiLine - italic (code 3)", () => {
		const result = parseAnsiLine("\x1b[3mItalic\x1b[0m");
		const segment = result.find((seg) => seg.text === "Italic");
		expect(segment?.attributes).toBe(TextAttributes.ITALIC);
	});

	test("parseAnsiLine - underline (code 4)", () => {
		const result = parseAnsiLine("\x1b[4mUnderline\x1b[0m");
		const segment = result.find((seg) => seg.text === "Underline");
		expect(segment?.attributes).toBe(TextAttributes.UNDERLINE);
	});

	test("parseAnsiLine - blink (code 5)", () => {
		const result = parseAnsiLine("\x1b[5mBlink\x1b[0m");
		const segment = result.find((seg) => seg.text === "Blink");
		expect(segment?.attributes).toBe(TextAttributes.BLINK);
	});

	test("parseAnsiLine - inverse/reverse (code 7)", () => {
		const result = parseAnsiLine("\x1b[7mInverse\x1b[0m");
		const segment = result.find((seg) => seg.text === "Inverse");
		expect(segment?.attributes).toBe(TextAttributes.INVERSE);
	});

	test("parseAnsiLine - strikethrough (code 9)", () => {
		const result = parseAnsiLine("\x1b[9mStrike\x1b[0m");
		const segment = result.find((seg) => seg.text === "Strike");
		expect(segment?.attributes).toBe(TextAttributes.STRIKETHROUGH);
	});

	test("parseAnsiLine - combined attributes (bold + italic)", () => {
		const result = parseAnsiLine("\x1b[1;3mBold Italic\x1b[0m");
		const segment = result.find((seg) => seg.text === "Bold Italic");
		expect(segment?.attributes).toBe(
			TextAttributes.BOLD | TextAttributes.ITALIC,
		);
	});

	test("parseAnsiLine - combined attributes (bold + underline + dim)", () => {
		const result = parseAnsiLine("\x1b[1;2;4mMulti attr\x1b[0m");
		const segment = result.find((seg) => seg.text === "Multi attr");
		expect(segment?.attributes).toBe(
			TextAttributes.BOLD | TextAttributes.DIM | TextAttributes.UNDERLINE,
		);
	});

	test("parseAnsiLine - attribute reset (code 22 resets bold/dim)", () => {
		const result = parseAnsiLine("\x1b[1mBold\x1b[22mNormal\x1b[0m");
		const boldSeg = result.find((seg) => seg.text === "Bold");
		const normalSeg = result.find((seg) => seg.text === "Normal");
		expect(boldSeg?.attributes).toBe(TextAttributes.BOLD);
		expect(normalSeg?.attributes ?? 0).toBe(0);
	});

	test("parseAnsiLine - italic reset (code 23)", () => {
		const result = parseAnsiLine("\x1b[3mItalic\x1b[23mNormal\x1b[0m");
		const italicSeg = result.find((seg) => seg.text === "Italic");
		const normalSeg = result.find((seg) => seg.text === "Normal");
		expect(italicSeg?.attributes).toBe(TextAttributes.ITALIC);
		expect(normalSeg?.attributes ?? 0).toBe(0);
	});

	test("parseAnsiLine - underline reset (code 24)", () => {
		const result = parseAnsiLine("\x1b[4mUnderline\x1b[24mNormal\x1b[0m");
		const underlineSeg = result.find((seg) => seg.text === "Underline");
		const normalSeg = result.find((seg) => seg.text === "Normal");
		expect(underlineSeg?.attributes).toBe(TextAttributes.UNDERLINE);
		expect(normalSeg?.attributes ?? 0).toBe(0);
	});

	test("parseAnsiLine - blink reset (code 25)", () => {
		const result = parseAnsiLine("\x1b[5mBlink\x1b[25mNormal\x1b[0m");
		const blinkSeg = result.find((seg) => seg.text === "Blink");
		const normalSeg = result.find((seg) => seg.text === "Normal");
		expect(blinkSeg?.attributes).toBe(TextAttributes.BLINK);
		expect(normalSeg?.attributes ?? 0).toBe(0);
	});

	test("parseAnsiLine - inverse reset (code 27)", () => {
		const result = parseAnsiLine("\x1b[7mInverse\x1b[27mNormal\x1b[0m");
		const inverseSeg = result.find((seg) => seg.text === "Inverse");
		const normalSeg = result.find((seg) => seg.text === "Normal");
		expect(inverseSeg?.attributes).toBe(TextAttributes.INVERSE);
		expect(normalSeg?.attributes ?? 0).toBe(0);
	});

	test("parseAnsiLine - strikethrough reset (code 29)", () => {
		const result = parseAnsiLine("\x1b[9mStrike\x1b[29mNormal\x1b[0m");
		const strikeSeg = result.find((seg) => seg.text === "Strike");
		const normalSeg = result.find((seg) => seg.text === "Normal");
		expect(strikeSeg?.attributes).toBe(TextAttributes.STRIKETHROUGH);
		expect(normalSeg?.attributes ?? 0).toBe(0);
	});

	test("parseAnsiLine - attributes with colors", () => {
		const result = parseAnsiLine("\x1b[1;31mBold red\x1b[0m");
		const segment = result.find((seg) => seg.text === "Bold red");
		expect(segment?.attributes).toBe(TextAttributes.BOLD);
		expect(segment?.colorIndex).toBe(1); // Red
	});

	test("parseAnsiLine - attributes with background", () => {
		const result = parseAnsiLine("\x1b[4;44mUnderline on blue\x1b[0m");
		const segment = result.find((seg) => seg.text === "Underline on blue");
		expect(segment?.attributes).toBe(TextAttributes.UNDERLINE);
		expect(segment?.bgColorIndex).toBe(4); // Blue
	});
});

describe("ANSI complex scenarios", () => {
	test("parseAnsiLine - multiple style changes in sequence", () => {
		const result = parseAnsiLine(
			"\x1b[31mRed\x1b[1m Bold\x1b[4m Underline\x1b[0m Normal",
		);
		const allText = result.map((seg) => seg.text).join("");
		expect(allText).toBe("Red Bold Underline Normal");

		// Find segments and verify progressive styling
		const redSeg = result.find((seg) => seg.text === "Red");
		expect(redSeg?.colorIndex).toBe(1); // Red

		const underlineSeg = result.find((seg) => seg.text === " Underline");
		expect(underlineSeg?.attributes).toBe(
			TextAttributes.BOLD | TextAttributes.UNDERLINE,
		);
	});

	test("parseAnsiLine - full RGB with all attributes", () => {
		const result = parseAnsiLine(
			"\x1b[1;3;4;38;2;255;128;0;48;2;0;64;128mStyled\x1b[0m",
		);
		const segment = result.find((seg) => seg.text === "Styled");
		expect(segment?.color).toBe("#ff8000"); // Orange foreground
		expect(segment?.bgColor).toBe("#004080"); // Dark blue background
		expect(segment?.attributes).toBe(
			TextAttributes.BOLD | TextAttributes.ITALIC | TextAttributes.UNDERLINE,
		);
	});

	test("parseAnsiLine - 256 color with attributes", () => {
		const result = parseAnsiLine("\x1b[1;38;5;196;48;5;21mRed on blue\x1b[0m");
		const segment = result.find((seg) => seg.text === "Red on blue");
		expect(segment?.color).toBe("#ff0000"); // 256-color red
		expect(segment?.bgColor).toBe("#0000ff"); // 256-color blue
		expect(segment?.attributes).toBe(TextAttributes.BOLD);
	});

	test("parseAnsiLine - preserves text between style changes", () => {
		const result = parseAnsiLine(
			"Start \x1b[31mred\x1b[0m middle \x1b[32mgreen\x1b[0m end",
		);
		const allText = result.map((seg) => seg.text).join("");
		expect(allText).toBe("Start red middle green end");
	});

	test("parseAnsiLine - handles empty reset", () => {
		const result = parseAnsiLine("\x1b[mReset text");
		expect(result.length).toBeGreaterThan(0);
		const allText = result.map((seg) => seg.text).join("");
		expect(allText).toBe("Reset text");
	});

	test("parseAnsiLine - handles default foreground (39) and background (49)", () => {
		const result = parseAnsiLine(
			"\x1b[31;44mColored\x1b[39mDefault fg\x1b[49mDefault bg\x1b[0m",
		);
		const coloredSeg = result.find((seg) => seg.text === "Colored");
		const fgResetSeg = result.find((seg) => seg.text === "Default fg");
		const bgResetSeg = result.find((seg) => seg.text === "Default bg");

		expect(coloredSeg?.colorIndex).toBe(1); // Red
		expect(coloredSeg?.bgColorIndex).toBe(4); // Blue

		expect(fgResetSeg?.colorIndex).toBeUndefined();
		expect(fgResetSeg?.color).toBeUndefined();
		expect(fgResetSeg?.bgColorIndex).toBe(4); // Still has blue bg

		expect(bgResetSeg?.colorIndex).toBeUndefined();
		expect(bgResetSeg?.color).toBeUndefined();
		expect(bgResetSeg?.bgColorIndex).toBeUndefined();
		expect(bgResetSeg?.bgColor).toBeUndefined();
	});
});

describe("getVisibleWidth", () => {
	test("getVisibleWidth - plain text", () => {
		expect(getVisibleWidth("hello")).toBe(5);
		expect(getVisibleWidth("world")).toBe(5);
	});

	test("getVisibleWidth - with ANSI codes", () => {
		expect(getVisibleWidth("\x1b[31mhello\x1b[0m")).toBe(5);
		expect(getVisibleWidth("\x1b[1mtest\x1b[0m")).toBe(4);
	});

	test("getVisibleWidth - empty string", () => {
		expect(getVisibleWidth("")).toBe(0);
	});

	test("getVisibleWidth - wide characters", () => {
		// Test with a CJK character (should count as 2)
		expect(getVisibleWidth("中")).toBe(2);
		expect(getVisibleWidth("hello中world")).toBe(12); // 5 + 2 + 5
	});

	test("getVisibleWidth - emoji", () => {
		// Emoji should count as 2
		expect(getVisibleWidth("😀")).toBe(2);
		expect(getVisibleWidth("hello😀world")).toBe(12); // 5 + 2 + 5
	});

	test("getVisibleWidth - mixed content", () => {
		const text = "\x1b[31mHello\x1b[0m 世界";
		const width = getVisibleWidth(text);
		// "Hello" = 5, space = 1, "世" = 2, "界" = 2, total = 10
		expect(width).toBe(10);
	});
});

describe("wrapSegments", () => {
	test("returns empty array for empty input", () => {
		const result = wrapSegments([], 80);
		expect(result).toHaveLength(0);
	});

	test("single segment fits within width - no wrapping", () => {
		const segments: TextSegment[] = [{ text: "Hello" }];
		const result = wrapSegments(segments, 80);
		expect(result).toHaveLength(1);
		expect(result[0]).toHaveLength(1);
		expect(result[0]?.[0]?.text).toBe("Hello");
	});

	test("wraps long text across multiple lines", () => {
		const segments: TextSegment[] = [{ text: "Hello World" }];
		const result = wrapSegments(segments, 6); // Width of 6 should wrap after "Hello "
		expect(result.length).toBeGreaterThanOrEqual(2);
		// All text should be preserved across lines
		const allText = result
			.flat()
			.map((s) => s.text)
			.join("");
		expect(allText).toBe("Hello World");
	});

	test("preserves color attributes when wrapping", () => {
		const segments: TextSegment[] = [
			{ text: "Red text here", color: "red", attributes: 1 },
		];
		const result = wrapSegments(segments, 5);
		// All resulting segments should preserve the color
		for (const line of result) {
			for (const segment of line) {
				expect(segment.color).toBe("red");
				expect(segment.attributes).toBe(1);
			}
		}
	});

	test("handles multiple segments", () => {
		const segments: TextSegment[] = [
			{ text: "Hello ", color: "red" },
			{ text: "World", color: "blue" },
		];
		const result = wrapSegments(segments, 80);
		expect(result).toHaveLength(1);
		expect(result[0]).toHaveLength(2);
		expect(result[0]?.[0]?.color).toBe("red");
		expect(result[0]?.[1]?.color).toBe("blue");
	});

	test("handles wide characters correctly", () => {
		const segments: TextSegment[] = [{ text: "中文" }]; // 4 columns wide
		const result = wrapSegments(segments, 3); // Should wrap after first character
		expect(result.length).toBeGreaterThanOrEqual(2);
	});

	test("handles very narrow width", () => {
		const segments: TextSegment[] = [{ text: "abc" }];
		const result = wrapSegments(segments, 1);
		// Should split into individual characters
		expect(result.length).toBe(3);
	});
});
