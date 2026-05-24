/**
 * Graphics event stream produced by Rapira's drawing primitives (§Appendix 3)
 * and by the Чертёжник turtle extension. The interpreter never touches a
 * canvas/SVG/etc. directly — it emits typed events that a host (CLI → SVG,
 * web → <canvas>) consumes.
 *
 * Coordinate convention: origin top-left, y-down, integer pixels. Default
 * canvas is 256 × 256 (Агат-7 high-resolution mode). Colors are 0..15 Agat
 * palette indices; the host maps to RGB.
 */

export type GfxEvent =
  | { type: 'clear' }
  | { type: 'color'; index: number }
  | { type: 'point'; x: number; y: number }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'rect'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'fill'; x: number; y: number }
  | { type: 'window'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'cursor'; x: number; y: number }
  | { type: 'origin'; x: number; y: number }
  | { type: 'scale'; sx: number; sy: number }
  // Audio events (from ЗВОН/ЗВУК). The renderer ignores them; the
  // playground may route them to Web Audio.
  | { type: 'beep' }
  | { type: 'tone'; freqHz: number; durationMs: number };

export interface GraphicsSink {
  emit(event: GfxEvent): void;
}

/** Discards events. Default for hosts that don't want graphics. */
export class NullSink implements GraphicsSink {
  emit(_e: GfxEvent): void { /* discard */ }
}

/** Buffers every event into an array. Useful for tests, web worker → main
 *  thread streaming, and SVG rendering. */
export class BufferingSink implements GraphicsSink {
  readonly events: GfxEvent[] = [];
  emit(event: GfxEvent): void { this.events.push(event); }
  clear(): void { this.events.length = 0; }
}

// ---- Agat default palette (16 indexed colours, high-res mode) ----
//
// Approximate RGB values used by Агат-9 in 16-color hires mode. Hosts may
// override; this is just a reasonable default.
export const AGAT_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [  0,   0,   0], // 0  black
  [217,  60,  41], // 1  red
  [ 97, 161,  62], // 2  green
  [255, 240,  76], // 3  yellow
  [ 22,  79, 187], // 4  blue
  [206,  66, 192], // 5  magenta
  [ 78, 196, 207], // 6  cyan
  [218, 218, 218], // 7  light grey
  [ 84,  84,  84], // 8  dark grey
  [255, 130, 124], // 9  light red
  [167, 234, 119], // 10 light green
  [255, 255, 175], // 11 light yellow
  [ 91, 156, 255], // 12 light blue
  [255, 161, 245], // 13 light magenta
  [165, 255, 255], // 14 light cyan
  [255, 255, 255], // 15 white
];
