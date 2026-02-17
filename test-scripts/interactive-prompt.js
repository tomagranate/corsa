#!/usr/bin/env bun

// Interactive prompt script for testing PTY / input mode in corsa.
//
// Usage in corsa.config.toml:
//   [[tools]]
//   name = "interactive-prompt"
//   command = "bun"
//   args = ["test-scripts/interactive-prompt.js"]
//   interactive = true
//
// This script asks a series of questions via stdin and echoes back the answers.
// It exercises: basic text input, yes/no confirmation, and password-style input.

import * as readline from "node:readline";

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const GREEN = `${ESC}32m`;
const CYAN = `${ESC}36m`;
const YELLOW = `${ESC}33m`;
const DIM = `${ESC}2m`;
const BOLD = `${ESC}1m`;

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

function ask(question) {
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			resolve(answer);
		});
	});
}

async function main() {
	console.log(
		`\n${BOLD}${CYAN}╔══════════════════════════════════════╗${RESET}`,
	);
	console.log(`${BOLD}${CYAN}║   Interactive Prompt Test Script     ║${RESET}`);
	console.log(
		`${BOLD}${CYAN}╚══════════════════════════════════════╝${RESET}\n`,
	);

	console.log(
		`${DIM}Press 'i' in corsa to enter input mode, then type your answers.${RESET}`,
	);
	console.log(`${DIM}Press Esc to exit input mode when done.${RESET}\n`);

	// Check if stdin is a TTY
	if (process.stdin.isTTY) {
		console.log(
			`${GREEN}✓${RESET} Running in a TTY (interactive mode works!)\n`,
		);
	} else {
		console.log(
			`${YELLOW}⚠${RESET} Not running in a TTY — interactive input won't work.\n`,
		);
		console.log(
			`${DIM}  Hint: Set interactive = true in corsa.config.toml${RESET}\n`,
		);
	}

	const name = await ask(`${CYAN}?${RESET} What is your name? `);
	console.log(`${GREEN}→${RESET} Hello, ${BOLD}${name}${RESET}!\n`);

	const language = await ask(
		`${CYAN}?${RESET} Favorite programming language? `,
	);
	console.log(
		`${GREEN}→${RESET} Nice choice! ${BOLD}${language}${RESET} is great.\n`,
	);

	const confirm = await ask(`${CYAN}?${RESET} Do you like corsa? (yes/no) `);
	if (confirm.toLowerCase().startsWith("y")) {
		console.log(`${GREEN}→${RESET} 🎉 Glad to hear it!\n`);
	} else {
		console.log(`${YELLOW}→${RESET} We'll try to do better next time!\n`);
	}

	const number = await ask(`${CYAN}?${RESET} Pick a number between 1 and 10: `);
	const n = parseInt(number, 10);
	if (n >= 1 && n <= 10) {
		console.log(
			`${GREEN}→${RESET} You picked ${BOLD}${n}${RESET}. ${"⭐".repeat(n)}\n`,
		);
	} else {
		console.log(`${YELLOW}→${RESET} That's not between 1 and 10, but ok!\n`);
	}

	console.log(
		`${BOLD}${GREEN}All done!${RESET} Thanks for testing interactive mode.`,
	);
	console.log(`${DIM}Process will exit now.${RESET}\n`);

	rl.close();
	process.exit(0);
}

main().catch((err) => {
	console.error(`${YELLOW}Error:${RESET}`, err.message);
	rl.close();
	process.exit(1);
});

process.on("SIGTERM", () => {
	console.log(
		`\n${YELLOW}[INTERACTIVE]${RESET} Received SIGTERM, shutting down`,
	);
	rl.close();
	process.exit(0);
});

process.on("SIGINT", () => {
	console.log(
		`\n${YELLOW}[INTERACTIVE]${RESET} Received SIGINT, shutting down`,
	);
	rl.close();
	process.exit(0);
});
