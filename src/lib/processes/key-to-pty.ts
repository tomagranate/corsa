/**
 * Maps TUI key events to PTY-compatible byte sequences.
 *
 * Used in input mode to forward keystrokes from corsa's TUI
 * to an interactive process's PTY.
 *
 * Escape is NOT mapped here -- it is reserved for exiting input mode.
 */

interface KeyLike {
	name: string;
	ctrl: boolean;
	shift: boolean;
	meta: boolean;
	sequence: string;
}

/** ANSI escape sequences for special keys */
const SPECIAL_KEY_MAP: Record<string, string> = {
	return: "\r",
	backspace: "\x7f",
	tab: "\t",
	up: "\x1b[A",
	down: "\x1b[B",
	right: "\x1b[C",
	left: "\x1b[D",
	home: "\x1b[H",
	end: "\x1b[F",
	delete: "\x1b[3~",
	pageup: "\x1b[5~",
	pagedown: "\x1b[6~",
	insert: "\x1b[2~",
	f1: "\x1bOP",
	f2: "\x1bOQ",
	f3: "\x1bOR",
	f4: "\x1bOS",
	f5: "\x1b[15~",
	f6: "\x1b[17~",
	f7: "\x1b[18~",
	f8: "\x1b[19~",
	f9: "\x1b[20~",
	f10: "\x1b[21~",
	f11: "\x1b[23~",
	f12: "\x1b[24~",
};

/**
 * Convert a TUI key event to the byte sequence to write to a PTY.
 *
 * @returns The string to write, or null if the key should not be forwarded
 *          (e.g., Escape which is reserved for exiting input mode)
 */
export function keyToPty(key: KeyLike): string | null {
	// Escape is reserved for exiting input mode
	if (key.name === "escape") {
		return null;
	}

	// Ctrl+letter combinations (a-z)
	if (key.ctrl && key.name.length === 1) {
		const code = key.name.charCodeAt(0);
		// Ctrl+A = 0x01, Ctrl+B = 0x02, ..., Ctrl+Z = 0x1A
		if (code >= 97 && code <= 122) {
			return String.fromCharCode(code - 96);
		}
	}

	// Special keys
	const special = SPECIAL_KEY_MAP[key.name];
	if (special !== undefined) {
		return special;
	}

	// For regular characters, use the raw sequence from the key event
	// This handles printable characters, unicode, etc.
	if (key.sequence && key.sequence.length > 0 && key.name !== "escape") {
		return key.sequence;
	}

	// Single printable character from key name
	if (key.name.length === 1 && !key.ctrl && !key.meta) {
		return key.name;
	}

	// Unknown key - don't forward
	return null;
}

/** All recognized special key names (for documentation / validation) */
export const SPECIAL_KEY_NAMES = Object.keys(SPECIAL_KEY_MAP);

/**
 * Convert a string key descriptor to the byte sequence to write to a PTY.
 *
 * Accepts:
 *  - Special key names: "return", "tab", "up", "f1", etc.
 *  - Ctrl combinations: "ctrl+c", "ctrl+d", etc.
 *  - Single characters: "a", "1", etc.
 *  - Literal text: "hello world" (sent as-is)
 *
 * @returns The string to write, or null for unrecognized special key names
 */
export function keyNameToPty(keyName: string): string | null {
	// ctrl+<letter> pattern
	const ctrlMatch = keyName.match(/^ctrl\+([a-z])$/i);
	const ctrlLetter = ctrlMatch?.[1];
	if (ctrlLetter) {
		const code = ctrlLetter.toLowerCase().charCodeAt(0);
		return String.fromCharCode(code - 96);
	}

	// Special key names
	const special = SPECIAL_KEY_MAP[keyName.toLowerCase()];
	if (special !== undefined) {
		return special;
	}

	// Single character or literal text — send as-is
	if (keyName.length >= 1) {
		return keyName;
	}

	return null;
}
