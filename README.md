# Ξ crunchpad

A ProseMirror document editor built for writing **inline math**. Equations are
stored as LaTeX but edited visually (via [MathLive](https://cortexjs.io/mathlive/)),
so you don't need to know LaTeX to use it. It runs in a browser or as a desktop
app (Windows / macOS / Linux, via Electron).

## Quick start

```bash
npm install
npm run dev            # web version at http://localhost:5173
npm run desktop:dev    # desktop window with hot reload
npm run desktop        # production build in the desktop shell
```

Installers: `npm run dist:win`, `npm run dist:mac` or `npm run dist:linux`
(uses electron-builder via `npx`; output goes to `release/`). Build the macOS
installer on a Mac.

## Writing math

| Do this | Get this |
| --- | --- |
| Type `$x^2+1$` in text | inline equation |
| Type `$$` on an empty line | display (centered) equation |
| Type `$$` mid-sentence | empty inline equation, cursor inside |
| Type `\frac`, `\alpha`, `\int`, `\sum`… then a space | equation pre-filled with that template |
| `Ctrl+M` / `Ctrl+Shift+M` | new inline / display equation |
| Paste text with `$…$`, `\(…\)`, `\[…\]` | real equations |
| Paste from web pages using KaTeX / MathJax / MathML | real equations (LaTeX is recovered) |

Inside an equation: `/` makes a fraction, `^` `_` for super/subscripts, words
like `sqrt`, `int`, `sum`, `lim`, `alpha`, `theta`, `RR`, `->`, `<=`, `!=`, `+-`
become symbols, `Tab` jumps between empty slots, arrow keys / `Enter` / `Esc`
leave the equation, and `Backspace` in an empty equation deletes it.
`Ctrl+Alt+M` opens the raw LaTeX source for the current equation.

Lists: type `- `, `1. ` or `a. ` at the start of a line for a bulleted,
numbered or lettered (a. b. c.) list, or use the Paragraph buttons.

## Right-click menu

Right-click anywhere in the document for Cut / Copy / Paste. On an equation
you also get **Copy LaTeX**, **Copy as image** (a crisp PNG you can paste into
Word, Slides, chat apps…), Edit LaTeX and Delete. Copied equations paste back
into crunchpad as real, editable equations.

## Drawings (Draw → Drawing)

Inserts a drawing area. Tools: pen, highlighter, line, arrow, rectangle,
ellipse (Shift = 45° steps / squares / circles), eraser, plus 8 colors and a
custom color picker, three thicknesses, filled shapes and an optional white
background. Drag the grip (or use the move tool) to place it anywhere; drag the
corner handle to resize. By default text flows above and below the drawing;
the "in front of text" button lets it float freely over the page. Ctrl+Z undoes
strokes. Exports: an image in Word, inline SVG in HTML, TikZ in LaTeX.

## Settings (⚙ in the ribbon)

Stored per device. **Document**: default font, size, line spacing, equation
number style `(1)` / `[1]`, spell check, theme — these also apply to exports.
**Math notation**: `arcsin` vs `sin⁻¹` (with a button to convert the open
document), `*` as `·` or `×`, italic `dx` vs upright `d`, `ℝ` vs bold `R`,
arrow vs bold vectors, and the letter style (TeX / ISO / French / upright).
Notation choices affect typing shortcuts and the built-in templates; equations
you already wrote are left alone. **Equation typing**: auto-closing brackets
and smart superscripts.

## Quick search (`Ctrl+Space`)

Opens a search bar at the bottom of the window. It searches across:

- **Math**: ~200 symbols and templates (Greek, operators, relations, arrows,
  sets & logic, calculus, matrices, accents, fonts…), with live previews.
  If you're editing an equation, the result is inserted at the caret.
- **Commands**: open/save/export, styles (Heading 1–4, code), formatting
  (bold, highlight colors, text colors, alignment, lists), theorem/proof
  blocks, zoom, dark mode, and more.
- **Macros**: your own math shortcuts and saved snippets.
- **Raw LaTeX**: type something starting with `\` (or `=`) to insert it
  directly, or save it as a macro.
- **Files**: recent files (desktop).

Narrow the search with prefixes `m:` (math), `c:` (commands), `k:` (macros),
`f:` (files), or press `Tab` to cycle between them.

## Macros

- **Math macros** have a trigger. Type the trigger inside any equation and it
  expands (e.g. built-in `pd` → ∂/∂, `quadf` → quadratic formula). Use `#?`
  in a macro for a placeholder you can `Tab` to.
- **Snippets** save a selection of formatted text and equations, which you can
  re-insert from quick search.

Manage them from **File ▸ Macros** in the ribbon, or search "macro".
Macros are stored per user (browser storage / app profile).

## Files and export

- Native format: **`.crunchpad`** (ProseMirror JSON). The desktop app registers
  it as a file type. Files from before the rename (`.mathdoc`) still open.
- **Open/import**: `.crunchpad` / `.mathdoc`, plus `.md`, `.txt`, `.tex` (math delimiters,
  headings and equations are converted).
- **Export**:
  - **Word (.docx)**: equations become native, editable Word equations (OMML).
    Headings, lists, highlights, colors, links, theorem blocks and numbered
    equations are preserved.
  - **PDF**: browser print dialog ("Save as PDF") on the web; direct PDF file in
    the desktop app.
  - **LaTeX (.tex)**: complete `article` document with amsmath/amsthm.
  - **HTML**: standalone page with MathML (+ LaTeX annotations).
- Unsaved work is kept as a recovery copy and restored on next launch.

## Project layout

```
src/
  editor/   schema, MathLive node view, input rules & keymaps, commands
  math/     symbol/template catalog, MathLive setup
  app/      ribbon, quick search, command registry, dialogs, macros, files
  export/   docx (OMML), LaTeX, HTML, LaTeX→MathML/OMML conversion
electron/   desktop main process + preload bridge
```

Every action is a command in `src/app/registry.ts`. Registering a command makes it
available in the ribbon, quick search and keyboard shortcuts at once.

## Licenses

MathLive (MIT), ProseMirror (MIT), JSZip (MIT/GPLv3 dual), mathml2omml (LGPL-3.0).
