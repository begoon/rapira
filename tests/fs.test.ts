import { describe, test, expect } from 'bun:test';
import { Interpreter, BufferedHost } from '../src/interpreter.ts';
import { tokenize } from '../src/lexer.ts';
import { parse } from '../src/parser.ts';
import { InMemoryFileSystem } from '../src/fs.ts';

function runWithFs(src: string, initialFiles: Record<string, string> = {}): { out: string; fs: InMemoryFileSystem } {
  const host = new BufferedHost();
  host.fs = new InMemoryFileSystem(initialFiles);
  const interp = new Interpreter(host);
  interp.run(parse(tokenize(src)));
  return { out: host.out, fs: host.fs };
}

describe('File I/O', () => {
  test('ОТКРЫТЬ + ВЫВОД В ФАЙЛ + ЗАКРЫТЬ writes to the file', () => {
    const r = runWithFs(`
      ОТКРЫТЬ "out.txt" КАК Ф;
      ВЫВОД В ФАЙЛ Ф : "первая строка";
      ВЫВОД В ФАЙЛ Ф : "вторая строка";
      ЗАКРЫТЬ Ф;
    `);
    expect(r.fs.snapshot().get('out.txt')).toBe('первая строка\nвторая строка\n');
  });

  test('ВВОД ИЗ ФАЙЛА ТЕКСТОВ reads whole lines', () => {
    const r = runWithFs(`
      ОТКРЫТЬ "in.txt" КАК Ф;
      ВВОД ИЗ ФАЙЛА Ф ТЕКСТОВ : А;
      ВВОД ИЗ ФАЙЛА Ф ТЕКСТОВ : Б;
      ЗАКРЫТЬ Ф;
      ? А;
      ? Б;
    `, { 'in.txt': 'привет\nмир\n' });
    expect(r.out).toBe('привет\nмир\n');
  });

  test('ВВОД ИЗ ФАЙЛА ДАННЫХ tokenises and detects numbers', () => {
    const r = runWithFs(`
      ОТКРЫТЬ "nums.txt" КАК Ф;
      ВВОД ИЗ ФАЙЛА Ф ДАННЫХ : А, Б, В;
      ЗАКРЫТЬ Ф;
      ? А + Б + В;
    `, { 'nums.txt': '10 20 12\n' });
    expect(r.out).toBe('42\n');
  });

  test('round trip: write then read back through the same FileSystem', () => {
    const r = runWithFs(`
      ОТКРЫТЬ "rt.txt" КАК Ф;
      ВЫВОД В ФАЙЛ Ф БПС : "hello world";
      ЗАКРЫТЬ Ф;

      ОТКРЫТЬ "rt.txt" КАК Ф;
      ВВОД ИЗ ФАЙЛА Ф ТЕКСТОВ : С;
      ЗАКРЫТЬ Ф;
      ? С;
    `);
    expect(r.out).toBe('hello world\n');
  });

  test('file I/O without an fs host throws cleanly (web case)', () => {
    const host = new BufferedHost();
    // Simulate the web worker host: no fs.
    (host as { fs?: InMemoryFileSystem }).fs = undefined;
    const interp = new Interpreter(host);
    expect(() => {
      interp.run(parse(tokenize('ОТКРЫТЬ "x.txt" КАК Ф;')));
    }).toThrow(/недоступны/);
  });

  test('ПОЗИЦИЯ rewinds the read pointer', () => {
    const r = runWithFs(`
      ОТКРЫТЬ "in.txt" КАК Ф;
      ВВОД ИЗ ФАЙЛА Ф ТЕКСТОВ : А;
      ПОЗИЦИЯ Ф = 1;
      ВВОД ИЗ ФАЙЛА Ф ТЕКСТОВ : Б;
      ЗАКРЫТЬ Ф;
      ? А;
      ? Б;
      ? А = Б;
    `, { 'in.txt': 'one\ntwo\n' });
    expect(r.out).toBe('one\none\nда\n');
  });

  test('ПОЗИЦИЯ jumps to mid-file offset', () => {
    // "abcdefghij" — position 4 puts us at 'd'.
    const r = runWithFs(`
      ОТКРЫТЬ "abc.txt" КАК Ф;
      ПОЗИЦИЯ Ф = 4;
      ВВОД ИЗ ФАЙЛА Ф ТЕКСТОВ : С;
      ЗАКРЫТЬ Ф;
      ? С;
    `, { 'abc.txt': 'abcdefghij' });
    expect(r.out).toBe('defghij\n');
  });

  test('ПОЗИЦИЯ_В() reports current 1-based position', () => {
    const r = runWithFs(`
      ОТКРЫТЬ "in.txt" КАК Ф;
      ? ПОЗИЦИЯ_В("Ф");
      ВВОД ИЗ ФАЙЛА Ф ТЕКСТОВ : С;
      ? ПОЗИЦИЯ_В("Ф");
      ПОЗИЦИЯ Ф = 1;
      ? ПОЗИЦИЯ_В("Ф");
      ЗАКРЫТЬ Ф;
    `, { 'in.txt': 'abc\ndef\n' });
    // start → 1; after reading "abc\n" (4 chars) → 5; after seek to 1 → 1
    expect(r.out).toBe('1\n5\n1\n');
  });

  test('ПОЗИЦИЯ past EOF clamps and yields empty reads', () => {
    const r = runWithFs(`
      ОТКРЫТЬ "in.txt" КАК Ф;
      ПОЗИЦИЯ Ф = 9999;
      ВВОД ИЗ ФАЙЛА Ф ТЕКСТОВ : С;
      ЗАКРЫТЬ Ф;
      ? С = "";
    `, { 'in.txt': 'hi' });
    expect(r.out).toBe('да\n');
  });

  test('ПОЗИЦИЯ rejects 0 and negative', () => {
    expect(() => runWithFs(`
      ОТКРЫТЬ "x" КАК Ф;
      ПОЗИЦИЯ Ф = 0;
    `)).toThrow(/≥ 1/);
  });

  test('КФ reports EOF status', () => {
    const r = runWithFs(`
      ОТКРЫТЬ "in.txt" КАК Ф;
      ? КФ("Ф");                    (* expect "Н" — file has content *)
      ВВОД ИЗ ФАЙЛА Ф ТЕКСТОВ : С;  (* consume the only line + newline *)
      ? КФ("Ф");                    (* expect "Д" — at EOF *)
      ЗАКРЫТЬ Ф;
    `, { 'in.txt': 'hello\n' });
    expect(r.out).toBe('Н\nД\n');
  });

  test('ЧТФ reads N characters as text', () => {
    const r = runWithFs(`
      ОТКРЫТЬ "in.txt" КАК Ф;
      ? ЧТФ("Ф", 5);
      ? ЧТФ("Ф", 100);  (* fewer than 100 left — get what's there *)
      ? ЧТФ("Ф", 1) = "";
      ЗАКРЫТЬ Ф;
    `, { 'in.txt': 'abcdefghij' });
    expect(r.out).toBe('abcde\nfghij\nда\n');
  });

  test('ЧТФ + КФ together for file-loop pattern', () => {
    const r = runWithFs(`
      ОТКРЫТЬ "in.txt" КАК Ф;
      "" -> ВСЁ;
      ПОКА КФ("Ф") = "Н" ::
         ЧТФ("Ф", 1) + ВСЁ -> ВСЁ
      ВСЕ;
      ЗАКРЫТЬ Ф;
      ? ВСЁ;
    `, { 'in.txt': 'abc' });
    expect(r.out).toBe('cba\n');
  });

  test('reading from EOF yields .пусто for ДАННЫХ', () => {
    const r = runWithFs(`
      ОТКРЫТЬ "empty.txt" КАК Ф;
      ВВОД ИЗ ФАЙЛА Ф ДАННЫХ : Х;
      ЗАКРЫТЬ Ф;
      ? Х = .пусто;
    `, { 'empty.txt': '' });
    expect(r.out).toBe('да\n');
  });
});

describe('Output formatters', () => {
  function run(src: string): string {
    const host = new BufferedHost();
    const interp = new Interpreter(host);
    interp.run(parse(tokenize(src)));
    return host.out;
  }

  test('precision on real', () => {
    expect(run('? 3.14159 : 0 : 2;')).toBe('3.14\n');
  });

  test('width + precision pads with spaces', () => {
    expect(run('? 3.14 : 8 : 2;')).toBe('    3.14\n');
  });

  test('width on integer right-aligns', () => {
    expect(run('? 42 : 5;')).toBe('   42\n');
  });

  test('width on text right-aligns', () => {
    expect(run('? "хи" : 5;')).toBe('   хи\n');
  });

  test('precision 0 on real rounds to integer-shaped string', () => {
    expect(run('? 3.7 : 0 : 0;')).toBe('4\n');
  });

  test('precision on integer applies toFixed', () => {
    expect(run('? 42 : 0 : 3;')).toBe('42.000\n');
  });

  test('mixed items keep their per-item formatting', () => {
    expect(run('? 1 : 3, " ", 2 : 3, " ", 3.14 : 6 : 2;'))
      .toBe('  1   2   3.14\n');
  });
});
