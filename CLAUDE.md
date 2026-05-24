# CLAUDE.md — working on this codebase

Project-level notes for future Claude sessions. The TL;DR: this is a faithful interpreter for the **1985 Agat dialect** of Rapira (not the modern *Rapture* dialect). When in doubt about language semantics, the source of truth order is:

1. [`RAPIRA.md`](./RAPIRA.md) — the canonical 1985 spec, in Russian
2. [`SPEC.md`](./SPEC.md) — what *this* implementation actually does, including documented deviations
3. The code

## Stack

- Bun for the runtime, test runner, and bundler. No Node, no Vite, no Svelte, no SvelteKit. They were ripped out — don't add them back without a strong reason.
- TypeScript with `allowImportingTsExtensions` so `.ts` extensions appear in imports (`import './foo.ts'`). The web tsconfig (`web/tsconfig.json`) inherits the same convention.
- CodeMirror 6 in the playground; the rest of the playground is plain DOM.
- `just` is optional — every recipe in `Justfile` is a thin wrapper around a `bun run` invocation.

## Commands

| What | Command |
| ---- | ------- |
| Tests | `bun test` |
| Type-check | `bun run typecheck` |
| Run a `.rap` file | `bun run cli/index.ts FILE.rap` |
| Render turtle output | `bun run cli/index.ts FILE.rap --svg out.svg` |
| Web dev server | `bun run dev` (port **10000**) |
| Web production build | `bun run build` → `docs/` (GitHub Pages-ready) |
| Bundle CLI for npm | `bun run cli:build` → `dist/rapira.js` |
| Preview npm tarball | `npm pack --dry-run` (or `just pack`) |

## Layout

```
src/                     interpreter core — pure, no I/O dependencies
  lexer.ts               tokeniser; Russian-only keyword table normalised to ru-RU upper-case
  parser.ts              recursive descent → AST
  ast.ts                 AST node types
  interpreter.ts         tree-walker; defines Host interface, BufferedHost
  values.ts              RValue + deep equality + arithmetic dispatch + display
  environment.ts         scope chain
  errors.ts              Pos + RapiraError subclasses
  graphics.ts            GfxEvent typed union + sinks
  fs.ts                  FileSystem capability + InMemoryFileSystem
  stdlib/gfx.ts          documented Agat graphics primitives + Чертёжник turtle
  keywords.ts            bilingual lookup table (Russian-only — "bilingual" is a misnomer left over from earlier; do not add English keywords)

cli/                     Node-backed host: stdin/stdout, NodeFileSystem, SVG renderer
                         Bundled by scripts/cli-build.ts into dist/rapira.js
                         for npm publish (`npx rapira FILE.rap`)
web/                     vanilla DOM + CodeMirror 6 playground
  worker.ts              interpreter in a Web Worker (sync sleep via Atomics.wait)
  lib/                   renderer.ts (canvas), rapira-mode.ts (CodeMirror language + light/dark highlight)

scripts/web-build.ts     Bun-only build driver (replaces Vite). Also copies tests/snippets/ → docs/examples/

tests/
  snippets/              *.rap + *.expected.txt / *.expected.svg — runner walks the directory
  *.test.ts              unit tests grouped by layer

examples/                .rap files for the CLI; not the same as tests/snippets/

RAPIRA.md                the 1985 spec
SPEC.md                  this implementation's contract
```

## Gotchas

### Contextual keyword recognition

The Agat spec (§2.2) says identifiers are distinguished from keywords *contextually*. In particular `И` (logical AND) is also a valid identifier (commonly a loop variable in `ДЛЯ И ОТ 1 ДО Н`). The lexer always tokenises keyword words as their keyword kind; the parser then accepts any identifier-shaped keyword token as a name in two positions:

- `parser.ts :: expectIdent()` — wherever the parser explicitly wants a name (loop var, parameter, local, field key, file handle)
- `parser.ts :: parseAtom()` — operand positions in expressions

If you add a new keyword and find loop variables breaking, this is why.

### `<>` vs `<` `>` ambiguity

`<…>` is a tuple literal; `<` and `>` are comparison operators. The parser tracks `tupleDepth`: while inside `<…>` it refuses to consume a bare `>` as a binary operator. A similar `noOfBinop` flag suppresses `ИЗ` as the membership operator inside `ВЫБОР expr ИЗ …` so the trailing `ИЗ` remains a keyword.

### Two assignment operators

Spec form: `выражение -> имя`. Modern form: `имя := выражение`. Both desugar to the same `Assign` node. Don't add other forms without spec backing.

### Case-insensitivity

Implementation A1.3 (the one the spec describes) is case-insensitive. Identifiers are stored in their original case for display, but `Token.value` for an `IDENT` is the normalised upper-case form (`String.prototype.toLocaleUpperCase('ru-RU')`). Environment lookups and keyword matching use the normalised form.

### `<¤ … ¤>` records and the `<$ … $>` alias

Records use the international currency sign `¤`. On Soviet КОИ-8 hardware the `$` glyph slot was remapped to `¤`, so `<$ … $>` is accepted as the ASCII-keyboard alias. Both produce identical AST.

### FileSystem is a host capability, not core

`Host.fs?: FileSystem` is optional. Three implementations:

- `NodeFileSystem` (`cli/fs.ts`) — backs the CLI via `node:fs`.
- `InMemoryFileSystem` (`src/fs.ts`) — backs `BufferedHost`, used by tests.
- The web worker host has **no** `fs` — any file op throws `Файлы недоступны в этой среде исполнения`. The playground is sandboxed by absence, not by special-case code. Don't add `fs` to the worker.

### ПАУЗА

CLI **and** web worker both use `Atomics.wait` on a fresh `SharedArrayBuffer` for portable synchronous sleep — works in Node ≥ 18, Bun, and Web Workers without any cross-origin headers. `BufferedHost.pause` records into a `pauses` array so tests assert without sleeping.

### CLI must work under plain Node, not just Bun

Anything in `cli/` runs in `npx rapira` from Node — no Bun-specific APIs. Don't introduce `Bun.sleepSync`, `Bun.file`, or `Bun.spawn` in `cli/`. The interpreter core in `src/` already avoids these; keep it that way. `scripts/` files run via `bun` so they're free to use Bun APIs.

### Tests and host hooks

- `BufferedHost.out` collects all writes.
- `BufferedHost.gfx.events` collects all `GfxEvent`s.
- `BufferedHost.fs.snapshot()` reads back what file ops wrote.
- `BufferedHost.pauses` records `ПАУЗА` durations in ms.

Most tests use the `run(src, input?)` convenience in `src/interpreter.ts`; tests that need a custom host construct `BufferedHost` directly.

### Web playground specifics

- Worker is bundled separately as `worker.js`; `main.ts` loads it via `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`. Both `web/index.html` and `web/worker.ts` are explicit entrypoints in `scripts/web-build.ts` so the output filenames are predictable.
- Light is the default theme. Theme tokens are CSS custom properties under `:root[data-theme='light']` / `[data-theme='dark']`. The CodeMirror highlight extension is also theme-aware (`web/lib/rapira-mode.ts` exports `lightHighlight` / `darkHighlight`).
- Theme swap uses a `Compartment` and `view.dispatch({ effects: editorTheme.reconfigure(...) })` — if you forget to dispatch, the highlight palette won't update until reload.
- Each `runOnce` clears the canvas before spawning the new worker so previous turtle output doesn't linger between runs.

## Adding a new built-in

Host-free natives (math, predicates, sequence ops) go in `defineNativeFns` at the top of `interpreter.ts`. Host-coupled natives (file ops, sleep, prompt, sound) go in `Interpreter.registerHostNatives()` so they close over `this.host`. Always:

1. Check argument types explicitly with a `RuntimeError` for mismatches.
2. Use the spec's name as the canonical form. Add a Latin alias only if the spec itself uses Latin (e.g. `ABS` and `SQRT` per Appendix 3).
3. Add at least one test in `tests/builtins.test.ts` or `tests/fs.test.ts`.
4. Update `SPEC.md`'s built-ins table.

## Adding new syntax

1. Add the lexer rule in `src/lexer.ts` if it needs a new token, or extend the keyword table in `src/keywords.ts`.
2. Add an AST variant in `src/ast.ts`.
3. Wire `parseStatement` (or `parseAtom` for expressions) in `src/parser.ts`.
4. Implement evaluation in `src/interpreter.ts`.
5. Tests in the matching `tests/*.test.ts`.
6. If it's a feature mentioned in `RAPIRA.md` but parts are deferred, say so in `SPEC.md`'s "Deferred from MVP" section. Be honest about what's actually working.

## Honest deferrals

These are listed in `SPEC.md`'s "Deferred from MVP" section. If you implement any of them, remove the line from the deferred list and update the relevant numbered chapter in `SPEC.md`.

- РОБИК front-end language (`[…]` predicate-set blocks, §43-46) — needs the Программистическое Руководство (Фг.00031-01 33 01) which isn't available in any archive we can reach. The `РОБИК` directive is parsed but inert.
- Module system (`СТАРТ`, `ФИНИШ`, `ДОСТУПНО`, `МОДУЛЬ`)
- `ЗАПЕРЕТЬ`, `ОТПЕРЕТЬ`, `СТЕРЕТЬ` file ops (file locks / erase)
- `ВВОД ИЗ ДЗУ` (Soviet disk-storage hardware concept)
- `НА БУМАГУ` printer direction (falls back to stdout)
- `КЛАВ`, `НАЖАТО` — interactive keyboard from a worker is awkward
- Hardware-bound built-ins (`АДРЧ`, `АДРЗ`, `АДРВЫЗ`, `РУЧКА`, `КНОПКА`, `ДЗУ`)
- `ОКСИМ`, `ЭКЦВ` — read pixel/colour from a framebuffer we don't keep
- `ВКЛ`/`ВЫКЛ`/`КАТАЛОГ`/`ЗАПУСК` — debug/shell ops with limited educational value here
- `ТКС` (text on the graphics surface) and `РЖМ` (graphics mode) — Tier 2 work

## Style

- Comments in Russian on Rapira-side examples (`.rap` files, snippet test fixtures, SPEC examples). TypeScript comments stay in English.
- Error messages thrown from the interpreter / runtime should be in Russian — they're surfaced to the end user.
- Source positions (`Pos`) are 1-based for line/col, 0-based for offset. Matches the rest of Rapira's 1-based indexing convention.
- Keep `SPEC.md` honest. If something is parsed-but-not-evaluated, say so. If a built-in's name differs from Appendix 3, document the alias.
