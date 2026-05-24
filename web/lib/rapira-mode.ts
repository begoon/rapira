/**
 * Minimal CodeMirror 6 language mode for Rapira.
 *
 * Highlights keywords, comments, strings, numbers, and the special
 * operator/punctuation forms. No parsing — just a stream tokenizer
 * matching what `src/lexer.ts` recognises, so highlight rules match
 * the actual language without us shipping the whole interpreter
 * grammar to the editor.
 */

import { StreamLanguage, type StreamParser } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';

const KEYWORDS = new Set([
  'ЕСЛИ', 'ТО', 'ИНАЧЕ', 'ВСЕ',
  'ВЫБОР', 'ИЗ', 'ВИДА',
  'ПОВТОР', 'РАЗ', 'РАЗА', 'ПОКА',
  'ДЛЯ', 'ОТ', 'ДО', 'ШАГ',
  'ПРОЦ', 'ФУНК', 'КНЦ', 'РЕЗ', 'ИМЕНА',
  'ВЫВОД', 'ВВОД', 'БПС',
  'НА', 'В', 'ДАННЫХ', 'ТЕКСТОВ', 'ЭКРАН', 'БУМАГУ', 'ФАЙЛ', 'ФАЙЛА', 'ДЗУ',
  'КОНТРОЛЬ', 'СТОП', 'ВЫХОД', 'ПУСК',
  'И', 'ИЛИ', 'НЕ',
  'МОДУЛЬ', 'СТАРТ', 'ФИНИШ', 'ДОСТУПНО',
  'ОТКРЫТЬ', 'ЗАКРЫТЬ', 'ПОЗИЦИЯ', 'КАК', 'ЗАПЕРЕТЬ', 'ОТПЕРЕТЬ', 'СТЕРЕТЬ',
  'РОБИК', 'РАПИРА',
]);

function isLetter(ch: string): boolean {
  return /[A-Za-zЀ-ӿ]/.test(ch);
}
function isIdentRest(ch: string): boolean {
  return /[A-Za-zЀ-ӿ0-9_]/.test(ch);
}

interface State { inComment: number }

const parser: StreamParser<State> = {
  startState: () => ({ inComment: 0 }),

  token(stream, state) {
    // multi-line block comment
    if (state.inComment > 0) {
      while (!stream.eol()) {
        if (stream.match('(*')) { state.inComment++; continue; }
        if (stream.match('*)')) { state.inComment--; if (state.inComment === 0) return 'comment'; continue; }
        stream.next();
      }
      return 'comment';
    }

    if (stream.eatSpace()) return null;

    // begin block comment
    if (stream.match('(*')) {
      state.inComment = 1;
      while (!stream.eol()) {
        if (stream.match('(*')) { state.inComment++; continue; }
        if (stream.match('*)')) { state.inComment--; if (state.inComment === 0) return 'comment'; continue; }
        stream.next();
      }
      return 'comment';
    }

    // string literal "..." with "" escape
    if (stream.peek() === '"') {
      stream.next();
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === '"') {
          if (stream.peek() === '"') { stream.next(); continue; }
          return 'string';
        }
      }
      return 'string';
    }

    // numeric literal
    const ch = stream.peek() ?? '';
    if (ch >= '0' && ch <= '9') {
      stream.eatWhile(/[0-9]/);
      if (stream.match(/^\.[0-9]+/)) { /* fractional part */ }
      if (stream.match(/^[EeЕе][+-]?[0-9]+/)) { /* exponent */ }
      return 'number';
    }

    // operators / punctuation (multi-char first)
    if (stream.match('<=>') || stream.match('->') || stream.match(':=')
        || stream.match('::') || stream.match('<*') || stream.match('*>')
        || stream.match('<¤') || stream.match('¤>') || stream.match('<$')
        || stream.match('$>') || stream.match('=>') || stream.match('<=')
        || stream.match('>=') || stream.match('/=') || stream.match('**')
        || stream.match('//')) {
      return 'operator';
    }

    if (/[+\-*/=<>#!?;,:()\[\]]/.test(ch)) {
      stream.next();
      return 'operator';
    }

    // identifier or keyword
    if (isLetter(ch)) {
      let word = '';
      while (!stream.eol()) {
        const c = stream.peek();
        if (c && isIdentRest(c)) { word += c; stream.next(); } else break;
      }
      if (KEYWORDS.has(word.toLocaleUpperCase('ru-RU'))) return 'keyword';
      return 'variableName';
    }

    stream.next();
    return null;
  },
};

const rapiraLanguage = StreamLanguage.define(parser);

const darkHighlight = HighlightStyle.define([
  { tag: t.keyword,      color: '#c678dd', fontWeight: '600' },
  { tag: t.comment,      color: '#5c6370', fontStyle: 'italic' },
  { tag: t.string,       color: '#98c379' },
  { tag: t.number,       color: '#d19a66' },
  { tag: t.operator,     color: '#56b6c2' },
  { tag: t.variableName, color: '#e6e6e6' },
]);

// Light-theme palette. Identifier / proc-call colour is deliberately near-
// black so names like `ВПЕРЕД` and `ЦВЕТ` read as solid text rather than
// the washed-out grey common with light syntax themes.
const lightHighlight = HighlightStyle.define([
  { tag: t.keyword,      color: '#6b21a8', fontWeight: '600' },  // deep purple
  { tag: t.comment,      color: '#6b7280', fontStyle: 'italic' }, // gray
  { tag: t.string,       color: '#0f766e' },                     // teal
  { tag: t.number,       color: '#b45309' },                     // amber
  { tag: t.operator,     color: '#1d4ed8' },                     // strong blue
  { tag: t.variableName, color: '#0b0d10' },                     // near-black
]);

export type RapiraTheme = 'light' | 'dark';

/** Returns the language + theme-appropriate highlight extensions. */
export function rapira(theme: RapiraTheme = 'light'): Extension {
  return [
    rapiraLanguage,
    syntaxHighlighting(theme === 'dark' ? darkHighlight : lightHighlight),
  ];
}
