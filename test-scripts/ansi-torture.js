#!/usr/bin/env bun

const ESC = "\x1b";
const ST = `${ESC}\\`;

console.log("=== ANSI torture: visible text must match each expectation ===");
console.log(`[T01] RIS mid-line — expect "beforeafter": before${ESC}cafter`);
console.log(`[T02] save/restore cursor — expect "abc": a${ESC}7b${ESC}8c`);
console.log(`[T03] reverse index — expect "ab": a${ESC}Mb`);
console.log(`[T04] keypad modes — expect "abc": a${ESC}=b${ESC}>c`);
console.log(`[T05] clear-screen combo — expect "ab": a${ESC}[2J${ESC}[Hb`);
console.log(`[T06] erase-line — expect "ab": a${ESC}[2Kb`);
console.log(`[T07] cursor moves — expect "abc": a${ESC}[5Ab${ESC}[10;20Hc`);
// \x1b[1G moves to column 1, so like \r it overwrites the whole line.
console.log(
	'[T07b] column-1 reset overwrites — expect next line to be just "d"',
);
console.log(`this text should be fully overwritten${ESC}[1Gd`);
console.log(`[T08] scroll region — expect "ab": a${ESC}[5;20rb`);
console.log(`[T09] hide/show cursor — expect "abc": a${ESC}[?25lb${ESC}[?25hc`);
console.log(
	`[T10] alternate screen — expect "abc": a${ESC}[?1049hb${ESC}[?1049lc`,
);
console.log(`[T11] bracketed paste — expect "ab": a${ESC}[?2004hb`);
console.log(`[T12] prefixed-m impostor — expect "ab": a${ESC}[>4;2mb`);
console.log(`[T13] CSI intermediate — expect "ab": a${ESC}[ qb`);
console.log(`[T14] OSC title/BEL — expect "ab": a${ESC}]0;hostile title\x07b`);
console.log(
	`[T15] OSC hyperlink/ST — expect "alinkb": a${ESC}]8;;https://example.com${ST}link${ESC}]8;;${ST}b`,
);
console.log(
	`[T16] unterminated OSC — expect "a": a${ESC}]0;payload must not leak`,
);
console.log(`[T17] DCS payload — expect "ab": a${ESC}Ppayload${ST}b`);
console.log(`[T18] SOS payload — expect "ab": a${ESC}Xpayload${ST}b`);
console.log(`[T19] PM payload — expect "ab": a${ESC}^payload${ST}b`);
console.log(`[T20] APC payload — expect "ab": a${ESC}_payload${ST}b`);
console.log(`[T21] C1 CSI — expect "ab": a\x9b31mb`);
console.log(`[T22] lone trailing ESC — expect "a": a${ESC}`);
console.log('[T23] stray BEL — expect "ab": a\x07b');
console.log(
	"[T24] next output line contains only escapes — expect: blank line",
);
console.log(`${ESC}c${ESC}[2J${ESC}[H${ESC}[?25l${ESC}[?25h`);
console.log(
	`[T25] SGR survives hostile controls — expect red "red", then green "green": ${ESC}[31mred${ESC}c${ESC}[32mgreen${ESC}[0m`,
);

console.log("=== tsc --watch simulation: a safe update every 3 seconds ===");
let counter = 0;
const interval = setInterval(() => {
	counter++;
	console.log(
		`${ESC}c[watch ${counter}] File change detected. Starting incremental compilation...`,
	);
	console.log(
		JSON.stringify({ level: 30, msg: "compile-complete", counter, errors: 0 }),
	);
	console.log(
		JSON.stringify({
			level: 30,
			msg: "steady-heartbeat",
			counter,
			alive: true,
		}),
	);
	console.log(
		JSON.stringify({ level: 20, msg: "watch-idle", counter, waiting: true }),
	);
}, 3000);

function shutdown(signal) {
	clearInterval(interval);
	console.log(`[ANSI TORTURE] ${signal} received — shutting down`);
	process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
