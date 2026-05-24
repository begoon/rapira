<script lang="ts">
  import Editor from './lib/Editor.svelte';
  import Output from './lib/Output.svelte';
  import type { WorkerIn, WorkerOut } from './lib/worker.ts';
  import type { GfxEvent } from '../src/graphics.ts';

  const SAMPLE = `(* Чертёжник рисует звезду *)
ЦВЕТ(1);
ПОВТОР 5 РАЗА ::
   ВПЕРЕД(80);
   НАПРАВО(144)
ВСЕ;

? "Готово!";
`;

  let source = $state(SAMPLE);
  let textOut = $state('');
  let gfx: GfxEvent[] = $state([]);
  let status = $state('готов');
  let isError = $state(false);

  let worker: Worker | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  function spawnWorker(): Worker {
    return new Worker(new URL('./lib/worker.ts', import.meta.url), { type: 'module' });
  }

  function runOnce(src: string): void {
    if (worker) worker.terminate();
    worker = spawnWorker();
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const r = e.data;
      textOut = r.output;
      gfx = r.gfx;
      if (r.kind === 'done') {
        status = `выполнено за ${r.durationMs} мс`;
        isError = false;
      } else {
        const where = r.line ? ` (стр. ${r.line}:${r.col})` : '';
        status = `ошибка: ${r.message}${where}`;
        isError = true;
      }
    };
    status = 'выполняется…';
    isError = false;
    const msg: WorkerIn = { kind: 'run', source: src };
    worker.postMessage(msg);
  }

  function onSourceChange(s: string): void {
    source = s;
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runOnce(s), 300);
  }

  // Run the sample on first paint
  $effect(() => { runOnce(source); });
</script>

<div class="layout">
  <header class="header">
    <h1>РАПИРА</h1>
    <span class="status" class:error={isError}>{status}</span>
  </header>

  <section class="pane editor-pane">
    <div class="pane-title">программа</div>
    <Editor initial={SAMPLE} onChange={onSourceChange} />
  </section>

  <section class="pane">
    <div class="pane-title">вывод</div>
    <Output text={textOut} {gfx} />
  </section>
</div>
