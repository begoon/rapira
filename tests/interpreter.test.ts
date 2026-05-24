import { describe, test, expect } from 'bun:test';
import { run } from '../src/interpreter.ts';

describe('interpreter (Agat)', () => {
  test('hello world via ?', () => {
    expect(run('? "ПРИВЕТ, МИР!";').out).toBe('ПРИВЕТ, МИР!\n');
  });

  test('hello world via ВЫВОД', () => {
    expect(run('ВЫВОД: "Здравствуй, мир!";').out).toBe('Здравствуй, мир!\n');
  });

  test('arithmetic precedence', () => {
    expect(run('? 1 + 2 * 3;').out).toBe('7\n');
    expect(run('? 2 ** 3 ** 2;').out).toBe('512\n');  // right-associative: 2 ** 9
    expect(run('? 10 // 3;').out).toBe('3\n');
    expect(run('? 1 + 2 * 3 - 4;').out).toBe('3\n');
  });

  test('assignment both directions', () => {
    expect(run('5 -> Х; ? Х;').out).toBe('5\n');
    expect(run('Х := 5; ? Х;').out).toBe('5\n');
  });

  test('if / else', () => {
    expect(run(`
      5 -> Х;
      ЕСЛИ Х > 0 ТО ? "ПОЛОЖ" ИНАЧЕ ? "НЕ_ПОЛОЖ" ВСЕ;
    `).out).toBe('ПОЛОЖ\n');
    expect(run(`
      -3 -> Х;
      ЕСЛИ Х > 0 ТО ? "ПОЛОЖ" ИНАЧЕ ? "НЕ_ПОЛОЖ" ВСЕ;
    `).out).toBe('НЕ_ПОЛОЖ\n');
  });

  test('ВЫБОР with discriminant', () => {
    const out = run(`
      2 -> К;
      ВЫБОР К ИЗ
          1, 2 : ? "мало"
        ! 3    : ? "три"
          ИНАЧЕ ? "много"
      ВСЕ;
    `).out;
    expect(out).toBe('мало\n');
  });

  test('ВЫБОР without discriminant (condition list)', () => {
    const out = run(`
      0 -> Х;
      ВЫБОР ИЗ
          Х > 0 : ? "ПОЛОЖ"
        ! Х < 0 : ? "ОТРИЦ"
          ИНАЧЕ   ? "НУЛЬ"
      ВСЕ;
    `).out;
    expect(out).toBe('НУЛЬ\n');
  });

  test('ДЛЯ-ОТ-ДО', () => {
    const out = run(`
      ДЛЯ И ОТ 1 ДО 5 ::
         ? И
      ВСЕ;
    `).out;
    expect(out).toBe('1\n2\n3\n4\n5\n');
  });

  test('ДЛЯ-ИЗ over text', () => {
    const out = run(`
      ДЛЯ С ИЗ "АБВ" ::
         ? С
      ВСЕ;
    `).out;
    expect(out).toBe('А\nБ\nВ\n');
  });

  test('ПОКА', () => {
    const out = run(`
      1 -> Х;
      ПОКА Х <= 3 ::
         ? Х;
         Х + 1 -> Х
      ВСЕ;
    `).out;
    expect(out).toBe('1\n2\n3\n');
  });

  test('ПОВТОР', () => {
    expect(run('ПОВТОР 3 РАЗА :: ? "А" ВСЕ;').out).toBe('А\nА\nА\n');
  });

  test('factorial via function', () => {
    const out = run(`
      ФУНК ФАКТ (Н) ;
         ИМЕНА: Р ;
         1 -> Р ;
         ДЛЯ И ОТ 1 ДО Н ::
            Р * И -> Р
         ВСЕ
      РЕЗ: Р
      КНЦ ;
      ? ФАКТ(5);
      ? ФАКТ(0);
    `).out;
    expect(out).toBe('120\n1\n');
  });

  test('swap via inout procedure', () => {
    const out = run(`
      ПРОЦ ПОМЕНЯТЬ ( <=> А, <=> Б );
         ИМЕНА: Т;
         А -> Т;
         Б -> А;
         Т -> Б
      КНЦ;

      1 -> Х; 2 -> Y;
      ПОМЕНЯТЬ(Х, Y);
      ? Х, " ", Y;
    `).out;
    expect(out).toBe('2 1\n');
  });

  test('output parameter receives result', () => {
    const out = run(`
      ПРОЦ ПЛЮС_ОДИН (Х, <=> Р);
         Х + 1 -> Р
      КНЦ;
      0 -> Y;
      ПЛЮС_ОДИН(41, Y);
      ? Y;
    `).out;
    expect(out).toBe('42\n');
  });

  test('tuple operations: +, #, [i], [a:b]', () => {
    const out = run(`
      <1, 2> + <3, 4> -> Т;
      ? Т;
      ? #Т;
      ? Т[2];
      ? Т[2:3];
    `).out;
    expect(out).toBe('<1, 2, 3, 4>\n4\n2\n<2, 3>\n');
  });

  test('set ops: union, intersect, diff; auto-dedup', () => {
    const out = run(`
      <* 1, 1, 2 *> -> А;     ? А;
      <* 2, 3 *> -> Б;
      ? А + Б;
      ? А * Б;
      ? А - Б;
    `).out;
    expect(out).toBe('<*1, 2*>\n<*1, 2, 3*>\n<*2*>\n<*1*>\n');
  });

  test('membership: ИЗ on tuple / set / text', () => {
    const out = run(`
      ? 2 ИЗ <1, 2, 3>;
      ? 5 ИЗ <1, 2, 3>;
      ? "А" ИЗ "АБВ";
      ? "Г" ИЗ "АБВ";
      ? 2 ИЗ <* 1, 2 *>;
    `).out;
    expect(out).toBe('да\nнет\nда\nнет\nда\n');
  });

  test('ВИДА — kind check', () => {
    const out = run(`
      ? 1 ВИДА 0;
      ? 1.5 ВИДА 0;
      ? "Х" ВИДА "";
      ? <1, 2> ВИДА <>;
    `).out;
    expect(out).toBe('да\nнет\nда\nда\n');
  });

  test('logical И ИЛИ НЕ with short-circuit', () => {
    // да/нет aren't reserved literals in Agat — values come from comparisons.
    const out = run(`
      ? (1 = 1) И (2 = 2);
      ? (1 = 2) ИЛИ (2 = 2);
      ? НЕ (1 = 1);
      ? НЕ (1 = 2);
    `).out;
    expect(out).toBe('да\nда\nнет\nда\n');
  });

  test('built-in АБС, ЦЕЛЧ, SQRT', () => {
    const out = run(`
      ? АБС(-7);
      ? ЦЕЛЧ(3.7);
      ? SQRT(9);
    `).out;
    // SQRT(9) → 3 — real may render as "3.0"
    expect(out.split('\n').slice(0, 2)).toEqual(['7', '3']);
    expect(out.split('\n')[2]).toMatch(/^3(\.0+)?$/);
  });

  test('КОНТРОЛЬ passes when true, halts when false', () => {
    expect(run('КОНТРОЛЬ 1 = 1; ? "ОК";').out).toBe('ОК\n');
    expect(() => run('КОНТРОЛЬ 1 = 2;')).toThrow(/КОНТРОЛЬ/);
  });

  test('indexed assignment into tuple', () => {
    const out = run(`
      <1, 2, 3> -> Т;
      99 -> Т[2];
      ? Т;
    `).out;
    expect(out).toBe('<1, 99, 3>\n');
  });

  test('slice assignment into text', () => {
    const out = run(`
      "ABCDE" -> Т;
      "xyz" -> Т[2:4];
      ? Т;
    `).out;
    // positions 2..4 (B,C,D) replaced with xyz; original E at 5 stays
    expect(out).toBe('AxyzE\n');
  });

  test('input — ВВОД ДАННЫХ', () => {
    const out = run(`
      ВВОД ДАННЫХ : Х, Y;
      ? Х + Y;
    `, ['10 32']).out;
    expect(out).toBe('42\n');
  });

  test('БПС suppresses newline', () => {
    expect(run('ВЫВОД БПС : "А", "Б";').out).toBe('АБ');
  });

  test('records: construct, read field, equality', () => {
    const out = run(`
      <¤ ФАМ: "Петров", ИМЯ: "Иван" ¤> -> АНКЕТА;
      ? АНКЕТА.ФАМ, " ", АНКЕТА.ИМЯ;
      ? АНКЕТА = <¤ ФАМ: "Петров", ИМЯ: "Иван" ¤>;
      ? АНКЕТА = <¤ ФАМ: "Иванов", ИМЯ: "Иван" ¤>;
    `).out;
    expect(out).toBe('Петров Иван\nда\nнет\n');
  });

  test('records: field assignment', () => {
    const out = run(`
      <¤ ФАМ: "Петров", ИМЯ: "Иван" ¤> -> АНКЕТА;
      "Сидоров" -> АНКЕТА.ФАМ;
      ? АНКЕТА.ФАМ, " ", АНКЕТА.ИМЯ;
    `).out;
    expect(out).toBe('Сидоров Иван\n');
  });

  test('records: $ alias and ¤ produce same value', () => {
    const out = run(`
      <$ А: 1, Б: 2 $> -> Х;
      <¤ А: 1, Б: 2 ¤> -> Y;
      ? Х = Y;
    `).out;
    expect(out).toBe('да\n');
  });

  test('records: field on missing field returns .пусто', () => {
    const out = run(`
      <¤ А: 1 ¤> -> Р;
      ? Р.А = .пусто;
      ? Р.Б = .пусто;
    `).out;
    expect(out).toBe('нет\nда\n');
  });

  test('records: inout parameter with .field target', () => {
    const out = run(`
      ПРОЦ ПОВЫСИТЬ (<=> Х);
         Х + 1 -> Х
      КНЦ;
      <¤ СЧЁТ: 41 ¤> -> С;
      ПОВЫСИТЬ(С.СЧЁТ);
      ? С.СЧЁТ;
    `).out;
    expect(out).toBe('42\n');
  });

  test('full canonical example: factorials in a loop', () => {
    const src = `
      ФУНК ФАКТ (Н) ;
         ИМЕНА: Р ;
         1 -> Р ;
         ДЛЯ И ОТ 1 ДО Н ::
            Р * И -> Р
         ВСЕ
      РЕЗ: Р
      КНЦ ;

      ДЛЯ Н ОТ 0 ДО 6 ::
         ? "ФАКТ(", Н, ") = ", ФАКТ(Н)
      ВСЕ;
    `;
    expect(run(src).out).toBe(
      'ФАКТ(0) = 1\nФАКТ(1) = 1\nФАКТ(2) = 2\nФАКТ(3) = 6\nФАКТ(4) = 24\nФАКТ(5) = 120\nФАКТ(6) = 720\n',
    );
  });
});
