/**
 * Web playground — entry point.
 *
 * Vanilla DOM + CodeMirror 6. The interpreter runs in a Web Worker so the
 * UI thread stays responsive; we debounce edits 300 ms and terminate any
 * in-flight worker before spawning a fresh one (cancel-on-edit).
 */

import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, foldGutter } from '@codemirror/language';

import { rapira, type RapiraTheme } from './lib/rapira-mode.ts';
import { renderEvents } from './lib/renderer.ts';
import type { WorkerIn, WorkerOut } from './worker.ts';

type Theme = 'light' | 'dark';

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
      <label for="example-select">Пример:</label>
      <select id="example-select" aria-label="Загрузить пример">
        <option value="">— выбрать —</option>
      </select>
      <span id="status" class="status">готов</span>
      <label for="theme-select">Тема:</label>
      <select id="theme-select" aria-label="Тема оформления">
        <option value="light">светлая</option>
        <option value="dark">тёмная</option>
      </select>
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

const statusEl     = document.getElementById('status')         as HTMLSpanElement;
const editorHost   = document.getElementById('editor')         as HTMLDivElement;
const textOutEl    = document.getElementById('text-out')       as HTMLDivElement;
const canvasHost   = document.getElementById('canvas-host')    as HTMLDivElement;
const canvas       = document.getElementById('canvas')         as HTMLCanvasElement;
const exampleSel   = document.getElementById('example-select') as HTMLSelectElement;
const themeSel     = document.getElementById('theme-select')   as HTMLSelectElement;

function setStatus(msg: string, error = false): void {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', error);
}

// ---- theme ----

const THEME_KEY = 'rapira-theme';
function getStoredTheme(): Theme {
  const v = localStorage.getItem(THEME_KEY);
  return v === 'dark' ? 'dark' : 'light';
}
function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  themeSel.value = theme;
  localStorage.setItem(THEME_KEY, theme);
  editorTheme.reconfigure(makeEditorExtensions(theme));
}

function makeEditorExtensions(theme: Theme): import('@codemirror/state').Extension {
  const cmTheme = EditorView.theme(
    {
      '&':                    { backgroundColor: 'var(--bg)', color: 'var(--fg)' },
      '.cm-gutters':          { backgroundColor: 'var(--panel)', color: 'var(--muted)', border: 'none' },
      '.cm-activeLine':       { backgroundColor: theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
      '.cm-activeLineGutter': { backgroundColor: theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' },
      '.cm-content':          { caretColor: 'var(--accent)' },
    },
    { dark: theme === 'dark' },
  );
  return [cmTheme, rapira(theme as RapiraTheme)];
}

const editorTheme = new Compartment();

// ---- worker management ----

let worker: Worker | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function runOnce(source: string): void {
  if (worker) worker.terminate();
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerOut>): void => {
    const r = e.data;
    textOutEl.textContent = r.output.length > 0 ? r.output : ' ';
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

const view = new EditorView({
  state: EditorState.create({
    doc: SAMPLE,
    extensions: [
      lineNumbers(),
      foldGutter(),
      history(),
      bracketMatching(),
      highlightActiveLine(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      editorTheme.of(makeEditorExtensions(getStoredTheme())),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) scheduleRun(u.state.doc.toString());
      }),
    ],
  }),
  parent: editorHost,
});

function replaceDocument(text: string): void {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

// ---- example selector ----

interface ExampleEntry { name: string; title: string }

async function populateExamples(): Promise<void> {
  try {
    const r = await fetch('./examples/index.json');
    if (!r.ok) return;
    const items = await r.json() as ExampleEntry[];
    for (const it of items) {
      const opt = document.createElement('option');
      opt.value = it.name;
      opt.textContent = `${it.name} — ${it.title}`;
      exampleSel.appendChild(opt);
    }
  } catch (e) {
    console.warn('failed to load examples', e);
  }
}

exampleSel.addEventListener('change', async () => {
  const name = exampleSel.value;
  if (!name) return;
  try {
    const r = await fetch(`./examples/${name}.rap`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const src = await r.text();
    replaceDocument(src);
  } catch (e) {
    setStatus(`не удалось загрузить пример: ${(e as Error).message}`, true);
  }
});

// ---- theme selector ----

themeSel.addEventListener('change', () => {
  applyTheme(themeSel.value === 'dark' ? 'dark' : 'light');
});

// ---- init ----

applyTheme(getStoredTheme());
void populateExamples();
runOnce(SAMPLE);
