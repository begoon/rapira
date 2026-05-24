import { describe, test, expect } from 'bun:test';
import { run } from '../src/interpreter.ts';

describe('graphics primitives (Agat §Appendix 3)', () => {
  test('ТЧК emits a point event', () => {
    const r = run('ТЧК(10, 20);');
    expect(r.gfx).toEqual([{ type: 'point', x: 10, y: 20 }]);
  });

  test('ЛИН emits a line event', () => {
    const r = run('ЛИН(0, 0, 100, 50);');
    expect(r.gfx).toEqual([{ type: 'line', x1: 0, y1: 0, x2: 100, y2: 50 }]);
  });

  test('ПРЯМ and ОБЛ', () => {
    const r = run('ПРЯМ(5, 5, 50, 30); ОБЛ(10, 10);');
    expect(r.gfx).toEqual([
      { type: 'rect', x1: 5, y1: 5, x2: 50, y2: 30 },
      { type: 'fill', x: 10, y: 10 },
    ]);
  });

  test('ЦВЕТ validates palette range', () => {
    expect(run('ЦВЕТ(0); ЦВЕТ(15);').gfx).toEqual([
      { type: 'color', index: 0 }, { type: 'color', index: 15 },
    ]);
    expect(() => run('ЦВЕТ(16);')).toThrow(/0\.\.15/);
  });

  test('ОКНО, ПОЗ, ОТСЧЕТ, МТБ, ОЧИСТИТЬ', () => {
    const r = run(`
      ОКНО(0, 0, 100, 100);
      ПОЗ(20, 20);
      ОТСЧЕТ(50, 50);
      МТБ(2, 2);
      ОЧИСТИТЬ();
    `);
    expect(r.gfx.map((e) => e.type)).toEqual(['window', 'cursor', 'origin', 'scale', 'clear']);
  });

  test('draws a simple house (composite)', () => {
    const r = run(`
      ЦВЕТ(2);
      ПРЯМ(20, 60, 80, 100);
      ЛИН(20, 60, 50, 30);
      ЛИН(50, 30, 80, 60);
    `);
    expect(r.gfx).toHaveLength(4);
    expect(r.gfx[0]).toEqual({ type: 'color', index: 2 });
  });
});

describe('Чертёжник (turtle extension)', () => {
  test('ВПЕРЕД with default heading (up) emits an upward line', () => {
    const r = run('ВПЕРЕД(50);');
    // Start at (128, 128) heading 0° (up) → end at (128, 128 - 50) = (128, 78)
    expect(r.gfx).toEqual([{ type: 'line', x1: 128, y1: 128, x2: 128, y2: 78 }]);
  });

  test('square: ВПЕРЕД/НАПРАВО ×4 returns to start', () => {
    const r = run(`
      ПОВТОР 4 РАЗА ::
         ВПЕРЕД(50);
         НАПРАВО(90)
      ВСЕ;
    `);
    expect(r.gfx).toHaveLength(4);
    expect(r.gfx[0]).toEqual({ type: 'line', x1: 128, y1: 128, x2: 128, y2: 78 });
    expect(r.gfx[1]).toEqual({ type: 'line', x1: 128, y1: 78, x2: 178, y2: 78 });
    expect(r.gfx[2]).toEqual({ type: 'line', x1: 178, y1: 78, x2: 178, y2: 128 });
    expect(r.gfx[3]).toEqual({ type: 'line', x1: 178, y1: 128, x2: 128, y2: 128 });
  });

  test('ПЕРО_ВВЕРХ suppresses line emission; ПЕРО_ВНИЗ resumes', () => {
    const r = run(`
      ПЕРО_ВВЕРХ();
      ВПЕРЕД(30);
      ПЕРО_ВНИЗ();
      ВПЕРЕД(30);
    `);
    // Only the second move emits a line; turtle has already moved up by 30.
    expect(r.gfx).toEqual([
      { type: 'line', x1: 128, y1: 98, x2: 128, y2: 68 },
    ]);
  });

  test('ДОМОЙ resets position and heading', () => {
    const r = run(`
      ВПЕРЕД(30); НАПРАВО(45);
      ДОМОЙ();
      ВПЕРЕД(20);
    `);
    // After ДОМОЙ we're at (128,128) heading 0 — next ВПЕРЕД(20) → (128, 108)
    expect(r.gfx.at(-1)).toEqual({ type: 'line', x1: 128, y1: 128, x2: 128, y2: 108 });
  });

  test('В_ТОЧКУ jumps to absolute position (still emits line when pen down)', () => {
    const r = run('В_ТОЧКУ(200, 50);');
    expect(r.gfx).toEqual([{ type: 'line', x1: 128, y1: 128, x2: 200, y2: 50 }]);
  });

  test('НАЛЕВО is opposite of НАПРАВО', () => {
    const r = run(`
      НАПРАВО(90); ВПЕРЕД(20);    (* heading 90° = right → moves +x *)
      ДОМОЙ();
      НАЛЕВО(90); ВПЕРЕД(20);     (* heading 270° = left → moves -x *)
    `);
    expect(r.gfx[0]).toEqual({ type: 'line', x1: 128, y1: 128, x2: 148, y2: 128 });
    expect(r.gfx[1]).toEqual({ type: 'line', x1: 128, y1: 128, x2: 108, y2: 128 });
  });

  test('inspectors expose current state', () => {
    const r = run(`
      ВПЕРЕД(40);
      НАПРАВО(90);
      ? ЧЕРТЕЖНИК_X(), " ", ЧЕРТЕЖНИК_Y(), " ", ЧЕРТЕЖНИК_КУРС();
    `);
    expect(r.out).toBe('128 88 90\n');
  });
});
