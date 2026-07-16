# DBML ER Diagrams

Obsidian plugin that renders ` ```dbml ` code blocks as **interactive entity-relationship diagrams**, with **orthogonal, dbdiagram.io-style routing** (right-angle lines), crow's-foot notation (crow's foot / bar) and direct editing on the canvas.

- **Plugin ID:** `dbml-erd`
- **Name:** DBML ER Diagrams
- **Author:** Wilmar Rojas Avendaño · **License:** MIT
- **Minimum Obsidian version:** 1.6.0 · Works on desktop and mobile.

---

## Fork notes

This is a personal fork ([Pedro Fonseca](https://github.com/pnmdfonseca)) of the plugin above, currently used and tested privately. It is **not** the plugin published in Obsidian's community plugin list — installed side by side with the original it uses a different plugin ID (`dbml-erd-pfonseca`) so the two don't collide.

Added on top of upstream:

- **`@include` directive** — compose a diagram from tables/relationships defined in another `.dbml` file (or another note), e.g. `@include attachments/shared-schema.dbml`. Resolved by textual expansion before parsing, so `Ref:` lines across included files work like any other relationship. Supports nested includes with cycle detection.
- **Live auto-reload** — editing an included file updates every open diagram that depends on it, without needing to touch the note itself or reopen it.
- **Configurable crow's-foot style** — Settings → DBML ER Diagrams → *Crow's foot style*: `Inverted` (fan opens on the entity, unambiguous even on horizontal links) or `Original` (upstream's default geometry, which can read as an arrowhead on horizontal links). Applies live to open diagrams.
- **External-source edit guard** — renaming/deleting a table or column, changing a type, recoloring a header, or changing a relationship's cardinality now shows a clear notice instead of silently failing when the target is defined in an `@include`d file rather than the block itself.

None of this changes the on-disk format for diagrams that don't use `@include` — existing notes and their `@pos`/`@view`/`@size`/`@edge` annotations keep working as-is.

The rest of this README documents the base plugin as written by the original author; it's still accurate for everything except the items above.

---

## What it does

You write a ` ```dbml ` block with your tables and relationships and the plugin draws it as an SVG ERD, with automatic layout, cardinality markers and interactive editing. Every change you make from the diagram (rename, move, color, cardinality, delete…) is written back into the note's own dbml block — the block is the single source of truth.

### Render and layout

- Renders `dbml` / `DBML` blocks to an SVG ERD.
- Automatic layout with [elkjs](https://github.com/kieler/elkjs) (`elk.layered`) that minimizes crossings.
- **Orthogonal (90°) routing** in dbdiagram.io style, with rounded corners; lines re-route live as you move tables.
- Layout cache by structure: saving the layout does not recompute the layout nor cause flicker.
- Theme integrated with Obsidian variables (automatic light/dark).

### Notation

- **One symbol per endpoint for cardinality**: crow's foot on the "many" side; on the "one" side, a bar (`│`) if the FK is `not null`, or a circle (`○`) if it is nullable.
- **PK** (🔑) and **FK** (🔗) icons, **`NN`** badge for `not null` columns.
- Per-table header color (text adjusts to white or dark depending on the background).

### Canvas navigation

- **Pan** (drag the empty space), **zoom** (mouse wheel), `+` / `−` / `⊡` (fit) buttons.
- **Resizable** canvas (width and height).
- Table positions, zoom/pan and canvas size are **persisted inside the block** and restored when you reopen the note.

### Interactive editing (from the diagram)

Everything is saved back to the dbml block:

- **Table header** (click the node header) → menu:
  - Rename table… (also updates references).
  - Pick color… / Remove color.
  - Delete table… (with confirmation dialog; removes the table and the relationships that reference it).
- **Column row** (click a column) → menu:
  - Rename column… (updates `table.col` references).
  - Change type…
- **Connection / relationship** (click the line):
  - First click: **selects** it and shows the route vertices.
  - Second click: menu with the **relationship type (cardinality)** — One to many, Many to one, One to one, Many to many (the current one is checked) —, "Reset route" (if hand-edited) and "Deselect".
- **Route vertices** (with the connection selected):
  - Add: tap/drag the `+` handle in the middle of a segment.
  - Move: drag a vertex (the line re-orthogonalizes itself to 90°).
  - Delete: **right-click** on a vertex → "Delete vertex"; if it was the last one, the route returns to automatic mode.

### Language

The interface (menus, dialogs and notices) is available in **English** (default) and **Spanish**. Switch it under **Settings → Community plugins → DBML ER Diagrams → Language**.

---

## Usage

Insert a code block with the `dbml` language:

````markdown
```dbml
// height: 600

Table contract {
  contract_id   int          [pk]
  contract_name varchar(120) [not null]
  client_id     int          [not null]
  status        varchar(20)
}

Table client {
  client_id int          [pk]
  name      varchar(100) [not null]
}

Ref: contract.client_id > client.client_id
```
````

### Supported syntax

- `Table name { ... }` (and the short form `name { ... }`).
- Columns: `name type [pk, not null, note: '...', ref: > other.col]`.
- Relationships: a `Ref: a.col > b.col` line, inline `ref: > b.col`, or the direct form `a.col <> b.col`.
- Cardinality operators: `>` (many→one), `<` (one→many), `<>` (many↔many), `-` (one↔one).
- Per-table header color: `Table name [headercolor: #2E7D32] { ... }`.
- Table and column notes (`Note: '...'`, `note: '...'`).
- Optional `// height: N` directive (canvas height in px).
- `//` comments.
- **(fork)** `@include <path>` — expands another `.dbml` file's content in place before parsing. Accepts a bare directive or `// @include <path>`. Path resolves like an Obsidian link (relative to the current note, aware of the attachments folder), falling back to a vault-absolute or note-relative path.

> A deliberate subset of DBML, enough for controlled schemas. It does not yet include enums, table groups or composite keys.

### Layout annotations (managed by the plugin)

The plugin stores the visual state as comments inside the block; you don't need to edit them by hand:

- `// @pos <table> <x> <y>` — position of a moved table.
- `// @view <x> <y> <zoom>` — pan and zoom.
- `// @size <w> <h>` — canvas size.
- `// @edge <from> <fromCol> <to> <toCol> <x1> <y1> …` — vertices of a hand-edited route.

---

## Generate the DBML automatically (`sql-to-dbml` skill)

So you don't have to write the DBML by hand there is a Claude Code skill, **`sql-to-dbml`**, that converts SQL `CREATE TABLE` scripts (generic ANSI) — or tables you define during the conversation — into DBML compatible with this plugin (it degrades to what the plugin draws, never emitting syntax it can't understand).

- Repository: <https://github.com/wrojasa/skill-sql-to-dbml>
- Typical triggers: "convert this CREATE TABLE to dbml", "generate the dbml for these tables", "build the ERD in dbml", "add this table to the dbml", "update the dbml with…".

Paste the resulting block into a note inside ` ```dbml ` and the plugin renders it.

---

## Installation

### Manual

1. Download `main.js`, `manifest.json` and `styles.css` from the latest release.
2. Copy the three files to `<vault>/.obsidian/plugins/dbml-erd/` (or `dbml-erd-pacheco/` for this fork — the folder name doesn't need to match the plugin ID, but keeping them aligned avoids confusion if you ever run both).
3. Enable the plugin under **Settings → Community plugins**.

---

## Development

```bash
npm install
npm run dev     # build with inline sourcemaps
npm run build   # minified production build
```

Code structure:

- `src/main.ts` — plugin, block rendering and the `Diagram` class (SVG, interaction, persistence).
- `src/parser.ts` — DBML parser (subset) and block mutators (rename, types, cardinality, delete).
- `src/layout.ts` — layout with elkjs and geometry constants.
- `src/i18n.ts` — interface strings (English/Spanish) and the `t()` lookup.
- `styles.css` — styles integrated with Obsidian's theme variables.

## Release

Releases are produced with GitHub Actions (`.github/workflows/release.yml`).
To publish a new version: bump `version` in `manifest.json` and `package.json`,
add the entry to `versions.json` and `CHANGELOG.md`, create a tag with that exact
number (no `v` prefix) and push it:

```bash
# use the exact number from the manifest, without the v prefix
git tag 0.1.19
git push origin 0.1.19
```

The workflow compiles and attaches `main.js`, `manifest.json` and `styles.css` to the release.

## License

MIT © 2026 Wilmar Rojas Avendaño
MIT © 2026 Pedro Fonseca (modifications)