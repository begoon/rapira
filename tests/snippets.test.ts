/**
 * Snippet pipeline: each `*.rap` file in tests/snippets/ is run through the
 * interpreter and compared against the sibling expected output:
 *
 *   foo.rap + foo.expected.txt  → assert textual output matches
 *   foo.rap + foo.expected.svg  → assert the rendered SVG matches
 *
 * Either expected file is optional; a `.rap` with neither is a test
 * failure to keep us honest about what we're checking.
 */

import { describe, test, expect } from 'bun:test';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

import { run } from '../src/interpreter.ts';
import { eventsToSvg } from '../cli/svg.ts';

const DIR = join(import.meta.dir, 'snippets');

const rapFiles = readdirSync(DIR)
  .filter((f) => f.endsWith('.rap'))
  .sort();

describe('snippet pipeline', () => {
  for (const f of rapFiles) {
    const stem = basename(f, '.rap');
    const txtPath = join(DIR, `${stem}.expected.txt`);
    const svgPath = join(DIR, `${stem}.expected.svg`);
    const hasTxt = existsSync(txtPath);
    const hasSvg = existsSync(svgPath);

    test(`${f}`, () => {
      expect(hasTxt || hasSvg).toBe(true);
      const src = readFileSync(join(DIR, f), 'utf8');
      const result = run(src);
      if (hasTxt) {
        const want = readFileSync(txtPath, 'utf8');
        expect(result.out).toBe(want);
      }
      if (hasSvg) {
        const want = readFileSync(svgPath, 'utf8');
        const got = eventsToSvg(result.gfx);
        expect(got).toBe(want);
      }
    });
  }
});
