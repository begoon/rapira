import { lookupKeyword, normalize, type KeywordKind } from './keywords.ts';
import { LexError, type Pos } from './errors.ts';

export type TokenKind =
  | KeywordKind
  | 'IDENT'
  | 'INT' | 'REAL' | 'TEXT'
  | 'ASSIGN'        // -> (canonical Agat) and := (our accepted alias)
  // tuple / set / record literal brackets
  | 'LTUPLE' | 'RTUPLE'    // < and > used as tuple brackets when in expression position
  | 'LSET' | 'RSET'        // <*  *>
  | 'LREC' | 'RREC'        // <¤  ¤>
  // ordinary relational ops (same printable shapes as <, >)
  | 'LT' | 'GT' | 'LEQ' | 'GEQ' | 'EQ' | 'NEQ'
  // arithmetic
  | 'PLUS' | 'MINUS' | 'STAR' | 'SLASH' | 'POWER' | 'INTDIV'
  // misc punctuation / Agat specials
  | 'LPAREN' | 'RPAREN' | 'LBRACK' | 'RBRACK'
  | 'COMMA' | 'COLON' | 'SEMI' | 'HASH' | 'DOT'
  | 'BANG'           // !   case-branch separator
  | 'QUESTION'       // ?   output shortcut
  | 'DCOLON'         // ::  loop body opener
  | 'APOS'           // '   compound-name separator
  | 'OUT_PARAM'      // =>  postfix output-param marker
  | 'INOUT_PARAM'    // <=> inout-param marker
  | 'EOF';

export interface Token {
  kind: TokenKind;
  text: string;       // original source text
  pos: Pos;
  value?: number | string;  // numeric value or decoded text content
}

/**
 * The lexer cannot tell whether `<` opens a tuple literal or means "less than":
 *   x := <1, 2, 3>     → tuple
 *   x := a < b         → comparison
 *
 * It emits the punctuation tokens (LT/GT, LEQ/GEQ) and lets the parser
 * re-interpret a `<` / `>` as tuple brackets when found in expression
 * start position. The other multi-char bracket forms — `<*`, `*>`, `<¤`,
 * `¤>` — are unambiguous and tokenised directly.
 */

const RE_LETTER = /[A-Za-z\p{Script=Cyrillic}]/u;
const RE_IDENT_REST = /[A-Za-z\p{Script=Cyrillic}0-9_]/u;
const isDigit = (c: string) => c >= '0' && c <= '9';
const isExpLetter = (c: string) => c === 'E' || c === 'e' || c === 'Е' || c === 'е';

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const here = (): Pos => ({ line, col, offset: i });

  const advance = (n = 1): void => {
    for (let k = 0; k < n; k++) {
      if (src[i] === '\n') { line++; col = 1; } else { col++; }
      i++;
    }
  };

  const peek = (k = 0): string => src[i + k] ?? '';

  while (i < src.length) {
    const start = here();
    const c = peek();

    // whitespace (incl. newlines — they are NOT statement separators in Agat)
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { advance(); continue; }

    // (* ... *) block comment — supports nesting
    if (c === '(' && peek(1) === '*') {
      let depth = 1;
      advance(2);
      while (i < src.length && depth > 0) {
        if (peek() === '(' && peek(1) === '*') { depth++; advance(2); continue; }
        if (peek() === '*' && peek(1) === ')') { depth--; advance(2); continue; }
        advance();
      }
      if (depth !== 0) throw new LexError('Unterminated (* … *) comment', start);
      continue;
    }

    // multi-char operators (longest-first)
    if (c === '<' && peek(1) === '=' && peek(2) === '>') { advance(3); out.push({ kind: 'INOUT_PARAM', text: '<=>', pos: start }); continue; }
    if (c === '<' && peek(1) === '*') { advance(2); out.push({ kind: 'LSET',    text: '<*',  pos: start }); continue; }
    if (c === '*' && peek(1) === '>') { advance(2); out.push({ kind: 'RSET',    text: '*>',  pos: start }); continue; }
    if (c === '<' && peek(1) === '¤') { advance(2); out.push({ kind: 'LREC',    text: '<¤',  pos: start }); continue; }
    if (c === '¤' && peek(1) === '>') { advance(2); out.push({ kind: 'RREC',    text: '¤>',  pos: start }); continue; }
    // `$` is the ASCII-keyboard alternative for the KOI-8 `¤` glyph.
    // On Soviet hardware the `$` ROM slot was remapped to `¤`, so the two
    // forms refer to the same delimiter in record literals.
    if (c === '<' && peek(1) === '$') { advance(2); out.push({ kind: 'LREC',    text: '<$',  pos: start }); continue; }
    if (c === '$' && peek(1) === '>') { advance(2); out.push({ kind: 'RREC',    text: '$>',  pos: start }); continue; }
    if (c === '-' && peek(1) === '>') { advance(2); out.push({ kind: 'ASSIGN',  text: '->',  pos: start }); continue; }
    if (c === ':' && peek(1) === '=') { advance(2); out.push({ kind: 'ASSIGN',  text: ':=',  pos: start }); continue; }
    if (c === ':' && peek(1) === ':') { advance(2); out.push({ kind: 'DCOLON',  text: '::',  pos: start }); continue; }
    if (c === '<' && peek(1) === '=') { advance(2); out.push({ kind: 'LEQ',     text: '<=',  pos: start }); continue; }
    if (c === '>' && peek(1) === '=') { advance(2); out.push({ kind: 'GEQ',     text: '>=',  pos: start }); continue; }
    if (c === '/' && peek(1) === '=') { advance(2); out.push({ kind: 'NEQ',     text: '/=',  pos: start }); continue; }
    if (c === '*' && peek(1) === '*') { advance(2); out.push({ kind: 'POWER',   text: '**',  pos: start }); continue; }
    if (c === '/' && peek(1) === '/') { advance(2); out.push({ kind: 'INTDIV',  text: '//',  pos: start }); continue; }
    if (c === '=' && peek(1) === '>') { advance(2); out.push({ kind: 'OUT_PARAM', text: '=>', pos: start }); continue; }

    // single-char
    const single: Record<string, TokenKind> = {
      '+': 'PLUS', '-': 'MINUS', '*': 'STAR', '/': 'SLASH',
      '<': 'LT',   '>': 'GT',    '=': 'EQ',
      '(': 'LPAREN', ')': 'RPAREN', '[': 'LBRACK', ']': 'RBRACK',
      ',': 'COMMA', ':': 'COLON', ';': 'SEMI', '#': 'HASH', '.': 'DOT',
      '!': 'BANG', '?': 'QUESTION', "'": 'APOS',
    };
    if (single[c]) {
      const kind = single[c]!;
      advance();
      out.push({ kind, text: c, pos: start });
      continue;
    }

    // number
    if (isDigit(c)) {
      let j = i;
      while (j < src.length && isDigit(src[j]!)) j++;
      let isReal = false;
      if (src[j] === '.' && j + 1 < src.length && isDigit(src[j + 1]!)) {
        isReal = true;
        j++;
        while (j < src.length && isDigit(src[j]!)) j++;
      }
      if (j < src.length && isExpLetter(src[j]!)) {
        isReal = true;
        j++;
        if (src[j] === '+' || src[j] === '-') j++;
        if (!isDigit(src[j] ?? '')) {
          throw new LexError('Malformed real literal: expected digits after exponent', start);
        }
        while (j < src.length && isDigit(src[j]!)) j++;
      }
      const text = src.slice(i, j);
      // For parsing the value, normalise Cyrillic Е/е → E/e
      const normalised = text.replace(/[Ее]/g, 'e');
      const value = isReal ? Number.parseFloat(normalised) : Number.parseInt(normalised, 10);
      advance(j - i);
      out.push({ kind: isReal ? 'REAL' : 'INT', text, pos: start, value });
      continue;
    }

    // text literal "..." with "" as escape for "
    if (c === '"') {
      advance(); // open quote
      let buf = '';
      while (i < src.length) {
        const ch = peek();
        if (ch === '\n' || ch === '\r') {
          throw new LexError('Unterminated text literal (newline inside string)', start);
        }
        if (ch === '"') {
          if (peek(1) === '"') { buf += '"'; advance(2); continue; }
          advance(); // close quote
          out.push({ kind: 'TEXT', text: `"${buf}"`, pos: start, value: buf });
          break;
        }
        buf += ch;
        advance();
      }
      continue;
    }

    // identifier or keyword
    if (RE_LETTER.test(c)) {
      let j = i;
      while (j < src.length && RE_IDENT_REST.test(src[j]!)) j++;
      const text = src.slice(i, j);
      advance(j - i);

      // Special-case: ".пусто" is parsed as DOT then IDENT(пусто). Reserved-name handling
      // happens at the parser/evaluator level. We don't bake it into the lexer.
      const kw = lookupKeyword(text);
      if (kw) {
        out.push({ kind: kw, text, pos: start });
      } else {
        // identifier text is preserved (display case); for env lookups, callers normalise.
        out.push({ kind: 'IDENT', text, pos: start, value: normalize(text) });
      }
      continue;
    }

    throw new LexError(`Unexpected character: ${JSON.stringify(c)}`, start);
  }

  out.push({ kind: 'EOF', text: '', pos: here() });
  return out;
}
