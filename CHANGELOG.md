# Changelog

All notable changes to this project are documented here. The project follows [Semantic Versioning](https://semver.org/);
the API, operations, events and error codes described in the README are the 1.x contract.

## 1.1.0

Added (all additive; data format, operations, validation, outline / Mermaid output and events are unchanged):
- Status icons: `render` (your element, once per status per draw), `image` (data:, https:, http:, blob:, relative URLs),
  `icon` `{viewBox, nodes, stroke}` in the Lucide `IconNode` format (whitelisted SVG geometry, 64 nodes, 8 KiB per `d`),
  `path` sugar, then `shape` / `symbol` / dot. The export skips `render` and non-`data:` images.
- `strike: true` on any status (the default `superseded` has it).
- Each used icon / image is one `<symbol>` in `<defs>`, drawn per node with `<use>` (map, outline, export); ids get a
  per-component prefix and never contain the status key.
- Named themes: `themes: {name: {base, tokens}}` (built-in `light` / `dark`, overridable), `theme` and `mm.setTheme(name |
  null | {base, tokens})` (`{ok}` or `bad_theme`), `getState().theme`. Tokens become `--mm-<token>` on the component.
- `mm.setStatusStyle(key, style)` for an existing status, keeping viewport, collapse and selection.
- `actions[].icon` accepts an icon object.
- `statusIcon(statusKey, statuses, theme)`: the export icon as a standalone `<svg>` string.
- devDependency lucide 1.76.0 (ISC) for tests and the demo; the library never imports it.

Fixed:
- A host `symbol` on a default status key was ignored (the inherited `shape` won). An entry that sets any icon field now
  replaces every inherited icon field; `label`, `color` and `strike` still inherit.
- A raw `var(...)` status colour leaked into the SVG export. Exported files now hold only colour syntax (status colours
  and theme tokens): `export("svg")` resolves `var()` / `color-mix()` in the page; `toSVG` falls back (token: default
  palette, status colour: grey), so no `var(` and no external `url(` reach a file.
- `toSVG(json, {idPrefix})` and `export("svg", {idPrefix})`; component id prefixes are unique per page, also across two
  copies of the library.
- Outline: drag-to-move in `edit` mode was never wired (map only); a row dragged onto another row now emits
  `intent {op: "move"}` with the map's rules. The ⋯ button sits beside the row's content instead of at the far edge of
  the view. A press on one row released on another (a text drag) no longer selects their common ancestor row.

## 1.0.2

- Tests only, no runtime change. The repository font test also reads the `font:` shorthand, `fontFamily =` and canvas
  `.font =` assignments, and fails on any common font name left in `src/` outside the two system lists.

## 1.0.1

- The default font stacks use system fonts only: `-apple-system, BlinkMacSystemFont, system-ui, "Helvetica Neue", sans-serif` and
  `ui-monospace, "SF Mono", Menlo, monospace` (`--mm-font` / `--mm-mono` defaults and the exported SVG). A repository test keeps it so.

## 1.0.0

First release.

- `createMindmap(el, options)`: three views (both sides, tree to the right, outline), three modes (`view`, `select`,
  `edit`), floating search, layout and zoom tools, focus on a branch, cross links, collapse with hidden counts, node menu
  actions with optional text icons, status filter (`filter`, `setFilter`, outline `filterOnly`), `badge` callback,
  replaceable `strings` and `statuses`, `focusSearch()`, CSS variables `--mm-*` (set on the component or any ancestor)
  with a dark palette.
- Data in and out: `setData`, atomic `apply`, `getData`, `getNode`, `getPath`, `find`, `getState`, `export` (`json`,
  `outline`, `mermaid`, `svg`).
- Events: interaction events only from user input; `invalid` and `error` for every caller.
- Pure functions for any JavaScript engine (`simple-mindmap/core`): `validate` with fixed error codes (link ends must be
  explicit node ids), `applyOps` (never throws; field errors name the op),
  `toOutline`, `toMermaid`, `fromOutline`, `pathOf`.
- Browser-only functions that measure text: `layout`, `toSVG`.
- The 1.0 sample data set in `test/fixtures/v1/`: every 1.x release must accept it.
