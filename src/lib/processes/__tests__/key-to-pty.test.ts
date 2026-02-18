import { describe, expect, test } from "bun:test";
import { keyNameToPty, keyToPty, SPECIAL_KEY_NAMES } from "../key-to-pty";

/** Helper to create a minimal key event */
function key(
	name: string,
	opts: {
		ctrl?: boolean;
		shift?: boolean;
		meta?: boolean;
		sequence?: string;
	} = {},
) {
	return {
		name,
		ctrl: opts.ctrl ?? false,
		shift: opts.shift ?? false,
		meta: opts.meta ?? false,
		sequence: opts.sequence ?? (name.length === 1 ? name : ""),
	};
}

describe("keyToPty", () => {
	// =========================================================================
	// Escape is reserved
	// =========================================================================

	test("escape returns null (reserved for exiting input mode)", () => {
		expect(keyToPty(key("escape"))).toBeNull();
	});

	// =========================================================================
	// Printable characters
	// =========================================================================

	test("printable characters pass through via sequence", () => {
		expect(keyToPty(key("a", { sequence: "a" }))).toBe("a");
		expect(keyToPty(key("z", { sequence: "z" }))).toBe("z");
		expect(keyToPty(key("A", { sequence: "A", shift: true }))).toBe("A");
		expect(keyToPty(key("1", { sequence: "1" }))).toBe("1");
		expect(keyToPty(key("!", { sequence: "!", shift: true }))).toBe("!");
	});

	test("space character passes through", () => {
		expect(keyToPty(key("space", { sequence: " " }))).toBe(" ");
	});

	// =========================================================================
	// Special keys
	// =========================================================================

	test("enter maps to carriage return", () => {
		expect(keyToPty(key("return"))).toBe("\r");
	});

	test("backspace maps to DEL", () => {
		expect(keyToPty(key("backspace"))).toBe("\x7f");
	});

	test("tab maps to tab character", () => {
		expect(keyToPty(key("tab"))).toBe("\t");
	});

	test("delete maps to ANSI delete sequence", () => {
		expect(keyToPty(key("delete"))).toBe("\x1b[3~");
	});

	// =========================================================================
	// Arrow keys
	// =========================================================================

	test("arrow keys map to ANSI escape sequences", () => {
		expect(keyToPty(key("up"))).toBe("\x1b[A");
		expect(keyToPty(key("down"))).toBe("\x1b[B");
		expect(keyToPty(key("right"))).toBe("\x1b[C");
		expect(keyToPty(key("left"))).toBe("\x1b[D");
	});

	// =========================================================================
	// Home/End/Page keys
	// =========================================================================

	test("home and end map to ANSI sequences", () => {
		expect(keyToPty(key("home"))).toBe("\x1b[H");
		expect(keyToPty(key("end"))).toBe("\x1b[F");
	});

	test("page up and page down map to ANSI sequences", () => {
		expect(keyToPty(key("pageup"))).toBe("\x1b[5~");
		expect(keyToPty(key("pagedown"))).toBe("\x1b[6~");
	});

	// =========================================================================
	// Ctrl+letter combinations
	// =========================================================================

	test("Ctrl+C maps to ETX (0x03)", () => {
		expect(keyToPty(key("c", { ctrl: true }))).toBe("\x03");
	});

	test("Ctrl+D maps to EOT (0x04)", () => {
		expect(keyToPty(key("d", { ctrl: true }))).toBe("\x04");
	});

	test("Ctrl+A maps to SOH (0x01)", () => {
		expect(keyToPty(key("a", { ctrl: true }))).toBe("\x01");
	});

	test("Ctrl+Z maps to SUB (0x1A)", () => {
		expect(keyToPty(key("z", { ctrl: true }))).toBe("\x1a");
	});

	test("Ctrl+L maps to FF (0x0C)", () => {
		expect(keyToPty(key("l", { ctrl: true }))).toBe("\x0c");
	});

	// =========================================================================
	// Function keys
	// =========================================================================

	test("function keys map to ANSI sequences", () => {
		expect(keyToPty(key("f1"))).toBe("\x1bOP");
		expect(keyToPty(key("f2"))).toBe("\x1bOQ");
		expect(keyToPty(key("f3"))).toBe("\x1bOR");
		expect(keyToPty(key("f4"))).toBe("\x1bOS");
		expect(keyToPty(key("f5"))).toBe("\x1b[15~");
		expect(keyToPty(key("f12"))).toBe("\x1b[24~");
	});

	// =========================================================================
	// Edge cases
	// =========================================================================

	test("unknown key with no sequence returns null", () => {
		expect(keyToPty(key("unknown-key", { sequence: "" }))).toBeNull();
	});

	test("insert key maps to ANSI sequence", () => {
		expect(keyToPty(key("insert"))).toBe("\x1b[2~");
	});
});

// =============================================================================
// keyNameToPty — string-based key descriptor conversion
// =============================================================================

describe("keyNameToPty", () => {
	// =========================================================================
	// Special key names
	// =========================================================================

	test("maps special key names to the same sequences as keyToPty", () => {
		for (const name of SPECIAL_KEY_NAMES) {
			const fromKeyName = keyNameToPty(name);
			const fromKey = keyToPty(key(name));
			expect(fromKeyName).toBe(fromKey);
		}
	});

	test("return maps to carriage return", () => {
		expect(keyNameToPty("return")).toBe("\r");
	});

	test("backspace maps to DEL", () => {
		expect(keyNameToPty("backspace")).toBe("\x7f");
	});

	test("tab maps to tab character", () => {
		expect(keyNameToPty("tab")).toBe("\t");
	});

	test("arrow keys map to ANSI sequences", () => {
		expect(keyNameToPty("up")).toBe("\x1b[A");
		expect(keyNameToPty("down")).toBe("\x1b[B");
		expect(keyNameToPty("left")).toBe("\x1b[D");
		expect(keyNameToPty("right")).toBe("\x1b[C");
	});

	test("special key names are case-insensitive", () => {
		expect(keyNameToPty("Return")).toBe("\r");
		expect(keyNameToPty("RETURN")).toBe("\r");
		expect(keyNameToPty("Tab")).toBe("\t");
		expect(keyNameToPty("UP")).toBe("\x1b[A");
	});

	// =========================================================================
	// Ctrl combinations
	// =========================================================================

	test("ctrl+c maps to ETX (0x03)", () => {
		expect(keyNameToPty("ctrl+c")).toBe("\x03");
	});

	test("ctrl+d maps to EOT (0x04)", () => {
		expect(keyNameToPty("ctrl+d")).toBe("\x04");
	});

	test("ctrl+a maps to SOH (0x01)", () => {
		expect(keyNameToPty("ctrl+a")).toBe("\x01");
	});

	test("ctrl+z maps to SUB (0x1A)", () => {
		expect(keyNameToPty("ctrl+z")).toBe("\x1a");
	});

	test("ctrl+l maps to FF (0x0C)", () => {
		expect(keyNameToPty("ctrl+l")).toBe("\x0c");
	});

	test("ctrl combinations are case-insensitive", () => {
		expect(keyNameToPty("Ctrl+C")).toBe("\x03");
		expect(keyNameToPty("CTRL+Z")).toBe("\x1a");
	});

	// =========================================================================
	// Literal text
	// =========================================================================

	test("single characters are sent as-is", () => {
		expect(keyNameToPty("a")).toBe("a");
		expect(keyNameToPty("Z")).toBe("Z");
		expect(keyNameToPty("1")).toBe("1");
		expect(keyNameToPty("!")).toBe("!");
	});

	test("multi-character strings are sent as literal text", () => {
		expect(keyNameToPty("hello")).toBe("hello");
		expect(keyNameToPty("npm test")).toBe("npm test");
		expect(keyNameToPty("yes")).toBe("yes");
	});

	// =========================================================================
	// Edge cases
	// =========================================================================

	test("empty string returns null", () => {
		expect(keyNameToPty("")).toBeNull();
	});

	test("SPECIAL_KEY_NAMES contains expected keys", () => {
		expect(SPECIAL_KEY_NAMES).toContain("return");
		expect(SPECIAL_KEY_NAMES).toContain("backspace");
		expect(SPECIAL_KEY_NAMES).toContain("tab");
		expect(SPECIAL_KEY_NAMES).toContain("up");
		expect(SPECIAL_KEY_NAMES).toContain("f1");
		expect(SPECIAL_KEY_NAMES).toContain("f12");
	});
});
