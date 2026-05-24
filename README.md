# Rapira

A TypeScript/Bun interpreter for **Rapira (Рапира)** — the Soviet educational programming language designed in the early 1980s under G. A. Zvenigorodsky as part of the *Shkolnitsa* (Школьница) system.

This project ships:

- **Interpreter core** (`src/`) — lexer, parser, tree-walking evaluator. Bilingual (Russian + English keywords).
- **CLI** (`cli/`) — `rapira file.rap` to run a program; REPL with no args; `--svg out.svg` to capture graphics.
- **Web playground** (`web/`) — SvelteKit + CodeMirror 6. Editor on the left, mixed text + turtle/graphics output on the right.
- **Snippet test pipeline** (`tests/snippets/`) — each `.rap` file diffed against a sibling `.expected.txt` or `.expected.svg`.

See [`SPEC.md`](./SPEC.md) for the language specification this implementation targets.

## Quick start

```sh
bun install
bun test
bun run cli examples/hello.rap
```

## Status

Early. See `SPEC.md` for the dialect we accept.
