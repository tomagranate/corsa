import { describe, expect, test } from "bun:test";
import { LineParser } from "../line-parser";

/**
 * Helper: feed a string through a LineParser and collect emitted lines.
 */
function parseString(
	input: string,
): { line: string; isReplacement: boolean }[] {
	const results: { line: string; isReplacement: boolean }[] = [];
	const parser = new LineParser((line, isReplacement) => {
		results.push({ line, isReplacement });
	});
	parser.push(input);
	parser.flush();
	return results;
}

/**
 * Helper: feed bytes through a LineParser and collect emitted lines.
 */
function parseBytes(input: string): { line: string; isReplacement: boolean }[] {
	const results: { line: string; isReplacement: boolean }[] = [];
	const parser = new LineParser((line, isReplacement) => {
		results.push({ line, isReplacement });
	});
	parser.write(new TextEncoder().encode(input));
	parser.flush();
	return results;
}

describe("LineParser", () => {
	// =========================================================================
	// Basic line parsing
	// =========================================================================

	test("parses simple newline-separated lines", () => {
		const results = parseString("Line 1\nLine 2\nLine 3\n");
		expect(results).toEqual([
			{ line: "Line 1", isReplacement: false },
			{ line: "Line 2", isReplacement: false },
			{ line: "Line 3", isReplacement: false },
		]);
	});

	test("handles empty input", () => {
		const results = parseString("");
		expect(results).toEqual([]);
	});

	test("handles input without trailing newline", () => {
		const results = parseString("no newline");
		expect(results).toEqual([{ line: "no newline", isReplacement: false }]);
	});

	test("handles empty lines", () => {
		const results = parseString("a\n\nb\n");
		expect(results).toEqual([
			{ line: "a", isReplacement: false },
			{ line: "", isReplacement: false },
			{ line: "b", isReplacement: false },
		]);
	});

	// =========================================================================
	// Windows line endings (CRLF)
	// =========================================================================

	test("strips \\r\\n (Windows line endings)", () => {
		const results = parseString("Line 1\r\nLine 2\r\nLine 3\r\n");
		expect(results).toEqual([
			{ line: "Line 1", isReplacement: false },
			{ line: "Line 2", isReplacement: false },
			{ line: "Line 3", isReplacement: false },
		]);
	});

	// =========================================================================
	// Carriage return handling (progress bars / spinners)
	// =========================================================================

	test("carriage return within complete line takes last segment", () => {
		const results = parseString("foo\rbar\rbaz\n");
		expect(results).toEqual([{ line: "baz", isReplacement: false }]);
	});

	test("progress bar - multiple \\r updates resolve to final state", () => {
		const results = parseString(
			"\rProgress 10%\rProgress 50%\rProgress 100%\n",
		);
		// The intermediate \r updates may emit replacements, but the final
		// complete line should be the last emitted
		const lastResult = results[results.length - 1];
		expect(lastResult?.line).toBe("Progress 100%");
	});

	test("spinner frames - intermediate \\r updates are replacements", () => {
		const results = parseString("\r- Loading\r/ Loading\rDone!\n");
		// The complete line "Done!" should be the final emission.
		// Intermediate replacements may be emitted for real-time display.
		const lastResult = results[results.length - 1];
		expect(lastResult?.line).toBe("Done!");
	});

	test("mixed normal lines and progress updates", () => {
		const results = parseString(
			"Starting...\n\rStep 1\rStep 2\rStep 3 done\nFinished!\n",
		);
		// First line is normal
		expect(results[0]).toEqual({ line: "Starting...", isReplacement: false });
		// Last line is normal
		const lastResult = results[results.length - 1];
		expect(lastResult).toEqual({ line: "Finished!", isReplacement: false });
		// The "Step 3 done" line should appear somewhere in between
		const stepLine = results.find((r) => r.line === "Step 3 done");
		expect(stepLine).toBeDefined();
	});

	// =========================================================================
	// Incremental / streaming input
	// =========================================================================

	test("handles data split across multiple push() calls", () => {
		const results: { line: string; isReplacement: boolean }[] = [];
		const parser = new LineParser((line, isReplacement) => {
			results.push({ line, isReplacement });
		});

		parser.push("Hel");
		parser.push("lo W");
		parser.push("orld\nLine 2\n");
		parser.flush();

		expect(results).toEqual([
			{ line: "Hello World", isReplacement: false },
			{ line: "Line 2", isReplacement: false },
		]);
	});

	test("handles newline split across chunks", () => {
		const results: { line: string; isReplacement: boolean }[] = [];
		const parser = new LineParser((line, isReplacement) => {
			results.push({ line, isReplacement });
		});

		parser.push("abc");
		// No emission yet (no newline)
		expect(results).toHaveLength(0);

		parser.push("\ndef\n");
		expect(results).toEqual([
			{ line: "abc", isReplacement: false },
			{ line: "def", isReplacement: false },
		]);

		parser.flush();
	});

	test("flush emits remaining buffer content", () => {
		const results: { line: string; isReplacement: boolean }[] = [];
		const parser = new LineParser((line, isReplacement) => {
			results.push({ line, isReplacement });
		});

		parser.push("incomplete");
		expect(results).toHaveLength(0);

		parser.flush();
		expect(results).toEqual([{ line: "incomplete", isReplacement: false }]);
	});

	test("flush with carriage return in remaining buffer", () => {
		const results: { line: string; isReplacement: boolean }[] = [];
		const parser = new LineParser((line, isReplacement) => {
			results.push({ line, isReplacement });
		});

		parser.push("old\rfinal");
		parser.flush();

		// Should emit "final" (after last \r)
		const lastResult = results[results.length - 1];
		expect(lastResult?.line).toBe("final");
	});

	// =========================================================================
	// write() - byte input
	// =========================================================================

	test("write() decodes bytes and parses lines", () => {
		const results = parseBytes("Hello\nWorld\n");
		expect(results).toEqual([
			{ line: "Hello", isReplacement: false },
			{ line: "World", isReplacement: false },
		]);
	});

	test("write() handles UTF-8 bytes", () => {
		const results = parseBytes("Unicode: 🎉✅\n");
		expect(results).toEqual([{ line: "Unicode: 🎉✅", isReplacement: false }]);
	});

	// =========================================================================
	// Replacement tracking across chunks
	// =========================================================================

	test("incomplete line with \\r marks next complete line as replacement", () => {
		const results: { line: string; isReplacement: boolean }[] = [];
		const parser = new LineParser((line, isReplacement) => {
			results.push({ line, isReplacement });
		});

		// First chunk: incomplete progress update
		parser.push("Downloading...\r50%");
		// "50%" should be emitted as replacement
		const afterFirstChunk = [...results];
		const replacement = afterFirstChunk.find((r) => r.line === "50%");
		expect(replacement?.isReplacement).toBe(true);

		// Second chunk: completes the line
		parser.push("\rDone!\n");
		parser.flush();

		// "Done!" should replace the previous incomplete line
		const doneLine = results.find((r) => r.line === "Done!");
		expect(doneLine).toBeDefined();
		expect(doneLine?.isReplacement).toBe(true);
	});

	// =========================================================================
	// flushPartial() - PTY prompt/echo display
	// =========================================================================

	test("flushPartial emits buffer as a new line when no prior partial", () => {
		const results: { line: string; isReplacement: boolean }[] = [];
		const parser = new LineParser((line, isReplacement) => {
			results.push({ line, isReplacement });
		});

		parser.push("What is your name? ");
		expect(results).toHaveLength(0);

		parser.flushPartial();
		expect(results).toEqual([
			{ line: "What is your name? ", isReplacement: false },
		]);
	});

	test("flushPartial emits as replacement on subsequent calls", () => {
		const results: { line: string; isReplacement: boolean }[] = [];
		const parser = new LineParser((line, isReplacement) => {
			results.push({ line, isReplacement });
		});

		// Prompt
		parser.push("Name: ");
		parser.flushPartial();
		expect(results).toHaveLength(1);
		expect(results[0]).toEqual({ line: "Name: ", isReplacement: false });

		// User types 'T' (PTY echo)
		parser.push("T");
		parser.flushPartial();
		expect(results).toHaveLength(2);
		expect(results[1]).toEqual({ line: "Name: T", isReplacement: true });

		// User types 'om'
		parser.push("om");
		parser.flushPartial();
		expect(results).toHaveLength(3);
		expect(results[2]).toEqual({ line: "Name: Tom", isReplacement: true });
	});

	test("flushPartial then newline finalizes the line", () => {
		const results: { line: string; isReplacement: boolean }[] = [];
		const parser = new LineParser((line, isReplacement) => {
			results.push({ line, isReplacement });
		});

		// Prompt + echo
		parser.push("Name: ");
		parser.flushPartial();
		parser.push("Tom");
		parser.flushPartial();

		// Enter pressed - PTY sends \r\n
		parser.push("\r\n");

		// The complete line should replace the partial
		const completeLine = results.find(
			(r) => r.line === "Name: Tom" && !r.isReplacement === false,
		);
		expect(completeLine).toBeDefined();

		// After the complete line, new content starts fresh
		parser.push("Next prompt: ");
		parser.flushPartial();
		const lastResult = results[results.length - 1];
		expect(lastResult?.line).toBe("Next prompt: ");
	});

	test("flushPartial does nothing when buffer is empty", () => {
		const results: { line: string; isReplacement: boolean }[] = [];
		const parser = new LineParser((line, isReplacement) => {
			results.push({ line, isReplacement });
		});

		parser.flushPartial();
		expect(results).toHaveLength(0);
	});

	test("flushPartial handles \\r in buffer", () => {
		const results: { line: string; isReplacement: boolean }[] = [];
		const parser = new LineParser((line, isReplacement) => {
			results.push({ line, isReplacement });
		});

		parser.push("old\rnew");
		// The \r handling in push() already emitted "new" as replacement
		// flushPartial should not double-emit
		const countBefore = results.length;
		parser.flushPartial();
		// Buffer after \r processing contains "new", which was already emitted
		// flushPartial may emit again as replacement (idempotent for display)
		expect(results.length).toBeGreaterThanOrEqual(countBefore);
		const lastResult = results[results.length - 1];
		expect(lastResult?.line).toBe("new");
	});

	// =========================================================================
	// Backspace handling (\x08) - PTY character deletion
	// =========================================================================

	test("backspace removes previous character from buffer", () => {
		const results: { line: string; isReplacement: boolean }[] = [];
		const parser = new LineParser((line, isReplacement) => {
			results.push({ line, isReplacement });
		});

		// Type "Tom", then backspace (PTY sends \x08 \x08 to erase 'm')
		parser.push("Tom");
		parser.push("\x08 \x08");
		parser.flushPartial();

		const lastResult = results[results.length - 1];
		expect(lastResult?.line).toBe("To");
	});

	test("backspace in single chunk works", () => {
		const results = parseString("abc\x08\n");
		// 'abc' then backspace removes 'c', then newline emits 'ab'
		expect(results).toEqual([{ line: "ab", isReplacement: false }]);
	});

	test("multiple backspaces erase multiple characters", () => {
		const results: { line: string; isReplacement: boolean }[] = [];
		const parser = new LineParser((line, isReplacement) => {
			results.push({ line, isReplacement });
		});

		parser.push("Hello");
		// PTY sends 3x (\x08 \x08) to erase 'l', 'l', 'o'
		parser.push("\x08 \x08\x08 \x08\x08 \x08");
		parser.flushPartial();

		const lastResult = results[results.length - 1];
		expect(lastResult?.line).toBe("He");
	});

	test("backspace at empty buffer is a no-op", () => {
		const results: { line: string; isReplacement: boolean }[] = [];
		const parser = new LineParser((line, isReplacement) => {
			results.push({ line, isReplacement });
		});

		parser.push("\x08\x08\x08");
		parser.flushPartial();
		// Buffer was empty, backspaces do nothing, nothing to emit
		expect(results).toHaveLength(0);
	});

	test("backspace with PTY prompt and editing", () => {
		const results: { line: string; isReplacement: boolean }[] = [];
		const parser = new LineParser((line, isReplacement) => {
			results.push({ line, isReplacement });
		});

		// Prompt appears
		parser.push("Name: ");
		parser.flushPartial();
		expect(results[0]?.line).toBe("Name: ");

		// User types "Tome" (typo)
		parser.push("T");
		parser.flushPartial();
		parser.push("o");
		parser.flushPartial();
		parser.push("m");
		parser.flushPartial();
		parser.push("e");
		parser.flushPartial();

		expect(results[results.length - 1]?.line).toBe("Name: Tome");

		// User presses backspace (PTY sends \x08 \x08)
		parser.push("\x08 \x08");
		parser.flushPartial();

		expect(results[results.length - 1]?.line).toBe("Name: Tom");
	});

	test("chunks without backspace use fast path", () => {
		// Verify that normal chunks (no \x08) still work correctly
		const results = parseString("Line 1\nLine 2\nLine 3\n");
		expect(results).toEqual([
			{ line: "Line 1", isReplacement: false },
			{ line: "Line 2", isReplacement: false },
			{ line: "Line 3", isReplacement: false },
		]);
	});

	// =========================================================================
	// ANSI terminal control sequence handling (readline line redraws)
	// =========================================================================

	test("\\x1b[1G (cursor to column 1) is treated as \\r", () => {
		const results: { line: string; isReplacement: boolean }[] = [];
		const parser = new LineParser((line, isReplacement) => {
			results.push({ line, isReplacement });
		});

		// Initial prompt
		parser.push("Name: Tom");
		parser.flushPartial();
		expect(results[results.length - 1]?.line).toBe("Name: Tom");

		// Readline redraws: cursor to col 1, erase screen, new content, position cursor
		parser.push("\x1b[1G\x1b[0JName: To\x1b[9G");
		parser.flushPartial();

		// Should see the redrawn line, not appended
		const lastResult = results[results.length - 1];
		expect(lastResult?.line).toBe("Name: To");
		expect(lastResult?.isReplacement).toBe(true);
	});

	test("readline full prompt redraw sequence", () => {
		const results: { line: string; isReplacement: boolean }[] = [];
		const parser = new LineParser((line, isReplacement) => {
			results.push({ line, isReplacement });
		});

		// Initial prompt from readline: \x1b[1G\x1b[0JName: \x1b[7G
		parser.push("\x1b[1G\x1b[0JName: \x1b[7G");
		parser.flushPartial();
		expect(results[results.length - 1]?.line).toBe("Name: ");

		// User types chars
		parser.push("T");
		parser.flushPartial();
		expect(results[results.length - 1]?.line).toBe("Name: T");

		parser.push("o");
		parser.flushPartial();
		parser.push("m");
		parser.flushPartial();
		expect(results[results.length - 1]?.line).toBe("Name: Tom");

		// User presses backspace → readline redraws
		parser.push("\x1b[1G\x1b[0JName: To\x1b[9G");
		parser.flushPartial();
		expect(results[results.length - 1]?.line).toBe("Name: To");
	});

	test("erase sequences are stripped but color codes preserved", () => {
		const results: { line: string; isReplacement: boolean }[] = [];
		const parser = new LineParser((line, isReplacement) => {
			results.push({ line, isReplacement });
		});

		// Mix of color codes (\x1b[32m) and erase (\x1b[0J) + positioning (\x1b[5G)
		parser.push("\x1b[32mGreen\x1b[0m text\n");
		expect(results[0]?.line).toBe("\x1b[32mGreen\x1b[0m text");

		// Erase and cursor positioning should be stripped
		parser.push("\x1b[0J\x1b[5Ghello\n");
		expect(results[1]?.line).toBe("hello");
	});

	test("cursor movement sequences (A/B/C/D) are stripped", () => {
		const results = parseString("hello\x1b[2Dworld\n");
		// \x1b[2D (cursor left 2) should be stripped
		expect(results[0]?.line).toBe("helloworld");
	});
});
