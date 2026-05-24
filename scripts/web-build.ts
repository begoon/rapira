#!/usr/bin/env bun
/**
 * Bun-only build + dev server for the web playground.
 *
 *   bun run scripts/web-build.ts            one-shot production build
 *   bun run scripts/web-build.ts --dev      build + watch + serve on :10000
 *
 * Two explicit entrypoints: the HTML page (which pulls in main.ts and the
 * CSS) and the worker module. Outputs sit side-by-side in `docs/` so
 * `new Worker(new URL('./worker.js', import.meta.url))` resolves at runtime
 * without an import-map. `docs/` is the GitHub Pages default — point Pages
 * at this directory on `main` to deploy.
 */

import { watch, rmSync, mkdirSync, readdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const OUTDIR = 'docs';
const SNIPPETS_DIR = 'tests/snippets';
const DEV_PORT = 10000;

const args = process.argv.slice(2);
const isDev = args.includes('--dev') || args.includes('--watch');

async function build(): Promise<boolean> {
  const start = performance.now();

  // Wipe the outdir each time so dev rebuilds don't accumulate stale hashed
  // files and prod builds don't carry old artefacts.
  rmSync(OUTDIR, { recursive: true, force: true });
  mkdirSync(OUTDIR, { recursive: true });

  // In dev we want stable filenames (so the browser refreshes the same URLs);
  // in prod we want content-hashed names for cache-busting.
  const naming = isDev
    ? { entry: '[name].[ext]', chunk: '[name].[ext]', asset: '[name].[ext]' }
    : undefined;

  // The two entrypoints emit independent module graphs:
  // - index.html → main.js (+ CSS, follows the <script src="./main.ts">)
  // - worker.ts → worker.js (the interpreter, loaded by the Worker constructor)
  const htmlBuild = Bun.build({
    entrypoints: ['web/index.html'],
    outdir: OUTDIR,
    target: 'browser',
    minify: !isDev,
    sourcemap: isDev ? 'linked' : 'none',
    ...(naming ? { naming } : {}),
  });
  const workerBuild = Bun.build({
    entrypoints: ['web/worker.ts'],
    outdir: OUTDIR,
    target: 'browser',
    format: 'esm',
    minify: !isDev,
    sourcemap: isDev ? 'linked' : 'none',
    naming: { entry: 'worker.js', chunk: 'worker-[hash].[ext]', asset: '[name].[ext]' },
  });
  const [r1, r2] = await Promise.all([htmlBuild, workerBuild]);

  for (const r of [r1, r2]) {
    for (const log of r.logs) {
      if (log.level === 'error')        console.error(`error: ${log.message}`);
      else if (log.level === 'warning') console.warn (`warn:  ${log.message}`);
    }
  }
  if (!r1.success || !r2.success) {
    console.error('build failed');
    return false;
  }

  // Copy example snippets (.rap files) and emit an index.json the
  // playground can fetch to populate the example selector.
  const examplesOut = join(OUTDIR, 'examples');
  mkdirSync(examplesOut, { recursive: true });
  const snippets = readdirSync(SNIPPETS_DIR).filter((f) => f.endsWith('.rap')).sort();
  const index: { name: string; title: string }[] = [];
  for (const f of snippets) {
    copyFileSync(join(SNIPPETS_DIR, f), join(examplesOut, f));
    const src = readFileSync(join(SNIPPETS_DIR, f), 'utf8');
    index.push({ name: basename(f, '.rap'), title: titleOf(src, f) });
  }
  writeFileSync(join(examplesOut, 'index.json'), JSON.stringify(index, null, 2));

  const ms = Math.round(performance.now() - start);
  console.log(`built ${r1.outputs.length + r2.outputs.length} bundle files, ${snippets.length} examples → ${OUTDIR}/ in ${ms} ms`);
  return true;
}

/** Pull a single-line label from the first `(* … *)` comment, otherwise
 *  derive one from the filename. Keeps the selector readable. */
function titleOf(src: string, file: string): string {
  const m = src.match(/\(\*\s*([^*\n]+?)\s*\*\)/);
  if (m && m[1]) return m[1].length > 60 ? m[1].slice(0, 60) + '…' : m[1];
  return basename(file, '.rap').replace(/^[0-9]+_/, '').replace(/_/g, ' ');
}

const ok = await build();
if (!ok && !isDev) process.exit(1);

if (isDev) {
  Bun.serve({
    port: DEV_PORT,
    development: true,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url);
      const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = Bun.file(`${OUTDIR}${pathname}`);
      if (await file.exists()) return new Response(file);
      return new Response('Not found', { status: 404 });
    },
  });
  console.log(`serving http://localhost:${DEV_PORT}`);

  let rebuilding = false;
  let pending = false;
  const onChange = async (): Promise<void> => {
    if (rebuilding) { pending = true; return; }
    rebuilding = true;
    try { await build(); } catch (e) { console.error(e); }
    rebuilding = false;
    if (pending) { pending = false; await onChange(); }
  };
  for (const dir of ['web', 'src']) {
    watch(dir, { recursive: true }, () => { void onChange(); });
  }
}
