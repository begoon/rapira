/**
 * Graphics built-ins (§Appendix 3) and the Чертёжник turtle extension.
 *
 * Procedures emit GfxEvents onto an injected GraphicsSink. The turtle keeps
 * (x, y, heading, pen) state in a closure and desugars its commands into
 * line/origin events on the same stream.
 */

import type { Env } from '../environment.ts';
import type { GraphicsSink } from '../graphics.ts';
import { EMPTY, rInt, typeName, type RValue } from '../values.ts';
import { RuntimeError } from '../errors.ts';

function intArg(v: RValue, name: string, i: number): number {
  if (v.kind === 'int')  return v.value;
  if (v.kind === 'real') return Math.round(v.value);
  throw new RuntimeError(`${name}: аргумент ${i + 1} должен быть числом (got ${typeName(v)})`);
}

function defineProc(env: Env, name: string, arity: number, fn: (args: RValue[]) => void): void {
  env.declare(name, {
    kind: 'native',
    name,
    arity,
    fn: (args) => { fn(args); return EMPTY; },
  });
}

export function registerGraphics(env: Env, sink: GraphicsSink): void {
  // ---- Documented Agat primitives (§Appendix 3) ----

  defineProc(env, 'ТЧК', 2, ([x, y]) => {
    sink.emit({ type: 'point', x: intArg(x!, 'ТЧК', 0), y: intArg(y!, 'ТЧК', 1) });
  });

  defineProc(env, 'ЛИН', 4, ([x1, y1, x2, y2]) => {
    sink.emit({
      type: 'line',
      x1: intArg(x1!, 'ЛИН', 0), y1: intArg(y1!, 'ЛИН', 1),
      x2: intArg(x2!, 'ЛИН', 2), y2: intArg(y2!, 'ЛИН', 3),
    });
  });

  defineProc(env, 'ПРЯМ', 4, ([x1, y1, x2, y2]) => {
    sink.emit({
      type: 'rect',
      x1: intArg(x1!, 'ПРЯМ', 0), y1: intArg(y1!, 'ПРЯМ', 1),
      x2: intArg(x2!, 'ПРЯМ', 2), y2: intArg(y2!, 'ПРЯМ', 3),
    });
  });

  defineProc(env, 'ОБЛ', 2, ([x, y]) => {
    sink.emit({ type: 'fill', x: intArg(x!, 'ОБЛ', 0), y: intArg(y!, 'ОБЛ', 1) });
  });

  defineProc(env, 'ЦВЕТ', 1, ([c]) => {
    const idx = intArg(c!, 'ЦВЕТ', 0);
    if (idx < 0 || idx > 15) throw new RuntimeError(`ЦВЕТ: индекс ${idx} вне 0..15`);
    sink.emit({ type: 'color', index: idx });
  });

  defineProc(env, 'ОКНО', 4, ([x1, y1, x2, y2]) => {
    sink.emit({
      type: 'window',
      x1: intArg(x1!, 'ОКНО', 0), y1: intArg(y1!, 'ОКНО', 1),
      x2: intArg(x2!, 'ОКНО', 2), y2: intArg(y2!, 'ОКНО', 3),
    });
  });

  defineProc(env, 'ПОЗ', 2, ([x, y]) => {
    sink.emit({ type: 'cursor', x: intArg(x!, 'ПОЗ', 0), y: intArg(y!, 'ПОЗ', 1) });
  });

  defineProc(env, 'ОТСЧЕТ', 2, ([x, y]) => {
    sink.emit({ type: 'origin', x: intArg(x!, 'ОТСЧЕТ', 0), y: intArg(y!, 'ОТСЧЕТ', 1) });
  });

  defineProc(env, 'МТБ', 2, ([sx, sy]) => {
    sink.emit({ type: 'scale', sx: intArg(sx!, 'МТБ', 0), sy: intArg(sy!, 'МТБ', 1) });
  });

  defineProc(env, 'ОЧИСТИТЬ', 0, () => {
    sink.emit({ type: 'clear' });
  });

  registerTurtle(env, sink);
}

/**
 * Чертёжник — the Soviet "Draftsman" executor from Школьница. Implemented here
 * as a Rapira extension (not the РОБИК front-end language, since that grammar
 * is beyond our reference). Faithful to the documented executor: turtle with
 * position + heading + pen state.
 *
 * Convention: canvas 256×256, turtle starts at centre (128, 128), heading 0°
 * points up, angles increase clockwise. Pen is down by default.
 */
export function registerTurtle(env: Env, sink: GraphicsSink): void {
  const HOME_X = 128, HOME_Y = 128;
  const state = { x: HOME_X, y: HOME_Y, heading: 0, pen: true };

  function move(dist: number): void {
    const rad = (state.heading * Math.PI) / 180;
    const nx = state.x + Math.sin(rad) * dist;
    const ny = state.y - Math.cos(rad) * dist; // y-down, heading 0 = up
    if (state.pen) {
      sink.emit({
        type: 'line',
        x1: Math.round(state.x), y1: Math.round(state.y),
        x2: Math.round(nx),       y2: Math.round(ny),
      });
    }
    state.x = nx; state.y = ny;
  }

  defineProc(env, 'ВПЕРЕД', 1, ([n]) => { move(intArg(n!, 'ВПЕРЕД', 0)); });
  defineProc(env, 'НАЗАД',  1, ([n]) => { move(-intArg(n!, 'НАЗАД', 0)); });
  defineProc(env, 'НАПРАВО', 1, ([d]) => { state.heading = (state.heading + intArg(d!, 'НАПРАВО', 0)) % 360; });
  defineProc(env, 'НАЛЕВО',  1, ([d]) => { state.heading = ((state.heading - intArg(d!, 'НАЛЕВО', 0)) % 360 + 360) % 360; });
  defineProc(env, 'ПЕРО_ВВЕРХ', 0, () => { state.pen = false; });
  defineProc(env, 'ПЕРО_ВНИЗ',  0, () => { state.pen = true; });
  defineProc(env, 'КУРС', 1, ([d]) => { state.heading = ((intArg(d!, 'КУРС', 0)) % 360 + 360) % 360; });

  defineProc(env, 'В_ТОЧКУ', 2, ([x, y]) => {
    const nx = intArg(x!, 'В_ТОЧКУ', 0);
    const ny = intArg(y!, 'В_ТОЧКУ', 1);
    if (state.pen) {
      sink.emit({
        type: 'line',
        x1: Math.round(state.x), y1: Math.round(state.y),
        x2: nx, y2: ny,
      });
    }
    state.x = nx; state.y = ny;
  });

  defineProc(env, 'ДОМОЙ', 0, () => {
    state.x = HOME_X; state.y = HOME_Y; state.heading = 0;
  });

  // Read-only inspector helpers (handy for tests / advanced programs).
  env.declare('ЧЕРТЕЖНИК_X', { kind: 'native', name: 'ЧЕРТЕЖНИК_X', arity: 0, fn: () => rInt(Math.round(state.x)) });
  env.declare('ЧЕРТЕЖНИК_Y', { kind: 'native', name: 'ЧЕРТЕЖНИК_Y', arity: 0, fn: () => rInt(Math.round(state.y)) });
  env.declare('ЧЕРТЕЖНИК_КУРС', { kind: 'native', name: 'ЧЕРТЕЖНИК_КУРС', arity: 0, fn: () => rInt(state.heading) });
}
