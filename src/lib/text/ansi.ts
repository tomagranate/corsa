import { TextAttributes } from "@opentui/core";
import type { TextSegment } from "../../types";

const ESC = String.fromCharCode(27);
const BEL = "\x07";
const C1_CSI = "\x9b";
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal controls must be removed before rendering
const UNSAFE_CONTROL_REGEX = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x9b]/g;

interface EscapeToken {
	end: number;
	sgrParams?: string;
}

/** Consume one ECMA-48 escape/control sequence beginning at `start`. */
function consumeEscape(text: string, start: number): EscapeToken {
	const isC1Csi = text[start] === C1_CSI;
	if (!isC1Csi && text[start] !== ESC) return { end: start + 1 };

	const introducer = isC1Csi ? "[" : text[start + 1];
	let index = start + (isC1Csi ? 1 : 2);

	if (introducer === "[") {
		const paramsStart = index;
		while (index < text.length) {
			const code = text.charCodeAt(index);
			if (code < 0x30 || code > 0x3f) break;
			index++;
		}
		const paramsEnd = index;
		while (index < text.length) {
			const code = text.charCodeAt(index);
			if (code < 0x20 || code > 0x2f) break;
			index++;
		}
		if (index < text.length) {
			const finalCode = text.charCodeAt(index);
			if (finalCode >= 0x40 && finalCode <= 0x7e) {
				const params = text.slice(paramsStart, paramsEnd);
				const isStandardSgr =
					!isC1Csi &&
					text[index] === "m" &&
					paramsEnd === index &&
					/^[0-9;]*$/.test(params);
				return {
					end: index + 1,
					sgrParams: isStandardSgr ? params : undefined,
				};
			}
		}
		// An incomplete CSI cannot safely contribute visible text.
		return { end: text.length };
	}

	if (introducer === "]") {
		while (index < text.length) {
			if (text[index] === BEL) return { end: index + 1 };
			if (text[index] === ESC && text[index + 1] === "\\") {
				return { end: index + 2 };
			}
			index++;
		}
		return { end: text.length };
	}

	if (
		introducer === "P" ||
		introducer === "X" ||
		introducer === "^" ||
		introducer === "_"
	) {
		while (index < text.length) {
			if (text[index] === ESC && text[index + 1] === "\\") {
				return { end: index + 2 };
			}
			index++;
		}
		return { end: text.length };
	}

	if (
		introducer === "(" ||
		introducer === ")" ||
		introducer === "*" ||
		introducer === "+"
	) {
		return { end: Math.min(start + 3, text.length) };
	}

	return { end: Math.min(start + 2, text.length) };
}

function stripTerminalControls(text: string): string {
	let cleanText = "";
	for (let index = 0; index < text.length; ) {
		const nextEsc = text.indexOf(ESC, index);
		const nextC1Csi = text.indexOf(C1_CSI, index);
		const nextControl =
			nextEsc < 0
				? nextC1Csi
				: nextC1Csi < 0
					? nextEsc
					: Math.min(nextEsc, nextC1Csi);
		if (nextControl < 0) {
			cleanText += text.slice(index);
			break;
		}
		cleanText += text.slice(index, nextControl);
		index = consumeEscape(text, nextControl).end;
	}
	return cleanText.replace(UNSAFE_CONTROL_REGEX, "");
}

/**
 * Calculates the visible width of text, ignoring ANSI escape codes.
 * Handles wide Unicode characters (count as 2 columns).
 */
export function getVisibleWidth(text: string): number {
	const cleanText = stripTerminalControls(text);

	let width = 0;
	for (const char of cleanText) {
		// Check if character is a wide Unicode character (CJK, emoji, etc.)
		const codePoint = char.codePointAt(0) ?? 0;
		// Wide characters: CJK, emoji, and other full-width characters
		if (
			(codePoint >= 0x1100 && codePoint <= 0x115f) || // Hangul Jamo
			(codePoint >= 0x2e80 && codePoint <= 0x2eff) || // CJK Radicals
			(codePoint >= 0x2f00 && codePoint <= 0x2fdf) || // Kangxi Radicals
			(codePoint >= 0x3000 && codePoint <= 0x303f) || // CJK Symbols
			(codePoint >= 0x3040 && codePoint <= 0x309f) || // Hiragana
			(codePoint >= 0x30a0 && codePoint <= 0x30ff) || // Katakana
			(codePoint >= 0x3100 && codePoint <= 0x312f) || // Bopomofo
			(codePoint >= 0x3130 && codePoint <= 0x318f) || // Hangul Compatibility Jamo
			(codePoint >= 0x3200 && codePoint <= 0x32ff) || // Enclosed CJK
			(codePoint >= 0x3300 && codePoint <= 0x33ff) || // CJK Compatibility
			(codePoint >= 0x3400 && codePoint <= 0x4dbf) || // CJK Unified Ideographs Extension A
			(codePoint >= 0x4e00 && codePoint <= 0x9fff) || // CJK Unified Ideographs
			(codePoint >= 0xa000 && codePoint <= 0xa48f) || // Yi Syllables
			(codePoint >= 0xa490 && codePoint <= 0xa4cf) || // Yi Radicals
			(codePoint >= 0xac00 && codePoint <= 0xd7af) || // Hangul Syllables
			(codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK Compatibility Ideographs
			(codePoint >= 0xfe30 && codePoint <= 0xfe4f) || // CJK Compatibility Forms
			(codePoint >= 0xff00 && codePoint <= 0xffef) || // Halfwidth and Fullwidth Forms
			(codePoint >= 0x1f300 && codePoint <= 0x1f5ff) || // Miscellaneous Symbols and Pictographs
			(codePoint >= 0x1f600 && codePoint <= 0x1f64f) || // Emoticons
			(codePoint >= 0x1f900 && codePoint <= 0x1f9ff) // Supplemental Symbols and Pictographs
		) {
			width += 2;
		} else {
			width += 1;
		}
	}
	return width;
}

/**
 * Parses a line containing ANSI escape codes into segments with color/style information.
 * For basic 16 colors (codes 30-37, 90-97, 40-47, 100-107), stores colorIndex/bgColorIndex
 * to allow theme-aware rendering. For 256-color and RGB modes, stores hex values directly.
 * @param text - The text to parse
 */
export function parseAnsiLine(text: string): TextSegment[] {
	const segments: TextSegment[] = [];
	let currentText = "";
	let currentAttributes = 0;

	// Track state for nested codes
	// For basic 16 colors, we store indices; for extended colors, we store hex
	let fgColorIndex: number | undefined;
	let fgColor: string | undefined;
	let bgColorIndex: number | undefined;
	let bgColor: string | undefined;
	let isBold = false;
	let isDim = false;
	let isItalic = false;
	let isUnderline = false;
	let isBlink = false;
	let isInverse = false;
	let isStrikethrough = false;

	// Reset function to create a new segment
	const pushSegment = () => {
		currentText = currentText.replace(UNSAFE_CONTROL_REGEX, "");
		if (currentText.length > 0) {
			segments.push({
				text: currentText,
				color: fgColor,
				colorIndex: fgColorIndex,
				bgColor: bgColor,
				bgColorIndex: bgColorIndex,
				attributes: currentAttributes,
			});
			currentText = "";
		}
	};

	// Scan left-to-right, retaining only printable text and standard SGR styling.
	for (let index = 0; index < text.length; ) {
		const nextEsc = text.indexOf(ESC, index);
		const nextC1Csi = text.indexOf(C1_CSI, index);
		const nextControl =
			nextEsc < 0
				? nextC1Csi
				: nextC1Csi < 0
					? nextEsc
					: Math.min(nextEsc, nextC1Csi);
		if (nextControl < 0) {
			currentText += text.slice(index);
			break;
		}
		currentText += text.slice(index, nextControl);

		const token = consumeEscape(text, nextControl);
		index = token.end;
		if (token.sgrParams !== undefined) {
			const params = token.sgrParams;
			if (params === "") {
				// Reset all
				pushSegment();
				fgColor = undefined;
				fgColorIndex = undefined;
				bgColor = undefined;
				bgColorIndex = undefined;
				isBold = false;
				isDim = false;
				isItalic = false;
				isUnderline = false;
				isBlink = false;
				isInverse = false;
				isStrikethrough = false;
				currentAttributes = 0;
			} else {
				const codes = params
					.split(";")
					.map((p) => parseInt(p, 10))
					.filter((n) => !Number.isNaN(n));

				for (let i = 0; i < codes.length; i++) {
					const c = codes[i];
					if (c === undefined) continue;

					if (c === 0) {
						// Reset all
						pushSegment();
						fgColor = undefined;
						fgColorIndex = undefined;
						bgColor = undefined;
						bgColorIndex = undefined;
						isBold = false;
						isDim = false;
						isItalic = false;
						isUnderline = false;
						isBlink = false;
						isInverse = false;
						isStrikethrough = false;
						currentAttributes = 0;
					} else if (c === 1) {
						pushSegment();
						isBold = true;
					} else if (c === 2) {
						pushSegment();
						isDim = true;
					} else if (c === 3) {
						pushSegment();
						isItalic = true;
					} else if (c === 4) {
						pushSegment();
						isUnderline = true;
					} else if (c === 5) {
						pushSegment();
						isBlink = true;
					} else if (c === 7) {
						pushSegment();
						isInverse = true;
					} else if (c === 9) {
						pushSegment();
						isStrikethrough = true;
					} else if (c === 22) {
						pushSegment();
						isBold = false;
						isDim = false;
					} else if (c === 23) {
						pushSegment();
						isItalic = false;
					} else if (c === 24) {
						pushSegment();
						isUnderline = false;
					} else if (c === 25) {
						pushSegment();
						isBlink = false;
					} else if (c === 27) {
						pushSegment();
						isInverse = false;
					} else if (c === 29) {
						pushSegment();
						isStrikethrough = false;
					} else if (c === 39) {
						// Default foreground
						pushSegment();
						fgColor = undefined;
						fgColorIndex = undefined;
					} else if (c === 49) {
						// Default background
						pushSegment();
						bgColor = undefined;
						bgColorIndex = undefined;
					} else if (c >= 30 && c <= 37) {
						// Standard foreground colors (0-7) - store as index
						pushSegment();
						fgColor = undefined;
						fgColorIndex = c - 30;
					} else if (c >= 90 && c <= 97) {
						// Bright foreground colors (8-15) - store as index
						pushSegment();
						fgColor = undefined;
						fgColorIndex = 8 + (c - 90);
					} else if (c >= 40 && c <= 47) {
						// Standard background colors (0-7) - store as index
						pushSegment();
						bgColor = undefined;
						bgColorIndex = c - 40;
					} else if (c >= 100 && c <= 107) {
						// Bright background colors (8-15) - store as index
						pushSegment();
						bgColor = undefined;
						bgColorIndex = 8 + (c - 100);
					} else if (c === 38) {
						// Extended foreground color
						if (i + 1 < codes.length) {
							const nextCode = codes[i + 1];
							if (nextCode === 5) {
								// 256-color mode: 38;5;X
								if (i + 2 < codes.length) {
									const color256 = codes[i + 2];
									if (color256 !== undefined) {
										pushSegment();
										if (color256 <= 15) {
											// Basic 16 colors - store as index for theme-aware rendering
											fgColor = undefined;
											fgColorIndex = color256;
										} else {
											// Extended colors (16-255) - store as hex
											fgColorIndex = undefined;
											fgColor = map256Color(color256);
										}
										i += 2;
									}
								}
							} else if (nextCode === 2) {
								// RGB mode: 38;2;R;G;B
								if (i + 4 < codes.length) {
									const r = codes[i + 2];
									const g = codes[i + 3];
									const b = codes[i + 4];
									if (r !== undefined && g !== undefined && b !== undefined) {
										pushSegment();
										fgColorIndex = undefined;
										fgColor = rgbToHex(r, g, b);
										i += 4;
									}
								}
							}
						}
					} else if (c === 48) {
						// Extended background color
						if (i + 1 < codes.length) {
							const nextCode = codes[i + 1];
							if (nextCode === 5) {
								// 256-color mode: 48;5;X
								if (i + 2 < codes.length) {
									const color256 = codes[i + 2];
									if (color256 !== undefined) {
										pushSegment();
										if (color256 <= 15) {
											// Basic 16 colors - store as index for theme-aware rendering
											bgColor = undefined;
											bgColorIndex = color256;
										} else {
											// Extended colors (16-255) - store as hex
											bgColorIndex = undefined;
											bgColor = map256Color(color256);
										}
										i += 2;
									}
								}
							} else if (nextCode === 2) {
								// RGB mode: 48;2;R;G;B
								if (i + 4 < codes.length) {
									const r = codes[i + 2];
									const g = codes[i + 3];
									const b = codes[i + 4];
									if (r !== undefined && g !== undefined && b !== undefined) {
										pushSegment();
										bgColorIndex = undefined;
										bgColor = rgbToHex(r, g, b);
										i += 4;
									}
								}
							}
						}
					}
				}

				// Update attributes based on current state
				currentAttributes = 0;
				if (isBold) {
					currentAttributes |= TextAttributes.BOLD;
				}
				if (isDim) {
					currentAttributes |= TextAttributes.DIM;
				}
				if (isItalic) {
					currentAttributes |= TextAttributes.ITALIC;
				}
				if (isUnderline) {
					currentAttributes |= TextAttributes.UNDERLINE;
				}
				if (isBlink) {
					currentAttributes |= TextAttributes.BLINK;
				}
				if (isInverse) {
					currentAttributes |= TextAttributes.INVERSE;
				}
				if (isStrikethrough) {
					currentAttributes |= TextAttributes.STRIKETHROUGH;
				}
			}
		}
	}

	// Push final segment
	pushSegment();

	// Never use the raw input as fallback: it may consist only of controls.
	if (segments.length === 0) {
		const sanitizedText = stripTerminalControls(text);
		if (sanitizedText.trim().length > 0) segments.push({ text: sanitizedText });
	}

	return segments;
}

/**
 * Maps a 256-color ANSI code (16-255) to a hex color.
 * Note: Codes 0-15 are handled via colorIndex for theme-aware rendering.
 * Supports:
 * - 16-231: 6x6x6 color cube
 * - 232-255: Grayscale ramp
 */
function map256Color(code: number): string {
	if (code >= 16 && code <= 231) {
		// 6x6x6 color cube
		// Each component ranges 0-5, mapped to 0, 95, 135, 175, 215, 255
		const cubeIndex = code - 16;
		const r = Math.floor(cubeIndex / 36);
		const g = Math.floor((cubeIndex % 36) / 6);
		const b = cubeIndex % 6;
		const toRgb = (v: number) => (v === 0 ? 0 : 55 + v * 40);
		return rgbToHex(toRgb(r), toRgb(g), toRgb(b));
	}
	if (code >= 232 && code <= 255) {
		// Grayscale ramp (24 shades from dark to light)
		// 232 = #080808, 255 = #eeeeee
		const gray = 8 + (code - 232) * 10;
		return rgbToHex(gray, gray, gray);
	}
	// Fallback for any unexpected values
	return "#ffffff";
}

/**
 * Converts RGB values to hex color string.
 */
function rgbToHex(r: number, g: number, b: number): string {
	return `#${[r, g, b]
		.map((x) => {
			const clamped = Math.max(0, Math.min(255, x));
			const hex = clamped.toString(16);
			return hex.length === 1 ? `0${hex}` : hex;
		})
		.join("")}`;
}

/**
 * Wraps segments across multiple lines based on visible width.
 * Attempts to wrap at word boundaries when possible.
 */
export function wrapSegments(
	segments: TextSegment[],
	maxWidth: number,
): TextSegment[][] {
	if (segments.length === 0) {
		return [];
	}

	const lines: TextSegment[][] = [];
	let currentLine: TextSegment[] = [];
	let currentWidth = 0;

	for (const segment of segments) {
		const segmentWidth = getVisibleWidth(segment.text);

		// If segment fits on current line, add it
		if (currentWidth + segmentWidth <= maxWidth) {
			currentLine.push(segment);
			currentWidth += segmentWidth;
		} else {
			// Segment doesn't fit
			if (currentLine.length > 0) {
				// Save current line and start new one
				lines.push(currentLine);
				currentLine = [];
				currentWidth = 0;
			}

			// If segment itself is longer than maxWidth, we need to split it
			if (segmentWidth > maxWidth) {
				// Split the segment text
				const words = segment.text.split(/(\s+)/);
				let wordBuffer = "";
				let wordBufferWidth = 0;

				for (const word of words) {
					const wordWidth = getVisibleWidth(word);

					if (wordBufferWidth + wordWidth <= maxWidth) {
						wordBuffer += word;
						wordBufferWidth += wordWidth;
					} else {
						// Word doesn't fit, push buffer and start new line
						if (wordBuffer.length > 0) {
							currentLine.push({
								text: wordBuffer,
								color: segment.color,
								attributes: segment.attributes,
							});
							lines.push(currentLine);
							currentLine = [];
							currentWidth = 0;
						}

						// If word itself is too long, split it character by character
						if (wordWidth > maxWidth) {
							for (const char of word) {
								const charWidth = getVisibleWidth(char);
								if (currentWidth + charWidth > maxWidth) {
									if (currentLine.length > 0) {
										lines.push(currentLine);
										currentLine = [];
										currentWidth = 0;
									}
								}
								currentLine.push({
									text: char,
									color: segment.color,
									attributes: segment.attributes,
								});
								currentWidth += charWidth;
							}
							wordBuffer = "";
							wordBufferWidth = 0;
						} else {
							wordBuffer = word;
							wordBufferWidth = wordWidth;
						}
					}
				}

				// Add remaining word buffer
				if (wordBuffer.length > 0) {
					currentLine.push({
						text: wordBuffer,
						color: segment.color,
						attributes: segment.attributes,
					});
					currentWidth = wordBufferWidth;
				}
			} else {
				// Segment fits on a new line
				currentLine.push(segment);
				currentWidth = segmentWidth;
			}
		}
	}

	// Add final line if it has content
	if (currentLine.length > 0) {
		lines.push(currentLine);
	}

	// If no lines were created, return at least one empty line
	return lines.length > 0 ? lines : [[]];
}
