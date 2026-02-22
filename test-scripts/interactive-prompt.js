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
// This script outputs a variety of content (banner, table, progress bars,
// colored output) to build up scrollback, then enters an interactive
// question-and-answer loop using readline. It exercises:
//   - Banner / box-drawing characters
//   - ANSI colors (16-color, 256-color, bold, dim, italic, underline)
//   - Tables with alignment
//   - Progress bar with \r replacement
//   - Spinner animation
//   - Interactive readline prompts

import * as readline from "node:readline";

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const ITALIC = `${ESC}3m`;
const UNDERLINE = `${ESC}4m`;
const RED = `${ESC}31m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const BLUE = `${ESC}34m`;
const MAGENTA = `${ESC}35m`;
const CYAN = `${ESC}36m`;
const WHITE = `${ESC}37m`;
const BG_BLUE = `${ESC}44m`;
const BG_GREEN = `${ESC}42m`;

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

function ask(question) {
	return new Promise((resolve) => {
		rl.question(question, (answer) => resolve(answer));
	});
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function printBanner() {
	console.log();
	console.log(
		`${BOLD}${CYAN}╔════════════════════════════════════════════════════════╗${RESET}`,
	);
	console.log(
		`${BOLD}${CYAN}║${RESET}  ${BOLD}${WHITE}${BG_BLUE} Interactive Prompt Test Script ${RESET}  ${DIM}v2.0${RESET}              ${BOLD}${CYAN}║${RESET}`,
	);
	console.log(
		`${BOLD}${CYAN}╠════════════════════════════════════════════════════════╣${RESET}`,
	);
	console.log(
		`${BOLD}${CYAN}║${RESET}  Tests: banners, tables, progress, colors, prompts    ${BOLD}${CYAN}║${RESET}`,
	);
	console.log(
		`${BOLD}${CYAN}╚════════════════════════════════════════════════════════╝${RESET}`,
	);
	console.log();
}

function printSystemInfo() {
	console.log(`${BOLD}${UNDERLINE}System Information${RESET}`);
	console.log(`  ${DIM}Platform:${RESET}  ${process.platform}`);
	console.log(`  ${DIM}Arch:${RESET}      ${process.arch}`);
	console.log(`  ${DIM}Node:${RESET}      ${process.version}`);
	console.log(`  ${DIM}PID:${RESET}       ${process.pid}`);
	console.log(
		`  ${DIM}TTY:${RESET}       ${process.stdin.isTTY ? `${GREEN}yes${RESET}` : `${RED}no${RESET}`}`,
	);
	console.log(`  ${DIM}Date:${RESET}      ${new Date().toISOString()}`);
	console.log();
}

function printColorPalette() {
	console.log(`${BOLD}${UNDERLINE}Color Palette${RESET}`);

	// Standard 16 colors
	let line = "  ";
	for (let i = 0; i < 8; i++) {
		line += `\x1b[48;5;${i}m   ${RESET}`;
	}
	console.log(`${line}  ${DIM}standard${RESET}`);

	line = "  ";
	for (let i = 8; i < 16; i++) {
		line += `\x1b[48;5;${i}m   ${RESET}`;
	}
	console.log(`${line}  ${DIM}bright${RESET}`);

	// 256-color gradient
	line = "  ";
	for (let i = 16; i < 52; i++) {
		line += `\x1b[48;5;${i}m ${RESET}`;
	}
	console.log(`${line}  ${DIM}256-color sample${RESET}`);
	console.log();
}

function printTextStyles() {
	console.log(`${BOLD}${UNDERLINE}Text Styles${RESET}`);
	console.log(
		`  ${BOLD}Bold text${RESET}  ${DIM}Dim text${RESET}  ${ITALIC}Italic text${RESET}  ${UNDERLINE}Underlined${RESET}`,
	);
	console.log(
		`  ${RED}Red${RESET}  ${GREEN}Green${RESET}  ${YELLOW}Yellow${RESET}  ${BLUE}Blue${RESET}  ${MAGENTA}Magenta${RESET}  ${CYAN}Cyan${RESET}`,
	);
	console.log(
		`  ${BOLD}${RED}Bold Red${RESET}  ${BOLD}${GREEN}Bold Green${RESET}  ${BOLD}${BLUE}Bold Blue${RESET}`,
	);
	console.log();
}

function printTable() {
	console.log(`${BOLD}${UNDERLINE}Service Status${RESET}`);

	const header = `  ${DIM}┌──────────────────┬──────────┬────────────┬─────────┐${RESET}`;
	const sep = `  ${DIM}├──────────────────┼──────────┼────────────┼─────────┤${RESET}`;
	const footer = `  ${DIM}└──────────────────┴──────────┴────────────┴─────────┘${RESET}`;

	console.log(header);
	console.log(
		`  ${DIM}│${RESET} ${BOLD}Service          ${DIM}│${RESET} ${BOLD}Status   ${DIM}│${RESET} ${BOLD}Uptime     ${DIM}│${RESET} ${BOLD}CPU     ${DIM}│${RESET}`,
	);
	console.log(sep);
	console.log(
		`  ${DIM}│${RESET} api-gateway      ${DIM}│${RESET} ${GREEN}● UP${RESET}     ${DIM}│${RESET} 14d 3h 22m ${DIM}│${RESET} 2.1%    ${DIM}│${RESET}`,
	);
	console.log(
		`  ${DIM}│${RESET} auth-service     ${DIM}│${RESET} ${GREEN}● UP${RESET}     ${DIM}│${RESET}  7d 8h 45m ${DIM}│${RESET} 0.8%    ${DIM}│${RESET}`,
	);
	console.log(
		`  ${DIM}│${RESET} database         ${DIM}│${RESET} ${GREEN}● UP${RESET}     ${DIM}│${RESET} 30d 1h 12m ${DIM}│${RESET} 5.3%    ${DIM}│${RESET}`,
	);
	console.log(
		`  ${DIM}│${RESET} cache-redis      ${DIM}│${RESET} ${YELLOW}● WARN${RESET}   ${DIM}│${RESET}  2d 6h 33m ${DIM}│${RESET} 12.7%   ${DIM}│${RESET}`,
	);
	console.log(
		`  ${DIM}│${RESET} worker-queue     ${DIM}│${RESET} ${RED}● DOWN${RESET}   ${DIM}│${RESET}         0s ${DIM}│${RESET} 0.0%    ${DIM}│${RESET}`,
	);
	console.log(
		`  ${DIM}│${RESET} metrics          ${DIM}│${RESET} ${GREEN}● UP${RESET}     ${DIM}│${RESET} 14d 3h 22m ${DIM}│${RESET} 1.4%    ${DIM}│${RESET}`,
	);
	console.log(footer);
	console.log();
}

async function runProgressBar() {
	console.log(`${BOLD}${UNDERLINE}Build Progress${RESET}`);

	const tasks = [
		{ name: "Compiling sources", duration: 800 },
		{ name: "Bundling assets", duration: 600 },
		{ name: "Optimizing images", duration: 400 },
		{ name: "Generating types", duration: 300 },
	];

	for (const task of tasks) {
		const steps = 30;
		const stepTime = task.duration / steps;
		for (let i = 0; i <= steps; i++) {
			const pct = Math.round((i / steps) * 100);
			const filled = Math.round((i / steps) * 20);
			const empty = 20 - filled;
			const bar = `${"█".repeat(filled)}${"░".repeat(empty)}`;
			const color = pct === 100 ? GREEN : pct > 60 ? YELLOW : CYAN;
			process.stdout.write(
				`\r  ${color}${bar}${RESET} ${pct.toString().padStart(3)}% ${task.name}  `,
			);
			await sleep(stepTime);
		}
		console.log(`${GREEN}✓${RESET}`);
	}
	console.log();
}

async function runSpinner() {
	console.log(`${BOLD}${UNDERLINE}Processing${RESET}`);
	const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	const messages = [
		"Connecting to server...",
		"Authenticating...",
		"Fetching data...",
		"Processing results...",
		"Finalizing...",
	];

	for (const msg of messages) {
		for (let i = 0; i < 12; i++) {
			const frame = frames[i % frames.length];
			process.stdout.write(`\r  ${CYAN}${frame}${RESET} ${msg}`);
			await sleep(80);
		}
		process.stdout.write(`\r  ${GREEN}✓${RESET} ${msg}${" ".repeat(20)}\n`);
	}
	console.log();
}

function printLogs() {
	console.log(`${BOLD}${UNDERLINE}Recent Logs${RESET}`);
	const levels = [
		{ tag: "INFO", color: BLUE },
		{ tag: "WARN", color: YELLOW },
		{ tag: "ERROR", color: RED },
		{ tag: "DEBUG", color: DIM },
	];

	const messages = [
		"Server started on port 3000",
		"Database connection established",
		"Cache miss for key user:1234",
		"Request timeout after 30s: GET /api/health",
		"Retrying connection (attempt 2/3)",
		"Worker pool initialized with 4 threads",
		"Schema migration completed: v42 → v43",
		"Rate limit exceeded for IP 192.168.1.100",
		"SSL certificate renewal scheduled",
		"Memory usage: 342MB / 512MB (66.8%)",
		"Garbage collection: freed 28MB in 12ms",
		"New deployment detected: sha=a1b2c3d",
		"Health check passed: all services operational",
		"Cron job executed: cleanup_sessions",
		"WebSocket connection opened: client_id=ws-789",
		"Query execution time: 145ms (slow query threshold: 100ms)",
		"Feature flag updated: dark_mode=enabled",
		"User session expired: user_id=42",
		"API response cached for 300s",
		"Background job completed: email_digest (took 3.2s)",
	];

	for (let i = 0; i < messages.length; i++) {
		const level = levels[i % levels.length];
		const ts = new Date(Date.now() - (messages.length - i) * 1000)
			.toISOString()
			.slice(11, 23);
		console.log(
			`  ${DIM}${ts}${RESET} ${level.color}[${level.tag.padEnd(5)}]${RESET} ${messages[i]}`,
		);
	}
	console.log();
}

function printDivider() {
	console.log(`${DIM}${"─".repeat(56)}${RESET}`);
	console.log();
}

async function interactiveLoop() {
	console.log(`${BOLD}${BG_GREEN}${WHITE} INTERACTIVE MODE ${RESET}`);
	console.log(
		`${DIM}Press 'i' in corsa to enter input mode, then answer below.${RESET}`,
	);
	console.log(
		`${DIM}Press Esc to exit input mode. Type "quit" to exit.${RESET}`,
	);
	console.log();

	let round = 1;

	while (true) {
		console.log(`${BOLD}── Round ${round} ──${RESET}`);

		const name = await ask(`${CYAN}?${RESET} What's your name? `);
		if (name.toLowerCase() === "quit") break;
		console.log(`${GREEN}→${RESET} Hello, ${BOLD}${name}${RESET}!\n`);

		const lang = await ask(`${CYAN}?${RESET} Favorite language? `);
		if (lang.toLowerCase() === "quit") break;
		console.log(
			`${GREEN}→${RESET} ${BOLD}${lang}${RESET} is a great choice!\n`,
		);

		const rating = await ask(`${CYAN}?${RESET} Rate corsa 1-5: `);
		if (rating.toLowerCase() === "quit") break;
		const stars = parseInt(rating, 10);
		if (stars >= 1 && stars <= 5) {
			console.log(
				`${GREEN}→${RESET} ${"⭐".repeat(stars)}${"☆".repeat(5 - stars)} (${stars}/5)\n`,
			);
		} else {
			console.log(`${YELLOW}→${RESET} That's not 1-5, but sure!\n`);
		}

		const more = await ask(`${CYAN}?${RESET} Another round? (y/n) `);
		if (more.toLowerCase() !== "y") break;
		console.log();
		round++;
	}

	console.log();
	console.log(
		`${BOLD}${GREEN}All done!${RESET} Thanks for testing interactive mode.`,
	);
	console.log(`${DIM}Process will exit now.${RESET}\n`);
}

async function main() {
	printBanner();
	printSystemInfo();
	printColorPalette();
	printTextStyles();
	printDivider();
	printTable();
	await runProgressBar();
	await runSpinner();
	printDivider();
	printLogs();
	printDivider();
	await interactiveLoop();

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
