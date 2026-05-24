#!/usr/bin/env node
/**
 * Rapira CLI.
 *
 *   rapira FILE.rap [--svg OUT.svg]
 *   rapira [--svg OUT.svg]              start REPL
 *
 * The REPL is line-buffered: statements accumulate until you submit an
 * empty line, then the buffer is executed as one program. Use Ctrl-D
 * (EOF) to quit.
 *
 * The shebang says `node` (not `bun`) because npm/npx invokes binaries via
 * the node shim on Windows. We rely on Atomics.wait for sync sleep so the
 * code stays portable across Node and Bun.
 */

import { readSync as fsReadSync, readFileSync, writeFileSync } from "node:fs";

import { LexError, ParseError, RapiraError } from "../src/errors.ts";
import { BufferingSink, type GraphicsSink } from "../src/graphics.ts";
import { Interpreter, type Host } from "../src/interpreter.ts";
import { tokenize } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
import { NodeFileSystem } from "./fs.ts";
import { eventsToSvg } from "./svg.ts";

interface Args {
    file: string | null;
    svgOut: string | null;
}

function parseArgs(argv: string[]): Args {
    const out: Args = { file: null, svgOut: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]!;
        if (a === "-h" || a === "--help") {
            printHelp();
            process.exit(0);
        }
        if (a === "--svg") {
            const next = argv[++i];
            if (!next) die("--svg requires a path");
            out.svgOut = next;
            continue;
        }
        if (a.startsWith("-")) die(`Unknown option: ${a}`);
        if (out.file !== null) die(`Unexpected extra argument: ${a}`);
        out.file = a;
    }
    return out;
}

function printHelp(): void {
    process.stdout.write(`Rapira — interpreter for vanilla Agat Rapira (Рапира).

Usage:
  rapira FILE.rap [--svg OUT.svg]    Run a program
  rapira [--svg OUT.svg]              Start REPL (Ctrl-D to quit)

Options:
  --svg PATH                          Write captured graphics to SVG
  -h, --help                          Show this help
`);
}

function die(msg: string): never {
    process.stderr.write(`rapira: ${msg}\n`);
    process.exit(2);
}

// ---- Real-stdin/stdout Host ----

class ConsoleHost implements Host {
    gfx: GraphicsSink;
    fs: NodeFileSystem = new NodeFileSystem();
    private inputBuffer: string[] = [];

    constructor(gfx: GraphicsSink) {
        this.gfx = gfx;
    }

    write(s: string): void {
        process.stdout.write(s);
    }
    writeln(): void {
        process.stdout.write("\n");
    }

    feedLines(lines: string[]): void {
        this.inputBuffer.push(...lines);
    }

    readLine(): string {
        if (this.inputBuffer.length > 0) return this.inputBuffer.shift()!;
        // For interpreter callers, EOF is indistinguishable from an empty line.
        return readLineSync() ?? "";
    }

    pause(ms: number): void {
        if (ms <= 0) return;
        // Portable synchronous sleep that works in both Node and Bun without
        // spawning a child process.
        const sab = new SharedArrayBuffer(4);
        const view = new Int32Array(sab);
        Atomics.wait(view, 0, 0, ms);
    }
}

/**
 * Blocking line read from fd 0, portable across Node and Bun. Returns:
 *   - the line text (without the trailing newline) on a successful read
 *   - "" when the user pressed Enter on an empty line
 *   - null when stdin is at EOF (Ctrl-D / closed pipe)
 *
 * The REPL distinguishes the second case ("submit buffer") from the third
 * ("quit"); other callers coerce null → "" since the interpreter has no
 * separate EOF concept.
 */
function readLineSync(): string | null {
    const chunks: number[] = [];
    const buf = new Uint8Array(1);
    let gotAny = false;
    while (true) {
        let n = 0;
        try {
            n = fsReadSync(0, buf, 0, 1, null);
        } catch {
            n = 0;
        }
        if (n === 0) return gotAny ? Buffer.from(chunks).toString("utf8") : null;
        gotAny = true;
        const b = buf[0]!;
        if (b === 0x0a) break; // \n
        if (b === 0x0d) continue; // \r — skip
        chunks.push(b);
    }
    return Buffer.from(chunks).toString("utf8");
}

// ---- Pretty error reporting ----

function reportError(e: unknown, source: string, sourceName: string): void {
    if (e instanceof RapiraError) {
        process.stderr.write(`${sourceName}:${e.pos?.line ?? "?"}:${e.pos?.col ?? "?"}: ${e.message}\n`);
        if (e.pos) {
            const line = source.split("\n")[e.pos.line - 1] ?? "";
            process.stderr.write(`  ${line}\n`);
            process.stderr.write(`  ${" ".repeat(Math.max(0, e.pos.col - 1))}^\n`);
        }
    } else if (e instanceof Error) {
        process.stderr.write(`${sourceName}: ${e.message}\n`);
    } else {
        process.stderr.write(`${sourceName}: ${String(e)}\n`);
    }
}

// ---- Run a file ----

function runFile(path: string, args: Args): void {
    const source = readFileSync(path, "utf8");
    const gfx = args.svgOut ? new BufferingSink() : undefined;
    const host = new ConsoleHost(gfx ?? noopSink());
    const interp = new Interpreter(host);
    try {
        interp.run(parse(tokenize(source)));
    } catch (e) {
        reportError(e, source, path);
        process.exit(1);
    } finally {
        host.fs.closeAll(); // flush any files left open by the program
    }
    if (gfx && args.svgOut) {
        writeFileSync(args.svgOut, eventsToSvg(gfx.events));
        process.stderr.write(`rapira: wrote ${gfx.events.length} graphics events to ${args.svgOut}\n`);
    }
}

function noopSink(): GraphicsSink {
    return {
        emit() {
            /* discard */
        },
    };
}

// ---- REPL ----

function runRepl(args: Args): void {
    const gfx = args.svgOut ? new BufferingSink() : undefined;
    const host = new ConsoleHost(gfx ?? noopSink());
    const interp = new Interpreter(host);

    process.stdout.write("РАПИРА/JS. Ctrl-D — выход.\n");

    const buffer: string[] = [];
    const prompt = (): void => {
        process.stdout.write(buffer.length === 0 ? "РАПИРА> " : "....> ");
    };
    prompt();

    const runBuffer = (): void => {
        const src = buffer.join("\n");
        buffer.length = 0;
        try {
            interp.run(parse(tokenize(src)));
        } catch (e) {
            reportError(e, src, "<repl>");
        }
    };

    while (true) {
        const line = readLineSync();

        // True EOF (Ctrl-D / closed pipe): flush any pending buffer, then quit.
        if (line === null) {
            if (buffer.length > 0) runBuffer();
            process.stdout.write("\n");
            break;
        }

        // Empty line with nothing buffered: just re-prompt.
        if (line === "" && buffer.length === 0) {
            prompt();
            continue;
        }

        // Empty line with content buffered: force-execute (even if syntactically
        // incomplete — the parse error will be surfaced by runBuffer).
        if (line === "") {
            runBuffer();
            prompt();
            continue;
        }

        buffer.push(line);

        // Auto-execute when the buffer parses cleanly. If it fails because the
        // parser ran out of tokens looking for more, keep buffering. Anything
        // else is a real error — surface it now and clear.
        const verdict = classifyInput(buffer.join("\n"));
        if (verdict !== "incomplete") runBuffer();
        prompt();
    }

    if (gfx && args.svgOut) {
        writeFileSync(args.svgOut, eventsToSvg(gfx.events));
        process.stderr.write(`\nrapira: wrote ${gfx.events.length} graphics events to ${args.svgOut}\n`);
    }
}

/**
 * Decide whether the in-progress REPL input is a complete program,
 * incomplete (parser/lexer ran out of input looking for more), or
 * syntactically broken in a way we should surface immediately.
 */
function classifyInput(src: string): "complete" | "incomplete" | "error" {
    let tokens;
    try {
        tokens = tokenize(src);
    } catch (e) {
        if (e instanceof LexError && /Unterminated/i.test(e.message)) return "incomplete";
        return "error";
    }
    try {
        parse(tokens);
        return "complete";
    } catch (e) {
        if (e instanceof ParseError && /got EOF/.test(e.message)) return "incomplete";
        return "error";
    }
}

// ---- Main ----

const args = parseArgs(process.argv.slice(2));
if (args.file) runFile(args.file, args);
else runRepl(args);
