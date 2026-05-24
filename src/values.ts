import type { ProcDef, FuncDef } from './ast.ts';

export type RValue =
  | { kind: 'int';     value: number }
  | { kind: 'real';    value: number }
  | { kind: 'logical'; value: boolean }
  | { kind: 'text';    value: string }
  | { kind: 'tuple';   items: RValue[] }
  | { kind: 'set';     items: RValue[] }                  // canonical-form deduped
  | { kind: 'record';  fields: ReadonlyMap<string, RValue> }
  | { kind: 'empty' }
  | { kind: 'proc';    def: ProcDef }
  | { kind: 'func';    def: FuncDef }
  | { kind: 'native';  name: string; arity: number | null; fn: NativeFn };

export type NativeFn = (args: RValue[]) => RValue;

export const EMPTY: RValue = { kind: 'empty' };
export const YES:   RValue = { kind: 'logical', value: true };
export const NO:    RValue = { kind: 'logical', value: false };

export const rInt  = (n: number): RValue => ({ kind: 'int',  value: n | 0 });
export const rReal = (n: number): RValue => ({ kind: 'real', value: n });
export const rText = (s: string): RValue => ({ kind: 'text', value: s });
export const rLog  = (b: boolean): RValue => (b ? YES : NO);
export const rTuple = (xs: RValue[]): RValue => ({ kind: 'tuple', items: xs });
export const rSet   = (xs: RValue[]): RValue => ({ kind: 'set',   items: dedupe(xs) });

export function typeName(v: RValue): string {
  switch (v.kind) {
    case 'int':     return 'целое';
    case 'real':    return 'дробное';
    case 'logical': return 'логич';
    case 'text':    return 'текст';
    case 'tuple':   return 'кортеж';
    case 'set':     return 'множ';
    case 'record':  return 'запись';
    case 'empty':   return 'пусто';
    case 'proc':    return 'процедура';
    case 'func':    return 'функция';
    case 'native':  return 'функция';
  }
}

/** Deep universal equality (`=` operator). */
export function equals(a: RValue, b: RValue): boolean {
  if (a === b) return true;
  // numeric coercion between int and real
  if ((a.kind === 'int' || a.kind === 'real') && (b.kind === 'int' || b.kind === 'real')) {
    return a.value === b.value;
  }
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'logical': return a.value === (b as typeof a).value;
    case 'text':    return a.value === (b as typeof a).value;
    case 'tuple': {
      const ai = a.items, bi = (b as typeof a).items;
      if (ai.length !== bi.length) return false;
      return ai.every((x, i) => equals(x, bi[i]!));
    }
    case 'set': {
      const ai = a.items, bi = (b as typeof a).items;
      if (ai.length !== bi.length) return false;
      return ai.every((x) => bi.some((y) => equals(x, y)));
    }
    case 'record': {
      const af = a.fields, bf = (b as typeof a).fields;
      if (af.size !== bf.size) return false;
      for (const [k, v] of af) {
        const bv = bf.get(k);
        if (bv === undefined || !equals(v, bv)) return false;
      }
      return true;
    }
    case 'empty':   return true;
    case 'proc':    return a.def === (b as typeof a).def;
    case 'func':    return a.def === (b as typeof a).def;
    case 'native':  return a.fn  === (b as typeof a).fn;
    default:        return false;
  }
}

/** Comparison for the `<`, `>`, `<=`, `>=` operators (numbers only per spec §2.5). */
export function compareNumeric(a: RValue, b: RValue): number {
  if ((a.kind !== 'int' && a.kind !== 'real') || (b.kind !== 'int' && b.kind !== 'real')) {
    throw new Error(`Сравнения <, > определены только для чисел (got ${typeName(a)} и ${typeName(b)})`);
  }
  return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
}

/** Returns true for ИЗ (membership): char in text, element in tuple/set. */
export function isMember(needle: RValue, haystack: RValue): boolean {
  switch (haystack.kind) {
    case 'tuple':
    case 'set':
      return haystack.items.some((x) => equals(x, needle));
    case 'text':
      if (needle.kind !== 'text' || needle.value.length !== 1) return false;
      return haystack.value.includes(needle.value);
    default:
      throw new Error(`ИЗ ожидает кортеж/множество/текст справа (got ${typeName(haystack)})`);
  }
}

/** Length / cardinality / # operator. */
export function len(v: RValue): number {
  switch (v.kind) {
    case 'text':  return v.value.length;
    case 'tuple':
    case 'set':   return v.items.length;
    default: throw new Error(`# ожидает текст / кортеж / множество (got ${typeName(v)})`);
  }
}

export function isTruthy(v: RValue): boolean {
  if (v.kind === 'logical') return v.value;
  if (v.kind === 'empty')   return false;
  throw new Error(`Условие должно быть логическим (got ${typeName(v)})`);
}

/** Spec §28 textual representation used by ВЫВОД. */
export function display(v: RValue): string {
  switch (v.kind) {
    case 'int':     return String(v.value);
    case 'real':    return formatReal(v.value);
    case 'logical': return v.value ? 'да' : 'нет';
    case 'text':    return v.value;          // ВЫВОД prints text without quotes
    case 'tuple':   return '<' + v.items.map(display).join(', ') + '>';
    case 'set':     return '<*' + v.items.map(display).join(', ') + '*>';
    case 'record': {
      const parts: string[] = [];
      for (const [k, val] of v.fields) parts.push(`${k}: ${display(val)}`);
      return '<¤ ' + parts.join(', ') + ' ¤>';
    }
    case 'empty':   return '.пусто';
    case 'proc':    return `<процедура ${v.def.name}>`;
    case 'func':    return `<функция ${v.def.name}>`;
    case 'native':  return `<встр.функция ${v.name}>`;
  }
}

function formatReal(n: number): string {
  if (Number.isNaN(n)) return 'NaN';
  if (!Number.isFinite(n)) return n > 0 ? '+∞' : '-∞';
  if (Number.isInteger(n)) return n.toFixed(1); // distinguish from integer display
  // Use exponential form for very large / very small; otherwise fixed.
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e15)) return n.toExponential();
  return String(n);
}

/** Apply :width:precision formatting (§28). Best-effort, matches Agat spirit. */
export function displayFormatted(v: RValue, width: number | null, precision: number | null): string {
  let s: string;
  if (precision !== null && (v.kind === 'int' || v.kind === 'real')) {
    s = v.value.toFixed(precision);
  } else {
    s = display(v);
  }
  if (width !== null && s.length < width) s = s.padStart(width, ' ');
  return s;
}

function dedupe(xs: RValue[]): RValue[] {
  const out: RValue[] = [];
  for (const x of xs) if (!out.some((y) => equals(x, y))) out.push(x);
  return out;
}

/** Arithmetic dispatch helpers (called from interpreter). */

export function numericResult(a: RValue, b: RValue, fn: (x: number, y: number) => number, intOk: boolean): RValue {
  if ((a.kind !== 'int' && a.kind !== 'real') || (b.kind !== 'int' && b.kind !== 'real')) {
    throw new Error(`Числовая операция требует чисел (got ${typeName(a)} и ${typeName(b)})`);
  }
  const r = fn(a.value, b.value);
  return intOk && a.kind === 'int' && b.kind === 'int' && Number.isInteger(r) ? rInt(r) : rReal(r);
}

/** 1-based indexing into tuple/text. */
export function indexValue(obj: RValue, indices: RValue[], pos = ''): RValue {
  let cur = obj;
  for (const idx of indices) {
    if (idx.kind !== 'int') throw new Error(`Индекс должен быть целым${pos}`);
    const i = idx.value;
    if (cur.kind === 'tuple') {
      if (i < 1 || i > cur.items.length) throw new Error(`Индекс ${i} вне диапазона 1..${cur.items.length}${pos}`);
      cur = cur.items[i - 1]!;
    } else if (cur.kind === 'text') {
      if (i < 1 || i > cur.value.length) throw new Error(`Индекс ${i} вне диапазона 1..${cur.value.length}${pos}`);
      cur = rText(cur.value[i - 1]!);
    } else {
      throw new Error(`Индексирование требует кортеж или текст${pos}`);
    }
  }
  return cur;
}

/** Slice [a:b] inclusive on tuple/text. `from`/`to` are 1-based; nulls default to 1 / length. */
export function sliceValue(obj: RValue, from: number | null, to: number | null): RValue {
  if (obj.kind === 'tuple') {
    const n = obj.items.length;
    const a = Math.max(1, from ?? 1);
    const b = Math.min(n, to ?? n);
    return rTuple(a > b ? [] : obj.items.slice(a - 1, b));
  }
  if (obj.kind === 'text') {
    const n = obj.value.length;
    const a = Math.max(1, from ?? 1);
    const b = Math.min(n, to ?? n);
    return rText(a > b ? '' : obj.value.slice(a - 1, b));
  }
  throw new Error(`Вырезка требует кортеж или текст (got ${typeName(obj)})`);
}

/** Replace items in a tuple/text by index for assignment targets. */
export function withIndexAssigned(obj: RValue, indices: RValue[], value: RValue): RValue {
  if (indices.length !== 1) throw new Error('Поддерживается только одномерное индексное присваивание');
  const idx = indices[0]!;
  if (idx.kind !== 'int') throw new Error('Индекс должен быть целым');
  const i = idx.value;
  if (obj.kind === 'tuple') {
    if (i < 1 || i > obj.items.length) throw new Error(`Индекс ${i} вне диапазона`);
    const next = obj.items.slice();
    next[i - 1] = value;
    return rTuple(next);
  }
  if (obj.kind === 'text') {
    if (value.kind !== 'text' || value.value.length !== 1) {
      throw new Error('Присваивание элементу текста ожидает одиночный символ');
    }
    if (i < 1 || i > obj.value.length) throw new Error(`Индекс ${i} вне диапазона`);
    return rText(obj.value.slice(0, i - 1) + value.value + obj.value.slice(i));
  }
  throw new Error(`Индексное присваивание требует кортеж или текст (got ${typeName(obj)})`);
}

/** Return a new record with one field updated/added. Field name should already
 *  be in canonical form (upper-case via `normalize`). */
export function withFieldAssigned(obj: RValue, field: string, value: RValue): RValue {
  if (obj.kind !== 'record') {
    throw new Error(`Присваивание полю требует запись (got ${typeName(obj)})`);
  }
  const next = new Map(obj.fields);
  next.set(field, value);
  return { kind: 'record', fields: next };
}

export function withSliceAssigned(obj: RValue, from: number | null, to: number | null, value: RValue): RValue {
  if (obj.kind === 'tuple') {
    if (value.kind !== 'tuple') throw new Error('Срезу кортежа можно присвоить только кортеж');
    const n = obj.items.length;
    const a = Math.max(1, from ?? 1);
    const b = Math.min(n, to ?? n);
    return rTuple([...obj.items.slice(0, a - 1), ...value.items, ...obj.items.slice(b)]);
  }
  if (obj.kind === 'text') {
    if (value.kind !== 'text') throw new Error('Срезу текста можно присвоить только текст');
    const n = obj.value.length;
    const a = Math.max(1, from ?? 1);
    const b = Math.min(n, to ?? n);
    return rText(obj.value.slice(0, a - 1) + value.value + obj.value.slice(b));
  }
  throw new Error(`Присваивание срезу требует кортеж или текст (got ${typeName(obj)})`);
}
