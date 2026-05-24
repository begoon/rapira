#!/usr/bin/env bun
/**
 * Bundle the Rapira CLI into a single self-contained `dist/rapira.js`
 * suitable for `npm publish` / `npx rapira`.
 *
 * Target is Node (not Bun) so the shipped binary runs anywhere npm
 * installs it. Internally we use Atomics.wait for sync sleep and node:fs
 * for everything else, both of which work on Bun too.
 */

import { rmSync, mkdirSync, readFileSync, writeFileSync, chmodSync, renameSync } from 'node:fs';

const OUTDIR = 'dist';
const OUTFILE = `${OUTDIR}/rapira.js`;

rmSync(OUTDIR, { recursive: true, force: true });
mkdirSync(OUTDIR, { recursive: true });

const start = performance.now();
const result = await Bun.build({
  entrypoints: ['cli/index.ts'],
  outdir: OUTDIR,
  target: 'node',
  format: 'esm',
  minify: false,                       // shipping readable JS — easier to debug installs
  sourcemap: 'none',
  naming: { entry: 'rapira.[ext]' },
});

for (const log of result.logs) {
  if (log.level === 'error')        console.error(`error: ${log.message}`);
  else if (log.level === 'warning') console.warn (`warn:  ${log.message}`);
}
if (!result.success) {
  console.error('CLI build failed');
  process.exit(1);
}

// Ensure the produced file is named rapira.js (Bun.build may emit rapira.js
// already; this is just defensive in case the naming template misses).
const produced = result.outputs[0]?.path;
if (produced && produced !== OUTFILE && !produced.endsWith('/rapira.js')) {
  renameSync(produced, OUTFILE);
}

// Replace whatever shebang Bun preserved with #!/usr/bin/env node.
let bundle = readFileSync(OUTFILE, 'utf8');
bundle = bundle.replace(/^#!.*\n/, '');
writeFileSync(OUTFILE, `#!/usr/bin/env node\n${bundle}`);
chmodSync(OUTFILE, 0o755);

const ms = Math.round(performance.now() - start);
const kb = Math.round(bundle.length / 1024);
console.log(`built ${OUTFILE} (${kb} KB) in ${ms} ms`);
