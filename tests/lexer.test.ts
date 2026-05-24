import { describe, test, expect } from 'bun:test';
import { tokenize } from '../src/lexer.ts';

const kinds = (src: string) => tokenize(src).map((t) => t.kind);

describe('lexer (Agat)', () => {
  test('keywords are case-insensitive (Russian only)', () => {
    expect(kinds('ПРОЦ проц Проц')).toEqual(['PROC', 'PROC', 'PROC', 'EOF']);
    expect(kinds('ЕСЛИ ТО ИНАЧЕ ВСЕ')).toEqual(['IF', 'THEN', 'ELSE', 'ALL', 'EOF']);
    expect(kinds('ПОВТОР РАЗ РАЗА ПОКА ДЛЯ ОТ ДО ШАГ ИЗ ВИДА')).toEqual([
      'REPEAT', 'TIMES', 'TIMES', 'WHILE', 'FOR', 'FROM', 'TO', 'STEP', 'OF', 'KIND', 'EOF',
    ]);
    expect(kinds('ФУНК КНЦ РЕЗ ИМЕНА')).toEqual(['FUNC', 'KNC', 'RES', 'NAMES', 'EOF']);
    expect(kinds('И ИЛИ НЕ')).toEqual(['AND', 'OR', 'NOT', 'EOF']);
  });

  test('English words are NOT keywords in Agat', () => {
    expect(kinds('if then else fun proc end')).toEqual([
      'IDENT', 'IDENT', 'IDENT', 'IDENT', 'IDENT', 'IDENT', 'EOF',
    ]);
  });

  test('assignment operators: -> primary, := accepted', () => {
    expect(kinds('1 -> Х')).toEqual(['INT', 'ASSIGN', 'IDENT', 'EOF']);
    expect(kinds('Х := 1')).toEqual(['IDENT', 'ASSIGN', 'INT', 'EOF']);
  });

  test('Agat block comment (* ... *), multi-line and nested', () => {
    expect(kinds('Х -> Ц (* comment *) ;')).toEqual([
      'IDENT', 'ASSIGN', 'IDENT', 'SEMI', 'EOF',
    ]);
    // multi-line
    expect(kinds('А (*\nlines\n*) Б')).toEqual(['IDENT', 'IDENT', 'EOF']);
    // nested
    expect(kinds('А (* outer (* inner *) still outer *) Б')).toEqual(['IDENT', 'IDENT', 'EOF']);
  });

  test('newlines are whitespace, not statement separators', () => {
    expect(kinds('Х\n:=\n1')).toEqual(['IDENT', 'ASSIGN', 'INT', 'EOF']);
  });

  test('tuple/set/record brackets and arrows', () => {
    expect(kinds('<1, 2>')).toEqual(['LT', 'INT', 'COMMA', 'INT', 'GT', 'EOF']);
    expect(kinds('<* 1, 2 *>')).toEqual(['LSET', 'INT', 'COMMA', 'INT', 'RSET', 'EOF']);
    expect(kinds('<¤ a: 1 ¤>')).toEqual(['LREC', 'IDENT', 'COLON', 'INT', 'RREC', 'EOF']);
    // $ is the ASCII alternative for the KOI-8 ¤ glyph; same delimiter
    expect(kinds('<$ a: 1 $>')).toEqual(['LREC', 'IDENT', 'COLON', 'INT', 'RREC', 'EOF']);
    expect(kinds('<=>')).toEqual(['INOUT_PARAM', 'EOF']);
    expect(kinds('=>')).toEqual(['OUT_PARAM', 'EOF']);
  });

  test('relational operators and arithmetic', () => {
    expect(kinds('= /= < <= > >= + - * / ** //')).toEqual([
      'EQ', 'NEQ', 'LT', 'LEQ', 'GT', 'GEQ',
      'PLUS', 'MINUS', 'STAR', 'SLASH', 'POWER', 'INTDIV', 'EOF',
    ]);
  });

  test('Agat specials: ? ! :: ‘ (apostrophe)', () => {
    expect(kinds('? ! ::')).toEqual(['QUESTION', 'BANG', 'DCOLON', 'EOF']);
    expect(kinds("МОД'ИМЯ")).toEqual(['IDENT', 'APOS', 'IDENT', 'EOF']);
  });

  test('real literals with Cyrillic Е and Latin E exponent', () => {
    const t = tokenize('3.141519 0.3141519Е1 3141519Е-6 2E10 1e+5');
    expect(t.map((x) => x.kind)).toEqual(['REAL', 'REAL', 'REAL', 'REAL', 'REAL', 'EOF']);
    expect(t[1]?.value).toBeCloseTo(3.141519);
    expect(t[2]?.value).toBeCloseTo(3.141519);
    expect(t[3]?.value).toBe(2e10);
    expect(t[4]?.value).toBe(1e5);
  });

  test('text with "" escape; Cyrillic content', () => {
    const t = tokenize('"ЛЕДОКОЛ ""АЛЬБАТРОС"""');
    expect(t[0]?.kind).toBe('TEXT');
    expect(t[0]?.value).toBe('ЛЕДОКОЛ "АЛЬБАТРОС"');
  });

  test('identifier carries normalized value for env lookup', () => {
    const t = tokenize('Тек_Имя');
    expect(t[0]?.kind).toBe('IDENT');
    expect(t[0]?.text).toBe('Тек_Имя');
    expect(t[0]?.value).toBe('ТЕК_ИМЯ');
  });

  test('full factorial sample tokenises', () => {
    const src = `ФУНК ФАКТ (Н) ;
   ИМЕНА: Р ;
   1 -> Р ;
   ДЛЯ И ОТ 1 ДО Н ::
      Р * И -> Р
   ВСЕ ;
РЕЗ: Р
КНЦ ;`;
    const t = tokenize(src);
    expect(t.find((x) => x.kind === 'FUNC')).toBeDefined();
    expect(t.find((x) => x.kind === 'RES')).toBeDefined();
    expect(t.find((x) => x.kind === 'KNC')).toBeDefined();
    expect(t.filter((x) => x.kind === 'DCOLON')).toHaveLength(1);
  });
});
