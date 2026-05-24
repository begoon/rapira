import type {
  Expr, Stmt, Program, LValue, Param,
  ProcDef, FuncDef, LoopHeader,
} from './ast.ts';
import { Env } from './environment.ts';
import {
  EMPTY, YES, NO,
  rInt, rReal, rText, rLog, rTuple, rSet,
  type RValue, type NativeFn,
  equals, compareNumeric, isMember, len, isTruthy,
  display, displayFormatted, typeName, numericResult,
  indexValue, sliceValue, withIndexAssigned, withSliceAssigned, withFieldAssigned,
} from './values.ts';
import { RuntimeError, type Pos } from './errors.ts';
import { type GraphicsSink, NullSink, BufferingSink } from './graphics.ts';
import { registerGraphics } from './stdlib/gfx.ts';

// ---- Host interface ----

export interface Host {
  /** Write text to the output stream (no implicit newline). */
  write(s: string): void;
  /** Write the platform line separator. */
  writeln(): void;
  /** Read one line of input (without the trailing newline). */
  readLine(): string;
  /** Graphics sink; defaults to a no-op for hosts without graphics. */
  gfx?: GraphicsSink;
}

export class BufferedHost implements Host {
  out = '';
  inputLines: string[] = [];
  gfx: BufferingSink = new BufferingSink();
  write(s: string): void { this.out += s; }
  writeln(): void { this.out += '\n'; }
  readLine(): string { return this.inputLines.shift() ?? ''; }
}

// ---- Control-flow signals (thrown / caught) ----

class LoopExitSignal {}
class ExitSignal {}                                          // ВЫХОД at top level

const LOOP_EXIT = new LoopExitSignal();
const EXIT      = new ExitSignal();

// ---- Native built-ins ----

function defineNativeFns(env: Env): void {
  const define = (name: string, arity: number | null, fn: NativeFn): void => {
    env.declare(name, { kind: 'native', name, arity, fn });
  };

  const numUnary = (name: string, op: (x: number) => number) =>
    define(name, 1, ([a]) => {
      const x = a!;
      if (x.kind !== 'int' && x.kind !== 'real') {
        throw new RuntimeError(`${name} ожидает число (got ${typeName(x)})`);
      }
      return rReal(op(x.value));
    });

  // §Appendix 3, plus a few common-sense aliases.
  define('АБС', 1, ([a]) => {
    const x = a!;
    if (x.kind === 'int')  return rInt(Math.abs(x.value));
    if (x.kind === 'real') return rReal(Math.abs(x.value));
    throw new RuntimeError(`АБС ожидает число (got ${typeName(x)})`);
  });
  define('ЦЕЛЧ', 1, ([a]) => {
    const x = a!;
    if (x.kind === 'int')  return x;
    if (x.kind === 'real') return rInt(Math.trunc(x.value));
    throw new RuntimeError(`ЦЕЛЧ ожидает число (got ${typeName(x)})`);
  });
  numUnary('SQRT', Math.sqrt);
  numUnary('КОР', Math.sqrt);
  numUnary('SIN', Math.sin);
  numUnary('COS', Math.cos);
  numUnary('LN',  Math.log);

  define('ДСЧ', 0, () => rReal(Math.random()));

  define('КОД', 1, ([a]) => {
    const x = a!;
    if (x.kind !== 'text' || x.value.length !== 1) {
      throw new RuntimeError('КОД ожидает текст из одной литеры');
    }
    return rInt(x.value.codePointAt(0)!);
  });
  define('АЛФ', 1, ([a]) => {
    const x = a!;
    if (x.kind !== 'int') throw new RuntimeError('АЛФ ожидает целое');
    return rText(String.fromCodePoint(x.value));
  });

  define('ФТЕКСТ', 2, ([a, b]) => {
    const n = a!, ch = b!;
    if (n.kind !== 'int' || ch.kind !== 'text' || ch.value.length !== 1) {
      throw new RuntimeError('ФТЕКСТ(длина, литера)');
    }
    return rText(ch.value.repeat(Math.max(0, n.value)));
  });
  define('ФКОРТ', 2, ([a, b]) => {
    const n = a!, el = b!;
    if (n.kind !== 'int') throw new RuntimeError('ФКОРТ(длина, элемент)');
    return rTuple(Array.from({ length: Math.max(0, n.value) }, () => el));
  });

  define('ВИД', 1, ([a]) => rText(typeName(a!)));
}

// ---- Interpreter ----

export class Interpreter {
  /** Top-level env: holds proc/func defs and top-level variable bindings. */
  readonly global = new Env(null);

  constructor(private readonly host: Host) {
    defineNativeFns(this.global);
    registerGraphics(this.global, host.gfx ?? new NullSink());
  }

  run(program: Program): void {
    // First pass: register all proc/func defs in the global env so they can
    // be called from anywhere in the program regardless of source order.
    for (const s of program.body) {
      if (s.kind === 'ProcDef') this.global.declare(s.name, { kind: 'proc', def: s as ProcDef });
      else if (s.kind === 'FuncDef') this.global.declare(s.name, { kind: 'func', def: s as FuncDef });
    }
    // Second pass: execute top-level statements (skip definitions).
    try {
      for (const s of program.body) {
        if (s.kind === 'ProcDef' || s.kind === 'FuncDef') continue;
        this.evalStmt(s, this.global);
      }
    } catch (e) {
      if (e === EXIT) return;
      throw e;
    }
  }

  // -------- statements --------

  private evalStmt(s: Stmt, env: Env): void {
    switch (s.kind) {
      case 'Empty': return;
      case 'Stop':  this.host.write('СТОП\n'); return;       // debugger no-op
      case 'Run':   return;                                  // ПУСК is a debugger command
      case 'Exit':  throw EXIT;
      case 'Assign':
        this.evalAssign(s.target, this.evalExpr(s.value, env), env, s.pos);
        return;
      case 'ProcCall':
        this.callProcStatement(s.callee, s.args, env, s.pos);
        return;
      case 'If': {
        if (isTruthy(this.evalExpr(s.cond, env))) {
          for (const st of s.then) this.evalStmt(st, env);
        } else if (s.else) {
          for (const st of s.else) this.evalStmt(st, env);
        }
        return;
      }
      case 'Case': {
        if (s.discriminant) {
          const d = this.evalExpr(s.discriminant, env);
          for (const w of s.whens) {
            if (w.values.some((v) => equals(d, this.evalExpr(v, env)))) {
              for (const st of w.body) this.evalStmt(st, env);
              return;
            }
          }
        } else {
          for (const w of s.whens) {
            if (isTruthy(this.evalExpr(w.values[0]!, env))) {
              for (const st of w.body) this.evalStmt(st, env);
              return;
            }
          }
        }
        if (s.else) for (const st of s.else) this.evalStmt(st, env);
        return;
      }
      case 'Loop':   return this.evalLoop(s.header, s.body, env);
      case 'Output': return this.evalOutput(s, env);
      case 'Input':  return this.evalInput(s, env);
      case 'Control': {
        const v = this.evalExpr(s.cond, env);
        if (!isTruthy(v)) {
          this.host.write('СРАБОТАЛ КОНТРОЛЬ\n');
          throw new RuntimeError('КОНТРОЛЬ нарушен', s.pos);
        }
        return;
      }
      case 'ProcDef': case 'FuncDef':
        // Local procedure/function definitions: register in the current env.
        // (Top-level ones are already registered by the pre-pass.)
        if (env !== this.global) {
          const v: RValue = s.kind === 'ProcDef'
            ? { kind: 'proc', def: s as ProcDef }
            : { kind: 'func', def: s as FuncDef };
          env.declare(s.name, v);
        }
        return;
    }
  }

  private evalLoop(header: LoopHeader, body: Stmt[], env: Env): void {
    const runBody = (): boolean => {
      try {
        for (const st of body) this.evalStmt(st, env);
        return true;
      } catch (e) {
        if (e === LOOP_EXIT) return false;
        throw e;
      }
    };
    switch (header.kind) {
      case 'While': {
        while (isTruthy(this.evalExpr(header.cond, env))) if (!runBody()) return;
        return;
      }
      case 'Repeat': {
        const n = this.evalExpr(header.count, env);
        if (n.kind !== 'int') throw new RuntimeError('ПОВТОР ожидает целое', header.pos);
        for (let i = 0; i < n.value; i++) if (!runBody()) return;
        return;
      }
      case 'ForRange': {
        const from = this.evalExpr(header.from, env);
        const to = this.evalExpr(header.to, env);
        const step = header.step ? this.evalExpr(header.step, env) : rInt(1);
        if (from.kind !== 'int' || to.kind !== 'int' || step.kind !== 'int') {
          throw new RuntimeError('ДЛЯ … ОТ … ДО … [ШАГ …] ожидает целые', header.pos);
        }
        const stepN = step.value;
        if (stepN === 0) throw new RuntimeError('ШАГ не может быть 0', header.pos);
        for (
          let i = from.value;
          stepN > 0 ? i <= to.value : i >= to.value;
          i += stepN
        ) {
          env.set(header.varName, rInt(i));
          if (!runBody()) return;
        }
        return;
      }
      case 'ForIn': {
        const coll = this.evalExpr(header.collection, env);
        const items: RValue[] =
          coll.kind === 'tuple' || coll.kind === 'set' ? coll.items :
          coll.kind === 'text' ? Array.from(coll.value).map(rText) :
          (() => { throw new RuntimeError(`ДЛЯ … ИЗ ожидает кортеж/множество/текст (got ${typeName(coll)})`, header.pos); })();
        for (const v of items) {
          env.set(header.varName, v);
          if (!runBody()) return;
        }
        return;
      }
    }
  }

  private evalOutput(s: Stmt & { kind: 'Output' }, env: Env): void {
    const parts: string[] = [];
    for (const it of s.items) {
      const v = this.evalExpr(it.expr, env);
      const w = it.width ? this.toIntOrNull(this.evalExpr(it.width, env)) : null;
      const p = it.precision ? this.toIntOrNull(this.evalExpr(it.precision, env)) : null;
      parts.push(displayFormatted(v, w, p));
    }
    this.host.write(parts.join(''));
    if (!s.suppressNewline) this.host.writeln();
  }

  private evalInput(s: Stmt & { kind: 'Input' }, env: Env): void {
    // Simple line-based reader for MVP. `ВВОД ТЕКСТОВ:` reads whole lines into
    // each target. Default and `ВВОД ДАННЫХ:` read whitespace-separated tokens
    // and try to parse as numbers, else fall back to text.
    if (s.mode === 'texts') {
      for (const t of s.targets) this.evalAssign(t, rText(this.host.readLine()), env, s.pos);
      return;
    }
    let tokens: string[] = [];
    const nextToken = (): string => {
      while (tokens.length === 0) tokens = this.host.readLine().split(/\s+/).filter(Boolean);
      return tokens.shift()!;
    };
    for (const t of s.targets) {
      const tok = nextToken();
      let v: RValue;
      if (/^-?\d+$/.test(tok))                  v = rInt(parseInt(tok, 10));
      else if (/^-?\d+(\.\d+)?([eEЕе][+-]?\d+)?$/.test(tok)) {
        v = rReal(parseFloat(tok.replace(/[Ее]/g, 'e')));
      } else                                    v = rText(tok);
      this.evalAssign(t, v, env, s.pos);
    }
  }

  private toIntOrNull(v: RValue): number | null {
    if (v.kind === 'int')  return v.value;
    if (v.kind === 'real') return Math.trunc(v.value);
    return null;
  }

  // -------- assignment to LValue --------

  private evalAssign(target: LValue, value: RValue, env: Env, pos: Pos): void {
    switch (target.kind) {
      case 'Name': {
        if (target.segments.length !== 1) {
          throw new RuntimeError(`Составные имена пока не поддерживаются в присваивании: ${target.segments.join("'")}`, pos);
        }
        env.set(target.segments[0]!, value);
        return;
      }
      case 'Index': {
        const cur = this.lvalueRead(target.obj, env);
        const idxs = target.indices.map((e) => this.evalExpr(e, env));
        this.lvalueWrite(target.obj, withIndexAssigned(cur, idxs, value), env, pos);
        return;
      }
      case 'Slice': {
        const cur = this.lvalueRead(target.obj, env);
        const a = target.from ? this.toIntOrNull(this.evalExpr(target.from, env)) : null;
        const b = target.to   ? this.toIntOrNull(this.evalExpr(target.to,   env)) : null;
        this.lvalueWrite(target.obj, withSliceAssigned(cur, a, b, value), env, pos);
        return;
      }
      case 'Field': {
        const cur = this.lvalueRead(target.obj, env);
        this.lvalueWrite(target.obj, withFieldAssigned(cur, target.field, value), env, pos);
        return;
      }
    }
  }

  private lvalueRead(target: LValue, env: Env): RValue {
    switch (target.kind) {
      case 'Name':  return env.get(target.segments[0]!);
      case 'Index': {
        const obj = this.lvalueRead(target.obj, env);
        return indexValue(obj, target.indices.map((e) => this.evalExpr(e, env)));
      }
      case 'Slice': {
        const obj = this.lvalueRead(target.obj, env);
        const a = target.from ? this.toIntOrNull(this.evalExpr(target.from, env)) : null;
        const b = target.to   ? this.toIntOrNull(this.evalExpr(target.to,   env)) : null;
        return sliceValue(obj, a, b);
      }
      case 'Field': {
        const obj = this.lvalueRead(target.obj, env);
        if (obj.kind !== 'record') {
          throw new RuntimeError(`.${target.field} требует запись (got ${typeName(obj)})`);
        }
        return obj.fields.get(target.field) ?? EMPTY;
      }
    }
  }

  private lvalueWrite(target: LValue, value: RValue, env: Env, pos: Pos): void {
    // Same shape as evalAssign but for nested writes after rewrap.
    this.evalAssign(target, value, env, pos);
  }

  // -------- expressions --------

  private evalExpr(e: Expr, env: Env): RValue {
    switch (e.kind) {
      case 'IntLit':   return rInt(e.value);
      case 'RealLit':  return rReal(e.value);
      case 'TextLit':  return rText(e.value);
      case 'EmptyLit': return EMPTY;
      case 'TupleLit': return rTuple(e.items.map((x) => this.evalExpr(x, env)));
      case 'SetLit':   return rSet(e.items.map((x) => this.evalExpr(x, env)));
      case 'RecordLit': {
        const m = new Map<string, RValue>();
        for (const f of e.fields) m.set(f.name, this.evalExpr(f.value, env));
        return { kind: 'record', fields: m };
      }
      case 'Name':
        if (e.segments.length !== 1) {
          throw new RuntimeError(`Составные имена пока не поддерживаются: ${e.segments.join("'")}`, e.pos);
        }
        return env.get(e.segments[0]!);
      case 'UnOp':  return this.evalUnary(e.op, this.evalExpr(e.operand, env), e.pos);
      case 'BinOp': return this.evalBinary(e.op, e.left, e.right, env, e.pos);
      case 'Index': {
        const obj = this.evalExpr(e.obj, env);
        const idxs = e.indices.map((x) => this.evalExpr(x, env));
        return indexValue(obj, idxs);
      }
      case 'Slice': {
        const obj = this.evalExpr(e.obj, env);
        const a = e.from ? this.toIntOrNull(this.evalExpr(e.from, env)) : null;
        const b = e.to   ? this.toIntOrNull(this.evalExpr(e.to,   env)) : null;
        return sliceValue(obj, a, b);
      }
      case 'Field': {
        const obj = this.evalExpr(e.obj, env);
        if (obj.kind !== 'record') {
          throw new RuntimeError(`.${e.field} требует запись (got ${typeName(obj)})`, e.pos);
        }
        const v = obj.fields.get(e.field);
        return v ?? EMPTY;
      }
      case 'Call': return this.callExpr(e.callee, e.args, env, e.pos);
    }
  }

  private evalUnary(op: 'neg' | 'not' | 'len', v: RValue, pos: Pos): RValue {
    switch (op) {
      case 'neg':
        if (v.kind === 'int')  return rInt(-v.value);
        if (v.kind === 'real') return rReal(-v.value);
        throw new RuntimeError(`Унарный минус ожидает число (got ${typeName(v)})`, pos);
      case 'not':
        if (v.kind === 'logical') return rLog(!v.value);
        throw new RuntimeError(`НЕ ожидает логическое (got ${typeName(v)})`, pos);
      case 'len': return rInt(len(v));
    }
  }

  private evalBinary(op: import('./ast.ts').BinOp, lE: Expr, rE: Expr, env: Env, pos: Pos): RValue {
    // Short-circuit for И / ИЛИ.
    if (op === 'and') {
      const l = this.evalExpr(lE, env);
      if (!isTruthy(l)) return NO;
      return rLog(isTruthy(this.evalExpr(rE, env)));
    }
    if (op === 'or') {
      const l = this.evalExpr(lE, env);
      if (isTruthy(l)) return YES;
      return rLog(isTruthy(this.evalExpr(rE, env)));
    }
    const l = this.evalExpr(lE, env);
    const r = this.evalExpr(rE, env);
    switch (op) {
      case 'eq':  return rLog( equals(l, r));
      case 'neq': return rLog(!equals(l, r));
      case 'lt':  return rLog(compareNumeric(l, r) < 0);
      case 'gt':  return rLog(compareNumeric(l, r) > 0);
      case 'leq': return rLog(compareNumeric(l, r) <= 0);
      case 'geq': return rLog(compareNumeric(l, r) >= 0);
      case 'in':   return rLog(isMember(l, r));
      case 'kind': return rLog(typeName(l) === typeName(r));
      case 'add': return this.addOp(l, r, pos);
      case 'sub': return this.subOp(l, r, pos);
      case 'mul': return this.mulOp(l, r, pos);
      case 'div': return numericResult(l, r, (a, b) => a / b, false);
      case 'intdiv': {
        if (l.kind !== 'int' || r.kind !== 'int') {
          throw new RuntimeError('// ожидает целые', pos);
        }
        if (r.value === 0) throw new RuntimeError('Деление на 0', pos);
        return rInt(Math.trunc(l.value / r.value));
      }
      case 'pow': return numericResult(l, r, Math.pow, true);
    }
  }

  private addOp(l: RValue, r: RValue, pos: Pos): RValue {
    if ((l.kind === 'int' || l.kind === 'real') && (r.kind === 'int' || r.kind === 'real')) {
      return numericResult(l, r, (a, b) => a + b, true);
    }
    if (l.kind === 'text' && r.kind === 'text') return rText(l.value + r.value);
    if (l.kind === 'tuple' && r.kind === 'tuple') return rTuple([...l.items, ...r.items]);
    if (l.kind === 'set' && r.kind === 'set')     return rSet([...l.items, ...r.items]);
    throw new RuntimeError(`+ не определён для ${typeName(l)} и ${typeName(r)}`, pos);
  }

  private subOp(l: RValue, r: RValue, pos: Pos): RValue {
    if ((l.kind === 'int' || l.kind === 'real') && (r.kind === 'int' || r.kind === 'real')) {
      return numericResult(l, r, (a, b) => a - b, true);
    }
    if (l.kind === 'set' && r.kind === 'set') {
      return rSet(l.items.filter((x) => !r.items.some((y) => equals(x, y))));
    }
    throw new RuntimeError(`- не определён для ${typeName(l)} и ${typeName(r)}`, pos);
  }

  private mulOp(l: RValue, r: RValue, pos: Pos): RValue {
    if ((l.kind === 'int' || l.kind === 'real') && (r.kind === 'int' || r.kind === 'real')) {
      return numericResult(l, r, (a, b) => a * b, true);
    }
    if (l.kind === 'set' && r.kind === 'set') {
      return rSet(l.items.filter((x) => r.items.some((y) => equals(x, y))));
    }
    throw new RuntimeError(`* не определён для ${typeName(l)} и ${typeName(r)}`, pos);
  }

  // -------- calls --------

  private callExpr(calleeE: Expr, argsE: Expr[], env: Env, pos: Pos): RValue {
    const callee = this.evalExpr(calleeE, env);
    if (callee.kind === 'native') {
      const args = argsE.map((a) => this.evalExpr(a, env));
      if (callee.arity !== null && args.length !== callee.arity) {
        throw new RuntimeError(`${callee.name} ожидает ${callee.arity} арг., получено ${args.length}`, pos);
      }
      return callee.fn(args);
    }
    if (callee.kind === 'func') {
      const args = argsE.map((a) => this.evalExpr(a, env));
      return this.runFunc(callee.def, args, pos);
    }
    if (callee.kind === 'proc') {
      throw new RuntimeError(`Процедура «${callee.def.name}» вызвана как функция`, pos);
    }
    throw new RuntimeError(`Не вызываемо: ${typeName(callee)}`, pos);
  }

  private callProcStatement(calleeE: Expr, argsE: Expr[], env: Env, pos: Pos): void {
    const callee = this.evalExpr(calleeE, env);
    if (callee.kind === 'native') {
      const args = argsE.map((a) => this.evalExpr(a, env));
      if (callee.arity !== null && args.length !== callee.arity) {
        throw new RuntimeError(`${callee.name} ожидает ${callee.arity} арг., получено ${args.length}`, pos);
      }
      callee.fn(args);                                       // ignore return
      return;
    }
    if (callee.kind === 'proc') {
      this.runProc(callee.def, argsE, env, pos);
      return;
    }
    if (callee.kind === 'func') {
      // Calling a func as a statement: legal, result discarded.
      const args = argsE.map((a) => this.evalExpr(a, env));
      this.runFunc(callee.def, args, pos);
      return;
    }
    throw new RuntimeError(`Не вызываемо: ${typeName(callee)}`, pos);
  }

  private runFunc(def: FuncDef, args: RValue[], pos: Pos): RValue {
    if (args.length !== def.params.length) {
      throw new RuntimeError(`${def.name}: ожидалось ${def.params.length} арг., получено ${args.length}`, pos);
    }
    const local = new Env(this.global);
    def.params.forEach((p, i) => local.declare(p.name, args[i]!));
    for (const n of def.locals) local.declare(n, EMPTY);
    for (const s of def.body) this.evalStmt(s, local);
    return this.evalExpr(def.result, local);
  }

  private runProc(def: ProcDef, argsE: Expr[], callerEnv: Env, pos: Pos): void {
    if (argsE.length !== def.params.length) {
      throw new RuntimeError(`${def.name}: ожидалось ${def.params.length} арг., получено ${argsE.length}`, pos);
    }
    const local = new Env(this.global);
    // Bind each parameter according to its mode.
    const inoutBindings: { param: Param; argExpr: Expr }[] = [];
    def.params.forEach((p, i) => {
      const argExpr = argsE[i]!;
      if (p.mode === 'in') {
        local.declare(p.name, this.evalExpr(argExpr, callerEnv));
      } else if (p.mode === 'out') {
        local.declare(p.name, EMPTY);
        inoutBindings.push({ param: p, argExpr });
      } else { // inout
        const lv = this.exprToLValue(argExpr, p.pos);
        const initial = this.lvalueRead(lv, callerEnv);
        local.declare(p.name, initial);
        inoutBindings.push({ param: p, argExpr });
      }
    });
    for (const n of def.locals) local.declare(n, EMPTY);

    for (const s of def.body) this.evalStmt(s, local);

    // Write back out / inout parameters to caller-side lvalues.
    for (const { param, argExpr } of inoutBindings) {
      const lv = this.exprToLValue(argExpr, param.pos);
      this.evalAssign(lv, local.get(param.name), callerEnv, param.pos);
    }
  }

  private exprToLValue(e: Expr, pos: Pos): LValue {
    switch (e.kind) {
      case 'Name':  return { kind: 'Name',  segments: e.segments, pos: e.pos };
      case 'Index': return { kind: 'Index', obj: this.exprToLValue(e.obj, pos), indices: e.indices, pos: e.pos };
      case 'Slice': return { kind: 'Slice', obj: this.exprToLValue(e.obj, pos), from: e.from, to: e.to, pos: e.pos };
      case 'Field': return { kind: 'Field', obj: this.exprToLValue(e.obj, pos), field: e.field, pos: e.pos };
      default: throw new RuntimeError(`Аргумент для out/inout параметра должен быть присваиваемым (got ${e.kind})`, pos);
    }
  }
}

// ---- convenience runner ----

import { tokenize } from './lexer.ts';
import { parse } from './parser.ts';

export interface RunResult { out: string; gfx: import('./graphics.ts').GfxEvent[] }

export function run(src: string, input: string[] = []): RunResult {
  const host = new BufferedHost();
  host.inputLines = input.slice();
  const interp = new Interpreter(host);
  interp.run(parse(tokenize(src)));
  return { out: host.out, gfx: host.gfx.events };
}

/** Top-level VS code-style API: run a program with a callback host (for CLI/web). */
export function runWith(src: string, host: Host): void {
  const interp = new Interpreter(host);
  interp.run(parse(tokenize(src)));
}

// `LOOP_EXIT` is currently unused publicly; reserved for future ВЫХОД-as-break semantics.
// Per spec §27 ВЫХОД at top-level aborts; inside loops we keep it as abort too (simpler &
// matches the debug-context wording). If a `прервать` keyword is later added, route it here.
export { LOOP_EXIT as LoopExit };
