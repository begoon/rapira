import { describe, test, expect } from 'bun:test';
import { tokenize } from '../src/lexer.ts';
import { parse } from '../src/parser.ts';

const ast = (src: string) => parse(tokenize(src));

describe('parser (Agat)', () => {
  test('assignment with ->', () => {
    const p = ast('1 + 2 -> Х;');
    expect(p.body[0]?.kind).toBe('Assign');
    const s = p.body[0]!;
    if (s.kind !== 'Assign') throw new Error();
    if (s.target.kind !== 'Name') throw new Error();
    expect(s.target.segments).toEqual(['Х']);
    expect(s.value.kind).toBe('BinOp');
  });

  test('assignment with := (our addition)', () => {
    const p = ast('Х := 1 + 2;');
    const s = p.body[0]!;
    if (s.kind !== 'Assign') throw new Error();
    if (s.target.kind !== 'Name') throw new Error();
    expect(s.target.segments).toEqual(['Х']);
  });

  test('tuple, set, record literals', () => {
    const p = ast('<1, 2, 3> -> Т; <* 1, 2 *> -> М; <¤ ФАМ: "Х" ¤> -> З;');
    expect(p.body).toHaveLength(3);
    const t = p.body[0]; const m = p.body[1]; const z = p.body[2];
    if (t?.kind !== 'Assign' || m?.kind !== 'Assign' || z?.kind !== 'Assign') throw new Error();
    expect(t.value.kind).toBe('TupleLit');
    expect(m.value.kind).toBe('SetLit');
    expect(z.value.kind).toBe('RecordLit');
  });

  test('record literal accepts $ as ASCII alias for ¤', () => {
    const a = ast('<$ ФАМ: "ПЕТРОВ", ИМЯ: "ИВАН" $> -> АНКЕТА;');
    const s = a.body[0]!;
    if (s.kind !== 'Assign' || s.value.kind !== 'RecordLit') throw new Error();
    expect(s.value.fields.map((f) => f.name)).toEqual(['ФАМ', 'ИМЯ']);
    // ¤ and $ produce the same AST
    const b = ast('<¤ ФАМ: "ПЕТРОВ", ИМЯ: "ИВАН" ¤> -> АНКЕТА;');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('empty tuple and empty set', () => {
    const p = ast('<> -> Т; <* *> -> М;');
    const t = p.body[0]; const m = p.body[1];
    if (t?.kind !== 'Assign' || m?.kind !== 'Assign') throw new Error();
    if (t.value.kind !== 'TupleLit' || m.value.kind !== 'SetLit') throw new Error();
    expect(t.value.items).toEqual([]);
    expect(m.value.items).toEqual([]);
  });

  test('if / else / ВСЕ', () => {
    const p = ast(`ЕСЛИ А > Б
        ТО А - Б -> Ц
        ИНАЧЕ 0 -> Ц
    ВСЕ;`);
    expect(p.body[0]?.kind).toBe('If');
  });

  test('case with conditions, ! as branch separator', () => {
    const p = ast(`ВЫБОР ИЗ
        А > Б : А - Б -> А
      ! А = Б : 0 -> С
      ! А < Б : Б - А -> А
        ИНАЧЕ ? "так не должно быть"
    ВСЕ;`);
    const s = p.body[0]!;
    if (s.kind !== 'Case') throw new Error();
    expect(s.discriminant).toBeNull();
    expect(s.whens).toHaveLength(3);
    expect(s.else).not.toBeNull();
  });

  test('case with discriminant and multi-value when', () => {
    const p = ast(`ВЫБОР К ИЗ
        1, 2 : ? "мало"
      ! 3    : ? "три"
        ИНАЧЕ ? "много"
    ВСЕ;`);
    const s = p.body[0]!;
    if (s.kind !== 'Case') throw new Error();
    expect(s.discriminant?.kind).toBe('Name');
    expect(s.whens[0]?.values).toHaveLength(2);
  });

  test('all four loop headers', () => {
    const src = `
      ПОВТОР 4 РАЗА :: ? "ПРИВЕТ" ВСЕ;
      ПОКА А > Б :: А - Б -> А ВСЕ;
      ДЛЯ С ИЗ "СТРОКА" :: С + Т -> Т ВСЕ;
      ДЛЯ А ОТ 1 ДО К ШАГ 2 :: ? А * А ВСЕ;
    `;
    const p = ast(src);
    expect(p.body).toHaveLength(4);
    const headers = p.body.map((s) => s.kind === 'Loop' ? s.header.kind : null);
    expect(headers).toEqual(['Repeat', 'While', 'ForIn', 'ForRange']);
  });

  test('procedure with three param modes', () => {
    const p = ast(`
      ПРОЦ ФОР_В ( А =>, <=> Б, В ) ;
         ИМЕНА: Г, Д ;
         А -> Г
      КНЦ;
    `);
    const s = p.body[0]!;
    if (s.kind !== 'ProcDef') throw new Error();
    expect(s.params.map((x) => x.mode)).toEqual(['out', 'inout', 'in']);
    expect(s.locals).toEqual(['Г', 'Д']);
  });

  test('function with РЕЗ', () => {
    const p = ast(`
      ФУНК ФАКТ (Н) ;
         ИМЕНА: Р ;
         1 -> Р ;
         ДЛЯ И ОТ 1 ДО Н ::
            Р * И -> Р
         ВСЕ ;
      РЕЗ: Р
      КНЦ ;
    `);
    const s = p.body[0]!;
    if (s.kind !== 'FuncDef') throw new Error();
    expect(s.name).toBe('ФАКТ');
    expect(s.params).toHaveLength(1);
    expect(s.params[0]?.mode).toBe('in');
    expect(s.result.kind).toBe('Name');
  });

  test('function rejects out/inout params', () => {
    expect(() => ast('ФУНК БАД (А =>) ; РЕЗ: А КНЦ ;')).toThrow();
    expect(() => ast('ФУНК БАД (<=> А) ; РЕЗ: А КНЦ ;')).toThrow();
  });

  test('? output shortcut', () => {
    const p = ast('? "ПРИВЕТ"; ? Х, Y;');
    const s = p.body[0]!;
    if (s.kind !== 'Output') throw new Error();
    expect(s.suppressNewline).toBe(false);
    expect(s.items).toHaveLength(1);
    const t = p.body[1]!;
    if (t.kind !== 'Output') throw new Error();
    expect(t.items).toHaveLength(2);
  });

  test('ВЫВОД with format and direction', () => {
    const p = ast('ВЫВОД НА ЭКРАН БПС : Х:10:3, А, Б:5;');
    const s = p.body[0]!;
    if (s.kind !== 'Output') throw new Error();
    expect(s.direction.kind).toBe('screen');
    expect(s.suppressNewline).toBe(true);
    expect(s.items[0]?.width?.kind).toBe('IntLit');
    expect(s.items[0]?.precision?.kind).toBe('IntLit');
    expect(s.items[1]?.width).toBeNull();
    expect(s.items[2]?.width?.kind).toBe('IntLit');
  });

  test('ВВОД with mode', () => {
    const p = ast('ВВОД ДАННЫХ : А, Б, В;');
    const s = p.body[0]!;
    if (s.kind !== 'Input') throw new Error();
    expect(s.mode).toBe('data');
    expect(s.targets).toHaveLength(3);
  });

  test('КОНТРОЛЬ assertion', () => {
    const p = ast('КОНТРОЛЬ Х > 0;');
    expect(p.body[0]?.kind).toBe('Control');
  });

  test('СТОП / ВЫХОД / ПУСК', () => {
    const p = ast('СТОП; ВЫХОД; ПУСК;');
    expect(p.body.map((s) => s.kind)).toEqual(['Stop', 'Exit', 'Run']);
  });

  test('ИЗ as binary membership operator', () => {
    const p = ast('1 ИЗ <1, 2, 3> -> Б;');
    const s = p.body[0]!;
    if (s.kind !== 'Assign') throw new Error();
    if (s.value.kind !== 'BinOp') throw new Error();
    expect(s.value.op).toBe('in');
  });

  test('ВИДА as binary type-check operator', () => {
    const p = ast('Х ВИДА <А, Б, Ц> -> Б;');
    const s = p.body[0]!;
    if (s.kind !== 'Assign') throw new Error();
    if (s.value.kind !== 'BinOp') throw new Error();
    expect(s.value.op).toBe('kind');
  });

  test('qualified target: index, slice, field', () => {
    const p = ast('1 -> К[2]; <2, 3> -> К[5:6]; "ПЕТРОВ" -> АНКЕТА.ФАМ;');
    const a = p.body[0]; const b = p.body[1]; const c = p.body[2];
    if (a?.kind !== 'Assign' || b?.kind !== 'Assign' || c?.kind !== 'Assign') throw new Error();
    expect(a.target.kind).toBe('Index');
    expect(b.target.kind).toBe('Slice');
    expect(c.target.kind).toBe('Field');
  });

  test('compound name parses to segments', () => {
    const p = ast("МОД'ИМЯ -> Х;");
    const s = p.body[0]!;
    if (s.kind !== 'Assign') throw new Error();
    if (s.value.kind !== 'Name') throw new Error();
    expect(s.value.segments).toEqual(['МОД', 'ИМЯ']);
  });

  test('.пусто is the empty literal', () => {
    const p = ast('.пусто -> Х;');
    const s = p.body[0]!;
    if (s.kind !== 'Assign') throw new Error();
    expect(s.value.kind).toBe('EmptyLit');
  });

  test('operator precedence: power right-assoc, ** > unary, * > +', () => {
    const p = ast('1 + 2 * 3 ** 4 -> Х;');
    const s = p.body[0]!;
    if (s.kind !== 'Assign' || s.value.kind !== 'BinOp') throw new Error();
    expect(s.value.op).toBe('add');
    const r = s.value.right; // 2 * (3 ** 4)
    if (r.kind !== 'BinOp') throw new Error();
    expect(r.op).toBe('mul');
    expect(r.right.kind).toBe('BinOp');
    if (r.right.kind === 'BinOp') expect(r.right.op).toBe('pow');
  });

  test('full factorial program parses end-to-end', () => {
    const src = `
      ФУНК ФАКТ (Н) ;
         ИМЕНА: Р ;
         1 -> Р ;
         ДЛЯ И ОТ 1 ДО Н ::
            Р * И -> Р
         ВСЕ ;
      РЕЗ: Р
      КНЦ ;

      ФАКТ(5) -> Х ;
      ? Х
    `;
    const p = ast(src);
    expect(p.body[0]?.kind).toBe('FuncDef');
    expect(p.body[1]?.kind).toBe('Assign');
    expect(p.body[2]?.kind).toBe('Output');
  });
});
