/**
 * Callback signature for parsed lines.
 * @param line - The parsed line text
 * @param isReplacement - If true, replace the last emitted line (progress bars, spinners)
 */
export type OnLineCallback = (line: string, isReplacement: boolean) => void;

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ESC in terminal sequences is intentional
const CURSOR_HOME_RE = /\x1b\[1G/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ESC in terminal sequences is intentional
const CURSOR_CONTROL_RE = /\x1b\[[\d;]*[ABCDEFGHJK]/g;

/**
 * Stateful line parser that handles newlines and carriage returns.
 *
 * Carriage return (`\r`) behavior:
 * - `\r` within a complete line (ending with \n) means display content after last `\r`
 * - `\r\n` is treated as a normal line ending (Windows style)
 * - Incomplete lines with `\r` (real-time progress updates) trigger replacement
 *
 * Replacement logic:
 * - Complete lines are always NEW lines (isReplacement = false)
 * - Incomplete lines with `\r` are real-time updates (isReplacement = true)
 *
 * Used by both piped stream reading and PTY data callbacks.
 */
export class LineParser {
	private buffer = "";
	private lastWasIncompleteReplacement = false;
	private decoder = new TextDecoder();
	private onLine: OnLineCallback;

	constructor(onLine: OnLineCallback) {
		this.onLine = onLine;
	}

	/**
	 * Feed raw bytes into the parser.
	 * Decodes to string and processes lines.
	 */
	write(data: Uint8Array): void {
		this.push(this.decoder.decode(data, { stream: true }));
	}

	/**
	 * Feed a string chunk into the parser.
	 */
	push(chunk: string): void {
		let processed = chunk;

		// Normalize terminal control sequences that affect line content.
		// Programs like Node's readline redraw lines using ANSI sequences:
		//   \x1b[1G  → cursor to column 1 (equivalent to \r)
		//   \x1b[0J  → erase from cursor to end of screen
		//   \x1b[nG  → cursor to column n (positioning)
		//   \x1b[nK  → erase line (0=to end, 1=to start, 2=whole)
		// We convert cursor-home to \r and strip erase/positioning sequences
		// while preserving color/style codes (which end in 'm').
		if (processed.includes("\x1b[")) {
			// \x1b[1G (cursor to column 1) → \r (carriage return)
			processed = processed.replace(CURSOR_HOME_RE, "\r");
			// Strip erase and cursor-positioning sequences (J, K, G, and cursor movement A-F)
			processed = processed.replace(CURSOR_CONTROL_RE, "");
		}

		// Handle backspace characters (\x08) by removing the previous character
		// from the buffer instead of appending them. PTY sends \x08 \x08
		// (back, space, back) to visually erase a character.
		if (processed.includes("\x08")) {
			for (const char of processed) {
				if (char === "\x08") {
					if (this.buffer.length > 0) {
						this.buffer = this.buffer.slice(0, -1);
					}
				} else {
					this.buffer += char;
				}
			}
		} else {
			this.buffer += processed;
		}

		// Process complete lines (ending with \n)
		let newlineIdx = this.buffer.indexOf("\n");
		while (newlineIdx !== -1) {
			let line = this.buffer.slice(0, newlineIdx);
			this.buffer = this.buffer.slice(newlineIdx + 1);

			// Handle \r\n (Windows line ending) - strip trailing \r
			if (line.endsWith("\r")) {
				line = line.slice(0, -1);
			}

			// Handle \r within the line - take last segment after any \r
			// This simulates terminal "carriage return" behavior where
			// \r moves cursor to start of line, overwriting previous content
			const crIdx = line.lastIndexOf("\r");
			if (crIdx >= 0) {
				line = line.slice(crIdx + 1);
			}

			// Complete lines are always emitted as NEW lines.
			// However, if the previous emission was an incomplete replacement,
			// this complete line should replace it (finalizing the progress bar).
			const isReplacement = this.lastWasIncompleteReplacement;
			this.lastWasIncompleteReplacement = false;

			this.onLine(line, isReplacement);

			// Check for more newlines in the remaining buffer
			newlineIdx = this.buffer.indexOf("\n");
		}

		// Handle incomplete lines with \r (real-time progress bar updates)
		// If buffer contains \r, the content after last \r is the "current" line
		// Emit it as a replacement so it updates the display in real-time
		const crIdx = this.buffer.lastIndexOf("\r");
		if (crIdx >= 0) {
			const currentLine = this.buffer.slice(crIdx + 1);
			this.buffer = currentLine; // Keep only content after \r
			if (currentLine.length > 0) {
				this.onLine(currentLine, true); // Emit as replacement
				this.lastWasIncompleteReplacement = true;
			}
		}
	}

	/**
	 * Emit the current buffer as a partial/replacement line without clearing it.
	 * Used in PTY mode to display prompts and echoed characters immediately,
	 * even when the line is not yet terminated by a newline.
	 */
	flushPartial(): void {
		if (this.buffer.length > 0) {
			// Handle \r in buffer - take content after last \r
			const crIdx = this.buffer.lastIndexOf("\r");
			const displayLine =
				crIdx >= 0 ? this.buffer.slice(crIdx + 1) : this.buffer;
			if (displayLine.length > 0) {
				this.onLine(displayLine, this.lastWasIncompleteReplacement);
				this.lastWasIncompleteReplacement = true;
			}
		}
	}

	/**
	 * Flush any remaining buffered content.
	 * Call when the stream/source ends.
	 */
	flush(): void {
		if (this.buffer) {
			// Process any final \r in the remaining buffer
			const crIdx = this.buffer.lastIndexOf("\r");
			const finalLine = crIdx >= 0 ? this.buffer.slice(crIdx + 1) : this.buffer;
			if (finalLine.length > 0) {
				this.onLine(finalLine, this.lastWasIncompleteReplacement);
			}
			this.buffer = "";
			this.lastWasIncompleteReplacement = false;
		}
	}
}
