/**
 * Web playground — entry point.
 *
 * Vanilla DOM + CodeMirror 6. The interpreter runs in a Web Worker so the
 * UI thread stays responsive; we debounce edits 300 ms and terminate any
 * in-flight worker before spawning a fresh one (cancel-on-edit).
 */

import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, foldGutter } from '@codemirror/language';

import { rapira } from './lib/rapira-mode.ts';
import { renderEvents } from './lib/renderer.ts';
import type { WorkerIn, WorkerOut } from './worker.ts';

const SAMPLE = `(* Чертёжник рисует звезду *)
ЦВЕТ(1);
ПОВТОР 5 РАЗА ::
   ВПЕРЕД(80);
   НАПРАВО(144)
ВСЕ;

? "Готово!";
`;

// ---- DOM scaffold ----

const app = document.getElementById('app');
if (!app) throw new Error('No #app element');

app.innerHTML = `
  <div class="layout">
    <header class="header">
      <h1>РАПИРА</h1>
      <span id="status" class="status">готов</span>
    </header>
    <section class="pane editor-pane">
      <div class="pane-title">программа</div>
      <div id="editor"></div>
    </section>
    <section class="pane">
      <div class="pane-title">вывод</div>
      <div class="output-pane">
        <div id="text-out" class="text-output"></div>
        <div id="canvas-host" class="canvas-host" hidden>
          <canvas id="canvas" width="256" height="256"></canvas>
        </div>
      </div>
    </section>
  </div>
`;

const statusEl   = document.getElementById('status')      as HTMLSpanElement;
const editorHost = document.getElementById('editor')      as HTMLDivElement;
const textOutEl  = document.getElementById('text-out')    as HTMLDivElement;
const canvasHost = document.getElementById('canvas-host') as HTMLDivElement;
const canvas     = document.getElementById('canvas')      as HTMLCanvasElement;

function setStatus(msg: string, error = false): void {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', error);
}

// ---- Worker management ----

let worker: Worker | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function runOnce(source: string): void {
  if (worker) worker.terminate();
  // Reference the bundled worker output. Both web/worker.ts and web/index.html
  // are explicit entrypoints in scripts/web-build.ts so they end up alongside
  // each other in the output directory.
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerOut>): void => {
    const r = e.data;
    textOutEl.textContent = r.output.length > 0 ? r.output : ' ';
    if (r.gfx.length > 0) {
      canvasHost.hidden = false;
      renderEvents(canvas, r.gfx);
    } else {
      canvasHost.hidden = true;
    }
    if (r.kind === 'done') {
      setStatus(`выполнено за ${r.durationMs} мс`);
    } else {
      const where = r.line ? ` (стр. ${r.line}:${r.col})` : '';
      setStatus(`ошибка: ${r.message}${where}`, true);
    }
  };
  setStatus('выполняется…');
  const msg: WorkerIn = { kind: 'run', source };
  worker.postMessage(msg);
}

function scheduleRun(source: string): void {
  if (debounceTimer !== undefined) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runOnce(source), 300);
}

// ---- CodeMirror editor ----

new EditorView({
  state: EditorState.create({
    doc: SAMPLE,
    extensions: [
      lineNumbers(),
      foldGutter(),
      history(),
      bracketMatching(),
      highlightActiveLine(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      rapira(),
      EditorView.theme(
        {
          '&':                    { backgroundColor: 'var(--bg)', color: 'var(--fg)' },
          '.cm-gutters':          { backgroundColor: 'var(--panel)', color: 'var(--muted)', border: 'none' },
          '.cm-activeLine':       { backgroundColor: 'rgba(255,255,255,0.04)' },
          '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.06)' },
          '.cm-content':          { caretColor: 'var(--accent)' },
        },
        { dark: true },
      ),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) scheduleRun(u.state.doc.toString());
      }),
    ],
  }),
  parent: editorHost,
});

// ---- Initial run ----

runOnce(SAMPLE);
