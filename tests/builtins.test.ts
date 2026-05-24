/**
 * Tests for the host-coupled built-ins added in tier 1:
 *   ПАУЗА, ЗВОН, ЗВУК, ПРИГЛ, and the ABS Latin alias.
 */

import { describe, test, expect } from 'bun:test';
import { tokenize } from '../src/lexer.ts';
import { parse } from '../src/parser.ts';
import { Interpreter, BufferedHost } from '../src/interpreter.ts';

function exec(src: string, input: string[] = []): BufferedHost {
  const host = new BufferedHost();
  host.inputLines = input.slice();
  new Interpreter(host).run(parse(tokenize(src)));
  return host;
}

describe('tier 1 built-ins', () => {
  test('ABS Latin alias matches АБС', () => {
    const h = exec('? ABS(-7); ? АБС(-7);');
    expect(h.out).toBe('7\n7\n');
  });

  test('ПАУЗА records duration on the host (tests do not actually sleep)', () => {
    const h = exec('ПАУЗА(5); ПАУЗА(3.5);');
    // 5 → 500 ms; 3.5 → 350 ms
    expect(h.pauses).toEqual([500, 350]);
  });

  test('ЗВОН emits a beep gfx event', () => {
    const h = exec('ЗВОН(); ЗВОН();');
    expect(h.gfx.events).toEqual([{ type: 'beep' }, { type: 'beep' }]);
  });

  test('ЗВУК emits a tone event with duration in ms and frequency in Hz', () => {
    const h = exec('ЗВУК(2, 440);'); // 2/10 sec = 200 ms at 440 Hz
    expect(h.gfx.events).toEqual([{ type: 'tone', freqHz: 440, durationMs: 200 }]);
  });

  test('ПРИГЛ sets the prompt printed before each console ВВОД read', () => {
    const h = exec(`
      ПРИГЛ("? ");
      ВВОД ДАННЫХ : Х, Y;
      ? Х + Y;
    `, ['10 20']);
    // The prompt is written ahead of the read; tokens come from the input
    // buffer so the prompt appears once (the input was buffered as one line).
    expect(h.out).toBe('? 30\n');
  });

  test('ПРИГЛ does not leak into ВВОД ИЗ ФАЙЛА', () => {
    const h = new BufferedHost();
    h.fs.open('x.txt', 'Ф'); // create an empty handle
    h.fs.writeText('Ф', '42\n');
    h.fs.close('Ф');
    new Interpreter(h).run(parse(tokenize(`
      ПРИГЛ(">>> ");
      ОТКРЫТЬ "x.txt" КАК Ф;
      ВВОД ИЗ ФАЙЛА Ф ДАННЫХ : Х;
      ЗАКРЫТЬ Ф;
      ? Х;
    `)));
    expect(h.out).toBe('42\n'); // no ">>> " leak
  });

  test('ПАУЗА(0) is a no-op (still records, but value is 0)', () => {
    const h = exec('ПАУЗА(0);');
    expect(h.pauses).toEqual([0]);
  });
});
