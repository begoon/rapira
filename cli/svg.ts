/**
 * Render a captured GfxEvent stream as a standalone SVG document.
 *
 * Honest about scope: this is a pragmatic renderer, not a full Agat
 * gfx-mode emulator. `window`, `cursor`, `scale`, and `origin` change
 * the affine state for subsequent commands; `fill` is approximated as
 * a single-pixel splat since real flood-fill needs a raster context.
 */

import type { GfxEvent } from '../src/graphics.ts';
import { AGAT_PALETTE } from '../src/graphics.ts';

export interface SvgOptions {
  width?: number;
  height?: number;
  background?: string;
}

interface State {
  stroke: string;
  fill: string;
  originX: number;
  originY: number;
  scaleX: number;
  scaleY: number;
}

export function eventsToSvg(events: ReadonlyArray<GfxEvent>, opts: SvgOptions = {}): string {
  const width = opts.width ?? 256;
  const height = opts.height ?? 256;
  const background = opts.background ?? '#ffffff';

  const s: State = { stroke: '#000000', fill: '#000000', originX: 0, originY: 0, scaleX: 1, scaleY: 1 };
  const elems: string[] = [];

  const tx = (x: number): number => Math.round(s.originX + x * s.scaleX);
  const ty = (y: number): number => Math.round(s.originY + y * s.scaleY);

  for (const ev of events) {
    switch (ev.type) {
      case 'clear':
        elems.length = 0;
        break;
      case 'color':
        s.stroke = colourFromIndex(ev.index);
        s.fill = s.stroke;
        break;
      case 'point':
        elems.push(`<rect x="${tx(ev.x)}" y="${ty(ev.y)}" width="1" height="1" fill="${s.fill}"/>`);
        break;
      case 'line':
        elems.push(`<line x1="${tx(ev.x1)}" y1="${ty(ev.y1)}" x2="${tx(ev.x2)}" y2="${ty(ev.y2)}" stroke="${s.stroke}" stroke-width="1"/>`);
        break;
      case 'rect': {
        const x1 = tx(ev.x1), y1 = ty(ev.y1), x2 = tx(ev.x2), y2 = ty(ev.y2);
        const x = Math.min(x1, x2), y = Math.min(y1, y2);
        const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
        elems.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="${s.stroke}" fill="none"/>`);
        break;
      }
      case 'fill':
        elems.push(`<rect x="${tx(ev.x)}" y="${ty(ev.y)}" width="2" height="2" fill="${s.fill}"/>`);
        break;
      case 'origin':
        s.originX = ev.x; s.originY = ev.y;
        break;
      case 'scale':
        s.scaleX = ev.sx; s.scaleY = ev.sy;
        break;
      case 'window':
      case 'cursor':
        // No visual side-effect in this renderer.
        break;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">
<rect width="100%" height="100%" fill="${background}"/>
${elems.join('\n')}
</svg>
`;
}

function colourFromIndex(i: number): string {
  const c = AGAT_PALETTE[Math.max(0, Math.min(15, i | 0))]!;
  const [r, g, b] = c;
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function hex(n: number): string { return n.toString(16).padStart(2, '0'); }
