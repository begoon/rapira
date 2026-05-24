/**
 * Render a GfxEvent stream onto an HTMLCanvasElement. Mirrors the
 * semantics of cli/svg.ts (origin/scale state machine, palette
 * mapping) so the playground and CLI render the same picture.
 */

import type { GfxEvent } from '../../src/graphics.ts';
import { AGAT_PALETTE } from '../../src/graphics.ts';

interface State {
  stroke: string;
  fill: string;
  originX: number;
  originY: number;
  scaleX: number;
  scaleY: number;
}

export function renderEvents(canvas: HTMLCanvasElement, events: ReadonlyArray<GfxEvent>): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const s: State = { stroke: '#000000', fill: '#000000', originX: 0, originY: 0, scaleX: 1, scaleY: 1 };
  const tx = (x: number): number => Math.round(s.originX + x * s.scaleX) + 0.5;
  const ty = (y: number): number => Math.round(s.originY + y * s.scaleY) + 0.5;

  for (const ev of events) {
    switch (ev.type) {
      case 'clear':
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        break;
      case 'color':
        s.stroke = paletteHex(ev.index);
        s.fill = s.stroke;
        ctx.strokeStyle = s.stroke;
        ctx.fillStyle = s.fill;
        break;
      case 'point':
        ctx.fillStyle = s.fill;
        ctx.fillRect(Math.round(s.originX + ev.x * s.scaleX), Math.round(s.originY + ev.y * s.scaleY), 1, 1);
        break;
      case 'line': {
        ctx.strokeStyle = s.stroke;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tx(ev.x1), ty(ev.y1));
        ctx.lineTo(tx(ev.x2), ty(ev.y2));
        ctx.stroke();
        break;
      }
      case 'rect': {
        const x1 = Math.round(s.originX + ev.x1 * s.scaleX);
        const y1 = Math.round(s.originY + ev.y1 * s.scaleY);
        const x2 = Math.round(s.originX + ev.x2 * s.scaleX);
        const y2 = Math.round(s.originY + ev.y2 * s.scaleY);
        const x = Math.min(x1, x2), y = Math.min(y1, y2);
        const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
        ctx.strokeStyle = s.stroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w, h);
        break;
      }
      case 'fill':
        ctx.fillStyle = s.fill;
        ctx.fillRect(Math.round(s.originX + ev.x * s.scaleX), Math.round(s.originY + ev.y * s.scaleY), 2, 2);
        break;
      case 'origin':
        s.originX = ev.x; s.originY = ev.y;
        break;
      case 'scale':
        s.scaleX = ev.sx; s.scaleY = ev.sy;
        break;
      case 'window':
      case 'cursor':
        // no visual effect in this renderer
        break;
    }
  }
}

function paletteHex(i: number): string {
  const idx = Math.max(0, Math.min(15, i | 0));
  const [r, g, b] = AGAT_PALETTE[idx]!;
  return `rgb(${r}, ${g}, ${b})`;
}
