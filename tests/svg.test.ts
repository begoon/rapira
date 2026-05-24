import { describe, test, expect } from 'bun:test';
import { eventsToSvg } from '../cli/svg.ts';
import type { GfxEvent } from '../src/graphics.ts';

describe('SVG renderer', () => {
  test('empty events → blank canvas', () => {
    const svg = eventsToSvg([]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('width="256" height="256"');
    expect(svg).toContain('fill="#ffffff"');
  });

  test('line event becomes a <line> in stroke color', () => {
    const events: GfxEvent[] = [
      { type: 'color', index: 1 },
      { type: 'line', x1: 10, y1: 20, x2: 100, y2: 200 },
    ];
    const svg = eventsToSvg(events);
    expect(svg).toMatch(/<line x1="10" y1="20" x2="100" y2="200"/);
    expect(svg).toMatch(/stroke="#d93c29"/);   // palette index 1
  });

  test('clear removes prior drawing', () => {
    const svg = eventsToSvg([
      { type: 'line', x1: 0, y1: 0, x2: 10, y2: 10 },
      { type: 'clear' },
      { type: 'line', x1: 5, y1: 5, x2: 15, y2: 15 },
    ]);
    expect(svg.match(/<line /g)).toHaveLength(1);
  });

  test('rect: normalises x/y/w/h regardless of point order', () => {
    const svg = eventsToSvg([{ type: 'rect', x1: 50, y1: 60, x2: 20, y2: 30 }]);
    expect(svg).toMatch(/<rect x="20" y="30" width="30" height="30"/);
  });

  test('point emits a single-pixel rect', () => {
    const svg = eventsToSvg([{ type: 'point', x: 5, y: 7 }]);
    expect(svg).toMatch(/<rect x="5" y="7" width="1" height="1"/);
  });

  test('origin/scale transforms apply to subsequent coords', () => {
    const svg = eventsToSvg([
      { type: 'scale', sx: 2, sy: 2 },
      { type: 'origin', x: 10, y: 10 },
      { type: 'line', x1: 0, y1: 0, x2: 5, y2: 5 },
    ]);
    // (0,0) → (10,10); (5,5) → (10+10, 10+10) = (20, 20)
    expect(svg).toMatch(/<line x1="10" y1="10" x2="20" y2="20"/);
  });
});
