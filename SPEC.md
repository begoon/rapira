# Rapira — Language Specification (vanilla Agat dialect)

This document specifies the **vanilla 1985 Agat dialect** of Rapira (Рапира), as implemented in this project. The reference is:

- **Primary source**: Л. С. Бараз, Е. В. Боровиков, Н. Г. Глаголева, П. А. Земцов, Е. В. Налимов, В. А. Цикоза. *Язык программирования Рапира*, описание языка, реализация А1.3 (1985). Re-hosted in the Agat archive: <https://agatcomp.ru/agat/Software/Other/ebooks-IKP-KPON/IKP/800.9/rapira/docs/RAPIRAopisanie_jazyka.shtml>.
- **Context**: Звенигородский Г. А., *Первые уроки программирования*, М.: Наука, 1985.

We do **not** track the modern *Rapture* dialect; we implement the original Soviet-era language as it ran on Агат-7/9 in *Школьница*.

## Sole concession to modernity

The 1985 spec only accepts `->` for assignment (expression-to-name). This implementation **also** accepts `:=` as a synonym, per the user's explicit request — both forms desugar to the same AST. Everything else is vanilla.

## Lexical structure

### Alphabet

Identifiers and keywords use **Russian and Latin letters interchangeably**. **Case is not significant** in the A1.3 implementation: `ЕСЛИ` = `если` = `Если` etc. (We normalize to upper-case for keyword lookup and reserved-name comparison; identifier *display* preserves the original case.)

### Identifiers (имена)

Simple name: starts with a letter; rest is letters / digits / `_` (underscore).

```rapira
НАШ_УЧЕБНЫЙ_ЯЗЫК_ПРОГРАММИРОВАНИЯ
ТЕК_ИМЯ
i n счёт
```

Compound name: simple names joined by `'` (apostrophe). Used for module-qualified references.

```rapira
МОДУЛЬ'ИМЯ
```

### Comments

Block comments, can span lines, can contain newlines:

```rapira
(* this is a
   multi-line comment *)
```

(No line-comment form.)

### Statement terminator

`;`. Newlines are whitespace; layout is free.

### Literals

- **Integer**: digit sequence — `0`, `42`, `2939837291020292901`. Negative integers are formed by unary `-`.
- **Real**: integer-part `.` fraction-part, optionally followed by exponent `Е` (Cyrillic) or `E` (Latin) and a signed integer. Or integer-part directly followed by exponent.

  ```rapira
  3.141519
  0.3141519Е1
  3141519Е-6
  2E10
  ```

- **Text** (string): `"…"`. Internal `"` is doubled: `"ЛЕДОКОЛ ""АЛЬБАТРОС"""`.
- **Tuple** (кортеж — ordered, indexable): `<e1, e2, …>` and the empty tuple `< >`.
- **Set** (множество — unordered, duplicates collapse, `+ * - ИЗ`): `<* e1, e2, … *>` and the empty set `<* *>`.
- **Record** (запись — named fields, accessed by `.field`): `<¤ имя1: v1, имя2: v2 ¤>`. The ASCII-keyboard form `<$ имя1: v1, имя2: v2 $>` is also accepted: in КОИ-8 the `$` glyph slot was remapped to `¤` on Soviet hardware, so they refer to the same delimiter. Field names are normalised to upper-case for storage/lookup. Read a field with `Р.имя`; assign with `значение -> Р.имя`. Reading an absent field returns `.пусто`. Records compare with universal `=` field-wise.
- **Empty constant**: `.пусто` (the value of an uninitialised name).

## Operators (Appendix 1)

### Unary

| Op   | Meaning                              |
| ---- | ------------------------------------ |
| `-`  | numeric negation                     |
| `#`  | length of text/tuple, cardinality of set |
| `НЕ` | logical negation                     |

### Binary

| Op   | Meaning                                                 |
| ---- | ------------------------------------------------------- |
| `+`  | numeric sum • text/tuple concatenation • set union      |
| `-`  | numeric difference • set difference                     |
| `*`  | numeric product • set intersection                      |
| `/`  | division                                                |
| `**` | power                                                   |
| `//` | integer division                                        |
| `=` `/=` `<` `<=` `>` `>=` | comparisons                                |
| `И` `ИЛИ` | logical                                            |
| `ИЗ` | membership: literal-in-text, element-in-tuple/set      |
| `ВИДА` | "of kind" — structural-type check vs. a template     |

There is no separate boolean type per the spec; comparisons yield empty-or-tuple sentinels checked by control constructs. **This implementation** materialises booleans as a distinct type for ergonomics; comparisons evaluate to it and control constructs accept it. (Pragmatic deviation, documented here.)

### Assignment (Section 2.6)

```rapira
expr -> qualified_name ;
expr := qualified_name ;        (* our addition *)
```

Targets may be qualified: `Х`, `К[2]`, `К[5:6]` (slice), `АНКЕТА.ФАМ` (field).

## Statements (Section 2.7 / Appendix 2)

### Conditional (§22)

```rapira
ЕСЛИ cond
   ТО список_предписаний
   [ ИНАЧЕ список_предписаний ]
ВСЕ ;
```

### Case (§23) — two forms

```rapira
ВЫБОР ИЗ
        cond1 : stmts
      ! cond2 : stmts
      ! cond3 : stmts
        ИНАЧЕ   stmts
ВСЕ ;

ВЫБОР expr ИЗ
        v1, v2 : stmts
      ! v3     : stmts
        ИНАЧЕ    stmts
ВСЕ ;
```

`!` separates branches.

### Loop (§25) — universal `header :: body ВСЕ`

```rapira
ПОВТОР n РАЗА  ::  ...  ВСЕ        (* РАЗА or РАЗ — both accepted *)
ПОКА cond      ::  ...  ВСЕ
ДЛЯ x ОТ a ДО b [ ШАГ s ] :: ... ВСЕ
ДЛЯ x ИЗ collection ::  ...  ВСЕ
```

### Output (§28)

```rapira
ВЫВОД [ направление ] [ БПС ] : item, item, … ;
?   item, item, … ;          (* shorthand for ВЫВОД : *)
ВЫВОД : Х:10:3 , А , Б:5 ;   (* per-item width and precision *)
```

`БПС` ("без перевода строки") suppresses the trailing newline.

Direction (file/printer/screen) is parsed but defers to plain stdout in MVP.

### Input (§31)

```rapira
ВВОД [ ТЕКСТОВ | ДАННЫХ ] : target, target, … ;
```

### Routine call

```rapira
ИМЯ(arg1, arg2, …) ;
expr(arg1, …) ;        (* expr must evaluate to a procedure *)
```

### Assert / debug (§24, §26, §27)

```rapira
КОНТРОЛЬ cond ;      (* assertion; failure prints "СРАБОТАЛ КОНТРОЛЬ" *)
СТОП ;                (* debugger break *)
ВЫХОД ;               (* abort current execution *)
```

## Procedures and functions (Section 2.8 / §38–§42)

### Parameter modes — three-arrow scheme

| Form          | Meaning  | Direction of arrow |
| ------------- | -------- | ------------------ |
| `name`        | input    | none / `=>` before is optional |
| `name =>`     | output   | arrow points outward, after the name |
| `<=> name`    | inout    | arrow points both ways, before the name |

This is the canonical Agat convention; the arrow shape literally depicts the direction of data flow at the call boundary.

### Procedure

```rapira
ПРОЦ ИМЯ [ ( params ) ] ;
   [ ИМЕНА: local1, local2 ; ]
   список_предписаний
КНЦ ;
```

### Function

The function body is followed by a **trailing `РЕЗ:` predicate** specifying the result expression:

```rapira
ФУНК ИМЯ [ ( params ) ] ;
   [ ИМЕНА: local1, local2 ; ]
   список_предписаний
РЕЗ: выражение [ ; ]
КНЦ ;
```

Functions take only input parameters (§42).

### Example

```rapira
ФУНК ФАКТ (Н) ;
   ИМЕНА: Р ;
   1 -> Р ;
   ДЛЯ И ОТ 1 ДО Н ::
      Р * И -> Р
   ВСЕ ;
РЕЗ: Р
КНЦ ;

ПРОЦ ПОМЕНЯТЬ ( <=> А, <=> Б ) ;
   ИМЕНА: Т ;
   А -> Т ;
   Б -> А ;
   Т -> Б
КНЦ ;
```

## Compound names and qualifications (§10–§12)

A qualified name has the form `name { qualifier }*` where each qualifier is:

- `. имя` — field access on a record
- `[ expr ]` — index (1-based) into tuple/text
- `[ expr1 : expr2 ]` — slice into tuple/text, inclusive both ends

## Reserved words

In addition to operators, the following are reserved (case-insensitive):

```
ЕСЛИ ТО ИНАЧЕ ВСЕ
ВЫБОР ИЗ ВИДА
ПОВТОР РАЗ РАЗА ПОКА ДЛЯ ОТ ДО ШАГ
ПРОЦ ФУНК КНЦ РЕЗ ИМЕНА
ВЫВОД ВВОД БПС НА В ИЗ ДАННЫХ ТЕКСТОВ ЭКРАН БУМАГУ ФАЙЛ ФАЙЛА ДЗУ
КОНТРОЛЬ СТОП ВЫХОД ПУСК ШАГ
И ИЛИ НЕ
СТАРТ ФИНИШ ДОСТУПНО МОДУЛЬ
ОТКРЫТЬ ЗАКРЫТЬ ПОЗИЦИЯ КАК ЗАПЕРЕТЬ ОТПЕРЕТЬ СТЕРЕТЬ
РОБИК РАПИРА
```

## Built-ins (Appendix 3)

### Functions

| Spec name | Aliases              | Meaning                              |
| --------- | -------------------- | ------------------------------------ |
| `АБС(Х)`  | `abs`                | absolute value                       |
| `ЦЕЛЧ(Х)` | `entier`             | integer part (truncation)            |
| `SQRT(Х)` | `КОР`, `sqrt`        | square root                          |
| `ДСЧ()`   | `random`             | random real in [0; 1)                |
| `КОД(Л)`  | `ord`                | char code of single-character text   |
| `АЛФ(N)`  | `chr`                | character for code                   |
| `ФТЕКСТ(N, Л)` | `make_text`     | text of length N filled with char Л |
| `ФКОРТ(N, П)` | `make_tuple`     | tuple of N copies of П               |

### Procedures

I/O & system:

| Name             | Meaning                                  |
| ---------------- | ---------------------------------------- |
| `ПАУЗА(N)`       | sleep N/10 seconds                       |
| `ЗВОН()`         | bell                                     |
| `ЗВУК(N1, N2)`   | tone of frequency N2 for duration N1     |
| `ПРИГЛ(Л)`       | set input prompt                         |

Graphics (emit events to host `GraphicsSink` — see *Graphics architecture* below):

| Name                          | Meaning                       |
| ----------------------------- | ----------------------------- |
| `ЦВЕТ(N)`                     | set current draw colour (0..15) |
| `ОКНО(Кх1, Ку1, Кх2, Ку2)`    | set drawing window            |
| `ПОЗ(Кх, Ку)`                 | move cursor                   |
| `ОТСЧЕТ(Кх, Ку)`              | set coordinate origin         |
| `МТБ(Sх, Sу)`                 | set per-axis scales           |
| `ТЧК(Кх, Ку)`                 | draw point                    |
| `ЛИН(Кх1, Ку1, Кх2, Ку2)`     | draw line                     |
| `ПРЯМ(Кх1, Ку1, Кх2, Ку2)`    | draw rectangle (stroke)       |
| `ОБЛ(Кх, Ку)`                 | flood-fill area from point    |
| `ОЧИСТИТЬ()`                  | clear surface (our addition)  |

## Чертёжник — turtle extension (this implementation)

The original *Школьница* system included a turtle-style executor called **Чертёжник** ("Draftsman") accessed through the РОБИК front-end language. The full РОБИК meta-grammar lives in the Школьница programmer's manual (Фг.00031-01 33 01) which is not in any archive we can reach — so we do **not** implement the РОБИК language itself. (The `РОБИК` directive is parsed but is currently inert.)

Instead, we expose the Чертёжник executor as ordinary Rapira procedures. The turtle keeps internal `(x, y, heading, pen)` state and desugars its commands into `line` events on the same graphics stream as `ЛИН`. Default state: at canvas centre `(128, 128)`, heading `0°` (up), pen down. Angles in degrees, clockwise.

| Procedure              | Effect                                                    |
| ---------------------- | --------------------------------------------------------- |
| `ВПЕРЕД(N)`            | move `N` units in current heading; emit line if pen down  |
| `НАЗАД(N)`             | move `N` units backwards                                  |
| `НАПРАВО(D)`           | rotate heading clockwise by `D` degrees                   |
| `НАЛЕВО(D)`            | rotate heading counter-clockwise by `D` degrees           |
| `КУРС(D)`              | set absolute heading to `D` degrees                       |
| `ПЕРО_ВВЕРХ()`         | lift pen — subsequent moves don't draw                    |
| `ПЕРО_ВНИЗ()`          | lower pen                                                 |
| `ДОМОЙ()`              | jump to `(128, 128)`, heading `0`, without drawing        |
| `В_ТОЧКУ(Х, У)`        | jump to absolute coordinates (draws if pen down)          |
| `ЧЕРТЕЖНИК_X()`        | current x (read-only)                                     |
| `ЧЕРТЕЖНИК_Y()`        | current y                                                 |
| `ЧЕРТЕЖНИК_КУРС()`     | current heading in degrees                                |

Example:

```rapira
(* draw a square *)
ПОВТОР 4 РАЗА ::
   ВПЕРЕД(50);
   НАПРАВО(90)
ВСЕ;
```

## Graphics architecture

The interpreter core never imports a drawing surface. Each graphics procedure emits a typed event onto an injected `GraphicsSink`:

```ts
type GfxEvent =
  | { kind: 'clear' }
  | { kind: 'color', index: number }     // ЦВЕТ index
  | { kind: 'window', x1: number, y1: number, x2: number, y2: number }
  | { kind: 'origin', x: number, y: number }
  | { kind: 'scale',  sx: number, sy: number }
  | { kind: 'cursor', x: number, y: number }
  | { kind: 'point',  x: number, y: number }
  | { kind: 'line',   x1: number, y1: number, x2: number, y2: number }
  | { kind: 'rect',   x1: number, y1: number, x2: number, y2: number }
  | { kind: 'fill',   x: number, y: number };
```

Hosts (CLI → SVG; web → `<canvas>`) consume the stream. The Agat colour palette (16 indexed colours of Агат-9 in high-resolution mode) is mapped to RGB in the host.

Default canvas is 256 × 256 (Агат-7 high-res), origin top-left, y-down — the host normalises Agat's bottom-left native convention.

## Deferred from MVP

- File I/O (`ОТКРЫТЬ`, `ЗАКРЫТЬ`, `ВВОД ИЗ ФАЙЛА`, …) — parsed, then rejected at runtime
- Modules (`СТАРТ`, `ФИНИШ`, `ДОСТУПНО`, `МОДУЛЬ`)
- Robic-mode predicate sets (`'[' … ']'` blocks)
- Output formatters (`:width:precision`) — parsed, formatting deferred to a simple default
