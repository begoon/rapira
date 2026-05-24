import { EMPTY, type RValue } from './values.ts';

/**
 * Variable scope. Each Env has its own bindings and an optional parent.
 *
 * Per spec §2.4: "Если имя не получило каким-либо способом явное определение,
 * то оно имеет значение .пусто" — reads of unknown names return .пусто.
 *
 * Procedures and functions are not nestable (§3), so the scope chain is
 * at most two deep in practice: a global Env, and a per-routine local Env.
 */
export class Env {
  private bindings = new Map<string, RValue>();
  constructor(public readonly parent: Env | null = null) {}

  /** Read with auto-default to .пусто. */
  get(name: string): RValue {
    if (this.bindings.has(name)) return this.bindings.get(name)!;
    if (this.parent) return this.parent.get(name);
    return EMPTY;
  }

  /** Assigns in the innermost scope that already defines `name`. Falls back
   *  to creating a binding in this scope. */
  set(name: string, value: RValue): void {
    let cur: Env | null = this;
    while (cur) {
      if (cur.bindings.has(name)) { cur.bindings.set(name, value); return; }
      cur = cur.parent;
    }
    this.bindings.set(name, value);
  }

  /** Predeclare a binding directly in this scope (params, ИМЕНА locals). */
  declare(name: string, value: RValue = EMPTY): void {
    this.bindings.set(name, value);
  }

  has(name: string): boolean {
    if (this.bindings.has(name)) return true;
    return this.parent ? this.parent.has(name) : false;
  }
}
