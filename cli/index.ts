#!/usr/bin/env bun
/**
 * Rapira CLI.
 *
 *   rapira FILE.rap [--svg OUT.svg]
 *   rapira [--svg OUT.svg]              start REPL
 *
 * The REPL is line-buffered: statements accumulate until you submit an
 * empty line, then the buffer is executed as one program. Use Ctrl-D
 * (EOF) to quit.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { Interpreter, type Host } from '../src/interpreter.ts';
import { tokenize } from '../src/lexer.ts';
import { parse } from '../src/parser.ts';
import { BufferingSink, type GraphicsSink } from '../src/graphics.ts';
import { RapiraError } from '../src/errors.ts';
import { eventsToSvg } from './svg.ts';
import { NodeFileSystem } from './fs.ts';

interface Args {
  file: string | null;
  svgOut: string | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { file: null, svgOut: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '-h' || a === '--help') { printHelp(); process.exit(0); }
    if (a === '--svg') {
      const next = argv[++i];
      if (!next) die('--svg requires a path');
      out.svgOut = next;
      continue;
    }
    if (a.startsWith('-')) die(`Unknown option: ${a}`);
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

  constructor(gfx: GraphicsSink) { this.gfx = gfx; }

  write(s: string): void { process.stdout.write(s); }
  writeln(): void { process.stdout.write('\n'); }

  feedLines(lines: string[]): void { this.inputBuffer.push(...lines); }

  readLine(): string {
    if (this.inputBuffer.length > 0) return this.inputBuffer.shift()!;
    // Synchronous one-line read from stdin via Bun. Returns '' at EOF.
    return readLineSync();
  }
}

/** Blocking line read from fd 0. Uses Bun's sync FFI for portability. */
function readLineSync(): string {
  const chunks: number[] = [];
  const buf = new Uint8Array(1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fs = require('node:fs');
  while (true) {
    let n = 0;
    try { n = fs.readSync(0, buf, 0, 1, null); } catch { n = 0; }
    if (n === 0) break;
    const b = buf[0]!;
    if (b === 0x0a) break;             // \n
    if (b === 0x0d) continue;          // \r — skip
    chunks.push(b);
  }
  return Buffer.from(chunks).toString('utf8');
}

// ---- Pretty error reporting ----

function reportError(e: unknown, source: string, sourceName: string): void {
  if (e instanceof RapiraError) {
    process.stderr.write(`${sourceName}:${e.pos?.line ?? '?'}:${e.pos?.col ?? '?'}: ${e.message}\n`);
    if (e.pos) {
      const line = source.split('\n')[e.pos.line - 1] ?? '';
      process.stderr.write(`  ${line}\n`);
      process.stderr.write(`  ${' '.repeat(Math.max(0, e.pos.col - 1))}^\n`);
    }
  } else if (e instanceof Error) {
    process.stderr.write(`${sourceName}: ${e.message}\n`);
  } else {
    process.stderr.write(`${sourceName}: ${String(e)}\n`);
  }
}

// ---- Run a file ----

function runFile(path: string, args: Args): void {
  const source = readFileSync(path, 'utf8');
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
  return { emit() { /* discard */ } };
}

// ---- REPL ----

function runRepl(args: Args): void {
  const gfx = args.svgOut ? new BufferingSink() : undefined;
  const host = new ConsoleHost(gfx ?? noopSink());
  const interp = new Interpreter(host);

  process.stdout.write('РАПИРА — Bun port. Пустая строка — выполнить буфер. Ctrl-D — выход.\n');

  const buffer: string[] = [];
  const prompt = (): void => { process.stdout.write(buffer.length === 0 ? 'РАПИРА> ' : '....> '); };
  prompt();

  // Read lines synchronously. Once EOF is hit (readLineSync returns '' with no
  // pending input), exit. We treat an empty submitted line as "run the buffer".
  while (true) {
    const line = readLineSync();
    if (line === '' && buffer.length === 0) {
      // Distinguish empty-prompt enter from true EOF: peek for more data with
      // a non-blocking read attempt; if no bytes, assume EOF.
      if (!stdinHasMore()) break;
      prompt();
      continue;
    }
    if (line === '') {
      const src = buffer.join('\n');
      buffer.length = 0;
      try {
        interp.run(parse(tokenize(src)));
      } catch (e) {
        reportError(e, src, '<repl>');
      }
    } else {
      buffer.push(line);
    }
    prompt();
  }

  if (gfx && args.svgOut) {
    writeFileSync(args.svgOut, eventsToSvg(gfx.events));
    process.stderr.write(`\nrapira: wrote ${gfx.events.length} graphics events to ${args.svgOut}\n`);
  }
}

function stdinHasMore(): boolean {
  // Conservative: if process.stdin is a TTY there's always more.
  return Boolean((process.stdin as { isTTY?: boolean }).isTTY);
}

// ---- Main ----

const args = parseArgs(process.argv.slice(2));
if (args.file) runFile(args.file, args);
else           runRepl(args);
