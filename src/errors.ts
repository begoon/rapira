export interface Pos {
  line: number;   // 1-based
  col: number;    // 1-based
  offset: number; // 0-based char index
}

export class RapiraError extends Error {
  constructor(message: string, public readonly pos?: Pos) {
    const where = pos ? ` at ${pos.line}:${pos.col}` : '';
    super(`${message}${where}`);
    this.name = 'RapiraError';
  }
}

export class LexError extends RapiraError { override name = 'LexError'; }
export class ParseError extends RapiraError { override name = 'ParseError'; }
export class RuntimeError extends RapiraError { override name = 'RuntimeError'; }
