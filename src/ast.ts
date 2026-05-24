import type { Pos } from './errors.ts';

export type BinOp =
  | 'or' | 'and'
  | 'eq' | 'neq' | 'lt' | 'gt' | 'leq' | 'geq'
  | 'in'         // ИЗ — membership
  | 'kind'       // ВИДА — structural type check
  | 'add' | 'sub' | 'mul' | 'div' | 'intdiv' | 'pow';

export type UnOp = 'neg' | 'not' | 'len';

export type Expr =
  | { kind: 'IntLit';   value: number; pos: Pos }
  | { kind: 'RealLit';  value: number; pos: Pos }
  | { kind: 'TextLit';  value: string; pos: Pos }
  | { kind: 'EmptyLit'; pos: Pos }                                              // .пусто
  | { kind: 'Name';     segments: string[]; pos: Pos }                          // simple or compound (a'b'c)
  | { kind: 'TupleLit'; items: Expr[]; pos: Pos }                               // <a, b, c>
  | { kind: 'SetLit';   items: Expr[]; pos: Pos }                               // <* a, b, c *>
  | { kind: 'RecordLit'; fields: { name: string; value: Expr }[]; pos: Pos }    // <¤ name: v, ... ¤>
  | { kind: 'Index';    obj: Expr; indices: Expr[]; pos: Pos }                  // x[i, j, ...]
  | { kind: 'Slice';    obj: Expr; from: Expr | null; to: Expr | null; pos: Pos }
  | { kind: 'Field';    obj: Expr; field: string; pos: Pos }                    // x.field
  | { kind: 'Call';     callee: Expr; args: Expr[]; pos: Pos }                  // x(a, b, ...)
  | { kind: 'UnOp';     op: UnOp; operand: Expr; pos: Pos }
  | { kind: 'BinOp';    op: BinOp; left: Expr; right: Expr; pos: Pos };

/** LValue = subset of Expr usable as assignment target / inout slot. */
export type LValue =
  | { kind: 'Name';  segments: string[]; pos: Pos }
  | { kind: 'Index'; obj: LValue; indices: Expr[]; pos: Pos }
  | { kind: 'Slice'; obj: LValue; from: Expr | null; to: Expr | null; pos: Pos }
  | { kind: 'Field'; obj: LValue; field: string; pos: Pos };

export type ParamMode = 'in' | 'out' | 'inout';
export interface Param { mode: ParamMode; name: string; pos: Pos }

export type LoopHeader =
  | { kind: 'While';    cond: Expr;                                                                 pos: Pos }
  | { kind: 'Repeat';   count: Expr;                                                                pos: Pos }
  | { kind: 'ForRange'; varName: string; from: Expr; to: Expr; step: Expr | null;                   pos: Pos }
  | { kind: 'ForIn';    varName: string; collection: Expr;                                          pos: Pos };

export interface OutputItem { expr: Expr; width: Expr | null; precision: Expr | null }
export type OutputDirection =
  | { kind: 'screen' }
  | { kind: 'paper' }
  | { kind: 'file'; handle: string };
export type InputDirection =
  | { kind: 'console' }
  | { kind: 'file'; handle: string }
  | { kind: 'dzu' };
export type InputMode = 'default' | 'texts' | 'data';

export interface CaseWhen { values: Expr[]; body: Stmt[]; pos: Pos }

export interface ProcDef {
  kind: 'ProcDef';
  name: string;
  params: Param[];
  locals: string[];
  body: Stmt[];
  pos: Pos;
}

export interface FuncDef {
  kind: 'FuncDef';
  name: string;
  params: Param[];   // all 'in' mode (enforced by parser)
  locals: string[];
  body: Stmt[];
  result: Expr;      // trailing РЕЗ: expression
  pos: Pos;
}

export type Stmt =
  | { kind: 'Assign'; target: LValue; value: Expr; pos: Pos }
  | { kind: 'ProcCall'; callee: Expr; args: Expr[]; pos: Pos }
  | { kind: 'If';     cond: Expr; then: Stmt[]; else: Stmt[] | null; pos: Pos }
  | { kind: 'Case';   discriminant: Expr | null; whens: CaseWhen[]; else: Stmt[] | null; pos: Pos }
  | { kind: 'Loop';   header: LoopHeader; body: Stmt[]; pos: Pos }
  | { kind: 'Output'; direction: OutputDirection; suppressNewline: boolean; items: OutputItem[]; pos: Pos }
  | { kind: 'Input';  direction: InputDirection; mode: InputMode; targets: LValue[]; pos: Pos }
  | { kind: 'Control'; cond: Expr; pos: Pos }
  | { kind: 'Stop';   pos: Pos }
  | { kind: 'Exit';   pos: Pos }
  | { kind: 'Run';    pos: Pos }   // ПУСК
  | { kind: 'Empty';  pos: Pos }
  | { kind: 'FileOpen';  path: Expr; handle: string; pos: Pos }
  | { kind: 'FileClose'; handle: string; pos: Pos }
  | ProcDef
  | FuncDef;

export interface Program { body: Stmt[] }
