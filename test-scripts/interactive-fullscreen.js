#!/usr/bin/env bun

// Full-screen interactive script for testing VT rendering in corsa.
//
// Usage in corsa.config.toml:
//   [[tools]]
//   name = "interactive-fullscreen"
//   command = "bun"
//   args = ["test-scripts/interactive-fullscreen.js"]
//   interactive = true
//
// This script uses cursor movement and screen manipulation to render a
// full-screen TUI with a menu, live-updating dashboard, and selection list.
// It exercises cursor positioning, screen clears, and multi-line redraws —
// the exact patterns that break without a proper VT.

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const UNDERLINE = `${ESC}4m`;
const RED = `${ESC}31m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const BLUE = `${ESC}34m`;
const CYAN = `${ESC}36m`;
const WHITE = `${ESC}37m`;
const BG_BLUE = `${ESC}44m`;
const BG_CYAN = `${ESC}46m`;

const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const CLEAR_SCREEN = `${ESC}2J`;
const HOME = `${ESC}H`;

// Query actual terminal size from the PTY
const COLS = process.stdout.columns || 120;
const ROWS = process.stdout.rows || 30;

function moveTo(row, col) {
	process.stdout.write(`${ESC}${row};${col}H`);
}

function clearLine() {
	process.stdout.write(`${ESC}2K`);
}

function write(text) {
	process.stdout.write(text);
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Selection List ─────────────────────────────────────────────────────────

const MENU_ITEMS = [
	{ label: "Dashboard", icon: "📊" },
	{ label: "Services", icon: "🔧" },
	{ label: "Logs", icon: "📝" },
	{ label: "Configuration", icon: "⚙️" },
	{ label: "Users & Permissions", icon: "👥" },
	{ label: "Networking", icon: "🌐" },
	{ label: "Storage", icon: "💾" },
	{ label: "Monitoring", icon: "📡" },
	{ label: "Deployments", icon: "🚀" },
	{ label: "Help & Documentation", icon: "❓" },
];

let selectedIndex = 0;

const MENU_START_ROW = 4;
const INFO_COL = Math.max(42, Math.floor(COLS / 2));
const STATUS_DIVIDER_ROW = ROWS - 2;
const STATUS_BAR_ROW = ROWS - 1;
const FEEDBACK_ROW = ROWS - 4;

function drawTitleBar(title) {
	const left = `  ${title}`;
	const right = `${COLS}×${ROWS}  `;
	const pad = Math.max(1, COLS - left.length - right.length);
	moveTo(1, 1);
	write(`${BOLD}${WHITE}${BG_BLUE}${left}${" ".repeat(pad)}${right}${RESET}`);
}

function drawFrame() {
	write(CLEAR_SCREEN);
	write(HOME);

	drawTitleBar("corsa Full-Screen Test");

	// Subtitle
	moveTo(2, 1);
	write(`${DIM}  Use ↑/↓ to navigate, Enter to select, q to quit${RESET}`);

	drawMenu();
	drawInfoPanel();

	// Status divider — full width
	moveTo(STATUS_DIVIDER_ROW, 1);
	write(`${DIM}${"─".repeat(COLS)}${RESET}`);

	// Status bar
	drawStatusBar();
}

function drawStatusBar() {
	moveTo(STATUS_BAR_ROW, 1);
	clearLine();
	write(
		`${DIM}  PID: ${process.pid}  │  TTY: ${process.stdin.isTTY ? "yes" : "no"}  │  Terminal: ${COLS}×${ROWS}  │  Selected: ${selectedIndex + 1}/${MENU_ITEMS.length}${RESET}`,
	);
}

function drawMenu() {
	moveTo(MENU_START_ROW, 1);
	write(`  ${BOLD}${UNDERLINE}Main Menu${RESET}`);

	for (let i = 0; i < MENU_ITEMS.length; i++) {
		const row = MENU_START_ROW + 2 + i;
		moveTo(row, 1);
		clearLine();

		const item = MENU_ITEMS[i];
		if (i === selectedIndex) {
			write(
				`  ${BOLD}${BG_CYAN}${WHITE} ❯ ${item.icon}  ${item.label.padEnd(30)}${RESET}`,
			);
		} else {
			write(`    ${DIM}${item.icon}${RESET}  ${item.label}`);
		}
	}
}

function drawInfoPanel() {
	const item = MENU_ITEMS[selectedIndex];
	const panelWidth = COLS - INFO_COL - 2;

	moveTo(MENU_START_ROW, INFO_COL);
	write(`${BOLD}${UNDERLINE}Details${RESET}`);

	moveTo(MENU_START_ROW + 2, INFO_COL);
	write(`${ESC}0K`);
	write(`${BOLD}${item.icon}  ${item.label}${RESET}`);

	moveTo(MENU_START_ROW + 4, INFO_COL);
	write(`${ESC}0K`);
	write(`${DIM}Status: ${GREEN}● Active${RESET}`);

	moveTo(MENU_START_ROW + 5, INFO_COL);
	write(`${ESC}0K`);
	write(`${DIM}Index:  ${selectedIndex + 1} of ${MENU_ITEMS.length}${RESET}`);

	// Mini bar chart
	moveTo(MENU_START_ROW + 7, INFO_COL);
	write(`${ESC}0K`);
	write(`${DIM}Load:${RESET}`);

	moveTo(MENU_START_ROW + 8, INFO_COL);
	write(`${ESC}0K`);
	let barUsed = 0;
	while (barUsed + 3 <= panelWidth) {
		const maxB = Math.min(8, panelWidth - barUsed - 1);
		const b = 1 + Math.floor(Math.random() * maxB);
		const color = b > 6 ? RED : b > 3 ? YELLOW : GREEN;
		write(`${color}${"▇".repeat(b)}${RESET} `);
		barUsed += b + 1;
	}

	// Resource summary
	moveTo(MENU_START_ROW + 10, INFO_COL);
	write(`${ESC}0K`);
	write(`${DIM}Memory:  ${GREEN}342MB${RESET}${DIM} / 512MB${RESET}`);

	moveTo(MENU_START_ROW + 11, INFO_COL);
	write(`${ESC}0K`);
	write(`${DIM}Disk:    ${YELLOW}78%${RESET}${DIM} used${RESET}`);

	moveTo(MENU_START_ROW + 12, INFO_COL);
	write(`${ESC}0K`);
	write(`${DIM}Network: ${GREEN}↓ 12.3${RESET}${DIM} ↑ 4.1 Mbps${RESET}`);
}

// ─── Live Dashboard ─────────────────────────────────────────────────────────

async function runDashboard() {
	write(HIDE_CURSOR);
	write(CLEAR_SCREEN);
	write(HOME);

	drawTitleBar("Live Dashboard");

	moveTo(2, 1);
	write(
		`${DIM}  Updating every 200ms... (auto-transitions to menu in 5s)${RESET}`,
	);
	moveTo(3, 1);
	write(`${DIM}${"─".repeat(COLS)}${RESET}`);

	const barWidth = Math.min(40, COLS - 25);

	for (let tick = 0; tick < 25; tick++) {
		// CPU gauges
		moveTo(5, 1);
		write(`  ${BOLD}CPU Usage${RESET}`);
		for (let core = 0; core < 4; core++) {
			moveTo(6 + core, 1);
			clearLine();
			const usage = Math.round(
				20 + Math.sin(tick * 0.3 + core) * 15 + Math.random() * 10,
			);
			const barLen = Math.round((usage / 100) * barWidth);
			const color = usage > 70 ? RED : usage > 40 ? YELLOW : GREEN;
			write(
				`  Core ${core}: ${color}${"█".repeat(barLen)}${"░".repeat(barWidth - barLen)}${RESET} ${usage}%`,
			);
		}

		// Memory
		moveTo(11, 1);
		write(`  ${BOLD}Memory${RESET}`);
		moveTo(12, 1);
		clearLine();
		const memUsed =
			2048 + Math.round(Math.sin(tick * 0.2) * 512 + Math.random() * 100);
		const memTotal = 4096;
		const memPct = Math.round((memUsed / memTotal) * 100);
		const memBar = Math.round((memPct / 100) * barWidth);
		const memColor = memPct > 80 ? RED : memPct > 50 ? YELLOW : GREEN;
		write(
			`  ${memColor}${"█".repeat(memBar)}${"░".repeat(barWidth - memBar)}${RESET} ${memUsed}MB / ${memTotal}MB (${memPct}%)`,
		);

		// Network I/O
		moveTo(14, 1);
		write(`  ${BOLD}Network I/O${RESET}`);
		moveTo(15, 1);
		clearLine();
		const rxMbps = (5 + Math.random() * 10).toFixed(1);
		const txMbps = (2 + Math.random() * 5).toFixed(1);
		write(
			`  ${GREEN}↓ ${rxMbps} Mbps${RESET}  ${BLUE}↑ ${txMbps} Mbps${RESET}`,
		);

		// Request counter with sparkline
		moveTo(17, 1);
		write(`  ${BOLD}Requests${RESET}`);
		moveTo(18, 1);
		clearLine();
		const rps = Math.round(
			100 + Math.sin(tick * 0.5) * 50 + Math.random() * 20,
		);
		const sparkLen = Math.min(30, COLS - 20);
		const sparkline = Array.from({ length: sparkLen }, (_, i) => {
			const v = Math.round(100 + Math.sin((tick - sparkLen + i) * 0.5) * 50);
			return v > 130 ? "▇" : v > 110 ? "▆" : v > 90 ? "▅" : v > 70 ? "▃" : "▁";
		}).join("");
		write(`  ${CYAN}${sparkline}${RESET}  ${rps} req/s`);

		// Tick counter and status
		moveTo(ROWS - 2, 1);
		write(`${DIM}${"─".repeat(COLS)}${RESET}`);
		moveTo(ROWS - 1, 1);
		clearLine();
		write(`${DIM}  Tick: ${tick + 1}/25  │  Terminal: ${COLS}×${ROWS}${RESET}`);

		await sleep(200);
	}
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
	// Phase 1: Output some initial text to scrollback
	console.log(`${BOLD}${CYAN}[interactive-fullscreen]${RESET} Starting up...`);
	console.log(
		`${DIM}PID: ${process.pid}, TTY: ${process.stdin.isTTY}, Terminal: ${COLS}×${ROWS}${RESET}`,
	);
	console.log();
	console.log(`This script demonstrates full-screen terminal rendering.`);
	console.log(`It will show a live dashboard, then a navigable menu.`);
	console.log();
	console.log(
		`${DIM}Press 'i' in corsa to enter input mode for navigation.${RESET}`,
	);
	console.log(`${DIM}${"─".repeat(COLS)}${RESET}`);

	await sleep(1000);

	// Phase 2: Live dashboard with in-place updates
	await runDashboard();

	// Phase 3: Interactive menu with cursor-based navigation
	if (process.stdin.isTTY) {
		process.stdin.setRawMode(true);
	}
	process.stdin.resume();

	drawFrame();

	process.stdin.on("data", (data) => {
		const key = data.toString();

		if (key === "\x1b[A") {
			selectedIndex = Math.max(0, selectedIndex - 1);
			drawMenu();
			drawInfoPanel();
			drawStatusBar();
			return;
		}

		if (key === "\x1b[B") {
			selectedIndex = Math.min(MENU_ITEMS.length - 1, selectedIndex + 1);
			drawMenu();
			drawInfoPanel();
			drawStatusBar();
			return;
		}

		if (key === "\r" || key === "\n") {
			const item = MENU_ITEMS[selectedIndex];
			moveTo(FEEDBACK_ROW, 1);
			clearLine();
			write(`  ${GREEN}✓${RESET} Selected: ${BOLD}${item.label}${RESET}`);
			return;
		}

		if (key === "q" || key === "\x03") {
			write(SHOW_CURSOR);
			write(CLEAR_SCREEN);
			write(HOME);
			console.log(`${BOLD}${GREEN}Goodbye!${RESET} Full-screen test complete.`);
			process.exit(0);
		}
	});
}

main().catch((err) => {
	write(SHOW_CURSOR);
	console.error(`${RED}Error:${RESET}`, err.message);
	process.exit(1);
});

process.on("SIGTERM", () => {
	write(SHOW_CURSOR);
	write(CLEAR_SCREEN);
	write(HOME);
	console.log(`${YELLOW}[fullscreen]${RESET} Received SIGTERM, shutting down`);
	process.exit(0);
});

process.on("SIGINT", () => {
	write(SHOW_CURSOR);
	write(CLEAR_SCREEN);
	write(HOME);
	console.log(`${YELLOW}[fullscreen]${RESET} Received SIGINT, shutting down`);
	process.exit(0);
});
