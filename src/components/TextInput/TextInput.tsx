import type { InputRenderable, PasteEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useRef } from "react";
import type { Theme } from "../../lib/theme";

const pasteDecoder = new TextDecoder();

interface TextInputProps {
	/** Current input value */
	value: string;
	/** Called when value changes */
	onValueChange: (value: string) => void;
	/** Called when backspace is pressed on empty input */
	onEmpty?: () => void;
	/** Called when Enter is pressed */
	onSubmit?: () => void;
	/** Whether the input is focused and receiving keyboard events */
	focused: boolean;
	/** Theme for styling */
	theme: Theme;
	/** Prefix text shown before input (e.g., "/" or ">") */
	prefix?: string;
	/** Whether to make prefix bold */
	prefixBold?: boolean;
	/** Custom prefix color (defaults to theme.colors.text) */
	prefixColor?: string;
	/** Flex grow for layout */
	flexGrow?: number;
}

/**
 * Reusable text input component with common keyboard extensions:
 * - Ctrl+Backspace: Clear entire input
 * - Backspace on empty: Calls onEmpty callback
 * - Enter: Calls onSubmit callback
 * - Escape handling should be done by parent component
 */
export function TextInput({
	value,
	onValueChange,
	onEmpty,
	onSubmit,
	focused,
	theme,
	prefix,
	prefixBold = false,
	prefixColor,
	flexGrow = 1,
}: TextInputProps) {
	const { colors } = theme;
	const inputRef = useRef<InputRenderable>(null);

	// Handle paste events
	const handlePaste = (event: PasteEvent) => {
		if (!focused) return;
		const input = inputRef.current;
		const text = pasteDecoder.decode(event.bytes);
		if (input && text) {
			// Insert the pasted text at the current cursor position
			input.insertText(text);
		}
	};

	// Handle keyboard extensions
	useKeyboard((key) => {
		if (!focused) return;

		// Ctrl+Backspace: clear entire input
		if (key.ctrl && key.name === "backspace") {
			key.preventDefault();
			key.stopPropagation();
			onValueChange("");
			return;
		}

		// Backspace on empty: call onEmpty
		if (key.name === "backspace" && value.length === 0 && onEmpty) {
			key.preventDefault();
			key.stopPropagation();
			onEmpty();
			return;
		}
	});

	return (
		<box flexDirection="row" flexGrow={flexGrow}>
			{prefix && (
				<text
					fg={prefixColor ?? colors.text}
					attributes={prefixBold ? 1 : 0} // TextAttributes.BOLD = 1
				>
					{prefix}
				</text>
			)}
			<input
				ref={inputRef}
				value={value}
				onInput={onValueChange}
				onSubmit={onSubmit}
				onPaste={handlePaste}
				focused={focused}
				textColor={colors.text}
				backgroundColor={colors.surface0}
				focusedTextColor={colors.text}
				focusedBackgroundColor={colors.surface0}
				cursorColor={colors.accent}
				flexGrow={1}
			/>
		</box>
	);
}
