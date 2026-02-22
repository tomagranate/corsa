import { describe, expect, test } from "bun:test";
import { TextAttributes } from "@opentui/core";
import type { LogLine, TextSegment } from "../../../types";
import { VirtualTerminal } from "../virtual-terminal";

/**
 * Helper: create a VT, write data, and collect the last emitted screen state.
 * Uses a Promise to wait for xterm-headless's async write parsing.
 */
function writeAndCapture(
	cols: number,
	rows: number,
	data: string,
): Promise<LogLine[]> {
	return new Promise((resolve) => {
		let lastLines: LogLine[] = [];
		const vt = new VirtualTerminal(cols, rows, (lines) => {
			lastLines = lines;
		});
		vt.write(data);
		setTimeout(() => {
			vt.dispose();
			resolve(lastLines);
		}, 50);
	});
}

/**
 * Helper: create a VT, write data, collect ALL emitted screen states.
 */
function writeAndCaptureAll(
	cols: number,
	rows: number,
	data: string,
): Promise<LogLine[][]> {
	return new Promise((resolve) => {
		const allEmissions: LogLine[][] = [];
		const vt = new VirtualTerminal(cols, rows, (lines) => {
			allEmissions.push(lines);
		});
		vt.write(data);
		setTimeout(() => {
			vt.dispose();
			resolve(allEmissions);
		}, 50);
	});
}

/** Concatenate all segment text in a LogLine. */
function lineText(line: LogLine): string {
	return line.segments.map((s) => s.text).join("");
}

/** Get total character width of a line's segments. */
function lineWidth(line: LogLine): number {
	return line.segments.reduce((w, s) => w + s.text.length, 0);
}

/** Get the max line width across all lines. */
function maxLineWidth(lines: LogLine[]): number {
	return Math.max(0, ...lines.map(lineWidth));
}

/** Find a segment containing the given text in the first line. */
function findSegment(
	lines: LogLine[],
	text: string,
	lineIndex = 0,
): TextSegment | undefined {
	return lines[lineIndex]?.segments.find((s) => s.text.includes(text));
}

// =============================================================================
// Basic output
// =============================================================================

describe("VirtualTerminal", () => {
	describe("basic output", () => {
		test("emits plain text", async () => {
			const lines = await writeAndCapture(80, 24, "Hello, world!");
			expect(lines.length).toBeGreaterThan(0);
			expect(lineText(lines[0] as LogLine)).toBe("Hello, world!");
		});

		test("handles multiple lines", async () => {
			const lines = await writeAndCapture(80, 24, "Line 1\r\nLine 2\r\nLine 3");
			const texts = lines.map(lineText);
			expect(texts[0]).toBe("Line 1");
			expect(texts[1]).toBe("Line 2");
			expect(texts[2]).toBe("Line 3");
		});

		test("trims trailing empty lines", async () => {
			const lines = await writeAndCapture(80, 24, "Only one line");
			expect(lines.length).toBe(1);
		});

		test("handles empty input", async () => {
			const lines = await writeAndCapture(80, 24, "");
			expect(lines.length).toBe(0);
		});

		test("handles line wrapping at column boundary", async () => {
			const longLine = "A".repeat(85);
			const lines = await writeAndCapture(80, 24, longLine);
			const allText = lines.map(lineText).join("");
			expect(allText).toBe(longLine);
			expect(lines.length).toBeGreaterThan(1);
		});
	});

	// =============================================================================
	// ANSI colors and attributes
	// =============================================================================

	describe("colors and attributes", () => {
		test("parses 16-color foreground (palette)", async () => {
			const lines = await writeAndCapture(80, 24, "\x1b[31mRed text\x1b[0m");
			const seg = findSegment(lines, "Red text");
			expect(seg).toBeDefined();
			expect(seg?.colorIndex).toBe(1);
		});

		test("parses 16-color background (palette)", async () => {
			const lines = await writeAndCapture(80, 24, "\x1b[42mGreen bg\x1b[0m");
			const seg = findSegment(lines, "Green bg");
			expect(seg).toBeDefined();
			expect(seg?.bgColorIndex).toBe(2);
		});

		test("parses 256-color foreground", async () => {
			const lines = await writeAndCapture(
				80,
				24,
				"\x1b[38;5;196mBright red\x1b[0m",
			);
			const seg = findSegment(lines, "Bright red");
			expect(seg).toBeDefined();
			expect(seg?.color).toBeDefined();
		});

		test("parses 256-color background", async () => {
			const lines = await writeAndCapture(
				80,
				24,
				"\x1b[48;5;21mBlue bg\x1b[0m",
			);
			const seg = findSegment(lines, "Blue bg");
			expect(seg).toBeDefined();
			expect(seg?.bgColor).toBeDefined();
		});

		test("parses RGB foreground", async () => {
			const lines = await writeAndCapture(
				80,
				24,
				"\x1b[38;2;255;128;0mOrange\x1b[0m",
			);
			const seg = findSegment(lines, "Orange");
			expect(seg).toBeDefined();
			expect(seg?.color).toBe("#ff8000");
		});

		test("parses RGB background", async () => {
			const lines = await writeAndCapture(
				80,
				24,
				"\x1b[48;2;0;0;255mBlue bg\x1b[0m",
			);
			const seg = findSegment(lines, "Blue bg");
			expect(seg).toBeDefined();
			expect(seg?.bgColor).toBe("#0000ff");
		});

		test("parses bold attribute", async () => {
			const lines = await writeAndCapture(80, 24, "\x1b[1mBold\x1b[0m");
			const seg = findSegment(lines, "Bold");
			expect(seg).toBeDefined();
			expect((seg?.attributes ?? 0) & TextAttributes.BOLD).toBeTruthy();
		});

		test("parses dim attribute", async () => {
			const lines = await writeAndCapture(80, 24, "\x1b[2mDim\x1b[0m");
			const seg = findSegment(lines, "Dim");
			expect(seg).toBeDefined();
			expect((seg?.attributes ?? 0) & TextAttributes.DIM).toBeTruthy();
		});

		test("parses italic attribute", async () => {
			const lines = await writeAndCapture(80, 24, "\x1b[3mItalic\x1b[0m");
			const seg = findSegment(lines, "Italic");
			expect(seg).toBeDefined();
			expect((seg?.attributes ?? 0) & TextAttributes.ITALIC).toBeTruthy();
		});

		test("parses underline attribute", async () => {
			const lines = await writeAndCapture(80, 24, "\x1b[4mUnderline\x1b[0m");
			const seg = findSegment(lines, "Underline");
			expect(seg).toBeDefined();
			expect((seg?.attributes ?? 0) & TextAttributes.UNDERLINE).toBeTruthy();
		});

		test("parses inverse attribute", async () => {
			const lines = await writeAndCapture(80, 24, "\x1b[7mInverse\x1b[0m");
			const seg = findSegment(lines, "Inverse");
			expect(seg).toBeDefined();
			expect((seg?.attributes ?? 0) & TextAttributes.INVERSE).toBeTruthy();
		});

		test("parses strikethrough attribute", async () => {
			const lines = await writeAndCapture(80, 24, "\x1b[9mStrike\x1b[0m");
			const seg = findSegment(lines, "Strike");
			expect(seg).toBeDefined();
			expect(
				(seg?.attributes ?? 0) & TextAttributes.STRIKETHROUGH,
			).toBeTruthy();
		});

		test("groups consecutive same-style cells into one segment", async () => {
			const lines = await writeAndCapture(80, 24, "\x1b[31mAAAAA\x1b[0m");
			const redSegments =
				lines[0]?.segments.filter((s) => s.colorIndex === 1) ?? [];
			expect(redSegments).toHaveLength(1);
			expect(redSegments[0]?.text).toBe("AAAAA");
		});

		test("splits different styles into separate segments", async () => {
			const lines = await writeAndCapture(
				80,
				24,
				"\x1b[31mRed\x1b[32mGreen\x1b[0m",
			);
			const allText = lines[0]?.segments.map((s) => s.text).join("") ?? "";
			expect(allText).toContain("Red");
			expect(allText).toContain("Green");
			const red = lines[0]?.segments.find((s) => s.text === "Red");
			const green = lines[0]?.segments.find((s) => s.text === "Green");
			expect(red?.colorIndex).toBe(1);
			expect(green?.colorIndex).toBe(2);
		});
	});

	// =============================================================================
	// Trailing whitespace trimming
	// =============================================================================

	describe("trailing whitespace trimming", () => {
		test("trims trailing whitespace from lines without bg color", async () => {
			const lines = await writeAndCapture(80, 24, "Hello   ");
			expect(lineText(lines[0] as LogLine)).toBe("Hello");
		});

		test("preserves trailing whitespace when segment has bg color", async () => {
			const data = `\x1b[48;2;0;0;0m${"X".repeat(10)}${" ".repeat(70)}\x1b[0m`;
			const lines = await writeAndCapture(80, 24, data);
			expect(lineWidth(lines[0] as LogLine)).toBe(80);
		});

		test("preserves trailing whitespace with palette bg color", async () => {
			const data = `\x1b[44mHello${" ".repeat(75)}\x1b[0m`;
			const lines = await writeAndCapture(80, 24, data);
			expect(lineWidth(lines[0] as LogLine)).toBe(80);
		});

		test("trims trailing empty lines without content", async () => {
			const lines = await writeAndCapture(80, 24, "Line 1\r\n");
			expect(lines.length).toBe(1);
			expect(lineText(lines[0] as LogLine)).toBe("Line 1");
		});

		test("preserves empty lines with bg color", async () => {
			const data = `Line 1\r\n\x1b[48;2;0;0;0m${" ".repeat(80)}\x1b[0m`;
			const lines = await writeAndCapture(80, 24, data);
			expect(lines.length).toBe(2);
		});
	});

	// =============================================================================
	// Cursor movement and screen control
	// =============================================================================

	describe("cursor movement and screen control", () => {
		test("handles carriage return (overwrites line)", async () => {
			const lines = await writeAndCapture(80, 24, "Old text\rNew");
			const text = lineText(lines[0] as LogLine);
			expect(text).toStartWith("New");
			expect(text).toContain("text");
		});

		test("handles cursor up (CSI A)", async () => {
			const lines = await writeAndCapture(
				80,
				24,
				"Line 1\r\nLine 2\x1b[1A\rOverwrite",
			);
			const text = lineText(lines[0] as LogLine);
			expect(text).toStartWith("Overwrite");
		});

		test("handles erase to end of line (CSI K)", async () => {
			const lines = await writeAndCapture(80, 24, "Hello World\r\x1b[5C\x1b[K");
			const text = lineText(lines[0] as LogLine);
			expect(text).toBe("Hello");
		});

		test("handles clear screen (CSI 2J)", async () => {
			const lines = await writeAndCapture(
				80,
				24,
				"Old content\r\n\x1b[2J\x1b[HNew content",
			);
			const allText = lines.map(lineText).join("");
			expect(allText).toContain("New content");
			expect(allText).not.toContain("Old content");
		});

		test("handles cursor positioning (CSI H)", async () => {
			const lines = await writeAndCapture(80, 24, "\x1b[3;5HPlaced");
			expect(lines.length).toBeGreaterThanOrEqual(3);
			const text = lineText(lines[2] as LogLine);
			expect(text).toContain("Placed");
		});
	});

	// =============================================================================
	// Alternate screen buffer
	// =============================================================================

	describe("alternate screen buffer", () => {
		test("switches to alternate buffer and back", async () => {
			const lines = await writeAndCapture(
				80,
				10,
				"Normal\r\n\x1b[?1049hAlt content\x1b[?1049l",
			);
			const allText = lines.map(lineText).join("");
			expect(allText).toContain("Normal");
		});

		test("alternate buffer content is isolated", async () => {
			let lastLines: LogLine[] = [];
			const vt = new VirtualTerminal(80, 10, (lines) => {
				lastLines = lines;
			});
			vt.write("Normal line");

			await new Promise<void>((r) => setTimeout(r, 50));
			const normalLines = [...lastLines];

			vt.write("\x1b[?1049hAlt only");
			await new Promise<void>((r) => setTimeout(r, 50));
			const altLines = [...lastLines];

			const normalText = normalLines.map(lineText).join("");
			const altText = altLines.map(lineText).join("");
			expect(normalText).toContain("Normal line");
			expect(altText).toContain("Alt only");
			expect(altText).not.toContain("Normal line");

			vt.dispose();
		});
	});

	// =============================================================================
	// Resize behavior (the bug fix)
	// =============================================================================

	describe("resize", () => {
		test("emits screen state on resize", async () => {
			let emitCount = 0;
			const vt = new VirtualTerminal(80, 24, () => {
				emitCount++;
			});
			vt.write("Hello");
			await new Promise<void>((r) => setTimeout(r, 50));
			const countBefore = emitCount;
			vt.resize(60, 24);
			expect(emitCount).toBe(countBefore + 1);
			vt.dispose();
		});

		test("resize clamps line width to new cols", async () => {
			let lastLines: LogLine[] = [];
			const vt = new VirtualTerminal(80, 10, (lines) => {
				lastLines = lines;
			});

			vt.write(`\x1b[48;2;0;0;0m${"X".repeat(80)}\x1b[0m`);
			await new Promise<void>((r) => setTimeout(r, 50));
			expect(maxLineWidth(lastLines)).toBe(80);

			vt.resize(60, 10);
			expect(maxLineWidth(lastLines)).toBeLessThanOrEqual(60);

			vt.dispose();
		});

		test("resize does not include stale cells from old width (the bug fix)", async () => {
			let lastLines: LogLine[] = [];
			const vt = new VirtualTerminal(80, 10, (lines) => {
				lastLines = lines;
			});

			// Enter alternate screen and fill with content at 80 cols
			vt.write("\x1b[?1049h");
			for (let i = 0; i < 10; i++) {
				vt.write(`\x1b[${i + 1};1H${"A".repeat(80)}`);
			}
			await new Promise<void>((r) => setTimeout(r, 50));
			expect(maxLineWidth(lastLines)).toBe(80);

			// Shrink — the bug was that extractLineSegments used line.length
			// (retains old 80-col allocation) instead of terminal.cols (60).
			vt.resize(60, 10);
			expect(maxLineWidth(lastLines)).toBeLessThanOrEqual(60);

			vt.dispose();
		});

		test("resize to larger does not lose content", async () => {
			let lastLines: LogLine[] = [];
			const vt = new VirtualTerminal(40, 10, (lines) => {
				lastLines = lines;
			});

			vt.write("Short line");
			await new Promise<void>((r) => setTimeout(r, 50));
			expect(lineText(lastLines[0] as LogLine)).toBe("Short line");

			vt.resize(80, 10);
			expect(lineText(lastLines[0] as LogLine)).toBe("Short line");

			vt.dispose();
		});

		test("multiple rapid resizes produce valid output each time", async () => {
			let lastLines: LogLine[] = [];
			const vt = new VirtualTerminal(80, 10, (lines) => {
				lastLines = lines;
			});

			vt.write("\x1b[?1049h");
			for (let i = 0; i < 10; i++) {
				vt.write(`\x1b[${i + 1};1H${"B".repeat(80)}`);
			}
			await new Promise<void>((r) => setTimeout(r, 50));

			const sizes = [60, 40, 50, 70, 45, 80];
			for (const cols of sizes) {
				vt.resize(cols, 10);
				expect(maxLineWidth(lastLines)).toBeLessThanOrEqual(cols);
			}

			vt.dispose();
		});

		test("resize followed by new write produces correctly sized output", async () => {
			let lastLines: LogLine[] = [];
			const vt = new VirtualTerminal(80, 10, (lines) => {
				lastLines = lines;
			});

			vt.write(`\x1b[?1049h${"X".repeat(80)}`);
			await new Promise<void>((r) => setTimeout(r, 50));

			vt.resize(60, 10);
			expect(maxLineWidth(lastLines)).toBeLessThanOrEqual(60);

			vt.write(`\x1b[2J\x1b[H${"Y".repeat(60)}`);
			await new Promise<void>((r) => setTimeout(r, 50));
			expect(lineText(lastLines[0] as LogLine)).toBe("Y".repeat(60));

			vt.dispose();
		});

		test("resize height changes number of lines in alternate buffer", async () => {
			let lastLines: LogLine[] = [];
			const vt = new VirtualTerminal(80, 24, (lines) => {
				lastLines = lines;
			});

			vt.write("\x1b[?1049h");
			for (let i = 0; i < 24; i++) {
				vt.write(`\x1b[${i + 1};1H` + `Row ${i + 1}`);
			}
			await new Promise<void>((r) => setTimeout(r, 50));

			vt.resize(80, 10);
			expect(lastLines.length).toBeLessThanOrEqual(10);

			vt.dispose();
		});
	});

	// =============================================================================
	// Scrollback
	// =============================================================================

	describe("scrollback", () => {
		test("preserves scrollback history in normal buffer", async () => {
			let lastLines: LogLine[] = [];
			const vt = new VirtualTerminal(80, 5, (lines) => {
				lastLines = lines;
			});

			for (let i = 1; i <= 20; i++) {
				vt.write(`Line ${i}\r\n`);
			}
			await new Promise<void>((r) => setTimeout(r, 50));

			expect(lastLines.length).toBeGreaterThan(5);
			const allText = lastLines.map(lineText).join("\n");
			expect(allText).toContain("Line 1");
			expect(allText).toContain("Line 20");

			vt.dispose();
		});
	});

	// =============================================================================
	// Dispose
	// =============================================================================

	describe("dispose", () => {
		test("does not emit after dispose", async () => {
			let emitCount = 0;
			const vt = new VirtualTerminal(80, 24, () => {
				emitCount++;
			});
			vt.write("Hello");
			await new Promise<void>((r) => setTimeout(r, 50));
			const countAfterWrite = emitCount;

			vt.dispose();
			vt.write("After dispose");
			await new Promise<void>((r) => setTimeout(r, 50));
			expect(emitCount).toBe(countAfterWrite);
		});

		test("resize after dispose is a no-op", () => {
			const vt = new VirtualTerminal(80, 24, () => {});
			vt.dispose();
			expect(() => vt.resize(60, 20)).not.toThrow();
		});
	});

	// =============================================================================
	// Edge cases
	// =============================================================================

	describe("edge cases", () => {
		test("handles very small terminal (minimum viable size)", async () => {
			const lines = await writeAndCapture(1, 1, "AB");
			expect(lines.length).toBeGreaterThan(0);
		});

		test("handles binary/control characters gracefully", async () => {
			const lines = await writeAndCapture(80, 24, "Before\x07\x00After");
			const allText = lines.map(lineText).join("");
			expect(allText).toContain("Before");
			expect(allText).toContain("After");
		});

		test("handles rapid sequential writes", async () => {
			let lastLines: LogLine[] = [];
			const vt = new VirtualTerminal(80, 24, (lines) => {
				lastLines = lines;
			});

			for (let i = 0; i < 100; i++) {
				vt.write(`Line ${i}\r\n`);
			}
			await new Promise<void>((r) => setTimeout(r, 100));

			const allText = lastLines.map(lineText).join("\n");
			expect(allText).toContain("Line 99");

			vt.dispose();
		});

		test("handles unicode characters", async () => {
			const lines = await writeAndCapture(80, 24, "Hello 世界 🌍");
			const text = lineText(lines[0] as LogLine);
			expect(text).toContain("Hello");
			expect(text).toContain("世界");
		});

		test("handles tab characters", async () => {
			const lines = await writeAndCapture(80, 24, "A\tB");
			const text = lineText(lines[0] as LogLine);
			expect(text).toContain("A");
			expect(text).toContain("B");
			expect(text.length).toBeGreaterThan(3);
		});
	});

	// =============================================================================
	// Full-screen TUI simulation
	// =============================================================================

	describe("full-screen TUI simulation", () => {
		test("simulates a TUI app drawing a status bar", async () => {
			const cols = 40;
			const rows = 10;

			const statusBar = "Status: OK".padEnd(cols);
			const data = `\x1b[?1049h\x1b[${rows};1H\x1b[7m${statusBar}\x1b[0m`;

			const lines = await writeAndCapture(cols, rows, data);
			const lastLine = lines[lines.length - 1];
			expect(lastLine).toBeDefined();
			expect(lineText(lastLine as LogLine)).toContain("Status: OK");
		});

		test("simulates a TUI app with title + content + footer", async () => {
			const cols = 40;
			const rows = 5;

			const title = "=== My App ===".padEnd(cols);
			const footer = "[q] quit".padEnd(cols);
			const data =
				"\x1b[?1049h" +
				"\x1b[1;1H\x1b[7m" +
				title +
				"\x1b[0m" +
				"\x1b[2;1HContent line 1" +
				"\x1b[3;1HContent line 2" +
				"\x1b[4;1HContent line 3" +
				`\x1b[${rows};1H\x1b[7m` +
				footer +
				"\x1b[0m";

			const lines = await writeAndCapture(cols, rows, data);
			expect(lines.length).toBeGreaterThanOrEqual(rows);
			expect(lineText(lines[0] as LogLine)).toContain("=== My App ===");
			expect(lineText(lines[1] as LogLine)).toBe("Content line 1");
			expect(lineText(lines[lines.length - 1] as LogLine)).toContain(
				"[q] quit",
			);
		});

		test("TUI resize: content clipped to new width, not garbled", async () => {
			const rows = 5;
			let lastLines: LogLine[] = [];
			const vt = new VirtualTerminal(80, rows, (lines) => {
				lastLines = lines;
			});

			vt.write("\x1b[?1049h");
			for (let i = 0; i < rows; i++) {
				vt.write(
					`\x1b[${i + 1};1H\x1b[48;2;30;30;30m` +
						`Row ${i + 1}`.padEnd(80) +
						"\x1b[0m",
				);
			}
			await new Promise<void>((r) => setTimeout(r, 50));

			for (const line of lastLines) {
				expect(lineWidth(line)).toBe(80);
			}

			vt.resize(40, rows);
			for (const line of lastLines) {
				expect(lineWidth(line)).toBeLessThanOrEqual(40);
			}

			expect(lineText(lastLines[0] as LogLine)).toContain("Row 1");

			vt.dispose();
		});
	});

	// =============================================================================
	// Callback behavior
	// =============================================================================

	describe("callback behavior", () => {
		test("fires callback on each write", async () => {
			const emissions = await writeAndCaptureAll(80, 24, "Hello\r\nWorld");
			expect(emissions.length).toBeGreaterThanOrEqual(1);
		});

		test("resize fires callback synchronously", () => {
			let callCount = 0;
			const vt = new VirtualTerminal(80, 24, () => {
				callCount++;
			});
			vt.resize(60, 20);
			expect(callCount).toBe(1);
			vt.dispose();
		});

		test("each emission is a fresh array (not mutated)", async () => {
			const emissions: LogLine[][] = [];
			const vt = new VirtualTerminal(80, 24, (lines) => {
				emissions.push(lines);
			});
			vt.write("First");
			await new Promise<void>((r) => setTimeout(r, 50));
			vt.write("\r\nSecond");
			await new Promise<void>((r) => setTimeout(r, 50));

			expect(emissions.length).toBeGreaterThanOrEqual(2);
			expect(emissions[0]).not.toBe(emissions[emissions.length - 1]);

			vt.dispose();
		});
	});
});
