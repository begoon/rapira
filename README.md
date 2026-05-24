# Rapira

A TypeScript / Bun interpreter for **РАПИРА** — the Soviet educational programming language designed in the early 1980s under G. A. Zvenigorodsky as part of the *Школьница* (Shkolnitsa) school computing system for the Агат (Agat) microcomputer.

```rapira
ФУНК ФАКТ (Н);
   ИМЕНА: Р;
   1 -> Р;
   ДЛЯ И ОТ 1 ДО Н ::
      Р * И -> Р
   ВСЕ
РЕЗ: Р
КНЦ;

ДЛЯ Н ОТ 0 ДО 6 ::
   ? "ФАКТ(", Н, ") = ", ФАКТ(Н)
ВСЕ;
```

## What's in the box

- **Interpreter core** (`src/`) — lexer, parser, tree-walking evaluator. Faithful to the 1985 Agat dialect: Russian-only keywords, case-insensitive identifiers, `(* … *)` block comments, `;` statement separator, three compound types (tuples `< >`, sets `<* *>`, records `<¤ ¤>`), three-arrow procedure parameter scheme (`name` / `name =>` / `<=> name`), trailing `РЕЗ:` for function results.
- **CLI** (`cli/`) — `rapira FILE.rap` runs a program, `rapira` drops into a multi-line REPL, `--svg PATH` captures turtle graphics as SVG.
- **Web playground** (`web/`) — vanilla HTML + CodeMirror 6 + Web Worker, light/dark theme, example selector loading from `tests/snippets/`. Build with `bun build`, output sits in `docs/` ready for GitHub Pages.
- **Snippet test pipeline** (`tests/snippets/`) — `.rap` files diffed against sibling `.expected.txt` / `.expected.svg` on every run of `bun test`.
- **Чертёжник turtle** — Soviet "Draftsman" executor exposed as ordinary Rapira procedures (`ВПЕРЕД`, `НАЗАД`, `НАПРАВО`, `НАЛЕВО`, `ПЕРО_ВНИЗ`, `ПЕРО_ВВЕРХ`, `ДОМОЙ`, `В_ТОЧКУ`, `КУРС`). Layered on top of the same `GfxEvent` stream as the documented graphics primitives (`ЛИН`, `ПРЯМ`, `ОБЛ`, etc.) so the CLI's SVG renderer and the playground's canvas renderer draw identical output.

## Quick start

```sh
bun install
bun test                                      # 129 tests across 9 files
bun run cli/index.ts examples/factorial.rap   # ФАКТ(0..7)
bun run dev                                   # playground on http://localhost:10000
```

If you have [`just`](https://github.com/casey/just) installed, you can use the recipe names — `just test`, `just dev`, `just run examples/turtle_star.rap --svg /tmp/star.svg`, etc.

## Examples

| File | What it shows |
| ---- | ------------- |
| `examples/hello.rap` | canonical `ВЫВОД: "Здравствуй, мир!"` |
| `examples/factorial.rap` | `ФУНК` with trailing `РЕЗ:`, `ДЛЯ … ОТ … ДО`, integer math |
| `examples/turtle_square.rap` | Чертёжник draws a square via `ПОВТОР … РАЗА :: ВПЕРЕД(50); НАПРАВО(90)` |
| `examples/turtle_star.rap` | five-pointed star from a single repeat loop |
| `examples/io_files.rap` | `ОТКРЫТЬ … КАК`, `ВЫВОД В ФАЙЛ`, `ВВОД ИЗ ФАЙЛА ТЕКСТОВ`, `ЗАКРЫТЬ` |
| `examples/io_seek.rap` | `ПОЗИЦИЯ Ф = N` for random-access file reading |

## Documentation

- [`SPEC.md`](./SPEC.md) — the implementation contract: lexical structure, statements, operators, built-ins, what's done vs. honestly deferred.
- [`RAPIRA.MD`](./RAPIRA.MD) — the canonical 1985 spec (Фг.00031-01 35 01) reformatted to Markdown from the [agatcomp.ru KOI-8 source](https://agatcomp.ru/agat/Software/Other/ebooks-IKP-KPON/IKP/800.9/rapira/docs/RAPIRAopisanie_jazyka.shtml).
- [`CLAUDE.md`](./CLAUDE.md) — onboarding notes for working on this codebase.

## License

[MIT](./LICENSE) © Alexander Demin
