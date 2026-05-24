// Vanilla Agat Rapira keyword table.
// Russian-only. Case-insensitive in the A1.3 implementation, so we
// normalise to upper-case (locale-aware) before lookup.
//
// Normalisation note: Cyrillic upper-case mapping is well-behaved for the
// letters used in Rapira keywords (а→А, б→Б, …, я→Я). We use
// `String.prototype.toLocaleUpperCase('ru-RU')` to be explicit.

export type KeywordKind =
  // structural
  | 'PROC' | 'FUNC' | 'KNC' | 'RES' | 'NAMES'
  // conditionals
  | 'IF' | 'THEN' | 'ELSE' | 'ALL'
  | 'CASE' | 'OF' | 'KIND'
  // loops
  | 'REPEAT' | 'TIMES' | 'WHILE' | 'FOR' | 'FROM' | 'TO' | 'STEP'
  // I/O
  | 'OUT' | 'IN' | 'NLF'
  | 'TO_DIR' | 'IN_DIR' | 'OF_DIR'
  | 'DATA' | 'TEXTS' | 'SCREEN' | 'PAPER' | 'FILE' | 'FILE_GEN' | 'DZU'
  // control / debug
  | 'CONTROL' | 'STOP' | 'EXIT' | 'RUN' | 'STEP_DBG'
  // logical
  | 'AND' | 'OR' | 'NOT'
  // misc / modules (parsed but largely deferred)
  | 'MODULE' | 'START' | 'FINISH' | 'AVAILABLE'
  | 'OPEN' | 'CLOSE' | 'POSITION' | 'AS' | 'LOCK' | 'UNLOCK' | 'ERASE'
  | 'ROBIK' | 'RAPIRA';

const TABLE: Record<string, KeywordKind> = {
  ЕСЛИ: 'IF', ТО: 'THEN', ИНАЧЕ: 'ELSE', ВСЕ: 'ALL',
  ВЫБОР: 'CASE', ИЗ: 'OF', ВИДА: 'KIND',

  ПОВТОР: 'REPEAT', РАЗ: 'TIMES', РАЗА: 'TIMES',
  ПОКА: 'WHILE',
  ДЛЯ: 'FOR', ОТ: 'FROM', ДО: 'TO', ШАГ: 'STEP',

  ПРОЦ: 'PROC', ФУНК: 'FUNC',
  КНЦ: 'KNC', РЕЗ: 'RES', ИМЕНА: 'NAMES',

  ВЫВОД: 'OUT', ВВОД: 'IN', БПС: 'NLF',
  НА: 'TO_DIR', В: 'IN_DIR',  // direction prepositions
  ДАННЫХ: 'DATA', ТЕКСТОВ: 'TEXTS',
  ЭКРАН: 'SCREEN', БУМАГУ: 'PAPER',
  ФАЙЛ: 'FILE', ФАЙЛА: 'FILE_GEN', ДЗУ: 'DZU',

  КОНТРОЛЬ: 'CONTROL', СТОП: 'STOP', ВЫХОД: 'EXIT', ПУСК: 'RUN',

  И: 'AND', ИЛИ: 'OR', НЕ: 'NOT',

  МОДУЛЬ: 'MODULE', СТАРТ: 'START', ФИНИШ: 'FINISH', ДОСТУПНО: 'AVAILABLE',
  ОТКРЫТЬ: 'OPEN', ЗАКРЫТЬ: 'CLOSE', ПОЗИЦИЯ: 'POSITION', КАК: 'AS',
  ЗАПЕРЕТЬ: 'LOCK', ОТПЕРЕТЬ: 'UNLOCK', СТЕРЕТЬ: 'ERASE',

  РОБИК: 'ROBIK', РАПИРА: 'RAPIRA',
};

/** Normalised form used for keyword lookup and reserved-name comparison. */
export function normalize(s: string): string {
  return s.toLocaleUpperCase('ru-RU');
}

export function lookupKeyword(text: string): KeywordKind | undefined {
  return TABLE[normalize(text)];
}

export function isReservedWord(text: string): boolean {
  return TABLE[normalize(text)] !== undefined;
}
