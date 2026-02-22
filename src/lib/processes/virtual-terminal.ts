import { TextAttributes } from "@opentui/core";
import { Terminal } from "@xterm/headless";
import type { LogLine, TextSegment } from "../../types";

/**
 * Callback fired when the virtual terminal's display state changes.
 * Receives the full set of screen lines to render.
 */
export type VTChangeCallback = (screenLines: LogLine[]) => void;

/**
 * Wraps @xterm/headless to process raw PTY output through a real terminal
 * emulator. Maintains a screen buffer that handles cursor movement, erasing,
 * alternate screen, and all other VT100/xterm sequences correctly.
 *
 * The screen state is extracted as LogLine[] (same format as the existing
 * log model) so the LogViewer can render it uniformly.
 */
export class VirtualTerminal {
	private terminal: Terminal;
	private onChange: VTChangeCallback;
	private disposed = false;

	constructor(cols: number, rows: number, onChange: VTChangeCallback) {
		this.onChange = onChange;
		this.terminal = new Terminal({
			cols,
			rows,
			scrollback: 10000,
			allowProposedApi: true,
			logLevel: "off",
		});

		this.terminal.onWriteParsed(() => {
			if (!this.disposed) {
				this.emitScreenState();
			}
		});
	}

	/**
	 * Feed raw PTY data into the virtual terminal.
	 */
	write(data: string | Uint8Array): void {
		if (this.disposed) return;
		this.terminal.write(data);
	}

	/**
	 * Resize the virtual terminal (should match the PTY dimensions).
	 * Emits screen state immediately so the UI shows content clipped to the
	 * new width rather than displaying stale wider lines that wrap.
	 * extractLineSegments clamps to terminal.cols, so stale cells beyond the
	 * new width are excluded.
	 */
	resize(cols: number, rows: number): void {
		if (this.disposed) return;
		this.terminal.resize(cols, rows);
		this.emitScreenState();
	}

	/**
	 * Extract the current display state (scrollback + active screen) as LogLine[].
	 *
	 * Reads all lines from the normal buffer's scrollback region plus the
	 * visible viewport, converting each IBufferLine into a LogLine with
	 * TextSegment[] that preserves colors and attributes.
	 */
	private emitScreenState(): void {
		const buffer = this.terminal.buffer.active;
		const lines: LogLine[] = [];

		for (let y = 0; y < buffer.length; y++) {
			const bufferLine = buffer.getLine(y);
			if (!bufferLine) continue;
			const segments = this.extractLineSegments(bufferLine);
			lines.push({ segments });
		}

		// Trim trailing lines that are visually empty (no text AND no
		// explicit background color). Lines with only spaces but a
		// non-default bg must be kept — apps use them for filled bars.
		while (lines.length > 0) {
			const last = lines[lines.length - 1];
			if (!last) break;
			const hasContent = last.segments.some(
				(s) =>
					s.text.trim().length > 0 ||
					s.bgColor !== undefined ||
					s.bgColorIndex !== undefined,
			);
			if (!hasContent) {
				lines.pop();
			} else {
				break;
			}
		}

		this.onChange(lines);
	}

	/**
	 * Convert an IBufferLine into TextSegment[], grouping consecutive cells
	 * with the same style into single segments (like parseAnsiLine does).
	 */
	private extractLineSegments(
		line: import("@xterm/headless").IBufferLine,
	): TextSegment[] {
		const segments: TextSegment[] = [];
		const cell = this.terminal.buffer.active.getNullCell();
		let currentText = "";
		let currentFg: string | undefined;
		let currentFgIndex: number | undefined;
		let currentBg: string | undefined;
		let currentBgIndex: number | undefined;
		let currentAttrs = 0;

		const colCount = Math.min(line.length, this.terminal.cols);
		for (let x = 0; x < colCount; x++) {
			const c = line.getCell(x, cell);
			if (!c) continue;

			const chars = c.getChars();
			if (c.getWidth() === 0) continue;

			const { fg, fgIndex, bg, bgIndex, attrs } = this.getCellStyle(c);

			const sameStyle =
				fg === currentFg &&
				fgIndex === currentFgIndex &&
				bg === currentBg &&
				bgIndex === currentBgIndex &&
				attrs === currentAttrs;

			if (sameStyle) {
				currentText += chars || " ";
			} else {
				if (currentText.length > 0) {
					segments.push(
						this.buildSegment(
							currentText,
							currentFg,
							currentFgIndex,
							currentBg,
							currentBgIndex,
							currentAttrs,
						),
					);
				}
				currentText = chars || " ";
				currentFg = fg;
				currentFgIndex = fgIndex;
				currentBg = bg;
				currentBgIndex = bgIndex;
				currentAttrs = attrs;
			}
		}

		if (currentText.length > 0) {
			segments.push(
				this.buildSegment(
					currentText,
					currentFg,
					currentFgIndex,
					currentBg,
					currentBgIndex,
					currentAttrs,
				),
			);
		}

		// Trim trailing whitespace from the last segment, but only if it
		// has no explicit background color. Segments with a bg color need
		// their full width preserved so the background fills the line.
		const lastSeg = segments[segments.length - 1];
		if (
			lastSeg &&
			lastSeg.bgColor === undefined &&
			lastSeg.bgColorIndex === undefined
		) {
			lastSeg.text = lastSeg.text.replace(/\s+$/, "");
			if (lastSeg.text.length === 0) {
				segments.pop();
			}
		}

		return segments;
	}

	private getCellStyle(cell: import("@xterm/headless").IBufferCell): {
		fg: string | undefined;
		fgIndex: number | undefined;
		bg: string | undefined;
		bgIndex: number | undefined;
		attrs: number;
	} {
		let fg: string | undefined;
		let fgIndex: number | undefined;
		let bg: string | undefined;
		let bgIndex: number | undefined;

		if (cell.isFgPalette()) {
			const color = cell.getFgColor();
			if (color < 16) {
				fgIndex = color;
			} else {
				fg = `#${palette256ToHex(color)}`;
			}
		} else if (cell.isFgRGB()) {
			const color = cell.getFgColor();
			fg = `#${color.toString(16).padStart(6, "0")}`;
		}

		if (cell.isBgPalette()) {
			const color = cell.getBgColor();
			if (color < 16) {
				bgIndex = color;
			} else {
				bg = `#${palette256ToHex(color)}`;
			}
		} else if (cell.isBgRGB()) {
			const color = cell.getBgColor();
			bg = `#${color.toString(16).padStart(6, "0")}`;
		}

		let attrs = 0;
		if (cell.isBold()) attrs |= TextAttributes.BOLD;
		if (cell.isDim()) attrs |= TextAttributes.DIM;
		if (cell.isItalic()) attrs |= TextAttributes.ITALIC;
		if (cell.isUnderline()) attrs |= TextAttributes.UNDERLINE;
		if (cell.isBlink()) attrs |= TextAttributes.BLINK;
		if (cell.isInverse()) attrs |= TextAttributes.INVERSE;
		if (cell.isStrikethrough()) attrs |= TextAttributes.STRIKETHROUGH;

		return { fg, fgIndex, bg, bgIndex, attrs };
	}

	private buildSegment(
		text: string,
		fg: string | undefined,
		fgIndex: number | undefined,
		bg: string | undefined,
		bgIndex: number | undefined,
		attrs: number,
	): TextSegment {
		const segment: TextSegment = { text };
		if (fg) segment.color = fg;
		if (fgIndex !== undefined) segment.colorIndex = fgIndex;
		if (bg) segment.bgColor = bg;
		if (bgIndex !== undefined) segment.bgColorIndex = bgIndex;
		if (attrs) segment.attributes = attrs;
		return segment;
	}

	dispose(): void {
		this.disposed = true;
		this.terminal.dispose();
	}
}

/**
 * Convert a 256-palette color index (16-255) to a hex string.
 * Indices 0-15 are handled via colorIndex in the segment model.
 */
function palette256ToHex(index: number): string {
	if (index >= 16 && index <= 231) {
		// 6x6x6 color cube
		const i = index - 16;
		const r = Math.floor(i / 36);
		const g = Math.floor((i % 36) / 6);
		const b = i % 6;
		const toHex = (v: number) =>
			(v === 0 ? 0 : 55 + v * 40).toString(16).padStart(2, "0");
		return `${toHex(r)}${toHex(g)}${toHex(b)}`;
	}
	if (index >= 232 && index <= 255) {
		// Grayscale ramp
		const v = (8 + (index - 232) * 10).toString(16).padStart(2, "0");
		return `${v}${v}${v}`;
	}
	return "000000";
}
