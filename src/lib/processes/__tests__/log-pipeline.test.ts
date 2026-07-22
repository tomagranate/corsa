import { describe, expect, test } from "bun:test";
import { parseAnsiLine } from "../../text/ansi";
import { LineParser } from "../line-parser";

// biome-ignore lint/suspicious/noControlCharactersInRegex: verifies terminal controls never reach rendered segments
const UNSAFE_CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x9b]/;

function runPipeline(chunks: Uint8Array[]): string[] {
	const visibleLines: string[] = [];
	const parser = new LineParser((line) => {
		const segments = parseAnsiLine(line);
		for (const segment of segments) {
			expect(segment.text).not.toMatch(UNSAFE_CONTROL_RE);
		}
		visibleLines.push(segments.map((segment) => segment.text).join(""));
	});
	for (const chunk of chunks) parser.write(chunk);
	parser.flush();
	return visibleLines;
}

function chunksAt(input: string, offsets: number[]): Uint8Array[] {
	const bytes = new TextEncoder().encode(input);
	const chunks: Uint8Array[] = [];
	let start = 0;
	for (const end of offsets) {
		chunks.push(bytes.slice(start, end));
		start = end;
	}
	chunks.push(bytes.slice(start));
	return chunks;
}

describe("hostile log pipeline", () => {
	test("sanitizes tsc --watch resets between JSON log lines", () => {
		const input =
			'{"level":30,"msg":"compiling"}\n\x1bc{"level":30,"msg":"ready ✓"}\n';
		const lines = runPipeline(chunksAt(input, [3, 32, 34, 51]));
		expect(lines).toEqual([
			'{"level":30,"msg":"compiling"}',
			'{"level":30,"msg":"ready ✓"}',
		]);
	});

	test("sanitizes private-mode spinner controls and carriage-return updates", () => {
		const input = "\x1b[?25l- loading\r\\ loading\rready\x1b[?25h\n";
		const lines = runPipeline(chunksAt(input, [1, 5, 15, 24, 31]));
		expect(lines.at(-1)).toBe("ready");
	});

	test("sanitizes OSC title and hyperlink streams", () => {
		const input =
			"\x1b]0;corsa logs\x07title set\n\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\\n";
		const lines = runPipeline(chunksAt(input, [2, 8, 18, 30, 43, 57]));
		expect(lines).toEqual(["title set", "link"]);
	});
});
