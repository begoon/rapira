/**
 * Web Worker: runs the Rapira interpreter off the UI thread.
 *
 * Protocol — main thread sends `{ kind: 'run', source }`; the worker
 * replies with output and gfx events. If the main thread wants to
 * cancel, it terminates this worker and spawns a fresh one.
 */

import { tokenize } from '../src/lexer.ts';
import { parse } from '../src/parser.ts';
import { Interpreter, type Host } from '../src/interpreter.ts';
import { BufferingSink } from '../src/graphics.ts';
import { RapiraError } from '../src/errors.ts';

export type WorkerIn  = { kind: 'run'; source: string };
export type WorkerOut =
  | { kind: 'done';  output: string; gfx: import('../src/graphics.ts').GfxEvent[]; durationMs: number }
  | { kind: 'error'; message: string; line?: number; col?: number; output: string; gfx: import('../src/graphics.ts').GfxEvent[] };

class WorkerHost implements Host {
  out = '';
  gfx = new BufferingSink();
  // No `fs` — file ops throw cleanly via interpreter's requireFs check.
  write(s: string): void { this.out += s; }
  writeln(): void { this.out += '\n'; }
  readLine(): string { return ''; }
  /** Synchronous blocking sleep, valid in a Web Worker via Atomics.wait. */
  pause(ms: number): void {
    if (ms <= 0) return;
    const sab = new SharedArrayBuffer(4);
    const view = new Int32Array(sab);
    Atomics.wait(view, 0, 0, ms);
  }
}

self.onmessage = (e: MessageEvent<WorkerIn>): void => {
  if (e.data.kind !== 'run') return;
  const t0 = performance.now();
  const host = new WorkerHost();
  try {
    const interp = new Interpreter(host);
    interp.run(parse(tokenize(e.data.source)));
    const msg: WorkerOut = {
      kind: 'done',
      output: host.out,
      gfx: host.gfx.events,
      durationMs: Math.round(performance.now() - t0),
    };
    (self as unknown as Worker).postMessage(msg);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const pos = err instanceof RapiraError ? err.pos : undefined;
    const msg: WorkerOut = {
      kind: 'error',
      message,
      ...(pos ? { line: pos.line, col: pos.col } : {}),
      output: host.out,
      gfx: host.gfx.events,
    };
    (self as unknown as Worker).postMessage(msg);
  }
};
