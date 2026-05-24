import type { Token, TokenKind } from './lexer.ts';
import { ParseError, type Pos } from './errors.ts';
import type {
  Expr, Stmt, Program, LValue, Param, ProcDef, FuncDef,
  CaseWhen, LoopHeader, OutputItem, OutputDirection, InputDirection, InputMode,
} from './ast.ts';
import { normalize } from './keywords.ts';

export function parse(tokens: Token[]): Program {
  return new Parser(tokens).parseProgram();
}

/** Regex matching identifier-shaped text (letter then letters/digits/underscore). */
const IDENT_RE = /^[A-Za-z\p{Script=Cyrillic}][A-Za-z\p{Script=Cyrillic}0-9_]*$/u;

/** Is this token usable as an identifier in operand/name positions? */
function isWordToken(t: Token): boolean {
  if (t.kind === 'IDENT') return true;
  // Any keyword token whose printable text is identifier-shaped is contextually
  // available as an identifier ("имена различаются от ключевых слов контекстно").
  return IDENT_RE.test(t.text);
}

class Parser {
  private i = 0;
  /** Depth of currently-open `< … >` tuple literals; while > 0 the comparison
   *  parser does not consume a bare `>` as a binary operator. */
  private tupleDepth = 0;

  /** When parsing the discriminant of a `ВЫБОР expr ИЗ …`, the trailing `ИЗ`
   *  must remain available as the case keyword. Setting this suppresses the
   *  membership binary operator inside that single expression. */
  private noOfBinop = false;

  constructor(private readonly tokens: Token[]) {}

  // ---- token helpers ----

  private peek(k = 0): Token { return this.tokens[this.i + k]!; }
  private at(...kinds: TokenKind[]): boolean { return kinds.includes(this.peek().kind); }
  private advance(): Token { return this.tokens[this.i++]!; }

  private eat(kind: TokenKind, what?: string): Token {
    const t = this.peek();
    if (t.kind !== kind) {
      throw new ParseError(`Expected ${what ?? kind}, got ${t.kind} (${JSON.stringify(t.text)})`, t.pos);
    }
    return this.advance();
  }

  private match(...kinds: TokenKind[]): Token | null {
    if (this.at(...kinds)) return this.advance();
    return null;
  }

  // Optional trailing semicolons are allowed in many places.
  private skipSemis(): void {
    while (this.match('SEMI')) { /* consume */ }
  }

  // ---- program ----

  parseProgram(): Program {
    this.skipSemis();
    const body: Stmt[] = [];
    while (!this.at('EOF')) {
      body.push(this.parseStatement());
      // Per Appendix 2 §3: statements are separated by ';'.
      // Trailing ';' before EOF is allowed.
      this.skipSemis();
    }
    return { body };
  }

  // ---- statements ----

  /** Parse a single statement. Does NOT consume the trailing `;`. */
  private parseStatement(): Stmt {
    const t = this.peek();
    switch (t.kind) {
      case 'PROC':    return this.parseProcDef();
      case 'FUNC':    return this.parseFuncDef();
      case 'IF':      return this.parseIf();
      case 'CASE':    return this.parseCase();
      case 'WHILE':
      case 'REPEAT':
      case 'FOR':     return this.parseLoop();
      case 'OUT':
      case 'QUESTION':return this.parseOutput();
      case 'IN':      return this.parseInput();
      case 'CONTROL': return this.parseControl();
      case 'STOP':    this.advance(); return { kind: 'Stop', pos: t.pos };
      case 'EXIT':    this.advance(); return { kind: 'Exit', pos: t.pos };
      case 'RUN':     this.advance(); return { kind: 'Run',  pos: t.pos };
      case 'OPEN':    return this.parseFileOpen();
      case 'CLOSE':   return this.parseFileClose();
      case 'SEMI':    // empty statement
        return { kind: 'Empty', pos: t.pos };
    }
    return this.parseAssignOrCall();
  }

  // ---- routine definitions ----

  private parseProcDef(): ProcDef {
    const start = this.eat('PROC').pos;
    const name = this.expectIdent('procedure name');
    let params: Param[] = [];
    if (this.match('LPAREN')) {
      params = this.parseParamList(/*allowOutAndInOut=*/true);
      this.eat('RPAREN');
    }
    this.eat('SEMI', '";" after procedure header');
    const locals = this.parseNamesDecl();
    const body = this.parseStmtList('KNC');
    this.eat('KNC');
    return { kind: 'ProcDef', name, params, locals, body, pos: start };
  }

  private parseFuncDef(): FuncDef {
    const start = this.eat('FUNC').pos;
    const name = this.expectIdent('function name');
    let params: Param[] = [];
    if (this.match('LPAREN')) {
      params = this.parseParamList(/*allowOutAndInOut=*/false);
      this.eat('RPAREN');
    }
    this.eat('SEMI', '";" after function header');
    const locals = this.parseNamesDecl();
    const body = this.parseStmtList('RES');
    this.eat('RES');
    this.eat('COLON', '":" after РЕЗ');
    const result = this.parseExpression();
    this.match('SEMI');
    this.eat('KNC');
    return { kind: 'FuncDef', name, params, locals, body, result, pos: start };
  }

  /** Parse `ИМЕНА: имя1, имя2, ... ;` declaration if present. */
  private parseNamesDecl(): string[] {
    if (!this.at('NAMES')) return [];
    this.advance();
    this.eat('COLON');
    const names: string[] = [this.expectIdent('local name')];
    while (this.match('COMMA')) names.push(this.expectIdent('local name'));
    this.eat('SEMI', '";" after ИМЕНА declaration');
    return names;
  }

  private parseParamList(allowOutAndInOut: boolean): Param[] {
    const params: Param[] = [];
    if (this.at('RPAREN')) return params;
    params.push(this.parseParam(allowOutAndInOut));
    while (this.match('COMMA')) params.push(this.parseParam(allowOutAndInOut));
    return params;
  }

  private parseParam(allowOutAndInOut: boolean): Param {
    const t = this.peek();
    // <=> name  →  inout
    if (this.match('INOUT_PARAM')) {
      if (!allowOutAndInOut) throw new ParseError('Function parameters cannot be inout (<=>)', t.pos);
      const name = this.expectIdent('parameter name');
      return { mode: 'inout', name, pos: t.pos };
    }
    // [=>] name [=>]  — leading => is an explicit "in" marker; trailing => makes it "out"
    this.match('OUT_PARAM'); // consume optional leading =>
    const name = this.expectIdent('parameter name');
    if (this.match('OUT_PARAM')) {
      if (!allowOutAndInOut) throw new ParseError('Function parameters cannot be out (name =>)', t.pos);
      return { mode: 'out', name, pos: t.pos };
    }
    return { mode: 'in', name, pos: t.pos };
  }

  /** Read statements until any of the given terminator tokens (or EOF). */
  private parseStmtList(...terms: TokenKind[]): Stmt[] {
    const out: Stmt[] = [];
    this.skipSemis();
    while (!this.at(...terms, 'EOF')) {
      out.push(this.parseStatement());
      if (this.at(...terms, 'EOF')) break;
      // After a statement we expect ';' (or one of the block-end keywords).
      if (!this.match('SEMI')) {
        if (this.at(...terms, 'EOF')) break;
        const t = this.peek();
        throw new ParseError(`Expected ';' between statements, got ${t.kind}`, t.pos);
      }
      this.skipSemis();
    }
    return out;
  }

  // ---- conditional ----

  private parseIf(): Stmt {
    const start = this.eat('IF').pos;
    const cond = this.parseExpression();
    this.eat('THEN', 'ТО');
    const thenBody = this.parseStmtList('ELSE', 'ALL');
    let elseBody: Stmt[] | null = null;
    if (this.match('ELSE')) {
      elseBody = this.parseStmtList('ALL');
    }
    this.eat('ALL', 'ВСЕ to close ЕСЛИ');
    return { kind: 'If', cond, then: thenBody, else: elseBody, pos: start };
  }

  // ---- case ----

  private parseCase(): Stmt {
    const start = this.eat('CASE').pos;
    let discriminant: Expr | null = null;
    // `ВЫБОР ИЗ` (conditionless) vs. `ВЫБОР expr ИЗ` (with discriminant)
    if (!this.match('OF')) {
      const prev = this.noOfBinop;
      this.noOfBinop = true;
      try {
        discriminant = this.parseExpression();
      } finally {
        this.noOfBinop = prev;
      }
      this.eat('OF', 'ИЗ');
    }
    const whens: CaseWhen[] = [];
    // First branch has no leading '!'; subsequent ones do.
    if (!this.at('ELSE', 'ALL')) {
      whens.push(this.parseCaseBranch(discriminant !== null));
      while (this.match('BANG')) {
        whens.push(this.parseCaseBranch(discriminant !== null));
      }
    }
    let elseBody: Stmt[] | null = null;
    if (this.match('ELSE')) {
      elseBody = this.parseStmtList('ALL');
    }
    this.eat('ALL', 'ВСЕ to close ВЫБОР');
    return { kind: 'Case', discriminant, whens, else: elseBody, pos: start };
  }

  private parseCaseBranch(multiValue: boolean): CaseWhen {
    const startPos = this.peek().pos;
    const values: Expr[] = [this.parseExpression()];
    if (multiValue) {
      while (this.match('COMMA')) values.push(this.parseExpression());
    }
    this.eat('COLON', '":" after ВЫБОР branch label');
    const body = this.parseStmtList('BANG', 'ELSE', 'ALL');
    return { values, body, pos: startPos };
  }

  // ---- loops ----

  private parseLoop(): Stmt {
    const start = this.peek().pos;
    const header = this.parseLoopHeader();
    this.eat('DCOLON', '"::" to open loop body');
    const body = this.parseStmtList('ALL');
    this.eat('ALL', 'ВСЕ to close loop');
    return { kind: 'Loop', header, body, pos: start };
  }

  private parseLoopHeader(): LoopHeader {
    const t = this.peek();
    if (this.match('WHILE')) {
      const cond = this.parseExpression();
      return { kind: 'While', cond, pos: t.pos };
    }
    if (this.match('REPEAT')) {
      const count = this.parseExpression();
      this.match('TIMES'); // РАЗ / РАЗА — optional, decorative
      return { kind: 'Repeat', count, pos: t.pos };
    }
    if (this.match('FOR')) {
      const varName = this.expectIdent('loop variable');
      // ДЛЯ x ИЗ collection  vs.  ДЛЯ x ОТ a ДО b [ШАГ s]
      if (this.match('OF')) {
        const collection = this.parseExpression();
        return { kind: 'ForIn', varName, collection, pos: t.pos };
      }
      this.eat('FROM', 'ОТ or ИЗ');
      const from = this.parseExpression();
      this.eat('TO', 'ДО');
      const to = this.parseExpression();
      let step: Expr | null = null;
      if (this.match('STEP')) step = this.parseExpression();
      return { kind: 'ForRange', varName, from, to, step, pos: t.pos };
    }
    throw new ParseError(`Expected loop header (ПОКА/ПОВТОР/ДЛЯ), got ${t.kind}`, t.pos);
  }

  // ---- I/O ----

  private parseOutput(): Stmt {
    const t = this.peek();
    let suppress = false;
    let direction: OutputDirection = { kind: 'screen' };
    if (this.match('QUESTION')) {
      // ?items… — shortcut for ВЫВОД :
    } else {
      this.eat('OUT', 'ВЫВОД');
      // optional direction: НА ЭКРАН | НА БУМАГУ | В [ФАЙЛ] name
      if (this.match('TO_DIR')) { // НА
        if (this.match('SCREEN'))      direction = { kind: 'screen' };
        else if (this.match('PAPER'))  direction = { kind: 'paper' };
        else throw new ParseError('Expected ЭКРАН or БУМАГУ after НА', this.peek().pos);
      } else if (this.match('IN_DIR')) { // В
        this.match('FILE'); // optional ФАЙЛ
        direction = { kind: 'file', handle: this.normalizedIdent('file handle') };
      }
      if (this.match('NLF')) suppress = true;
      this.eat('COLON', '":" before output items');
    }
    const items: OutputItem[] = [this.parseOutputItem()];
    while (this.match('COMMA')) items.push(this.parseOutputItem());
    return { kind: 'Output', direction, suppressNewline: suppress, items, pos: t.pos };
  }

  private parseOutputItem(): OutputItem {
    const expr = this.parseExpression();
    let width: Expr | null = null, precision: Expr | null = null;
    if (this.match('COLON')) {
      width = this.parseExpression();
      if (this.match('COLON')) precision = this.parseExpression();
    }
    return { expr, width, precision };
  }

  private parseInput(): Stmt {
    const t = this.eat('IN');
    let direction: InputDirection = { kind: 'console' };
    let mode: InputMode = 'default';
    if (this.match('OF')) { // ИЗ
      if (this.match('FILE_GEN')) {
        direction = { kind: 'file', handle: this.normalizedIdent('file handle') };
      } else if (this.match('DZU')) {
        direction = { kind: 'dzu' };
      } else {
        throw new ParseError('Expected ФАЙЛА or ДЗУ after ИЗ', this.peek().pos);
      }
    }
    if (this.match('TEXTS')) mode = 'texts';
    else if (this.match('DATA')) mode = 'data';
    this.eat('COLON', '":" before input targets');
    const targets: LValue[] = [this.parseLValue()];
    while (this.match('COMMA')) targets.push(this.parseLValue());
    return { kind: 'Input', direction, mode, targets, pos: t.pos };
  }

  private parseControl(): Stmt {
    const start = this.eat('CONTROL').pos;
    const cond = this.parseExpression();
    return { kind: 'Control', cond, pos: start };
  }

  /**
   * ОТКРЫТЬ путь КАК имя       — open a file at `путь`, label as `имя`
   * (the optional-path form `ОТКРЫТЬ имя` is not supported)
   */
  private parseFileOpen(): Stmt {
    const start = this.eat('OPEN').pos;
    const path = this.parseExpression();
    this.eat('AS', 'КАК');
    const handle = this.normalizedIdent('file handle');
    return { kind: 'FileOpen', path, handle, pos: start };
  }

  /** ЗАКРЫТЬ имя */
  private parseFileClose(): Stmt {
    const start = this.eat('CLOSE').pos;
    const handle = this.normalizedIdent('file handle');
    return { kind: 'FileClose', handle, pos: start };
  }

  /** expect an identifier and return its canonical (upper-case) form. */
  private normalizedIdent(what: string): string {
    return normalize(this.expectIdent(what));
  }

  // ---- assignment / call ----

  private parseAssignOrCall(): Stmt {
    const start = this.peek().pos;
    const expr = this.parseExpression();

    // Canonical Agat:  expression -> qualified_name.
    // Our addition:    qualified_name := expression.
    // We support both by examining what follows.
    if (this.at('ASSIGN')) {
      const tok = this.advance();
      if (tok.text === ':=') {
        // LHS we just parsed is the target; RHS is the value.
        const value = this.parseExpression();
        const target = this.exprToLValue(expr);
        return { kind: 'Assign', target, value, pos: start };
      } else {
        // tok.text === '->' — LHS is value, RHS is target.
        const targetExpr = this.parseExpression();
        const target = this.exprToLValue(targetExpr);
        return { kind: 'Assign', target, value: expr, pos: start };
      }
    }

    // Otherwise: a Call at the statement level becomes a procedure-call statement.
    if (expr.kind === 'Call') {
      return { kind: 'ProcCall', callee: expr.callee, args: expr.args, pos: start };
    }
    throw new ParseError(`Statement must be an assignment or procedure call (got bare expression of kind ${expr.kind})`, expr.pos);
  }

  private exprToLValue(e: Expr): LValue {
    switch (e.kind) {
      case 'Name':  return { kind: 'Name',  segments: e.segments, pos: e.pos };
      case 'Index': return { kind: 'Index', obj: this.exprToLValue(e.obj), indices: e.indices, pos: e.pos };
      case 'Slice': return { kind: 'Slice', obj: this.exprToLValue(e.obj), from: e.from, to: e.to, pos: e.pos };
      case 'Field': return { kind: 'Field', obj: this.exprToLValue(e.obj), field: e.field, pos: e.pos };
      default:
        throw new ParseError(`Not an assignable target (got ${e.kind})`, e.pos);
    }
  }

  private parseLValue(): LValue {
    const e = this.parsePostfix(this.parseAtom());
    return this.exprToLValue(e);
  }

  // ---- expressions: precedence climb ----

  parseExpression(): Expr { return this.parseOr(); }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.at('OR')) {
      const t = this.advance();
      const right = this.parseAnd();
      left = { kind: 'BinOp', op: 'or', left, right, pos: t.pos };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.at('AND')) {
      const t = this.advance();
      const right = this.parseNot();
      left = { kind: 'BinOp', op: 'and', left, right, pos: t.pos };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.at('NOT')) {
      const t = this.advance();
      const operand = this.parseNot();
      return { kind: 'UnOp', op: 'not', operand, pos: t.pos };
    }
    return this.parseComparison();
  }

  /** Comparisons + ИЗ + ВИДА. Non-chaining: pick at most one. */
  private parseComparison(): Expr {
    const left = this.parseAdditive();
    const t = this.peek();
    const op = (() => {
      switch (t.kind) {
        case 'EQ':   return 'eq';
        case 'NEQ':  return 'neq';
        case 'LT':   return 'lt';
        // Inside a tuple literal, `>` is the closer, not a comparison.
        case 'GT':   return this.tupleDepth > 0 ? null : 'gt';
        case 'LEQ':  return 'leq';
        case 'GEQ':  return 'geq';
        case 'OF':   return this.noOfBinop ? null : 'in'; // ИЗ as binary operator
        case 'KIND': return 'kind';   // ВИДА
        default:     return null;
      }
    })();
    if (!op) return left;
    this.advance();
    const right = this.parseAdditive();
    return { kind: 'BinOp', op, left, right, pos: t.pos };
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (this.at('PLUS', 'MINUS')) {
      const t = this.advance();
      const right = this.parseMultiplicative();
      left = { kind: 'BinOp', op: t.kind === 'PLUS' ? 'add' : 'sub', left, right, pos: t.pos };
    }
    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    while (this.at('STAR', 'SLASH', 'INTDIV')) {
      const t = this.advance();
      const right = this.parseUnary();
      const op = t.kind === 'STAR' ? 'mul' : t.kind === 'SLASH' ? 'div' : 'intdiv';
      left = { kind: 'BinOp', op, left, right, pos: t.pos };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.at('MINUS')) {
      const t = this.advance();
      const operand = this.parsePower();
      return { kind: 'UnOp', op: 'neg', operand, pos: t.pos };
    }
    if (this.at('HASH')) {
      const t = this.advance();
      const operand = this.parseUnary();
      return { kind: 'UnOp', op: 'len', operand, pos: t.pos };
    }
    return this.parsePower();
  }

  private parsePower(): Expr {
    const base = this.parsePostfix(this.parseAtom());
    if (this.at('POWER')) {
      const t = this.advance();
      const right = this.parseUnary(); // right-associative
      return { kind: 'BinOp', op: 'pow', left: base, right, pos: t.pos };
    }
    return base;
  }

  /** Apply postfix operators (.field, [i,...], [a:b], (...)) to a primary. */
  private parsePostfix(expr: Expr): Expr {
    for (;;) {
      if (this.match('DOT')) {
        const field = this.expectIdent('field name');
        expr = { kind: 'Field', obj: expr, field: normalize(field), pos: expr.pos };
        continue;
      }
      if (this.match('LBRACK')) {
        expr = this.parseIndexOrSlice(expr);
        continue;
      }
      if (this.match('LPAREN')) {
        const args: Expr[] = [];
        if (!this.at('RPAREN')) {
          args.push(this.parseExpression());
          while (this.match('COMMA')) args.push(this.parseExpression());
        }
        this.eat('RPAREN');
        expr = { kind: 'Call', callee: expr, args, pos: expr.pos };
        continue;
      }
      return expr;
    }
  }

  private parseIndexOrSlice(obj: Expr): Expr {
    if (this.match('COLON')) {
      // [: to]
      let to: Expr | null = null;
      if (!this.at('RBRACK')) to = this.parseExpression();
      this.eat('RBRACK');
      return { kind: 'Slice', obj, from: null, to, pos: obj.pos };
    }
    const first = this.parseExpression();
    if (this.match('COLON')) {
      let to: Expr | null = null;
      if (!this.at('RBRACK')) to = this.parseExpression();
      this.eat('RBRACK');
      return { kind: 'Slice', obj, from: first, to, pos: obj.pos };
    }
    const indices: Expr[] = [first];
    while (this.match('COMMA')) indices.push(this.parseExpression());
    this.eat('RBRACK');
    return { kind: 'Index', obj, indices, pos: obj.pos };
  }

  // ---- atoms ----

  private parseAtom(): Expr {
    const t = this.peek();
    switch (t.kind) {
      case 'INT':  this.advance(); return { kind: 'IntLit',  value: t.value as number, pos: t.pos };
      case 'REAL': this.advance(); return { kind: 'RealLit', value: t.value as number, pos: t.pos };
      case 'TEXT': this.advance(); return { kind: 'TextLit', value: t.value as string, pos: t.pos };
      case 'LPAREN': {
        this.advance();
        const e = this.parseExpression();
        this.eat('RPAREN');
        return e;
      }
      case 'LT':   return this.parseTupleLit();
      case 'GT':
        // A bare `>` here can only mean an empty closing — flag clearly.
        break;
      case 'LSET': return this.parseSetLit();
      case 'LREC': return this.parseRecordLit();
      case 'DOT':  return this.parseDotName();      // .пусто and similar reserved-name forms
      case 'IDENT': return this.parseCompoundName();
    }
    // Per the Agat spec, words are distinguished from keywords contextually.
    // In operand position, any identifier-shaped token (including ones the
    // lexer happened to recognise as a keyword, like `И` / `ИЗ`) refers to a name.
    if (isWordToken(t)) return this.parseCompoundName();
    throw new ParseError(`Unexpected token in expression: ${t.kind} (${JSON.stringify(t.text)})`, t.pos);
  }

  /** `< … >` tuple literal, including empty `<>`. */
  private parseTupleLit(): Expr {
    const start = this.eat('LT').pos;
    const items: Expr[] = [];
    if (!this.match('GT')) {
      this.tupleDepth++;
      try {
        items.push(this.parseExpression());
        while (this.match('COMMA')) items.push(this.parseExpression());
      } finally {
        this.tupleDepth--;
      }
      this.eat('GT', '">" to close tuple literal');
    }
    return { kind: 'TupleLit', items, pos: start };
  }

  private parseSetLit(): Expr {
    const start = this.eat('LSET').pos;
    const items: Expr[] = [];
    if (!this.match('RSET')) {
      items.push(this.parseExpression());
      while (this.match('COMMA')) items.push(this.parseExpression());
      this.eat('RSET', '"*>" to close set literal');
    }
    return { kind: 'SetLit', items, pos: start };
  }

  private parseRecordLit(): Expr {
    const start = this.eat('LREC').pos;
    const fields: { name: string; value: Expr }[] = [];
    if (!this.at('RREC')) {
      fields.push(this.parseRecordField());
      while (this.match('COMMA')) fields.push(this.parseRecordField());
    }
    this.eat('RREC', '"¤>" to close record literal');
    return { kind: 'RecordLit', fields, pos: start };
  }

  private parseRecordField(): { name: string; value: Expr } {
    const name = normalize(this.expectIdent('record field name'));
    this.eat('COLON');
    const value = this.parseExpression();
    return { name, value };
  }

  private parseDotName(): Expr {
    const start = this.eat('DOT').pos;
    const name = this.expectIdent('reserved name (e.g. .пусто)');
    if (normalize(name) === 'ПУСТО') return { kind: 'EmptyLit', pos: start };
    throw new ParseError(`Unknown reserved name: .${name}`, start);
  }

  /** identifier ('identifier)*  — compound name. */
  private parseCompoundName(): Expr {
    const t = this.peek();
    if (!isWordToken(t)) {
      throw new ParseError(`Expected name, got ${t.kind} (${JSON.stringify(t.text)})`, t.pos);
    }
    this.advance();
    const segments: string[] = [normalize(t.text)];
    while (this.at('APOS')) {
      this.advance();
      segments.push(normalize(this.expectIdent('compound-name segment')));
    }
    return { kind: 'Name', segments, pos: t.pos };
  }

  /** Accept either an IDENT or any identifier-shaped keyword token. */
  private expectIdent(what: string): string {
    const t = this.peek();
    if (!isWordToken(t)) {
      throw new ParseError(`Expected ${what}, got ${t.kind} (${JSON.stringify(t.text)})`, t.pos);
    }
    this.advance();
    return t.text;
  }
}
